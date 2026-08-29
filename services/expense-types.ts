export interface Expense {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  fx_rate: number | null;
  description: string | null;
  merchant_name: string | null;
  raw_merchant_name: string | null;
  category_id: string | null;
  payment_mode_id: string | null;
  date: string;
  transaction_time: string;
  is_right_spend: number | null;
  source: "manual" | "sms_auto" | "email_auto";
  status: "approved" | "pending_review" | "rejected";
  nature: "realized" | "forecast" | "credit" | "ledger_adjustment";
  due_date: string | null;
  account_id: string | null;
  refund_of_expense_id: string | null;
  raw_source_text: string | null;
  split_original_amount: number | null;
  split_person_id: string | null;
  split_pct: number | null;
  split_hisaab_entry_id: string | null;
  /**
   * v15.13.1: the original split mode the user picked at creation time.
   * NULL for legacy pre-migration-024 rows (edit flow falls back to a
   * percentage reconstruction using split_pct for those).
   */
  split_mode: "equal" | "they_owe_full" | "i_owe_full" | "exact" | "percentage" | null;
  /**
   * v15.13.1: the user-entered exact ₹ amount when split_mode = "exact".
   * Preserved so editing total (₹1000 → ₹1200) keeps the other-person
   * share unchanged instead of scaling with the new total.
   */
  split_exact_amount: number | null;
  matched_forecast_id: string | null;
  deleted_at: string | null;
  forecast_type: "expense" | "repayment";
  paid_from_account_id: string | null;
  convenience_fee: number;
  fee_absorbed: number;
  /**
   * Shared identifier for legs of a split-tender purchase (e.g. one ₹2,000
   * purchase paid ₹1,500 on credit card + ₹500 from wallet). Null for
   * standalone expenses. Capped at 3 legs per group (enforced at service layer).
   */
  purchase_group_id: string | null;
  /**
   * Legacy from v14.6.0 when rules auto-materialized forecasts. v14.7.0
   * cleared every non-null value via migration 014 and stopped writing it.
   * Kept in the schema for backup-compat; don't read this anywhere.
   */
  recurring_rule_id: string | null;
  /**
   * When set, this realized expense fulfills one cycle of the pointed-to
   * recurring rule. Stamped by `fulfillReminder`, cleared by
   * `unfulfillReminder`. Plain stamp, not a DB-level FK, to avoid a
   * circular reference with recurring_expense_rules.source_expense_id.
   */
  fulfills_rule_id: string | null;
  /**
   * v15.2: If this expense was auto-categorized by a smart rule, this is the
   * rule id. Never re-applied on edit — the user's manual overrides always
   * win once set. Cleared on rule delete.
   */
  applied_rule_id: string | null;
  /** migration 061 — JSON-encoded array of ALL rule IDs that fired, not just the first. */
  applied_rule_ids?: string | null;
  /**
   * v15.12.1: When set to 1, this expense/credit has been reclassified as a transfer.
   * Instead of soft-deleting, we mark it to keep it visible in the UI.
   */
  reclassified_as_transfer: number | null;
  /**
   * v15.12.1: When expense is reclassified as transfer, this points to the transfer record.
   */
  linked_transfer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateExpenseInput {
  user_id: string;
  amount: number;
  description?: string;
  merchant_name?: string;
  category_id?: string;
  payment_mode_id?: string;
  date: string;
  is_right_spend?: number | null;
  currency?: string;
  nature?: "realized" | "forecast" | "credit" | "ledger_adjustment";
  transaction_time?: string | null;
  due_date?: string | null;
  account_id?: string | null;
  /** For manual refunds linked to a prior expense. */
  refund_of_expense_id?: string | null;
  /** Set when this expense is one leg of a split-tender purchase. */
  purchase_group_id?: string | null;
}

export interface UpdateExpenseInput {
  amount?: number;
  description?: string | null;
  merchant_name?: string | null;
  category_id?: string | null;
  payment_mode_id?: string | null;
  account_id?: string | null;
  date?: string;
  is_right_spend?: number | null;
  currency?: string;
}

export type SplitMode = "equal" | "they_owe_full" | "i_owe_full" | "exact" | "percentage";

export interface SplitConfig {
  paidBy: "me" | string; // "me" or a hisaab person ID
  splitMode: SplitMode;
  personId: string; // The other person in the split
  exactAmount?: number; // For "exact" mode: how much the other party's share is
  percentage?: number; // For "percentage" mode: other party's share %
}

export interface ExpenseFilters {
  startDate?: string;
  endDate?: string;
  categoryIds?: string[];
  paymentModeIds?: string[];
  accountIds?: string[];
  tagIds?: string[];
  search?: string;
  status?: "approved" | "pending_review" | "rejected";
  /** Which transaction kind to list. Defaults to 'realized'. Pass 'all' to see both expenses + credits. */
  nature?: "realized" | "credit" | "all";
  /** UI-level segment filter — narrows realized expenses by link type. Applied on top of nature='realized'. */
  segment?: "spend" | "committed";
  /**
   * Restrict results to a specific set of expense IDs — used when drilling
   * into an insight group so the list shows exactly the expenses that insight
   * aggregated.
   */
  expenseIds?: string[];
  /**
   * Filter by whether a realized expense has had a refund credit linked to it
   * (via credit.refund_of_expense_id). Only meaningful when nature='realized'.
   */
  refundedStatus?: "refunded" | "not_refunded";
  /** Filter by is_right_spend: 'avoidable' = 0, 'unavoidable' = 1. */
  avoidability?: "avoidable" | "unavoidable";
  /** Filter by merchant name (exact match from distinct list). */
  merchantNames?: string[];
  /** Filter by smart rule ID — matches expenses where any of these rules fired. */
  ruleIds?: string[];
  /** Sort order for the list. Defaults to date_desc (newest first). */
  sortBy?: "date_desc" | "date_asc" | "amount_desc" | "amount_asc" | "name_asc";
}

export interface CategoryActual {
  category_id: string;
  total: number;
}

export interface MonthlyTotal {
  month: string; // "YYYY-MM"
  total: number;
}

export interface ForecastMatch {
  forecast: Expense;
  confidence: number; // 0-100
}

export interface ForecastMatchPair {
  realized: Expense;
  forecast: Expense;
}
