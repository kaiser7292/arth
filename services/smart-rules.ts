/**
 * v15.2.0 — Smart rules. Redesigned in migration 053 to a dynamic
 * conditions/actions model (was: fixed match_X / action_X columns).
 *
 * User-defined rules that auto-apply category / payment mode / tags / flags
 * to new expenses based on a set of conditions over merchant, description,
 * amount, account, payment mode, category, or raw SMS body.
 *
 * Design:
 *   - Rules are stored in `smart_rules` (migration 017, reshaped in 053).
 *   - `conditions` / `actions` are JSON arrays persisted as TEXT columns.
 *   - `match_mode` controls how conditions combine: 'all' (AND) or 'any' (OR).
 *   - A rule with zero conditions never matches (safety) — CRUD rejects this.
 *   - `expenses.applied_rule_id` stamps which rule fired (plain column).
 *   - Evaluation is a pure function (`evaluateRule`) so it's unit-testable
 *     without a DB.
 *   - Actions apply in the order they're defined; later actions of the same
 *     type win. Any existing value on the incoming expense takes precedence
 *     (rule doesn't stomp user-set fields) — enforced by the caller, same
 *     as before.
 *   - Priority ascending; first match wins; tiebreak by created_at ASC.
 *   - Soft-deleted (deleted_at) like the rest of the app; deleteRule() never
 *     hard-deletes.
 */

import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { bumpDataVersion } from "@/services/settings";
import { getFlag } from "@/services/feature-flags";
import { logger } from "@/utils/logger";
import { DEFAULT_USER_ID } from "@/constants/app";
import { splitExistingExpense } from "@/services/expense-splits";
import type { SplitMode } from "@/services/expense-types";

// ─── Types ───

export type ConditionField =
  | "merchant"
  | "description"
  | "amount"
  | "account_id"
  | "payment_mode"
  | "category_id"
  | "sms_body";

export type ConditionOperator =
  | "equals"
  | "not_equals"
  | "is_empty"
  | "is_not_empty"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "regex"
  | "greater_than"
  | "less_than"
  | "between";

/** Which operators make sense for which field — drives the UI's operator picker. */
export const OPERATORS_BY_FIELD: Record<ConditionField, ConditionOperator[]> = {
  merchant: ["contains", "not_contains", "starts_with", "ends_with", "regex", "equals", "not_equals", "is_empty", "is_not_empty"],
  description: ["contains", "not_contains", "starts_with", "ends_with", "regex", "equals", "not_equals", "is_empty", "is_not_empty"],
  sms_body: ["contains", "not_contains", "starts_with", "ends_with", "regex", "is_empty", "is_not_empty"],
  amount: ["equals", "not_equals", "greater_than", "less_than", "between"],
  account_id: ["equals", "not_equals", "is_empty", "is_not_empty"],
  payment_mode: ["equals", "not_equals", "is_empty", "is_not_empty"],
  category_id: ["equals", "not_equals", "is_empty", "is_not_empty"],
};

/** UI label for each condition field — shared by the editor and list screens. */
export const FIELD_LABELS: Record<ConditionField, string> = {
  merchant: "Merchant",
  description: "Description",
  amount: "Amount",
  account_id: "Account",
  payment_mode: "Payment mode",
  category_id: "Category",
  sms_body: "SMS body",
};

/** UI label for each operator — shared by the editor and list screens. */
export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: "equals",
  not_equals: "doesn't equal",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  contains: "contains",
  not_contains: "doesn't contain",
  starts_with: "starts with",
  ends_with: "ends with",
  regex: "matches regex",
  greater_than: "is at least",
  less_than: "is at most",
  between: "is between",
};

export interface RuleCondition {
  field: ConditionField;
  operator: ConditionOperator;
  /** null for is_empty/is_not_empty. A [min, max] tuple for between. */
  value: string | number | [number, number] | null;
}

export type ActionType =
  | "category"
  | "payment_mode"
  | "set_description"
  | "tags"
  | "is_right_spend"
  | "mark_auto"
  | "split_with_person";

export interface RuleAction {
  type: ActionType;
  category_id?: string;
  payment_mode?: string;
  description_template?: string;
  tag_ids?: string[];
  is_right_spend?: boolean;
  person_id?: string;
  split_mode?: string;
  paid_by?: string;
  split_percentage?: number;
  split_exact_amount?: number;
}

