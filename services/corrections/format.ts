/**
 * Fix my data: the correction file an AI assistant writes back, and the instructions that tell it
 * how. See docs/AI_CORRECTIONS_DESIGN.md. Rigid on purpose: the reply is read by a machine after a
 * person pastes it from a chat app.
 */

export const CORRECTIONS_FORMAT = "arth-corrections/1";
export const MAX_CORRECTIONS = 2000;

/** Corrections only Fix my data applies. */
export type FixType =
  | "set_account_type"
  | "mark_duplicate"
  | "mark_transfer"
  | "link_refund"
  | "move_account"
  | "set_merchant"
  | "set_payment_mode"
  | "set_spend_type"
  | "set_income_type"
  | "mark_redemption"
  | "link_to_bucket"
  | "adjust_balance"
  | "update_goal";

/** Corrections the setup suggestions code already reads and applies (services/ai-suggestions.ts). */
export const SHARED_TYPES = [
  "add_category",
  "fix_merchant",
  "merchant_category",
  "recategorise",
  "add_rule",
  "set_budget",
  "set_savings_target",
  "add_investment_bucket",
  "add_milestone",
] as const;
export type SharedType = (typeof SHARED_TYPES)[number];

export const FIX_TYPE_ALIASES: Record<string, FixType> = {
  set_account_type: "set_account_type",
  fix_account_type: "set_account_type",
  mark_duplicate: "mark_duplicate",
  duplicate: "mark_duplicate",
  mark_transfer: "mark_transfer",
  transfer: "mark_transfer",
  link_refund: "link_refund",
  refund: "link_refund",
  move_account: "move_account",
  set_account: "move_account",
  set_merchant: "set_merchant",
  set_payment_mode: "set_payment_mode",
  set_mode: "set_payment_mode",
  set_spend_type: "set_spend_type",
  set_income_type: "set_income_type",
  mark_redemption: "mark_redemption",
  link_to_bucket: "link_to_bucket",
  link_bucket: "link_to_bucket",
  adjust_balance: "adjust_balance",
  match_balance: "adjust_balance",
  update_goal: "update_goal",
  update_milestone: "update_goal",
};

/**
 * Apply order: each step can rest on the ones before it. Shared types sit where their effect
 * belongs (categories before the single entries that use them, rules last).
 */
export const APPLY_ORDER: (FixType | SharedType)[] = [
  "set_account_type",
  "mark_duplicate",
  "mark_transfer",
  "link_refund",
  "move_account",
  "add_category",
  "fix_merchant",
  "merchant_category",
  "recategorise",
  "set_merchant",
  "set_payment_mode",
  "set_spend_type",
  "set_income_type",
  "add_investment_bucket",
  "mark_redemption",
  "link_to_bucket",
  "adjust_balance",
  "set_budget",
  "set_savings_target",
  "add_milestone",
  "update_goal",
  "add_rule",
];

export const GROUP_LABELS: Record<FixType | SharedType, string> = {
  set_account_type: "Account types",
  mark_duplicate: "Duplicates to remove",
  mark_transfer: "Transfers between your accounts",
  link_refund: "Refunds to link",
  move_account: "Transactions on the wrong account",
  add_category: "New categories",
  fix_merchant: "Merchant names",
  merchant_category: "Merchant categories",
  recategorise: "Single entries re-categorised",
  set_merchant: "Merchant on single entries",
  set_payment_mode: "Payment modes",
  set_spend_type: "Unavoidable or discretionary",
  set_income_type: "Income types",
  add_investment_bucket: "New investment buckets",
  mark_redemption: "Money back from investments",
  link_to_bucket: "Investments linked to buckets",
  adjust_balance: "Balances matched to the bank",
  set_budget: "Budgets",
  set_savings_target: "Savings target",
  add_milestone: "New goals",
  update_goal: "Goals updated",
  add_rule: "Rules for the future",
};

/** Ticked off by default: they reshape the plan, so applying one is a deliberate yes. */
export const DELIBERATE: ReadonlySet<string> = new Set(["set_savings_target", "add_milestone", "update_goal", "add_investment_bucket"]);

