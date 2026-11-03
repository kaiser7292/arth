import { isPathOn } from "@/services/customise";
import { Platform } from "react-native";
import { getFlag } from "@/services/feature-flags";

/**
 * Everything "Search or do" can do or open that isn't the person's own data. Each entry says where it
 * goes; __tests__ checks every route is a real screen, so a renamed screen can't quietly break one.
 */
export interface SearchTarget {
  pathname: string;
  params?: Record<string, string>;
}

export interface CatalogEntry {
  id: string;
  kind: "do" | "go";
  title: string;
  /** Extra words that should find this, beyond what search-semantics already knows. */
  words?: string;
  icon: string;
  target?: SearchTarget;
  /** Not a screen: the search screen carries this out itself. */
  action?: "toggleAmounts";
  only?: "household" | "ios" | "android";
}

const add = (id: string, title: string, icon: string, pathname: string, words?: string, params?: Record<string, string>, only?: CatalogEntry["only"]): CatalogEntry => ({
  id,
  kind: "do",
  title,
  icon,
  words,
  target: { pathname, params },
  only,
});
const go = (id: string, title: string, icon: string, pathname: string, words?: string, params?: Record<string, string>, only?: CatalogEntry["only"]): CatalogEntry => ({
  id,
  kind: "go",
  title,
  icon,
  words,
  target: { pathname, params },
  only,
});

const HOME = "/(tabs)";
const TX = "/(tabs)/expenses";
const SET = "/(tabs)/settings";