export interface SmartRule {
  id: string;
  user_id: string;
  name: string;
  priority: number;
  is_active: number;
  match_mode: "all" | "any";
  conditions: RuleCondition[];
  actions: RuleAction[];

  /** v17.2.0 — if set, post-create hook creates an expense_investment_links row. */
  action_link_to_investment_bucket_id: string | null;

  apply_count: number;
  last_applied_at: string | null;
  /** 1 = rule was created or edited since last retroactive apply; 0 = up-to-date */
  pending_retroactive: number;
  deleted_at: string | null;

  created_at: string;
  updated_at: string;
}

export interface CreateSmartRuleInput {
  name: string;
  priority?: number;
  is_active?: boolean;
  match_mode?: "all" | "any";
  conditions: RuleCondition[];
  actions: RuleAction[];
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
  /** Pre-alias SMS merchant name — fallback for positive string conditions when merchant doesn't match. */
  raw_merchant?: string | null;
  account_id: string | null;
  payment_mode_id: string | null;
  sms_body?: string | null;
  description?: string | null;
  category_id?: string | null;
}

export interface RuleApplication {
  rule: SmartRule;
  category_id: string | null;
  payment_mode: string | null;
  description: string | null;
  tag_ids: string[];
  is_right_spend: number | null;
  mark_auto: boolean;
  split_person_id: string | null;
  split_mode: string | null;
  split_paid_by: string | null;
  split_percentage: number | null;
  split_exact_amount: number | null;
}

// ─── Raw DB row (conditions/actions still JSON text) ───

interface SmartRuleRow {
  id: string;
  user_id: string;
  name: string;
  priority: number;
  is_active: number;
  match_mode: string;
  conditions: string;
  actions: string;
  action_link_to_investment_bucket_id: string | null;
  apply_count: number;
  last_applied_at: string | null;
  pending_retroactive: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

function safeParseConditions(raw: string | null | undefined): RuleCondition[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RuleCondition[]) : [];
  } catch {
    return [];
  }
}

function safeParseActions(raw: string | null | undefined): RuleAction[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RuleAction[]) : [];
  } catch {
    return [];
  }
}

