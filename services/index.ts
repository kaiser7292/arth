// ─── Core Services (barrel re-exports) ───

export * from "./settings";
export * from "./category";
export * from "./payment-mode";
export * from "./budget";
export * from "./expense";
export * from "./financial-account";
export * from "./tags";
export * from "./hisaab";
export * from "./salary-profile";
export * from "./yearly-plan";
export * from "./tax-engine";
export * from "./capital-gains";
export * from "./life-milestone";
export * from "./backup";
export * from "./notifications";
export * from "./notification-scheduler";

// ─── Insights & Analytics ───

export * from "./spending-insights";
export * from "./comparison-insights";

// ─── Expense Sub-services (already re-exported via ./expense barrel) ───
// expense-types, expense-crud, expense-queries, expense-splits, expense-forecasts
// are all re-exported through ./expense — do NOT re-export them individually.

// ─── Detection & Import ───

export * from "./duplicate-detection";
export * from "./recurring-detector";
export * from "./smart-categorizer";
export * from "./data-cleanup";
export * from "./excel-import";
export * from "./estimations-import";

// ─── Export ───

export * from "./hisaab-export-excel";
export * from "./hisaab-export-pdf";

// ─── Forecast ───

export * from "./forecast-engine";
export * from "./savings-tracker";

// ─── Account Master (selective — PaymentMode & getAllPaymentModes conflict with payment-mode.ts) ───

export {
  getAccountWithModes,
  getAllAccountsWithModes,
  addPaymentModeToAccount,
  removePaymentModeFromAccount,
  autoPopulateAccountMode,
  getLinkedModesForAccount,
  updateAccountLabel,
  findPaymentModeByType,
} from "./account-master";
export type { AccountPaymentModeLink, AccountWithModes } from "./account-master";

// ─── Account Master: re-export getAllPaymentModes under alias to avoid conflict ───
// Consumers needing account-master's getAllPaymentModes should import directly from "./account-master".

// ─── Merchant ───

export * from "./merchant-alias";

// ─── SMS (sub-barrel) ───

export * from "./sms";