export const SEARCH_CATALOG: CatalogEntry[] = [
  // ── Add ──
  add("add-expense", "Add an expense", "add-circle-outline", "/expense/add", "new spend cash manual"),
  add("add-credit", "Add money received", "arrow-down-circle-outline", "/expense/add", "new income credit salary", { type: "credit" }),
  add("add-transfer", "Add a transfer", "swap-horizontal-outline", "/expense/add", "new move between accounts", { type: "transfer" }),
  add("add-voice", "Add by voice", "mic-outline", HOME, "say speak", { voice: "1" }),
  add("add-picture", "Add from a picture", "image-outline", "/expense/from-screenshot", "screenshot receipt photo"),
  add("paste-message", "Paste a bank message", "clipboard-outline", "/expense/paste-message", "sms"),
  // ── Edit a transaction: pick it from the list, then its own screen does the rest ──
  add("edit-tx", "Edit a transaction", "create-outline", TX, "change fix correct", { hint: "Tap a transaction, then Edit" }),
  add("edit-tx-date", "Change a transaction's date", "calendar-outline", TX, "edit wrong day", { hint: "Tap a transaction, then Edit to change its date" }),
  add("edit-tx-amount", "Change a transaction's amount", "cash-outline", TX, "edit wrong", { hint: "Tap a transaction, then Edit to change its amount" }),
  add("edit-tx-category", "Change a transaction's category", "grid-outline", TX, "edit wrong recategorise", { hint: "Tap a transaction, then Edit to change its category" }),
  add("edit-tx-merchant", "Change a transaction's merchant", "storefront-outline", TX, "edit name wrong", { hint: "Tap a transaction, then Edit to change its merchant" }),
  add("edit-tx-account", "Change a transaction's account", "business-outline", TX, "edit wrong bank", { hint: "Tap a transaction, then Edit to change its account" }),
  add("edit-tx-mode", "Change a transaction's payment mode", "card-outline", TX, "edit upi wrong", { hint: "Tap a transaction, then Edit to change its payment mode" }),
  add("delete-tx", "Delete a transaction", "trash-outline", TX, "remove", { hint: "Tap a transaction, then Delete" }),
  add("split-tx", "Split a transaction", "git-branch-outline", TX, "share bill friend", { hint: "Tap a transaction, then Split" }),
  add("refund-tx", "Mark a transaction as a refund", "return-down-back-outline", TX, "returned money back", { hint: "Tap a transaction to mark it as a refund" }),
  add("transfer-tx", "Mark a transaction as a transfer", "swap-horizontal-outline", TX, "own account not spending", { hint: "Tap a transaction to mark it as a transfer" }),
  add("income-month-tx", "Move income to another month", "calendar-number-outline", TX, "salary period tag credit counts", { show: "credit", hint: "Tap the credit, then choose the month it counts for" }),
  // ── Edit in bulk: opens Transactions already selecting ──
  add("bulk-edit", "Edit transactions in bulk", "checkbox-outline", TX, "select many change", { select: "1", hint: "Tap the ones you want, then choose what to change" }),
  add("bulk-date", "Change dates in bulk", "calendar-outline", TX, "select many transactions", { select: "1", hint: "Tap the ones you want, then choose Date" }),
  add("bulk-category", "Change category in bulk", "grid-outline", TX, "select many transactions recategorise", { select: "1", hint: "Tap the ones you want, then choose Category" }),
  add("bulk-merchant", "Change merchant in bulk", "storefront-outline", TX, "select many transactions", { select: "1", hint: "Tap the ones you want, then choose Merchant" }),
  add("bulk-account", "Change account in bulk", "business-outline", TX, "select many transactions", { select: "1", hint: "Tap the ones you want, then choose Account" }),
  add("bulk-mode", "Change payment mode in bulk", "card-outline", TX, "select many transactions", { select: "1", hint: "Tap the ones you want, then choose Mode" }),
  // ── Edit or remove everything else ──
  add("edit-transfer", "Edit or delete a transfer", "swap-horizontal-outline", TX, "change wrong", { show: "transfers", hint: "Tap a transfer to change or delete it" }),
  add("edit-account", "Edit an account", "business-outline", "/settings/account-master", "change rename close bank card"),
  add("close-account", "Close or delete an account", "close-circle-outline", "/settings/account-master", "remove"),
  add("edit-balance", "Correct an account balance", "calculator-outline", "/reconciliation/bank-accounts", "adjust wrong opening reconcile"),
  add("edit-goal", "Edit or delete a goal", "flag-outline", "/goals/investment-buckets", "change target date amount remove"),
  add("edit-milestone", "Edit or delete a milestone", "trophy-outline", "/goals/milestones", "change remove"),
  add("edit-loan", "Edit or delete a loan", "cash-outline", "/goals/loans", "change rate emi remove"),
  add("edit-reminder", "Edit or stop a reminder", "alarm-outline", "/settings/recurring-rules", "change subscription bill remove cancel"),
  add("edit-category", "Edit or delete a category", "grid-outline", "/settings/categories", "change rename remove"),
  add("edit-tag", "Edit or delete a tag", "pricetags-outline", "/settings/tags", "change rename remove"),
  add("edit-mode", "Edit or delete a payment mode", "card-outline", "/settings/payment-modes", "change rename remove"),
  add("edit-rule", "Edit or delete a smart rule", "flash-outline", "/settings/smart-rules", "change remove"),
  add("edit-sms-template", "Edit or delete an SMS template", "chatbox-ellipses-outline", "/settings/sms-templates", "change remove"),
  add("edit-picture-template", "Edit or delete a picture template", "images-outline", "/settings/image-templates", "change remove"),
  add("edit-hisaab", "Edit or delete a Hisaab entry", "people-outline", "/hisaab/persons", "change lent wrong remove"),
  add("edit-person", "Edit or remove a Hisaab person", "person-outline", "/hisaab/persons", "rename change"),
  add("change-password", "Change a saved password", "key-outline", "/vault", "edit vault update login pin"),
  add("delete-vault", "Delete a Vault entry", "trash-outline", "/vault", "remove password login"),
  add("edit-snapshot", "Edit or delete a snapshot", "camera-outline", "/investments", "change portfolio value wrong demat"),
  add("edit-investment", "Edit or delete an investment", "trending-up-outline", "/investments", "change fd deposit remove"),
  add("edit-assumptions", "Change my projections", "analytics-outline", "/investments/projections", "return sip lump sum edit step up inflation"),
  add("edit-scenario", "Edit or delete a scenario", "git-branch-outline", "/simulator", "simulator change remove"),
  add("edit-insurance", "Edit or delete insurance", "shield-outline", "/goals/risk-coverage", "change policy remove"),
  add("edit-merchant", "Edit a merchant", "storefront-outline", "/settings/merchants", "change category name"),
  add("edit-merchant-category", "Change a merchant's category", "pricetag-outline", "/settings/merchant-categories", "map edit"),
  add("edit-household-members", "Remove someone from the household", "person-remove-outline", "/settings/household", "member partner leave", undefined, "household"),
  add("edit-plan", "Edit my yearly plan", "list-outline", "/goals/yearly-plan", "change annual"),
  // ── Review ──
  add("review", "Review pending transactions", "checkmark-done-outline", "/expense/review-queue", "approve queue"),
  add("catch-up", "Catch up", "albums-outline", "/expense/catch-up", "swipe review"),
  add("just-arrived", "See what just arrived", "notifications-outline", "/expense/just-arrived", "new latest recent"),
  add("duplicates", "Sort out duplicates", "copy-outline", "/expense/review-queue", "same twice"),
  add("review-transfers", "Review transfers", "swap-vertical-outline", "/settings/transfer-review", "own account self"),
  // ── Accounts ──
  add("add-account", "Add an account", "business-outline", "/settings/account-add", "new bank savings"),
  add("add-card", "Add a credit card", "card-outline", "/settings/account-add", "new", { presetType: "credit_card" }),
  add("add-wallet", "Add a wallet", "wallet-outline", "/settings/account-add", "new", { presetType: "wallet" }),
  add("add-loan", "Add a loan", "cash-outline", "/loans/add", "new emi"),
  add("add-pension", "Add a pension account", "briefcase-outline", "/settings/account-add", "new epf nps ppf", { presetType: "pension" }),
  add("add-demat", "Add a demat account", "trending-up-outline", "/settings/account-add", "new broker", { presetType: "demat" }),
  // ── Investments ──
  add("add-investment", "Add an investment", "trending-up-outline", "/investments/add", "new"),
  add("add-fd", "Add a fixed deposit", "cash-outline", "/investments/add-fd", "new"),
  add("add-snapshot", "Add a snapshot", "camera-outline", "/investments", "portfolio value today"),
  add("sync", "Sync my investments", "sync-outline", "/investments/sync-review", "brokers refresh today"),
  add("sync-move", "How much did my investments move?", "pulse-outline", "/investments/sync-review", "up down gain loss today yesterday daily change"),
  add("sync-values", "Update my investment values", "create-outline", "/investments/sync-review", "manual type enter worth today"),
  add("projections", "See projections", "analytics-outline", "/investments/projections", "future grow where could"),
  add("projection-more", "Try investing more", "add-circle-outline", "/investments/projections", "infusion capital extra sip calculator what if lump sum"),
  add("projection-step-up", "Plan a SIP step-up", "trending-up-outline", "/investments/projections", "increase yearly raise calculator"),
  add("projection-inflation", "Set inflation for projections", "pricetag-outline", "/investments/projections", "today's money real value prices"),
  // ── Insights ──
  add("cash-flow-see", "See my money in and out", "swap-vertical-outline", "/insights/cash-flow", "cash flow income spending saved left trend"),
  add("cash-flow-year", "Money in and out this year", "swap-vertical-outline", "/insights/cash-flow", "cash flow fy annual", { period: "this_fy" }),
  add("cash-flow-custom", "Money in and out for any period", "swap-vertical-outline", "/insights/cash-flow", "cash flow custom range dates months", { period: "custom" }),
  add("budget-actual-year", "Budget vs actual this year", "bar-chart-outline", "/insights/budget-vs-actual", "fy annual overspend", { period: "this_fy" }),
  add("budget-actual-custom", "Budget vs actual for any period", "bar-chart-outline", "/insights/budget-vs-actual", "custom range dates months overspend", { period: "custom" }),
  add("forecast-do", "Will I stay within budget?", "trending-up-outline", "/insights/forecast", "month end likely spend forecast"),
  add("connect-kite", "Connect Zerodha", "link-outline", "/settings/kite-connect", "kite broker log in"),
  add("connect-angel", "Connect Angel One", "link-outline", "/settings/angel-connect", "broker"),
  add("connect-zebpay", "Connect Zebpay", "link-outline", "/settings/zebpay-connect", "crypto broker"),
  // ── Income ──
  add("change-income", "Change my income", "wallet-outline", "/goals/salary-calculator", "salary update hike raise"),
  add("pay-day", "Change my pay day", "calendar-outline", "/goals/salary-calculator", "salary date credit"),
  add("income-month", "Choose which month income counts for", "calendar-number-outline", "/goals/salary-calculator", "salary period previous next"),
  add("add-bonus", "Add a bonus", "gift-outline", "/goals/salary-calculator", "expected"),
  // ── Budget, goals ──
  add("set-budget", "Set a budget", "calculator-outline", "/settings/budget-config", "new create"),
  add("change-budget", "Change a budget", "create-outline", "/settings/budget-config", "edit"),
  add("add-goal", "Set up a goal", "flag-outline", "/goals/investment-buckets", "new create save for"),
  add("add-milestone", "Add a milestone", "trophy-outline", "/goals/milestones", "new life"),
  add("contribute", "Add to a goal", "add-outline", "/goals/investment-buckets", "contribution money"),
  add("plan", "Set up my yearly plan", "list-outline", "/goals/yearly-plan", "annual"),
  // ── Loans ──
  add("prepay", "Add a prepayment", "trending-down-outline", "/goals/loans", "loan part pay extra"),
  add("correct-loan", "Correct a loan", "construct-outline", "/goals/loans", "wrong fix edit"),
  add("emi-paid", "Mark an EMI paid", "checkmark-circle-outline", "/goals/loans", "loan"),
  // ── People ──
  add("add-person", "Add a person to Hisaab", "person-add-outline", "/hisaab/persons", "new friend"),
  add("lend", "Record money lent", "arrow-up-circle-outline", "/hisaab/persons", "gave friend borrowed"),
  add("settle", "Settle up", "checkmark-done-circle-outline", "/hisaab/persons", "repay paid back"),
  add("start-household", "Start a household", "people-outline", "/settings/household/start", "new partner", undefined, "household"),
  add("invite", "Invite to household", "person-add-outline", "/settings/household/invite", "add partner", undefined, "household"),
  add("join", "Join a household", "enter-outline", "/settings/household/join", "code", undefined, "household"),
  add("rename-household", "Rename household", "create-outline", "/settings/household", "name", undefined, "household"),
  add("household-share", "Choose what's shared", "share-social-outline", "/settings/household/share", "privacy", undefined, "household"),
  add("household-settle", "Settle up with household", "checkmark-done-circle-outline", "/together/settle", "partner", undefined, "household"),
  add("household-goal", "Add a household goal", "flag-outline", "/together/goal", "partner", undefined, "household"),
  add("household-budget", "Set a household budget", "calculator-outline", "/together/budget", "partner", undefined, "household"),
  // ── Planning ──
  add("scenario", "Try a scenario", "git-branch-outline", "/simulator", "simulator what if afford"),
  add("add-reminder", "Add a reminder or subscription", "alarm-outline", "/settings/recurring-rules", "new bill rent"),
  add("add-insurance", "Add insurance", "shield-checkmark-outline", "/goals/risk-coverage", "new policy"),
  // ── Vault ──
  add("vault-add", "Add a password", "key-outline", "/vault/add", "new login vault"),
  add("vault-card", "Add a card to the Vault", "card-outline", "/vault/add", "number cvv pin", { prefill_category: "card" }),
  add("vault-upi", "Add a UPI PIN", "keypad-outline", "/vault/add", "vault", { prefill_category: "upi" }),
  add("vault-statement", "Add a statement password", "document-lock-outline", "/vault/add", "pdf vault", { prefill_category: "banking" }),
  // ── Teach Arth ──
  add("add-rule", "Add a smart rule", "flash-outline", "/settings/smart-rules", "automatic categorise"),
  add("teach-sms", "Teach a new SMS format", "school-outline", "/settings/sms-templates/new", "template bank message unrecognised"),
  add("picture-template", "Add a picture template", "images-outline", "/settings/image-templates", "receipt screenshot"),
  add("merge-merchants", "Merge merchants", "git-merge-outline", "/settings/merchants", "combine same"),
  add("rename-merchant", "Rename a merchant", "create-outline", "/settings/merchants", "name"),
  add("add-category", "Add a category", "grid-outline", "/settings/category-edit", "new"),
  add("add-tag", "Add a tag", "pricetags-outline", "/settings/tags", "new label"),
  add("add-mode", "Add a payment mode", "card-outline", "/settings/payment-mode-edit", "new upi"),
  // ── Data ──
  add("scan", "Scan my messages", "scan-outline", "/settings/transaction-messages", "sms read", undefined, "android"),
  add("backup", "Back up now", "cloud-upload-outline", "/settings/backup-restore", "save export"),
  add("restore", "Restore a backup", "cloud-download-outline", "/settings/backup-restore", "new phone"),
  add("import", "Import from Excel", "document-outline", "/settings/import-excel", "csv sheet"),
  add("reconcile", "Reconcile a statement", "git-compare-outline", "/settings/reconciliation/new", "pdf match tally"),
  add("export-ai", "Export for AI", "sparkles-outline", "/insights/export-for-ai", "chatgpt claude"),
  add("ai-setup", "Use AI to set up", "sparkles-outline", "/settings/ai-assisted-setup", "chatgpt claude"),
  add("recycle", "Restore something deleted", "trash-outline", "/settings/recycle-bin", "undo empty recycle bin"),
  add("clean-up", "Clean up data", "brush-outline", "/settings/clean-up", "reset old"),
  // ── Settings ──
  { id: "hide-amounts", kind: "do", title: "Hide or show amounts", icon: "eye-off-outline", words: "privacy mask", action: "toggleAmounts" },
  add("app-lock", "Turn on app lock", "lock-closed-outline", "/settings/security", "fingerprint face"),
  add("notifications", "Change notifications", "notifications-outline", "/settings/notifications", "alerts"),
  add("calendar", "Sync to calendar", "calendar-outline", "/settings/calendar-sync", "dues"),
  add("home-cards", "Show or hide Home cards", "grid-outline", "/settings/customise", "customise"),
  add("reorder-cards", "Reorder Home cards", "reorder-four-outline", "/settings/customise", "move order arrange customise"),
  add("switch-off", "Switch off a feature or tab", "options-outline", "/settings/customise", "hide remove disable vault simulator insights hisaab loans investments together budget goals tab customise"),
  add("region", "Change region or currency", "globe-outline", "/settings/region", "language date"),
  add("fy", "Change financial year", "calendar-outline", "/settings/region", "april start"),
  add("theme", "Change theme", "contrast-outline", SET, "dark light mode"),
  // ── Check-ins ──
  add("month-end", "Month-end check", "checkbox-outline", "/check-in/month-end", "balances"),
  add("bills-check", "Bills check", "receipt-outline", "/check-in/bills", "dues"),
  add("subs-check", "Subscriptions check", "repeat-outline", "/check-in/subscriptions", "netflix"),
  add("rules-check", "Rules check", "flash-outline", "/check-in/rules", "suggestions"),
  add("settle-check", "Settle-up check", "people-outline", "/check-in/settle-up", "hisaab"),

  // ── Go to: month ──
  go("my-month", "My Month", "calendar-outline", "/summary/my-month", "cash flow salary how i spent left over"),
  go("summary", "Monthly summary", "stats-chart-outline", "/(tabs)/budget", "spent"),
  go("budget", "Budget", "wallet-outline", "/(tabs)/budget", "categories"),
  go("split", "Spending split", "pie-chart-outline", "/budget/spending-split", "where did my money go unavoidable discretionary"),
  go("budget-actual", "Budget vs actual", "bar-chart-outline", "/insights/budget-vs-actual", "compare"),
  // ── Transactions ──
  go("tx", "All transactions", "receipt-outline", TX, "ledger history"),
  go("tx-credits", "Credits", "arrow-down-outline", TX, "money in received", { preset: "credits" }),
  go("recycle-go", "Recycle bin", "trash-outline", "/settings/recycle-bin", "deleted"),
  // ── Accounts ──
  go("banks", "Bank accounts", "business-outline", "/reconciliation/bank-accounts", "savings balance"),
  go("cards", "Credit cards", "card-outline", "/reconciliation/credit-cards", "bill limit utilised"),
  go("wallets", "Wallets", "wallet-outline", "/reconciliation/wallets", "paytm"),
  go("demat", "Demat", "trending-up-outline", "/reconciliation/demat-portfolio", "stocks portfolio"),
  go("pension", "Pension", "briefcase-outline", "/reconciliation/pension-accounts", "epf nps ppf"),
  go("accounts", "All accounts", "albums-outline", "/settings/account-master", "manage"),
  go("modes", "Payment modes", "card-outline", "/settings/payment-modes", "upi"),
  // ── Wealth ──
  go("investments", "Investments", "trending-up-outline", "/investments", "portfolio"),
  go("projections-go", "Projections", "analytics-outline", "/investments/projections", "future"),
  go("net-worth", "Net worth", "podium-outline", "/goals/balance-sheet", "wealth"),
  go("balance-sheet", "Balance sheet", "reader-outline", "/goals/balance-sheet", "assets liabilities"),
  go("gains", "Capital gains", "cash-outline", "/goals/capital-gains-reference", "tax ltcg stcg"),
  // ── Plan ──
  go("goals", "Goals", "trophy-outline", "/(tabs)/goals"),
  go("yearly", "Yearly plan", "list-outline", "/goals/yearly-plan", "annual"),
  go("buckets", "Investment buckets", "file-tray-stacked-outline", "/goals/investment-buckets", "goals"),
  go("milestones", "Milestones", "flag-outline", "/goals/milestones", "life goals"),
  go("calculator", "Income Calculator", "calculator-outline", "/goals/salary-calculator", "tax ctc in hand salary"),
  go("health", "Financial health", "fitness-outline", "/goals/health-grade", "grade score"),
  go("risk", "Risk coverage", "shield-outline", "/goals/risk-coverage", "insurance"),
  go("simulator", "Simulator", "git-branch-outline", "/simulator", "cash flow what if"),
  go("yoy", "Year-over-year", "swap-horizontal-outline", "/goals/yoy-comparison", "compare last year"),
  go("loans", "Loans", "cash-outline", "/goals/loans", "emi prepayment debt"),
  // ── Insights ──
  go("insights", "Insights", "bulb-outline", "/insights", "analytics"),
  go("cash-flow", "Money in and out", "swap-vertical-outline", "/insights/cash-flow", "cash flow income spending"),
  go("compare", "Compare", "git-compare-outline", "/insights/compare", "months"),
  go("forecast", "Forecast", "trending-up-outline", "/insights/forecast", "month end projection"),
  go("patterns", "Patterns", "repeat-outline", "/insights/patterns", "habits recurring"),
  go("merchant-insights", "Merchants insights", "storefront-outline", "/insights/merchants", "top where"),
  go("reports", "Reports", "document-text-outline", "/insights/reports"),
  go("year-review", "Year in Review", "ribbon-outline", "/insights/year-review", "wrapped annual"),
  go("r-retire", "Retirement report", "umbrella-outline", "/insights/report-retirement", "pension corpus"),
  go("r-loan", "Loan payoff report", "trending-down-outline", "/insights/report-loan-payoff", "emi prepay"),
  go("r-persona", "Spending personality", "happy-outline", "/insights/report-spending-personality"),
  go("r-health", "Financial health report", "fitness-outline", "/insights/report-financial-health", "grade"),
  // ── People ──
  go("hisaab", "Hisaab", "people-outline", "/hisaab/persons", "who owes me family ledger"),
  go("together", "Together", "home-outline", "/together", "household partner", undefined, "household"),
  go("shared", "Shared transactions", "receipt-outline", "/together/transactions", "household", undefined, "household"),
  go("household", "Household settings", "settings-outline", "/settings/household", "members", undefined, "household"),
  // ── Security ──
  go("vault", "Vault", "lock-closed-outline", "/vault", "passwords pin login"),
  go("security", "Security", "shield-checkmark-outline", "/settings/security", "app lock"),
  // ── Set-up ──
  go("categories", "Categories", "grid-outline", "/settings/categories"),
  go("tags", "Tags", "pricetags-outline", "/settings/tags"),
  go("rules", "Smart rules", "flash-outline", "/settings/smart-rules"),
  go("reminders", "Reminders", "alarm-outline", "/settings/recurring-rules", "recurring subscriptions bills"),
  go("merchants", "Merchants", "storefront-outline", "/settings/merchants"),
  go("merchant-cats", "Merchant categories", "pricetag-outline", "/settings/merchant-categories", "map"),
  go("sms-templates", "SMS templates", "chatbox-ellipses-outline", "/settings/sms-templates", "format teach"),
  go("image-templates", "Picture templates", "images-outline", "/settings/image-templates"),
  go("scan-history", "Scan history", "time-outline", "/settings/sms-scan-runs", "messages runs"),
  go("messages", "Transaction messages", "chatbubbles-outline", "/settings/transaction-messages", "sms"),
  go("iphone", "iPhone bank messages", "phone-portrait-outline", "/settings/iphone-bank-messages", "shortcut", undefined, "ios"),
  go("voice", "Voice input", "mic-outline", "/settings/voice-input"),
  go("cards-setting", "Customise Arth", "options-outline", "/settings/customise", "home cards tabs features"),
  go("region-go", "Region", "globe-outline", "/settings/region"),
  go("notif-go", "Notifications", "notifications-outline", "/settings/notifications"),
  go("calendar-go", "Calendar sync", "calendar-outline", "/settings/calendar-sync"),
  go("audit", "Audit log", "list-outline", "/settings/audit-log", "history changes"),
  go("backup-go", "Backup and data", "cloud-outline", "/settings/backup-data"),
  go("import-go", "Import", "document-outline", "/settings/import-excel", "excel"),
  go("reconcile-go", "Reconciliation", "git-compare-outline", "/settings/reconciliation", "statement"),
  go("dup-accounts", "Duplicate accounts", "copy-outline", "/settings/duplicate-accounts", "merge"),
  go("dup-dismissed", "Dismissed duplicates", "copy-outline", "/settings/dismissed-duplicates", "kept"),
  go("ai-go", "AI setup", "sparkles-outline", "/settings/ai-assisted-setup", "chatgpt"),
  go("ai-sug", "AI suggestions", "sparkles-outline", "/settings/ai-suggestions"),
  // ── Brokers ──
  go("kite", "Zerodha", "trending-up-outline", "/settings/kite-connect", "kite"),
  go("angel", "Angel One", "bar-chart-outline", "/settings/angel-connect"),
  go("zebpay", "Zebpay", "logo-bitcoin", "/settings/zebpay-connect", "crypto"),
  // ── About ──
  go("help", "Help centre", "help-circle-outline", "/settings/help", "faq guide"),
  go("disclosure", "SMS disclosure", "document-text-outline", "/settings/sms-disclosure", "privacy what arth reads"),
  go("licences", "Open-source licences", "code-slash-outline", "/settings/licenses"),
  go("all-settings", "Settings", "settings-outline", SET),
];

/** Shown before anything's typed. */
export const SUGGESTED_ACTION_IDS = ["add-expense", "add-investment", "add-goal", "change-income", "my-month", "split", "sync", "vault"];

export function availableCatalog(): CatalogEntry[] {
  return SEARCH_CATALOG.filter((e) => {
    if (e.target && !isPathOn(e.target.pathname)) return false;
    if (e.only === "household") return getFlag("household");
    if (e.only === "ios") return Platform.OS === "ios";
    if (e.only === "android") return Platform.OS === "android";
    return true;
  });
}
