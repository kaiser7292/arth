/**
 * v15.2.0 — Smart rules.
 *
 * User-defined rules that auto-apply category / payment mode / tags / flags
 * to new expenses based on matchers on merchant, amount, account, payment
 * mode, or raw SMS body.
 *
 * Design:
 *   - Rules are stored in `smart_rules` (migration 017).
 *   - `expenses.applied_rule_id` stamps which rule fired (plain column).
 *   - Evaluation is a pure function (`evaluateRule`) so it's unit-testable
 *     without a DB.
 *   - Conditions use AND semantics (ALL must match). If a rule has no
 *     conditions it's considered ALWAYS-MATCH and should be rejected at
 *     CRUD time; evaluator will treat it as no-match for safety.
 *   - Actions apply in order: category → payment_mode → tags (append) →
 *     is_right_spend → mark_auto. Any existing value on the incoming
 *     expense takes precedence (rule doesn't stomp user-set fields).
 *   - Priority ascending; first match wins; tiebreak by created_at ASC.
 */

import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { bumpDataVersion } from "@/services/settings";
import { getFlag } from "@/services/feature-flags";
import { logger } from "@/utils/logger";
import { DEFAULT_USER_ID } from "@/constants/app";

// ─── Types ───

export interface SmartRule {
  id: string;
  user_id: string;
  name: string;
  priority: number;
  is_active: number;

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
  /** v17.2.0 — if set, post-create hook creates an expense_investment_links row. */
  action_link_to_investment_bucket_id: string | null;

  apply_count: number;
  last_applied_at: string | null;

  created_at: string;
  updated_at: string;
}

export interface CreateSmartRuleInput {
  name: string;
  priority?: number;
  is_active?: boolean;
  match_merchant_contains?: string | null;
  match_merchant_regex?: string | null;
  match_min_amount?: number | null;
  match_max_amount?: number | null;
  match_account_id?: string | null;
  match_payment_mode?: string | null;
  match_sms_keyword?: string | null;
  action_category_id?: string | null;
  action_payment_mode?: string | null;
  action_tag_ids?: string[] | null;
  action_is_right_spend?: number | null;
  action_mark_auto?: boolean;
  action_link_to_investment_bucket_id?: string | null;
}

export interface UpdateSmartRuleInput extends Partial<CreateSmartRuleInput> {}

/**
 * The expense-shaped subset the evaluator needs. Intentionally a structural
 * type so both CreateExpenseInput (manual) and ParsedSMS (SMS) can be
 * adapted by callers.
 */
export interface EvaluationTarget {
  amount: number;
  merchant: string | null;
  account_id: string | null;
  payment_mode_id: string | null;
  sms_body?: string | null;
}

export interface RuleApplication {
  rule: SmartRule;
  category_id: string | null;
  payment_mode: string | null;
  tag_ids: string[];
  is_right_spend: number | null;
  mark_auto: boolean;
}

// ─── Pure evaluator ───

/**
 * Does this rule match the target? Returns true only if ALL configured
 * conditions pass. A rule with zero conditions returns false (safety).
 */
export function evaluateRule(rule: SmartRule, target: EvaluationTarget): boolean {
  if (!rule.is_active) return false;

  let anyCondition = false;

  if (rule.match_merchant_contains) {
    anyCondition = true;
    const hay = (target.merchant ?? "").toLowerCase();
    if (!hay.includes(rule.match_merchant_contains.toLowerCase())) return false;
  }

  if (rule.match_merchant_regex) {
    anyCondition = true;
    try {
      const rx = new RegExp(rule.match_merchant_regex, "i");
      if (!rx.test(target.merchant ?? "")) return false;
    } catch {
      // Invalid regex → rule never matches (caller should flag this at CRUD)
      return false;
    }
  }

  if (rule.match_min_amount !== null && rule.match_min_amount !== undefined) {
    anyCondition = true;
    if (target.amount < rule.match_min_amount) return false;
  }

  if (rule.match_max_amount !== null && rule.match_max_amount !== undefined) {
    anyCondition = true;
    if (target.amount > rule.match_max_amount) return false;
  }

  if (rule.match_account_id) {
    anyCondition = true;
    if (target.account_id !== rule.match_account_id) return false;
  }

  if (rule.match_payment_mode) {
    anyCondition = true;
    if (target.payment_mode_id !== rule.match_payment_mode) return false;
  }

  if (rule.match_sms_keyword) {
    anyCondition = true;
    const body = (target.sms_body ?? "").toLowerCase();
    if (!body.includes(rule.match_sms_keyword.toLowerCase())) return false;
  }

  return anyCondition;
}

