/**
 * Audit Log Service — v15.12.1 (new)
 *
 * Single union query over expenses + account_transfers + hisaab_entries with
 * a derived `actionType` for each row. The classifier looks at status +
 * deleted_at + nature + source + FK stamps (matched_forecast_id,
 * fulfills_rule_id, applied_rule_id, settlement_source) to answer:
 *   "what happened to this row, and who did it?"
 *
 * Pure read path — no writes, no cascades. Rows are fetched fresh on every
 * call (no caching); list sizes are typically < 500 for a 30-day window.
 */

import { getDatabase } from "@/database";

export type AuditSourceType = "sms" | "manual" | "excel" | "auto_detected";
export type AuditObjectType = "expense" | "credit" | "transfer" | "hisaab" | "forecast";
export type AuditActionType =
  | "created"
  | "approved"
  | "rejected"
  | "deleted"
  | "edited"
  | "marked_as_transfer"
  | "marked_as_cc_bill"
  | "marked_as_settlement"
  | "linked_to_reminder"
  | "reclassified_by_rule"
  | "refunded";

export interface AuditLogEntry {
  /** Stable UUID of the underlying row. Same id is re-emitted as different entries when it's been both approved and deleted. */
  id: string;
  objectType: AuditObjectType;
  sourceType: AuditSourceType;
  actionType: AuditActionType;
  /** YYYY-MM-DD of the record's date field (not when the action happened — we don't track that precisely across all tables). */
  date: string;
  /** updated_at or created_at of the underlying row — best approximation of "when the action ran". */
  actionTimestamp: string;
  amount: number;
  description: string;
  merchantName: string | null;
  /** Account label for display ("HDFC Savings", "ICICI Credit Card ••4532"). */
  accountLabel: string | null;
  /** Category name for display, if applicable. */
  categoryName: string | null;
  /** True if the user can navigate to this record's detail screen (false if hard-deleted or no screen). */
  navigable: boolean;
  /** For "edited" entries: what changed. */
  editDetails?: {
    editId: string;
    fieldName: string;
    fieldLabel: string;
    oldValue: string | null;
    newValue: string | null;
  };
}

export interface AuditLogFilters {
  /** Empty/undefined = no filter. Multi-select. */
  sources?: AuditSourceType[];
  objectTypes?: AuditObjectType[];
  actionTypes?: AuditActionType[];
  /** Inclusive YYYY-MM-DD date range against the `date` field. */
  fromDate?: string;
  toDate?: string;
  /** Free-text search on description + merchantName. Case-insensitive. */
  search?: string;
  /** Max rows returned. Default 500. */
  limit?: number;
}

/**
 * Classifier for expenses (and credits, forecasts, ledger_adjustments).
 * Returns up to N action rows per expense — e.g. an SMS that was approved
 * AND then deleted produces two entries.
 */
function classifyExpense(
  row: {
    id: string;
    source: string;
    status: string;
    nature: string;
    deleted_at: string | null;
    matched_forecast_id: string | null;
    fulfills_rule_id: string | null;
    applied_rule_id: string | null;
    refund_of_expense_id: string | null;
  },
): { sourceType: AuditSourceType; actions: AuditActionType[] } {
  let sourceType: AuditSourceType;
  if (row.source === "sms_auto" || row.source === "email_auto") sourceType = "sms";
  else sourceType = "manual";
  // (Excel-imported rows have source='manual' today — we can't distinguish them
  // without a new column. Treated as manual.)

  const actions: AuditActionType[] = [];

  if (row.nature === "forecast") {
    // Forecasts are lifecycle-managed differently — ignore them in base classifier;
    // the caller handles forecasts via its own pass.
    return { sourceType, actions };
  }

  // Primary action — what the user actively did with this record.
  if (row.deleted_at) {
    actions.push("deleted");
  } else if (row.status === "approved" && row.source === "sms_auto") {
    actions.push("approved");
  } else if (row.status === "approved") {
    actions.push("created");
  } else if (row.status === "rejected") {
    actions.push("rejected");
  }
  // status='pending_review' → no entry (nothing happened yet)

  // Secondary stamps (supplementary actions, not primary).
  if (row.applied_rule_id) {
    actions.push("reclassified_by_rule");
  }
  if (row.fulfills_rule_id) {
    actions.push("linked_to_reminder");
  }
  if (row.refund_of_expense_id) {
    actions.push("refunded");
  }

  return { sourceType, actions };
}

/**
 * Main query. Unions expenses + transfers + hisaab settlements + forecasts
 * into a normalized event stream. Filters applied in SQL where indexed,
 * post-hoc in JS where they span multiple tables (source + action).
 */