function fromRow(row: SmartRuleRow): SmartRule {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    priority: row.priority,
    is_active: row.is_active,
    match_mode: row.match_mode === "any" ? "any" : "all",
    conditions: safeParseConditions(row.conditions),
    actions: safeParseActions(row.actions),
    action_link_to_investment_bucket_id: row.action_link_to_investment_bucket_id,
    apply_count: row.apply_count,
    last_applied_at: row.last_applied_at,
    pending_retroactive: row.pending_retroactive ?? 1,
    deleted_at: row.deleted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── Pure evaluator ───

function getFieldValue(field: ConditionField, target: EvaluationTarget): string | number | null {
  switch (field) {
    case "merchant":
      return target.merchant;
    case "description":
      return target.description ?? null;
    case "amount":
      return target.amount;
    case "account_id":
      return target.account_id;
    case "payment_mode":
      return target.payment_mode_id;
    case "category_id":
      return target.category_id ?? null;
    case "sms_body":
      return target.sms_body ?? null;
  }
}

function isEmptyValue(v: string | number | null): boolean {
  return v === null || v === undefined || v === "";
}

/** Evaluate one condition operator against a single resolved field value. */
function evaluateSingleValue(
  operator: ConditionOperator,
  value: RuleCondition["value"],
  fieldValue: string | number | null,
): boolean {
  switch (operator) {
    case "is_empty":
      return isEmptyValue(fieldValue);
    case "is_not_empty":
      return !isEmptyValue(fieldValue);
    case "equals":
      return String(fieldValue ?? "").toLowerCase() === String(value ?? "").toLowerCase();
    case "not_equals":
      return String(fieldValue ?? "").toLowerCase() !== String(value ?? "").toLowerCase();
    case "contains":
      return typeof fieldValue === "string" && typeof value === "string"
        ? fieldValue.toLowerCase().includes(value.toLowerCase())
        : false;
    case "not_contains":
      return typeof fieldValue === "string" && typeof value === "string"
        ? !fieldValue.toLowerCase().includes(value.toLowerCase())
        : true;
    case "starts_with":
      return typeof fieldValue === "string" && typeof value === "string"
        ? fieldValue.toLowerCase().startsWith(value.toLowerCase())
        : false;
    case "ends_with":
      return typeof fieldValue === "string" && typeof value === "string"
        ? fieldValue.toLowerCase().endsWith(value.toLowerCase())
        : false;
    case "regex": {
      if (typeof value !== "string") return false;
      try {
        return new RegExp(value, "i").test(String(fieldValue ?? ""));
      } catch {
        // Invalid regex → condition never matches (caller should flag this at CRUD)
        return false;
      }
    }
    case "greater_than": // inclusive ≥ (persisted string — do not rename; UI label is "is at least")
      return typeof fieldValue === "number" && typeof value === "number"
        ? fieldValue >= value
        : false;
    case "less_than": // inclusive ≤ (persisted string — do not rename; UI label is "is at most")
      return typeof fieldValue === "number" && typeof value === "number"
        ? fieldValue <= value
        : false;
    case "between": {
      if (typeof fieldValue !== "number" || !Array.isArray(value)) return false;
      const [min, max] = value;
      return fieldValue >= min && fieldValue <= max;
    }
  }
}

// Positive-string operators where a raw_merchant fallback is safe: when the
// alias name doesn't match, also try the original SMS name so rules survive
// alias remapping. NOT-operators are excluded — they must not flip to true
// just because the alias doesn't contain a term.
const POSITIVE_STRING_OPERATORS = new Set<ConditionOperator>([
  "contains", "starts_with", "ends_with", "regex", "equals",
]);

function evaluateCondition(condition: RuleCondition, target: EvaluationTarget): boolean {
  const fieldValue = getFieldValue(condition.field, target);
  const result = evaluateSingleValue(condition.operator, condition.value, fieldValue);

  if (
    !result &&
    condition.field === "merchant" &&
    POSITIVE_STRING_OPERATORS.has(condition.operator) &&
    target.raw_merchant != null &&
    target.raw_merchant !== target.merchant
  ) {
    return evaluateSingleValue(condition.operator, condition.value, target.raw_merchant);
  }

  return result;
}

/**
 * Does this rule match the target? 'all' = every condition must pass
 * (AND), 'any' = at least one must pass (OR). A rule with zero conditions
 * returns false (safety) — CRUD rejects creating one.
 */
export function evaluateRule(rule: SmartRule, target: EvaluationTarget): boolean {
  if (!rule.is_active) return false;
  if (rule.conditions.length === 0) return false;

  return rule.match_mode === "any"
    ? rule.conditions.some((c) => evaluateCondition(c, target))
    : rule.conditions.every((c) => evaluateCondition(c, target));
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
 * Return ALL matching rules for the target (in priority order).
 */
export function findAllMatches(
  rules: SmartRule[],
  target: EvaluationTarget,
): SmartRule[] {
  return rules.filter((r) => evaluateRule(r, target));
}

/**
 * Convert a matched rule into a RuleApplication the caller can project onto
 * its expense record. Later actions of the same type win.
 */
export function materialize(rule: SmartRule): RuleApplication {
  let category_id: string | null = null;
  let payment_mode: string | null = null;
  let description: string | null = null;
  let tag_ids: string[] = [];
  let is_right_spend: number | null = null;
  let mark_auto = false;
  let split_person_id: string | null = null;
  let split_mode: string | null = null;
  let split_paid_by: string | null = null;
  let split_percentage: number | null = null;
  let split_exact_amount: number | null = null;

  for (const action of rule.actions) {
    switch (action.type) {
      case "category":
        if (action.category_id) category_id = action.category_id;
        break;
      case "payment_mode":
        if (action.payment_mode) payment_mode = action.payment_mode;
        break;
      case "set_description":
        if (action.description_template) description = action.description_template;
        break;
      case "tags":
        if (action.tag_ids && action.tag_ids.length > 0) tag_ids = action.tag_ids;
        break;
      case "is_right_spend":
        if (action.is_right_spend !== undefined) is_right_spend = action.is_right_spend ? 1 : 0;
        break;
      case "mark_auto":
        mark_auto = true;
        break;
      case "split_with_person":
        if (action.person_id) {
          split_person_id = action.person_id;
          split_mode = action.split_mode ?? null;
          split_paid_by = action.paid_by ?? null;
          split_percentage = action.split_percentage ?? null;
          split_exact_amount = action.split_exact_amount ?? null;
        }
        break;
    }
  }

  return { rule, category_id, payment_mode, description, tag_ids, is_right_spend, mark_auto, split_person_id, split_mode, split_paid_by, split_percentage, split_exact_amount };
}

// ─── DB-backed operations ───

/**
 * Fetch active rules in evaluation order.
 */
export async function getActiveRules(): Promise<SmartRule[]> {
  if (!getFlag("v15_smart_rules")) return [];
  const db = getDatabase();
  const rows = await db.getAllAsync<SmartRuleRow>(
    `SELECT * FROM smart_rules
     WHERE is_active = 1 AND deleted_at IS NULL
     ORDER BY priority ASC, created_at ASC;`,
  );
  return rows.map(fromRow);
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
 * High-level: evaluate ALL active rules against a target and return a merged
 * application (later priority rules win per-field; tags accumulate) plus the
 * full list of matched rule IDs. Returns null when no rules match.
 */
export async function applyAllRules(
  target: EvaluationTarget,
): Promise<{ application: RuleApplication; ruleIds: string[] } | null> {
  if (!getFlag("v15_smart_rules")) return null;
  try {
    const rules = await getActiveRules();
    const matches = findAllMatches(rules, target);
    if (matches.length === 0) return null;

    // Merge: rules are in priority ASC order; later entries win per-field.
    let category_id: string | null = null;
    let payment_mode: string | null = null;
    let description: string | null = null;
    let tag_ids: string[] = [];
    let is_right_spend: number | null = null;
    let mark_auto = false;
    let split_person_id: string | null = null;
    let split_mode: string | null = null;
    let split_paid_by: string | null = null;
    let split_percentage: number | null = null;
    let split_exact_amount: number | null = null;
    let primaryRule = matches[0];

    for (const rule of matches) {
      const app = materialize(rule);
      if (app.category_id !== null) category_id = app.category_id;
      if (app.payment_mode !== null) payment_mode = app.payment_mode;
      if (app.description !== null) description = app.description;
      if (app.tag_ids.length > 0) {
        const tagSet = new Set([...tag_ids, ...app.tag_ids]);
        tag_ids = Array.from(tagSet);
      }
      if (app.is_right_spend !== null) is_right_spend = app.is_right_spend;
      if (app.mark_auto) mark_auto = true;
      if (app.split_person_id !== null) {
        split_person_id = app.split_person_id;
        split_mode = app.split_mode;
        split_paid_by = app.split_paid_by;
        split_percentage = app.split_percentage;
        split_exact_amount = app.split_exact_amount;
        primaryRule = rule;
      }
    }

    const application: RuleApplication = {
      rule: primaryRule,
      category_id,
      payment_mode,
      description,
      tag_ids,
      is_right_spend,
      mark_auto,
      split_person_id,
      split_mode,
      split_paid_by,
      split_percentage,
      split_exact_amount,
    };

    return { application, ruleIds: matches.map((r) => r.id) };
  } catch (e) {
    logger.warn("applyAllRules failed (non-fatal):", e);
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
  const rows = await db.getAllAsync<SmartRuleRow>(
    `SELECT * FROM smart_rules
     WHERE deleted_at IS NULL
     ORDER BY is_active DESC, priority ASC, created_at ASC;`,
  );
  return rows.map(fromRow);
}

export async function getRule(id: string): Promise<SmartRule | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<SmartRuleRow>(
    `SELECT * FROM smart_rules WHERE id = ? AND deleted_at IS NULL;`,
    id,
  );
  return row ? fromRow(row) : null;
}

export async function createRule(input: CreateSmartRuleInput): Promise<string> {
  assertValidInput(input);
  const db = getDatabase();
  const id = generateUUID();
  await db.runAsync(
    `INSERT INTO smart_rules (
       id, user_id, name, priority, is_active,
       match_mode, conditions, actions,
       action_link_to_investment_bucket_id, pending_retroactive
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1);`,
    id,
    DEFAULT_USER_ID,
    input.name.trim(),
    input.priority ?? 100,
    input.is_active === false ? 0 : 1,
    input.match_mode ?? "all",
    JSON.stringify(input.conditions),
    JSON.stringify(input.actions),
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
    match_mode: input.match_mode ?? existing.match_mode,
    conditions: input.conditions ?? existing.conditions,
    actions: input.actions ?? existing.actions,
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
       match_mode = ?, conditions = ?, actions = ?,
       action_link_to_investment_bucket_id = ?,
       pending_retroactive = 1,
       updated_at = datetime('now')
     WHERE id = ?;`,
    merged.name.trim(),
    merged.priority ?? 100,
    merged.is_active === false ? 0 : 1,
    merged.match_mode ?? "all",
    JSON.stringify(merged.conditions),
    JSON.stringify(merged.actions),
    merged.action_link_to_investment_bucket_id ?? null,
    id,
  );
  await bumpDataVersion();
}

/** Soft-delete, matching the rest of the app — never hard-deletes. */
export async function deleteRule(id: string): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE expenses SET applied_rule_id = NULL WHERE applied_rule_id = ?;`,
      id,
    );
    await db.runAsync(
      `UPDATE smart_rules SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?;`,
      id,
    );
  });
  await bumpDataVersion();
}

export async function listDeletedRules(): Promise<SmartRule[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<SmartRuleRow>(
    `SELECT * FROM smart_rules WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC;`,
  );
  return rows.map(fromRow);
}

export async function restoreRule(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE smart_rules SET deleted_at = NULL, is_active = 1, updated_at = datetime('now') WHERE id = ?;`,
    id,
  );
  await bumpDataVersion();
}

export async function restoreAllRules(): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE smart_rules SET deleted_at = NULL, is_active = 1, updated_at = datetime('now') WHERE deleted_at IS NOT NULL;`,
  );
  await bumpDataVersion();
}