/**
 * Given an ordered list of active rules (priority ASC, then created_at ASC),
 * return the first match for the target, or null.
 */
export function findFirstMatch(
  rules: SmartRule[],
  target: EvaluationTarget,
): SmartRule | null {
  for (const r of rules) {
    if (evaluateRule(r, target)) return r;
  }
  return null;
}

/**
 * Parse a stored tag_ids JSON column safely. Returns [] on malformed input
 * (prevents rule-edit crashes when a backup restore from a different version
 * leaves the string in an unexpected shape).
 */
function safeParseTagIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    // Malformed JSON → treat as no tags; rule detail UI can surface this.
  }
  return [];
}

/**
 * Convert a matched rule into a RuleApplication the caller can project onto
 * its expense record.
 */
export function materialize(rule: SmartRule): RuleApplication {
  return {
    rule,
    category_id: rule.action_category_id,
    payment_mode: rule.action_payment_mode,
    tag_ids: safeParseTagIds(rule.action_tag_ids),
    is_right_spend: rule.action_is_right_spend,
    mark_auto: rule.action_mark_auto === 1,
  };
}

// ─── DB-backed operations ───

/**
 * Fetch active rules in evaluation order.
 */
export async function getActiveRules(): Promise<SmartRule[]> {
  if (!getFlag("v15_smart_rules")) return [];
  const db = getDatabase();
  return db.getAllAsync<SmartRule>(
    `SELECT * FROM smart_rules
     WHERE is_active = 1
     ORDER BY priority ASC, created_at ASC;`,
  );
}

/**
 * High-level: evaluate all active rules against a target and return the
 * first-matching rule's application, or null. Use this from
 * createExpense / sms-to-expense.
 */
export async function applyRules(
  target: EvaluationTarget,
): Promise<RuleApplication | null> {
  if (!getFlag("v15_smart_rules")) return null;
  try {
    const rules = await getActiveRules();
    const hit = findFirstMatch(rules, target);
    if (!hit) return null;
    return materialize(hit);
  } catch (e) {
    logger.warn("applyRules failed (non-fatal):", e);
    return null;
  }
}

/**
 * Bump apply_count / last_applied_at after a rule successfully applied.
 * Fire-and-forget safe.
 */
export async function stampApplication(ruleId: string): Promise<void> {
  const db = getDatabase();
  try {
    await db.runAsync(
      `UPDATE smart_rules
       SET apply_count = apply_count + 1,
           last_applied_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?;`,
      ruleId,
    );
  } catch (e) {
    logger.warn(`stampApplication for ${ruleId} failed:`, e);
  }
}

// ─── CRUD ───

export async function listRules(): Promise<SmartRule[]> {
  const db = getDatabase();
  return db.getAllAsync<SmartRule>(
    `SELECT * FROM smart_rules
     ORDER BY is_active DESC, priority ASC, created_at ASC;`,
  );
}

export async function getRule(id: string): Promise<SmartRule | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<SmartRule>(
    `SELECT * FROM smart_rules WHERE id = ?;`,
    id,
  );
  return row ?? null;
}