export async function getAuditLog(
  userId: string,
  filters: AuditLogFilters = {},
): Promise<AuditLogEntry[]> {
  const db = getDatabase();
  const limit = filters.limit ?? 500;

  const fromDate = filters.fromDate ?? "1970-01-01";
  const toDate = filters.toDate ?? "2099-12-31";

  const all: AuditLogEntry[] = [];

  // Account label lookup (used by all row types)
  const accts = await db.getAllAsync<{ id: string; label: string | null; bank: string; last4: string }>(
    `SELECT id, account_label as label, bank_name as bank, account_identifier as last4
     FROM financial_accounts WHERE user_id = ?;`,
    userId,
  );
  const acctLabelMap = new Map<string, string>();
  for (const a of accts) {
    acctLabelMap.set(a.id, a.label ?? `${a.bank} ••${a.last4}`);
  }

  // Category label lookup
  const cats = await db.getAllAsync<{ id: string; name: string }>(
    `SELECT id, name FROM categories WHERE user_id = ?;`,
    userId,
  );
  const catLabelMap = new Map<string, string>();
  for (const c of cats) catLabelMap.set(c.id, c.name);

  // Payment mode label lookup
  const pms = await db.getAllAsync<{ id: string; name: string }>(
    `SELECT id, name FROM payment_modes WHERE user_id = ?;`,
    userId,
  );
  const pmLabelMap = new Map<string, string>();
  for (const p of pms) pmLabelMap.set(p.id, p.name);

  // ─── Expenses / credits / ledger_adjustments ─────────────
  // Include soft-deleted rows so deletions appear. Forecasts are excluded
  // from this pass and picked up separately below since their lifecycle
  // (materialize → realize / dismiss) is different.
  const expRows = await db.getAllAsync<{
    id: string;
    amount: number;
    description: string | null;
    merchant_name: string | null;
    category_id: string | null;
    account_id: string | null;
    date: string;
    source: string;
    status: string;
    nature: string;
    deleted_at: string | null;
    matched_forecast_id: string | null;
    fulfills_rule_id: string | null;
    applied_rule_id: string | null;
    refund_of_expense_id: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, amount, description, merchant_name, category_id, account_id, date,
            source, status, nature, deleted_at, matched_forecast_id,
            fulfills_rule_id, applied_rule_id, refund_of_expense_id,
            created_at, updated_at
     FROM expenses
     WHERE user_id = ? AND nature IN ('realized','credit','ledger_adjustment')
       AND date >= ? AND date <= ?;`,
    userId,
    fromDate,
    toDate,
  );

  for (const r of expRows) {
    const { sourceType, actions } = classifyExpense(r);
    const objectType: AuditObjectType = r.nature === "credit" ? "credit" : "expense";
    for (const actionType of actions) {
      all.push({
        id: r.id,
        objectType,
        sourceType,
        actionType,
        date: r.date,
        actionTimestamp: r.updated_at || r.created_at,
        amount: r.amount,
        description: r.description || r.merchant_name || (objectType === "credit" ? "Credit" : "Expense"),
        merchantName: r.merchant_name,
        accountLabel: r.account_id ? acctLabelMap.get(r.account_id) ?? null : null,
        categoryName: r.category_id ? catLabelMap.get(r.category_id) ?? null : null,
        navigable: !r.deleted_at,
      });
    }
  }

  // ─── Forecasts (only when realized / dismissed) ─────────
  // A forecast that became a real expense is represented by the realized
  // row above — skip here. We just want rejected/dismissed forecasts.
  const forecastRows = await db.getAllAsync<{
    id: string;
    amount: number;
    description: string | null;
    merchant_name: string | null;
    account_id: string | null;
    due_date: string | null;
    source: string;
    status: string;
    deleted_at: string | null;
    forecast_type: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, amount, description, merchant_name, account_id, due_date,
            source, status, deleted_at, forecast_type,
            created_at, updated_at
     FROM expenses
     WHERE user_id = ? AND nature = 'forecast'
       AND status IN ('rejected') AND deleted_at IS NULL
       AND COALESCE(due_date, date(created_at)) >= ? AND COALESCE(due_date, date(created_at)) <= ?;`,
    userId,
    fromDate,
    toDate,
  );
  for (const r of forecastRows) {
    // A rejected repayment forecast = the user paid the CC bill.
    // A rejected expense forecast = the user dismissed it / marked paid externally.
    const actionType: AuditActionType = r.forecast_type === "repayment" ? "marked_as_cc_bill" : "rejected";
    all.push({
      id: r.id,
      objectType: "forecast",
      sourceType: r.source === "sms_auto" ? "sms" : "manual",
      actionType,
      date: r.due_date ?? r.created_at.slice(0, 10),
      actionTimestamp: r.updated_at || r.created_at,
      amount: r.amount,
      description: r.description || r.merchant_name || (r.forecast_type === "repayment" ? "CC bill forecast" : "Forecast"),
      merchantName: r.merchant_name,
      accountLabel: r.account_id ? acctLabelMap.get(r.account_id) ?? null : null,
      categoryName: null,
      navigable: false, // forecast rows aren't directly navigable once closed
    });
  }

  // ─── Account transfers (created + SMS-reclassified) ─────
  // A transfer with raw_source_text set came from reclassifying an SMS credit
  // or an SMS debit — the "marked as transfer" / "marked as CC bill" action.
  const trRows = await db.getAllAsync<{
    id: string;
    amount: number;
    description: string | null;
    from_account_id: string;
    to_account_id: string;
    date: string;
    source: string;
    deleted_at: string | null;
    raw_source_text: string | null;
    linked_forecast_id: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, amount, description, from_account_id, to_account_id, date,
            source, deleted_at, raw_source_text, linked_forecast_id,
            created_at, updated_at
     FROM account_transfers
     WHERE user_id = ? AND date >= ? AND date <= ?;`,
    userId,
    fromDate,
    toDate,
  );
  for (const r of trRows) {
    const toAcct = acctLabelMap.get(r.to_account_id) ?? "Unknown";
    const fromAcct = acctLabelMap.get(r.from_account_id) ?? "Unknown";
    // Classify:
    //   - SMS-reclassified + linked_forecast_id = CC bill payment (or payment-fulfilling an SMS-detected repayment forecast)
    //   - SMS-reclassified without forecast = Mark as Transfer on an SMS credit/debit
    //   - Plain manual = normal created transfer
    let actionType: AuditActionType;
    let sourceType: AuditSourceType = "manual";
    if (r.deleted_at) {
      actionType = "deleted";
    } else if (r.raw_source_text) {
      sourceType = "sms";
      actionType = r.linked_forecast_id ? "marked_as_cc_bill" : "marked_as_transfer";
    } else {
      actionType = "created";
    }
    all.push({
      id: r.id,
      objectType: "transfer",
      sourceType,
      actionType,
      date: r.date,
      actionTimestamp: r.updated_at || r.created_at,
      amount: r.amount,
      description: r.description || `${fromAcct} → ${toAcct}`,
      merchantName: null,
      accountLabel: `${fromAcct} → ${toAcct}`,
      categoryName: null,
      navigable: !r.deleted_at,
    });
  }

  // ─── Hisaab settlements (v15.12 linked-credit flow) ─────
  const hisaabRows = await db.getAllAsync<{
    id: string;
    amount: number;
    description: string | null;
    date: string;
    type: string;
    settlement_source: string | null;
    linked_expense_id: string | null;
    person_name: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT he.id, he.amount, he.description, he.date, he.type,
            he.settlement_source, he.linked_expense_id,
            hp.name as person_name,
            he.created_at, he.updated_at
     FROM hisaab_entries he
     INNER JOIN hisaab_persons hp ON hp.id = he.hisaab_person_id
     WHERE hp.owner_user_id = ? AND he.type = 'settlement'
       AND he.settlement_source = 'linked'
       AND he.date >= ? AND he.date <= ?;`,
    userId,
    fromDate,
    toDate,
  );
  for (const r of hisaabRows) {
    all.push({
      id: r.id,
      objectType: "hisaab",
      sourceType: "manual",
      actionType: "marked_as_settlement",
      date: r.date,
      actionTimestamp: r.updated_at || r.created_at,
      amount: r.amount,
      description: r.description || `Settlement from ${r.person_name}`,
      merchantName: null,
      accountLabel: r.person_name,
      categoryName: null,
      navigable: true,
    });
  }

  // ─── Edit history entries ───────────────────────────────
  const FIELD_LABELS: Record<string, string> = {
    category_id: "Category",
    payment_mode_id: "Payment Mode",
    account_id: "Account",
    merchant_name: "Merchant",
    date: "Date",
    amount: "Amount",
    description: "Description",
    is_right_spend: "Avoidability",
  };

  const editRows = await db.getAllAsync<{
    id: string;
    expense_id: string;
    field_name: string;
    old_value: string | null;
    new_value: string | null;
    edited_at: string;
  }>(
    `SELECT h.id, h.expense_id, h.field_name, h.old_value, h.new_value, h.edited_at
     FROM expense_edit_history h
     JOIN expenses e ON e.id = h.expense_id
     WHERE e.user_id = ? AND h.undone = 0
       AND date(h.edited_at) >= ? AND date(h.edited_at) <= ?
     ORDER BY h.edited_at DESC;`,
    userId, fromDate, toDate,
  );

  for (const r of editRows) {
    const exp = expRows.find((e) => e.id === r.expense_id);
    if (!exp) continue;

    // Resolve human-readable values for ID fields
    let oldDisplay = r.old_value;
    let newDisplay = r.new_value;
    if (r.field_name === "category_id") {
      oldDisplay = r.old_value ? catLabelMap.get(r.old_value) ?? r.old_value : "None";
      newDisplay = r.new_value ? catLabelMap.get(r.new_value) ?? r.new_value : "None";
    } else if (r.field_name === "payment_mode_id") {
      oldDisplay = r.old_value ? pmLabelMap.get(r.old_value) ?? r.old_value : "None";
      newDisplay = r.new_value ? pmLabelMap.get(r.new_value) ?? r.new_value : "None";
    } else if (r.field_name === "account_id") {
      oldDisplay = r.old_value ? acctLabelMap.get(r.old_value) ?? r.old_value : "None";
      newDisplay = r.new_value ? acctLabelMap.get(r.new_value) ?? r.new_value : "None";
    } else if (r.field_name === "is_right_spend") {
      oldDisplay = r.old_value === "1" ? "Unavoidable" : r.old_value === "0" ? "Avoidable" : "Not set";
      newDisplay = r.new_value === "1" ? "Unavoidable" : r.new_value === "0" ? "Avoidable" : "Not set";
    }

    all.push({
      id: `edit_${r.id}`,
      objectType: "expense",
      sourceType: exp.source === "sms_auto" ? "sms" : "manual",
      actionType: "edited",
      date: exp.date,
      actionTimestamp: r.edited_at,
      amount: exp.amount,
      description: exp.description || exp.merchant_name || "Expense",
      merchantName: exp.merchant_name,
      accountLabel: exp.account_id ? acctLabelMap.get(exp.account_id) ?? null : null,
      categoryName: exp.category_id ? catLabelMap.get(exp.category_id) ?? null : null,
      navigable: !exp.deleted_at,
      editDetails: {
        editId: r.id,
        fieldName: r.field_name,
        fieldLabel: FIELD_LABELS[r.field_name] ?? r.field_name,
        oldValue: oldDisplay,
        newValue: newDisplay,
      },
    });
  }

  // ─── Apply post-hoc filters ─────────────────────────────
  let filtered = all;

  if (filters.sources && filters.sources.length > 0) {
    const set = new Set(filters.sources);
    filtered = filtered.filter((e) => set.has(e.sourceType));
  }
  if (filters.objectTypes && filters.objectTypes.length > 0) {
    const set = new Set(filters.objectTypes);
    filtered = filtered.filter((e) => set.has(e.objectType));
  }
  if (filters.actionTypes && filters.actionTypes.length > 0) {
    const set = new Set(filters.actionTypes);
    filtered = filtered.filter((e) => set.has(e.actionType));
  }
  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    filtered = filtered.filter((e) =>
      e.description.toLowerCase().includes(q)
      || (e.merchantName?.toLowerCase() ?? "").includes(q)
      || (e.accountLabel?.toLowerCase() ?? "").includes(q),
    );
  }

  // Sort by action timestamp desc (most recent first).
  filtered.sort((a, b) => b.actionTimestamp.localeCompare(a.actionTimestamp));

  return filtered.slice(0, limit);
}

/**
 * Aggregate counts for the filter chips. Cheap — runs the same union query
 * with no filters and counts by source/action/object.
 */
export async function getAuditLogSummary(
  userId: string,
  fromDate?: string,
  toDate?: string,
): Promise<{
  total: number;
  bySource: Record<AuditSourceType, number>;
  byAction: Record<AuditActionType, number>;
  byObject: Record<AuditObjectType, number>;
}> {
  const all = await getAuditLog(userId, { fromDate, toDate, limit: 10000 });
  const bySource: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  const byObject: Record<string, number> = {};
  for (const e of all) {
    bySource[e.sourceType] = (bySource[e.sourceType] ?? 0) + 1;
    byAction[e.actionType] = (byAction[e.actionType] ?? 0) + 1;
    byObject[e.objectType] = (byObject[e.objectType] ?? 0) + 1;
  }
  return {
    total: all.length,
    bySource: bySource as Record<AuditSourceType, number>,
    byAction: byAction as Record<AuditActionType, number>,
    byObject: byObject as Record<AuditObjectType, number>,
  };
}
