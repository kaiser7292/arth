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
  /** Who sent the message this came from (migration 048). */
  source_sms_address?: string | null;
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
  /** migration 066 — 1 when the rule was applied manually via ⚡ button (vs auto-fired during SMS import). */
  applied_rule_manually?: number | null;
  /**
   * v15.12.1: When set to 1, this expense/credit has been reclassified as a transfer.
   * Instead of soft-deleting, we mark it to keep it visible in the UI.
   */
  reclassified_as_transfer: number | null;
  /**
   * v15.12.1: When expense is reclassified as transfer, this points to the transfer record.
   */
  linked_transfer_id: string | null;
  /** migration 080 — review hint for SMS rows: what this money movement looks like. Cleared once acted on. */
  money_event?: MoneyEvent | null;
  /** migration 080 — what a credit is (salary, interest, …). NULL for debits and older credits. */
  credit_kind?: CreditKind | null;
  /** The month this salary credit counts for, when it doesn't follow the setting (migration 090). */
  salary_for_month?: string | null;
  /** migration 087 — set on rows Together writes from what another household member shared. */
  household_ref?: string | null;
  created_at: string;
  updated_at: string;
}

/** balance_adjustment: a balance difference recorded as a spend or money in (Update balances), kept out of budgets. */
export type MoneyEvent = "fd_open" | "fd_closure" | "self_transfer" | "sip" | "investment_withdrawal" | "balance_adjustment";

export const CREDIT_KINDS = ["salary", "bonus", "interest", "dividend", "rent", "refund", "cashback", "reimbursement", "gift", "gain", "settlement", "other"] as const;
export type CreditKind = (typeof CREDIT_KINDS)[number];

export const CREDIT_KIND_LABELS: Record<CreditKind, string> = {
  salary: "Income",
  bonus: "Bonus",
  interest: "Interest",
  refund: "Refund",
  cashback: "Cashback",
  reimbursement: "Reimbursement",
  gift: "Gift",
  gain: "Investment gain",
  dividend: "Dividend",
  rent: "Rent received",
  settlement: "Hisaab settlement",
  other: "Other",
};

/** The types you can choose. "settlement" isn't one: it follows the credit's link to a Hisaab settlement. */
export const PICKABLE_CREDIT_KINDS: readonly CreditKind[] = CREDIT_KINDS.filter((k) => k !== "settlement");

/** Types a search matches by name, so "dividend" finds dividends whatever their text says. */
export function creditKindsMatching(text: string): CreditKind[] {
  const q = text.trim().toLowerCase();
  if (q.length < 3) return [];
  return CREDIT_KINDS.filter((k) => k !== "other" && CREDIT_KIND_LABELS[k].toLowerCase().includes(q));
}

/** A credit's look comes from its type, not a category. */
export const CREDIT_KIND_LOOKS: Record<CreditKind, { icon: string; color: string }> = {
  salary: { icon: "briefcase-outline", color: "#16A34A" },
  bonus: { icon: "star-outline", color: "#D97706" },
  interest: { icon: "trending-up-outline", color: "#0D9488" },
  dividend: { icon: "pie-chart-outline", color: "#7C3AED" },
  rent: { icon: "key-outline", color: "#B45309" },
  refund: { icon: "return-down-back-outline", color: "#2563EB" },
  cashback: { icon: "cash-outline", color: "#059669" },
  reimbursement: { icon: "receipt-outline", color: "#0284C7" },
  gift: { icon: "gift-outline", color: "#DB2777" },
  gain: { icon: "stats-chart-outline", color: "#4F46E5" },
  settlement: { icon: "people-outline", color: "#0891B2" },
  other: { icon: "ellipsis-horizontal-circle-outline", color: "#6B7280" },
};

/** The type a credit shows: one with none set reads as Other. */
export function creditKindOf(kind: string | null | undefined): CreditKind {
  return (CREDIT_KINDS as readonly string[]).includes(kind ?? "") ? (kind as CreditKind) : "other";
}

/** What a credit shows in place of a category. */
export function creditLook(kind: string | null | undefined): { name: string; icon: string; color: string } {
  const k = creditKindOf(kind);
  return { name: CREDIT_KIND_LABELS[k], ...CREDIT_KIND_LOOKS[k] };
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
  /** migration 080 — what a credit is. Only meaningful when nature = 'credit'. */
  credit_kind?: CreditKind | null;
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
  credit_kind?: CreditKind | null;
}

export type SplitMode = "equal" | "they_owe_full" | "i_owe_full" | "exact" | "percentage";

export interface SplitConfig {
  paidBy: "me" | string; // "me" or a hisaab person ID
  splitMode: SplitMode;
  personId: string; // The other person in the split
  exactAmount?: number; // For "exact" mode: how much the other party's share is
  percentage?: number; // For "percentage" mode: other party's share %
}

/**
 * In a filter's id list (categoryIds, paymentModeIds, accountIds, tagIds, merchantNames): match
 * expenses that have no value there - no category, no tags, and so on.
 */
export const NOT_SET = "__none__";

/** How NOT_SET reads in each Transactions filter. */
export const NOT_SET_LABELS = {
  category: "No category",
  paymentMode: "No payment mode",
  account: "No account",
  tags: "No tags",
  merchant: "No merchant",
} as const;

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
  /** Filter by is_right_spend: 'avoidable' = 0, 'unavoidable' = 1, 'unclassified' = not set yet. */
  avoidability?: "avoidable" | "unavoidable" | "unclassified";
  /** Credits of these types. A credit with no type counts as "other". */
  creditKinds?: string[];
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