export async function hardDeleteRule(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(`DELETE FROM smart_rules WHERE id = ?;`, id);
  await bumpDataVersion();
}

export async function purgeDeletedRules(): Promise<void> {
  const db = getDatabase();
  await db.runAsync(`DELETE FROM smart_rules WHERE deleted_at IS NOT NULL;`);
  await bumpDataVersion();
}

// ─── Validation ───

function assertValidInput(input: CreateSmartRuleInput): void {
  if (!input.name || input.name.trim().length === 0) {
    throw new Error("Rule name is required");
  }
  if (!input.conditions || input.conditions.length === 0) {
    throw new Error("Rule must have at least one condition");
  }
  if (!input.actions || input.actions.length === 0) {
    throw new Error("Rule must have at least one action");
  }
  for (const condition of input.conditions) {
    if (condition.operator === "regex" && typeof condition.value === "string") {
      try {
        new RegExp(condition.value, "i");
      } catch {
        throw new Error(`Invalid regex for ${condition.field}`);
      }
    }
    if (
      condition.operator === "between" &&
      (!Array.isArray(condition.value) || condition.value[0] > condition.value[1])
    ) {
      throw new Error("Between range's first value must be ≤ the second");
    }
  }
}

// ─── Retroactive apply ───

export interface RetroactiveScope {
  ruleId: string;
  /** Fallback window when startDate is not provided. Defaults to 90. */
  sinceDaysAgo?: number;
  /** Explicit start date (YYYY-MM-DD, inclusive). Takes priority over sinceDaysAgo. */
  startDate?: string | null;
  /** Explicit end date (YYYY-MM-DD, inclusive). No upper bound if omitted. */
  endDate?: string | null;
  /** Restrict to these account IDs. Empty / null = all accounts. */
  accountIds?: string[] | null;
  overwriteExisting: boolean;
}

