// Barrel re-export — all expense functionality split into focused modules.
// Consumers continue to import from "@/services/expense" with no changes.

export type {
  Expense,
  CreateExpenseInput,
  UpdateExpenseInput,
  SplitMode,
  SplitConfig,
  ExpenseFilters,
  CategoryActual,
  MonthlyTotal,
  ForecastMatch,
  ForecastMatchPair,
} from "./expense-types";

export {
  createExpense,
  updateExpense,
  deleteExpense,
  permanentlyDeleteExpense,
  restoreExpense,
  getDeletedExpenses,
  getRejectedExpenses,
  purgeOldDeletedExpenses,
  approveExpense,
  approveExpenses,
  approveCcRepaymentCredit,
  rejectExpense,
  rejectExpenses,
  restoreAllDeletedExpenses,
  approveAllRejectedExpenses,
  deleteAllRejectedExpenses,
  remapExpenses,
  bulkAssignCategory,
  undoRefund,
} from "./expense-crud";

export type { FilteredSummary, FilteredSummaryGroup } from "./expense-queries";

export {
  getExpenses,
  getExpenseById,
  getExpensesByIds,
  getExpensesPaginated,
  getFilteredExpenseSummary,
  getPreviousPeriodTotal,
  getExpenseTotal,
  getMonthlyExpenseTotals,
  getExpenseTotalsByCategory,
  getExpenseIdsByCategory,
  getExpenseTotalsByCategoryAndClassification,
  getCategoryMonthlyTrend,
  getRightSpendTotal,
  getTopCategoriesBySpending,
  getExpenseCount,
  getUncategorizedTotal,
  getUncategorizedCount,
  getUncategorizedExpenses,
  getPendingExpensesForReview,
  getPendingExpenseCount,
} from "./expense-queries";

export {
  removeSplit,
  deleteSplitExpense,
  computeSplitAmounts,
  splitNewExpense,
  splitExistingExpense,
} from "./expense-splits";

export {
  applyMultiSplit,
  removeMultiSplit,
  getMultiSplitSummary,
} from "./expense-multi-split";

export type {
  MultiSplitEntry,
  MultiSplitConfig,
  ExpenseSplitRow,
  MultiSplitSummary,
} from "./expense-multi-split";

export {
  MAX_PURCHASE_GROUP_LEGS,
  createSplitTender,
  getGroupSiblings,
  unlinkFromGroup,
  propagateSharedEdit,
  convertToSplitTender,
  addLegToExistingGroup,
} from "./purchase-group";

export {
  createRule as createRecurringRule,
  stopRule as stopRecurringRule,
  updateRule as updateRecurringRule,
  getRuleForExpense as getRecurringRuleForExpense,
  getActiveRules as getActiveRecurringRules,
  getReminders as getRecurringReminders,
  getDueReminders as getDueRecurringReminders,
  getLastFulfillment as getReminderLastFulfillment,
  findCandidateExpenses as findReminderCandidateExpenses,
  fulfillReminder,
  unfulfillReminder,
  skipReminderCycle,
  suggestReminderForExpense,
  onSourceExpenseDeleted as onRecurringSourceDeleted,
  onFulfillingExpenseDeleted,
  getReminderDetail,
} from "./recurring-rules";

export type {
  RecurringRule,
  CreateRuleInput as CreateRecurringRuleInput,
  RecurringFrequency,
  ReminderWithSource,
  ReminderFulfillment,
  ReminderDetail,
  ReminderHistoryEntry,
} from "./recurring-rules";

export type {
  CreateSplitTenderInput,
  PurchaseGroupLeg,
} from "./purchase-group";

export {
  getForecastExpenses,
  getOverdueForecasts,
  realizeForecast,
  findMatchingForecast,
  getMatchedForecastPairs,
  resolveMatchRealize,
  resolveMatchAlreadyCaptured,
  resolveMatchBothDifferent,
  dismissOverdueForecasts,
  markForecastAsPaid,
  markExpenseForecastAsPaid,
  markRepaymentAsPaid,
  markForecastPaidExternally,
  findRefundTarget,
} from "./expense-forecasts";

export {
  effectiveAmountSql,
  getRefundedAmount,
  getRefundsForExpense,
  sumRefundsByExpenseIds,
  classifyRefund,
} from "./expense-effective-amount";

export type { RefundState } from "./expense-effective-amount";
