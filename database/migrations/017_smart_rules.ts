import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 017: Smart rules for auto-categorizing expenses.
 *
 * Adds a `smart_rules` table + `expenses.applied_rule_id` plain column
 * (not a real FK — same pattern as recurring_expense_rules to avoid a
 * circular reference; orphan cleanup lives in cleanupData + rule delete).
 *
 * Rule evaluation:
 *   - Conditions (ALL must match — AND semantics):
 *       match_merchant_contains   case-insensitive substring
 *       match_merchant_regex      raw JS regex applied with `i` flag
 *       match_min_amount          inclusive
 *       match_max_amount          inclusive
 *       match_account_id          exact financial_account id
 *       match_payment_mode        enum slug ("upi", "credit_card", ...)
 *       match_sms_keyword         case-insensitive substring on raw SMS body
 *
 *   - Actions (at least one required):
 *       action_category_id        set expense.category_id
 *       action_payment_mode       set expense.payment_mode_id (resolved by slug at apply-time)
 *       action_tag_ids            JSON array of tag_id strings — appended to expense tags
 *       action_is_right_spend     override is_right_spend flag
 *       action_mark_auto          if 1, bypass review-queue for SMS-detected expenses
 *
 * Precedence: lower `priority` fires first; tiebreak by created_at ASC.
 * First match wins per expense; no rule re-evaluation on edit.
 */
export default {
  version: 17,
  name: "smart_rules",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS smart_rules (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 100,
        is_active INTEGER NOT NULL DEFAULT 1,

        -- Conditions
        match_merchant_contains TEXT,
        match_merchant_regex TEXT,
        match_min_amount REAL,
        match_max_amount REAL,
        match_account_id TEXT,
        match_payment_mode TEXT,
        match_sms_keyword TEXT,

        -- Actions
        action_category_id TEXT,
        action_payment_mode TEXT,
        action_tag_ids TEXT,
        action_is_right_spend INTEGER,
        action_mark_auto INTEGER NOT NULL DEFAULT 0,

        -- Stats (for list-row display; updated by apply code)
        apply_count INTEGER NOT NULL DEFAULT 0,
        last_applied_at TEXT,

        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_smart_rules_active_priority
        ON smart_rules(is_active, priority ASC, created_at ASC);
    `);

    // Add applied_rule_id to expenses (plain column, no FK, see doc above)
    const cols = (await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(expenses);",
    )) as Array<{ name: string }>;
    const hasAppliedRuleId = cols.some((c) => c.name === "applied_rule_id");
    if (!hasAppliedRuleId) {
      await db.execAsync(
        "ALTER TABLE expenses ADD COLUMN applied_rule_id TEXT;",
      );
    }
  },
};