export interface RetroactivePreview {
  matching: number;
  wouldOverwrite: number;
  wouldSkip: number;
}

type RetroactiveCandidate = {
  id: string;
  amount: number;
  merchant_name: string | null;
  raw_merchant_name: string | null;
  description: string | null;
  account_id: string | null;
  payment_mode_id: string | null;
  category_id: string | null;
  raw_source_text: string | null;
  status: string | null;
  split_hisaab_entry_id: string | null;
  is_right_spend: number | null;
};

async function fetchRetroactiveCandidates(
  scope: Pick<RetroactiveScope, "startDate" | "endDate" | "accountIds" | "sinceDaysAgo">,
): Promise<RetroactiveCandidate[]> {
  const db = getDatabase();
  const conds: string[] = ["deleted_at IS NULL", "nature = 'realized'"];
  const params: (string | number)[] = [];

  if (scope.startDate) {
    conds.push("date >= ?");
    params.push(scope.startDate);
  } else {
    const days = scope.sinceDaysAgo ?? 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    conds.push("date >= ?");
    params.push(cutoff.toISOString().slice(0, 10));
  }

  if (scope.endDate) {
    conds.push("date <= ?");
    params.push(scope.endDate);
  }

  if (scope.accountIds && scope.accountIds.length > 0) {
    conds.push(`account_id IN (${scope.accountIds.map(() => "?").join(",")})`);
    params.push(...scope.accountIds);
  }

  return db.getAllAsync<RetroactiveCandidate>(
    `SELECT id, amount, merchant_name, raw_merchant_name, description, account_id, payment_mode_id, category_id, raw_source_text, status, split_hisaab_entry_id, is_right_spend
     FROM expenses
     WHERE ${conds.join(" AND ")};`,
    params,
  );
}