export async function createRule(input: CreateSmartRuleInput): Promise<string> {
  assertValidInput(input);
  const db = getDatabase();
  const id = generateUUID();
  await db.runAsync(
    `INSERT INTO smart_rules (
       id, user_id, name, priority, is_active,
       match_merchant_contains, match_merchant_regex,
       match_min_amount, match_max_amount,
       match_account_id, match_payment_mode, match_sms_keyword,
       action_category_id, action_payment_mode, action_tag_ids,
       action_is_right_spend, action_mark_auto,
       action_link_to_investment_bucket_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    id,
    DEFAULT_USER_ID,
    input.name.trim(),
    input.priority ?? 100,
    input.is_active === false ? 0 : 1,
    input.match_merchant_contains?.trim() || null,
    input.match_merchant_regex?.trim() || null,
    input.match_min_amount ?? null,
    input.match_max_amount ?? null,
    input.match_account_id ?? null,
    input.match_payment_mode ?? null,
    input.match_sms_keyword?.trim() || null,
    input.action_category_id ?? null,
    input.action_payment_mode ?? null,
    input.action_tag_ids ? JSON.stringify(input.action_tag_ids) : null,
    input.action_is_right_spend ?? null,
    input.action_mark_auto ? 1 : 0,
    input.action_link_to_investment_bucket_id ?? null,
  );
  await bumpDataVersion();
  return id;
}

export async function updateRule(id: string, input: UpdateSmartRuleInput): Promise<void> {
  const existing = await getRule(id);
  if (!existing) throw new Error(`Rule ${id} not found`);

  const merged: CreateSmartRuleInput = {
    name: input.name ?? existing.name,
    priority: input.priority ?? existing.priority,
    is_active: input.is_active ?? existing.is_active === 1,
    match_merchant_contains:
      input.match_merchant_contains !== undefined
        ? input.match_merchant_contains
        : existing.match_merchant_contains,
    match_merchant_regex:
      input.match_merchant_regex !== undefined
        ? input.match_merchant_regex
        : existing.match_merchant_regex,
    match_min_amount:
      input.match_min_amount !== undefined ? input.match_min_amount : existing.match_min_amount,
    match_max_amount:
      input.match_max_amount !== undefined ? input.match_max_amount : existing.match_max_amount,
    match_account_id:
      input.match_account_id !== undefined ? input.match_account_id : existing.match_account_id,
    match_payment_mode:
      input.match_payment_mode !== undefined
        ? input.match_payment_mode
        : existing.match_payment_mode,
    match_sms_keyword:
      input.match_sms_keyword !== undefined
        ? input.match_sms_keyword
        : existing.match_sms_keyword,
    action_category_id:
      input.action_category_id !== undefined
        ? input.action_category_id
        : existing.action_category_id,
    action_payment_mode:
      input.action_payment_mode !== undefined
        ? input.action_payment_mode
        : existing.action_payment_mode,
    action_tag_ids:
      input.action_tag_ids !== undefined
        ? input.action_tag_ids
        : safeParseTagIds(existing.action_tag_ids),
    action_is_right_spend:
      input.action_is_right_spend !== undefined
        ? input.action_is_right_spend
        : existing.action_is_right_spend,
    action_mark_auto:
      input.action_mark_auto !== undefined
        ? input.action_mark_auto
        : existing.action_mark_auto === 1,
    action_link_to_investment_bucket_id:
      input.action_link_to_investment_bucket_id !== undefined
        ? input.action_link_to_investment_bucket_id
        : existing.action_link_to_investment_bucket_id,
  };

  assertValidInput(merged);

  const db = getDatabase();
  await db.runAsync(
    `UPDATE smart_rules SET
       name = ?, priority = ?, is_active = ?,
       match_merchant_contains = ?, match_merchant_regex = ?,
       match_min_amount = ?, match_max_amount = ?,
       match_account_id = ?, match_payment_mode = ?, match_sms_keyword = ?,
       action_category_id = ?, action_payment_mode = ?, action_tag_ids = ?,
       action_is_right_spend = ?, action_mark_auto = ?,
       action_link_to_investment_bucket_id = ?,
       updated_at = datetime('now')
     WHERE id = ?;`,
    merged.name.trim(),
    merged.priority ?? 100,
    merged.is_active === false ? 0 : 1,
    merged.match_merchant_contains?.trim() || null,
    merged.match_merchant_regex?.trim() || null,
    merged.match_min_amount ?? null,
    merged.match_max_amount ?? null,
    merged.match_account_id ?? null,
    merged.match_payment_mode ?? null,
    merged.match_sms_keyword?.trim() || null,
    merged.action_category_id ?? null,
    merged.action_payment_mode ?? null,
    merged.action_tag_ids ? JSON.stringify(merged.action_tag_ids) : null,
    merged.action_is_right_spend ?? null,
    merged.action_mark_auto ? 1 : 0,
    merged.action_link_to_investment_bucket_id ?? null,
    id,
  );
  await bumpDataVersion();
}

export async function deleteRule(id: string): Promise<void> {
  const db = getDatabase();
  // Clear the applied_rule_id stamp on any expense that referenced this rule.
  // We don't un-apply the categorization — that's the user's historical truth.
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE expenses SET applied_rule_id = NULL WHERE applied_rule_id = ?;`,
      id,
    );
    await db.runAsync(`DELETE FROM smart_rules WHERE id = ?;`, id);
  });
  await bumpDataVersion();
}

// ─── Validation ───