export const FIX_REQUEST =
  "Go through my whole Arth history and fix it. Make it consistent: one spelling per merchant, the same category, payment mode and spend type for the same kind of transaction, and the right income types. Fix mistakes: duplicates, transfers between my own accounts counted as spending or income, refunds not linked to their purchase, transactions on the wrong account, account types that are wrong, and balances that don't match what my bank says. Then tidy my budgets and goals to fit what I really spend. Start from the health findings in the file. Reply only with the corrections file, straight away.";

/** The "how to reply" section of the export, one instruction per line. */
export function buildCorrectionInstructions(): string[] {
  return [
    `Reply with ONE JSON object and nothing else: {"format": "${CORRECTIONS_FORMAT}", "corrections": [ ... ]}. Put every correction in the list; at most ${MAX_CORRECTIONS}.`,
    `Every correction has "type", the fields below, and "why": one short sentence a person can check (under 160 characters).`,
    `Name a transaction by its "ref" from the transactions list AND repeat its "date" and "amount" exactly. A correction whose ref, date and amount don't match one row is thrown away.`,
    `Name an account by its "fix_ref" from accounts_for_fixes (e.g. "k1a2b3c4d"). Name categories, payment modes, investment buckets and goals exactly as they appear in the file.`,
    `Never change an amount or a date, and never delete. To remove a duplicate use mark_duplicate (it goes to the Recycle Bin).`,
    `Types and their fields:`,
    `- set_account_type: account, account_type ("savings", "credit_card", "wallet" or "loan"). Example: {"type":"set_account_type","account":"k1a2b3c4d","account_type":"credit_card","why":"Messages for ··4821 mention a credit limit"}`,
    `- mark_duplicate: ref, date, amount (the copy to remove), same_as_ref, same_as_date, same_as_amount (the one to keep).`,
    `- mark_transfer: ref, date, amount, other_account. A debit becomes money moved TO other_account; a credit becomes money moved FROM it. Use it for card bill payments, moving money between own accounts, wallet top-ups.`,
    `- link_refund: ref, date, amount (the refund credit), purchase_ref, purchase_date, purchase_amount (what it refunds).`,
    `- move_account: ref, date, amount, account. For a transaction recorded on the wrong account, or on none.`,
    `- set_merchant: ref, date, amount, merchant. For one entry. To rename every entry of a merchant use fix_merchant.`,
    `- set_payment_mode: ref, date, amount, payment_mode (one of payment_modes).`,
    `- set_spend_type: ref, date, amount, unavoidable (true for rent, bills, EMIs, groceries, medicines; false for eating out, shopping, entertainment).`,
    `- set_income_type: ref, date, amount, income_type ("salary", "bonus", "interest", "dividend", "rent", "refund", "cashback", "reimbursement", "gift", "gain", "settlement" or "other").`,
    `- mark_redemption: ref, date, amount. A credit that is money back from an investment (MF redemption, broker payout), not income.`,
    `- link_to_bucket: ref, date, amount, bucket (an investment bucket name). For SIPs and other investing.`,
    `- adjust_balance: account, balance. Sets the account's balance today to what the bank says, with a visible adjustment. Only when the gap can't be explained by a transaction you can fix.`,
    `- update_goal: goal (a goal name), and target_amount and/or target_date (YYYY-MM-DD).`,
    `- fix_merchant: from, to. Renames a merchant everywhere and for the future. Example: {"type":"fix_merchant","from":"SWIGGY*ORDER","to":"Swiggy","why":"Same merchant"}`,
    `- merchant_category: merchant, category. Files every entry of a merchant, now and in future.`,
    `- recategorise: ref, date, amount, category. One entry that's an exception.`,
    `- add_category: name. Only when no existing category fits.`,
    `- add_rule: name, when (1-4 of {"field": "merchant"|"description"|"amount", "is": "contains"|"equals"|"starts_with"|"ends_with"|"greater_than"|"less_than", "value": ...}), category.`,
    `- set_budget: category, amount (monthly).`,
    `- set_savings_target: percent.`,
    `- add_investment_bucket: name, annual_target.`,
    `- add_milestone: name, target_amount, target_date.`,
    `Order doesn't matter: Arth applies them in the right order. Prefer one fix_merchant or merchant_category over many single-entry changes.`,
  ];
}