function candidateToTarget(e: RetroactiveCandidate): EvaluationTarget {
  return {
    amount: e.amount,
    merchant: e.merchant_name,
    raw_merchant: e.raw_merchant_name,
    description: e.description,
    account_id: e.account_id,
    payment_mode_id: e.payment_mode_id,
    category_id: e.category_id,
    sms_body: e.raw_source_text,
  };
}

/**
 * Returns true when every field the rule would set is already populated on the
 * candidate — meaning "don't override" mode has nothing to contribute.
 */
function hasNothingToAdd(app: RuleApplication, e: RetroactiveCandidate): boolean {
  if (app.category_id !== null && e.category_id === null) return false;
  if (app.payment_mode !== null && e.payment_mode_id === null) return false;
  if (app.description !== null && e.description === null) return false;
  if (app.is_right_spend !== null && e.is_right_spend === null) return false;
  if (app.mark_auto && e.status === "pending_review") return false;
  if (app.split_person_id !== null && e.split_hisaab_entry_id === null) return false;
  if (app.tag_ids.length > 0) return false;
  return true;
}

/**
 * Preview how many past expenses a rule would affect. Does not write.
 */
export async function previewRetroactiveApply(
  scope: RetroactiveScope,
): Promise<RetroactivePreview> {
  const rule = await getRule(scope.ruleId);
  if (!rule) return { matching: 0, wouldOverwrite: 0, wouldSkip: 0 };

  const candidates = await fetchRetroactiveCandidates(scope);
  const application = materialize(rule);

  let matching = 0;
  let wouldOverwrite = 0;
  let wouldSkip = 0;

  for (const e of candidates) {
    if (!evaluateRule(rule, candidateToTarget(e))) continue;
    matching++;
    if (!scope.overwriteExisting && hasNothingToAdd(application, e)) {
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

  const candidates = await fetchRetroactiveCandidates(scope);
  const application = materialize(rule);
  let applied = 0;
  // Collect split requests to run AFTER the outer transaction — splitExistingExpense
  // opens its own withTransactionAsync and must never nest inside an outer one
  // (nesting causes "cannot rollback - no transaction is active" on the outer rollback).
  const toSplit: Array<{ expenseId: string; config: Parameters<typeof splitExistingExpense>[1] }> = [];

  await db.withTransactionAsync(async () => {
    for (const e of candidates) {
      if (!evaluateRule(rule, candidateToTarget(e))) continue;
      if (!scope.overwriteExisting && hasNothingToAdd(application, e)) continue;

      // Per-field: when not overriding, keep existing non-null values
      const nextCategory = scope.overwriteExisting
        ? (application.category_id ?? e.category_id)
        : (e.category_id ?? application.category_id);
      const nextPaymentMode = scope.overwriteExisting
        ? (application.payment_mode ?? e.payment_mode_id)
        : (e.payment_mode_id ?? application.payment_mode);
      const nextDescription = scope.overwriteExisting
        ? (application.description ?? e.description)
        : (e.description ?? application.description);
      const nextIsRightSpend = scope.overwriteExisting
        ? (application.is_right_spend ?? e.is_right_spend)
        : (e.is_right_spend ?? application.is_right_spend);

      await db.runAsync(
        `UPDATE expenses SET
           category_id = ?,
           payment_mode_id = ?,
           description = ?,
           is_right_spend = ?,
           applied_rule_id = ?,
           updated_at = datetime('now')
         WHERE id = ?;`,
        nextCategory,
        nextPaymentMode,
        nextDescription,
        nextIsRightSpend,
        rule.id,
        e.id,
      );

      if (application.mark_auto && e.status === "pending_review") {
        await db.runAsync(
          `UPDATE expenses SET status = 'approved', updated_at = datetime('now') WHERE id = ?;`,
          e.id,
        );
      }

      if (application.split_person_id && e.split_hisaab_entry_id === null) {
        toSplit.push({
          expenseId: e.id,
          config: {
            personId: application.split_person_id,
            splitMode: (application.split_mode ?? "equal") as SplitMode,
            paidBy: application.split_paid_by ?? "me",
            ...(application.split_percentage != null ? { percentage: application.split_percentage } : {}),
            ...(application.split_exact_amount != null ? { exactAmount: application.split_exact_amount } : {}),
          },
        });
      }

      applied++;
    }
  });

  for (const { expenseId, config } of toSplit) {
    try {
      await splitExistingExpense(expenseId, config, { skipAutoApprove: true });
    } catch (splitErr) {
      logger.warn(`retroactive split failed for expense ${expenseId}`, splitErr);
    }
  }

  // Always clear the pending flag — the rule is now up-to-date with past expenses
  // regardless of whether any matched, so the user doesn't need to re-run.
  await db.runAsync(
    "UPDATE smart_rules SET pending_retroactive = 0, updated_at = datetime('now') WHERE id = ?;",
    rule.id,
  );

  if (applied > 0) {
    await stampApplication(rule.id);
    await bumpDataVersion();
  }

  return applied;
}

/**
 * Apply the actions of a single rule to a single expense, bypassing conditions.
 * Used by the "Apply rule…" feature in the expense detail screen.
 */
export async function applyRuleActionsToExpense(ruleId: string, expenseId: string): Promise<void> {
  const db = getDatabase();
  const rule = await getRule(ruleId);
  if (!rule) throw new Error("Rule not found");
  const e = await db.getFirstAsync<{
    id: string; category_id: string | null; payment_mode_id: string | null;
    description: string | null; is_right_spend: number | null;
    status: string; split_hisaab_entry_id: string | null;
  }>(
    `SELECT id, category_id, payment_mode_id, description, is_right_spend, status, split_hisaab_entry_id
     FROM expenses WHERE id = ? AND deleted_at IS NULL;`,
    expenseId,
  );
  if (!e) throw new Error("Expense not found");
  const application = materialize(rule);

  await db.runAsync(
    `UPDATE expenses SET
       category_id = COALESCE(?, category_id),
       payment_mode_id = COALESCE(?, payment_mode_id),
       description = COALESCE(?, description),
       is_right_spend = COALESCE(?, is_right_spend),
       applied_rule_id = ?,
       updated_at = datetime('now')
     WHERE id = ?;`,
    application.category_id,
    application.payment_mode,
    application.description,
    application.is_right_spend,
    ruleId,
    expenseId,
  );

  if (application.mark_auto && e.status === "pending_review") {
    await db.runAsync(
      `UPDATE expenses SET status = 'approved', updated_at = datetime('now') WHERE id = ?;`,
      expenseId,
    );
  }

  if (application.split_person_id && e.split_hisaab_entry_id === null) {
    try {
      await splitExistingExpense(expenseId, {
        personId: application.split_person_id,
        splitMode: (application.split_mode ?? "equal") as SplitMode,
        paidBy: application.split_paid_by ?? "me",
        ...(application.split_percentage != null ? { percentage: application.split_percentage } : {}),
        ...(application.split_exact_amount != null ? { exactAmount: application.split_exact_amount } : {}),
      }, { skipAutoApprove: true });
    } catch (splitErr) {
      logger.warn(`apply-rule split failed for expense ${expenseId}`, splitErr);
    }
  }

  await stampApplication(ruleId);
  await bumpDataVersion();
}

export async function duplicateRule(id: string): Promise<string> {
  const original = await getRule(id);
  if (!original) throw new Error(`Rule ${id} not found`);
  return createRule({
    name: `Copy of ${original.name}`,
    priority: original.priority,
    is_active: original.is_active === 1,
    match_mode: original.match_mode,
    conditions: original.conditions,
    actions: original.actions,
    action_link_to_investment_bucket_id: original.action_link_to_investment_bucket_id,
  });
}