function assertValidInput(input: CreateSmartRuleInput): void {
  if (!input.name || input.name.trim().length === 0) {
    throw new Error("Rule name is required");
  }
  const hasCondition =
    !!(input.match_merchant_contains?.trim() ||
      input.match_merchant_regex?.trim() ||
      input.match_min_amount !== null && input.match_min_amount !== undefined ||
      input.match_max_amount !== null && input.match_max_amount !== undefined ||
      input.match_account_id ||
      input.match_payment_mode ||
      input.match_sms_keyword?.trim());
  if (!hasCondition) {
    throw new Error("Rule must have at least one condition");
  }
  const hasAction =
    !!(input.action_category_id ||
      input.action_payment_mode ||
      (input.action_tag_ids && input.action_tag_ids.length > 0) ||
      input.action_is_right_spend !== null && input.action_is_right_spend !== undefined ||
      input.action_mark_auto);
  if (!hasAction) {
    throw new Error("Rule must have at least one action");
  }
  if (input.match_merchant_regex?.trim()) {
    try {
      new RegExp(input.match_merchant_regex, "i");
    } catch {
      throw new Error("Merchant regex is not valid");
    }
  }
  if (
    input.match_min_amount !== null &&
    input.match_min_amount !== undefined &&
    input.match_max_amount !== null &&
    input.match_max_amount !== undefined &&
    input.match_min_amount > input.match_max_amount
  ) {
    throw new Error("Min amount must be less than or equal to max amount");
  }
}

// ─── Retroactive apply ───

export interface RetroactiveScope {
  ruleId: string;
  sinceDaysAgo: number;
  overwriteExisting: boolean;
}

export interface RetroactivePreview {
  matching: number;
  wouldOverwrite: number;
  wouldSkip: number;
}

/**
 * Preview how many past expenses a rule would affect. Does not write.
 */
export async function previewRetroactiveApply(
  scope: RetroactiveScope,
): Promise<RetroactivePreview> {
  const db = getDatabase();
  const rule = await getRule(scope.ruleId);
  if (!rule) return { matching: 0, wouldOverwrite: 0, wouldSkip: 0 };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - scope.sinceDaysAgo);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const candidates = await db.getAllAsync<{
    id: string;
    amount: number;
    merchant_name: string | null;
    account_id: string | null;
    payment_mode_id: string | null;
    category_id: string | null;
    raw_source_text: string | null;
  }>(
    `SELECT id, amount, merchant_name, account_id, payment_mode_id, category_id, raw_source_text
     FROM expenses
     WHERE deleted_at IS NULL
       AND date >= ?;`,
    cutoffIso,
  );

  let matching = 0;
  let wouldOverwrite = 0;
  let wouldSkip = 0;

  for (const e of candidates) {
    const ok = evaluateRule(rule, {
      amount: e.amount,
      merchant: e.merchant_name,
      account_id: e.account_id,
      payment_mode_id: e.payment_mode_id,
      sms_body: e.raw_source_text,
    });
    if (!ok) continue;
    matching++;
    const alreadyCategorized = e.category_id !== null;
    if (alreadyCategorized && !scope.overwriteExisting) {
      wouldSkip++;
    } else {
      wouldOverwrite++;
    }
  }

  return { matching, wouldOverwrite, wouldSkip };
}

export async function runRetroactiveApply(scope: RetroactiveScope): Promise<number> {
  const db = getDatabase();
  const rule = await getRule(scope.ruleId);
  if (!rule) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - scope.sinceDaysAgo);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const candidates = await db.getAllAsync<{
    id: string;
    amount: number;
    merchant_name: string | null;
    account_id: string | null;
    payment_mode_id: string | null;
    category_id: string | null;
    raw_source_text: string | null;
  }>(
    `SELECT id, amount, merchant_name, account_id, payment_mode_id, category_id, raw_source_text
     FROM expenses
     WHERE deleted_at IS NULL
       AND date >= ?;`,
    cutoffIso,
  );

  const application = materialize(rule);
  let applied = 0;

  await db.withTransactionAsync(async () => {
    for (const e of candidates) {
      const ok = evaluateRule(rule, {
        amount: e.amount,
        merchant: e.merchant_name,
        account_id: e.account_id,
        payment_mode_id: e.payment_mode_id,
        sms_body: e.raw_source_text,
      });
      if (!ok) continue;
      const alreadyCategorized = e.category_id !== null;
      if (alreadyCategorized && !scope.overwriteExisting) continue;

      const nextCategory = application.category_id ?? e.category_id;
      const nextPaymentMode = application.payment_mode ?? e.payment_mode_id;

      await db.runAsync(
        `UPDATE expenses SET
           category_id = ?,
           payment_mode_id = ?,
           applied_rule_id = ?,
           updated_at = datetime('now')
         WHERE id = ?;`,
        nextCategory,
        nextPaymentMode,
        rule.id,
        e.id,
      );
      applied++;
    }
  });

  if (applied > 0) {
    await stampApplication(rule.id);
    await bumpDataVersion();
  }

  return applied;
}
