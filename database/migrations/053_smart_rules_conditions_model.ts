import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 053: Smart Rules — dynamic conditions model.
 *
 * Replaces the fixed match_X / action_X columns (one slot per condition type,
 * AND-only) with a flexible model:
 *   - match_mode: 'all' | 'any' — how `conditions` combine.
 *   - conditions: JSON array of { field, operator, value }, any number of
 *     rows, any field repeated.
 *   - actions: JSON array of { type, ... }, replacing the fixed
 *     action_category_id / action_payment_mode / action_tag_ids /
 *     action_is_right_spend / action_mark_auto columns.
 *   - deleted_at: soft-delete, matching the rest of the app's recycle-bin
 *     convention (rules didn't have one before).
 *
 * action_link_to_investment_bucket_id stays a dedicated column rather than
 * moving into `actions` — it drives a side-effect (creating an
 * expense_investment_links row) that's simpler to keep as a plain FK.
 *
 * Existing rows are converted in place so nobody's configured rules
 * silently vanish on upgrade. The old match_X / action_X columns are left
 * in the table (unused, harmless) rather than dropped — this project's
 * migrations are additive-only by convention.
 *
 * Idempotent via PRAGMA table_info guard.
 */
export default {
  version: 53,
  name: "smart_rules_conditions_model",
  up: async (db: SQLiteDatabase) => {
    const cols = (await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(smart_rules);",
    )) as Array<{ name: string }>;
    const hasCol = (name: string) => cols.some((c) => c.name === name);

    if (!hasCol("match_mode")) {
      await db.execAsync(
        "ALTER TABLE smart_rules ADD COLUMN match_mode TEXT NOT NULL DEFAULT 'all' CHECK(match_mode IN ('all','any'));",
      );
    }
    if (!hasCol("conditions")) {
      await db.execAsync(
        "ALTER TABLE smart_rules ADD COLUMN conditions TEXT NOT NULL DEFAULT '[]';",
      );
    }
    if (!hasCol("actions")) {
      await db.execAsync(
        "ALTER TABLE smart_rules ADD COLUMN actions TEXT NOT NULL DEFAULT '[]';",
      );
    }
    if (!hasCol("deleted_at")) {
      await db.execAsync(
        "ALTER TABLE smart_rules ADD COLUMN deleted_at TEXT DEFAULT NULL;",
      );
    }

    // Convert existing rows' fixed columns into the new JSON shape. Only
    // rows that still have empty conditions/actions need conversion — this
    // keeps the migration safe to re-run.
    type OldRow = {
      id: string;
      match_merchant_contains: string | null;
      match_merchant_regex: string | null;
      match_min_amount: number | null;
      match_max_amount: number | null;
      match_account_id: string | null;
      match_payment_mode: string | null;
      match_sms_keyword: string | null;
      action_category_id: string | null;
      action_payment_mode: string | null;
      action_tag_ids: string | null;
      action_is_right_spend: number | null;
      action_mark_auto: number;
    };
    const rows = await db.getAllAsync<OldRow>(
      `SELECT id, match_merchant_contains, match_merchant_regex, match_min_amount,
              match_max_amount, match_account_id, match_payment_mode, match_sms_keyword,
              action_category_id, action_payment_mode, action_tag_ids,
              action_is_right_spend, action_mark_auto
       FROM smart_rules
       WHERE conditions = '[]' AND actions = '[]';`,
    );

    for (const row of rows) {
      const conditions: Record<string, unknown>[] = [];
      if (row.match_merchant_contains) {
        conditions.push({ field: "merchant", operator: "contains", value: row.match_merchant_contains });
      }
      if (row.match_merchant_regex) {
        conditions.push({ field: "merchant", operator: "regex", value: row.match_merchant_regex });
      }
      if (row.match_min_amount !== null && row.match_max_amount !== null) {
        conditions.push({ field: "amount", operator: "between", value: [row.match_min_amount, row.match_max_amount] });
      } else if (row.match_min_amount !== null) {
        conditions.push({ field: "amount", operator: "greater_than", value: row.match_min_amount });
      } else if (row.match_max_amount !== null) {
        conditions.push({ field: "amount", operator: "less_than", value: row.match_max_amount });
      }
      if (row.match_account_id) {
        conditions.push({ field: "account_id", operator: "equals", value: row.match_account_id });
      }
      if (row.match_payment_mode) {
        conditions.push({ field: "payment_mode", operator: "equals", value: row.match_payment_mode });
      }
      if (row.match_sms_keyword) {
        conditions.push({ field: "sms_body", operator: "contains", value: row.match_sms_keyword });
      }

      const actions: Record<string, unknown>[] = [];
      if (row.action_category_id) {
        actions.push({ type: "category", category_id: row.action_category_id });
      }
      if (row.action_payment_mode) {
        actions.push({ type: "payment_mode", payment_mode: row.action_payment_mode });
      }
      if (row.action_tag_ids) {
        try {
          const tagIds = JSON.parse(row.action_tag_ids);
          if (Array.isArray(tagIds) && tagIds.length > 0) {
            actions.push({ type: "tags", tag_ids: tagIds });
          }
        } catch {
          // Malformed JSON on a legacy row — skip, don't fail the migration.
        }
      }
      if (row.action_is_right_spend !== null) {
        actions.push({ type: "is_right_spend", is_right_spend: row.action_is_right_spend === 1 });
      }
      if (row.action_mark_auto === 1) {
        actions.push({ type: "mark_auto" });
      }

      // Old evaluator was AND-only, so match_mode for converted rows is 'all'.
      await db.runAsync(
        "UPDATE smart_rules SET conditions = ?, actions = ?, match_mode = 'all' WHERE id = ?;",
        JSON.stringify(conditions),
        JSON.stringify(actions),
        row.id,
      );
    }
  },
};
