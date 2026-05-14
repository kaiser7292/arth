import { getExpenses } from "@/services/expense-queries";
import { getBudgetsForMonth } from "@/services/budget";
import { getCategories, type Category } from "@/services/category";
import { getRecurringTransactions, type RecurringTransaction } from "@/services/recurring-detector";
import { deriveYearlyPlan } from "@/services/yearly-plan";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { getCurrentFY } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";
import type { Expense } from "@/services/expense-types";
import type { Budget } from "@/services/budget";
import type { ClassifiedExpense, Classification } from "@/utils/analytics/types";
import { normalizeMerchant } from "@/services/smart-categorizer";

export interface AnalyticsDatasets {
  expenses: Expense[];
  previousMonthExpenses: Expense[];
  threeMonthExpenses: Expense[];
  budgets: Budget[];
  categories: Category[];
  categoryNameMap: Map<string, string>;
  categoryUnavoidableMap: Map<string, boolean>;
  recurringTransactions: RecurringTransaction[];
  monthlyIncome: number;
  dataMonths: number;
  currentMonth: string;
}

export async function fetchAnalyticsDatasets(
  userId: string,
  month?: string
): Promise<AnalyticsDatasets> {
  const now = new Date();
  const currentMonth = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const { startDate, endDate } = getMonthDateRange(currentMonth);

  const prevMonth = getPreviousMonth(currentMonth);
  const { startDate: prevStart, endDate: prevEnd } = getMonthDateRange(prevMonth);

  const threeMonthsAgo = getMonthOffset(currentMonth, -3);
  const { startDate: threeStart } = getMonthDateRange(threeMonthsAgo);

  const startMonth = getFYStartMonth();
  const currentFY = getCurrentFY(startMonth);
  const fy = String(currentFY);

  const [
    expenses,
    previousMonthExpenses,
    threeMonthExpenses,
    budgets,
    categories,
    recurringTransactions,
    derivedPlan,
  ] = await Promise.all([
    getExpenses(userId, startDate, endDate),
    getExpenses(userId, prevStart, prevEnd),
    getExpenses(userId, threeStart, endDate),
    getBudgetsForMonth(userId, currentMonth),
    getCategories(userId),
    getRecurringTransactions(userId),
    deriveYearlyPlan(userId, fy).catch(() => null),
  ]);

  const categoryNameMap = new Map(categories.map((c) => [c.id, c.name]));
  const categoryUnavoidableMap = new Map(
    categories.map((c) => [c.id, c.is_unavoidable === 1])
  );

  const monthlyIncome = derivedPlan ? Math.round(derivedPlan.total_income / 12) : 0;

  const dataMonths = recurringTransactions.length > 0
    ? Math.max(2, Math.min(recurringTransactions.reduce((max, r) => Math.max(max, r.occurrence_count), 0), 12))
    : estimateDataMonths(threeMonthExpenses);

  return {
    expenses,
    previousMonthExpenses,
    threeMonthExpenses,
    budgets,
    categories,
    categoryNameMap,
    categoryUnavoidableMap,
    recurringTransactions,
    monthlyIncome,
    dataMonths,
    currentMonth,
  };
}

export function classifyExpenses(
  expenses: Expense[],
  recurringTransactions: RecurringTransaction[]
): ClassifiedExpense[] {
  const recurringMerchants = new Map(
    recurringTransactions
      .filter((r) => r.is_confirmed === 1 || r.occurrence_count >= 3)
      .map((r) => [r.merchant_normalized, r])
  );

  return expenses.map((e) => {
    const normalized = e.merchant_name
      ? normalizeMerchant(e.merchant_name)
      : "";
    const matchedRecurring = recurringMerchants.get(normalized);

    let classification: Classification = "variable";
    if (matchedRecurring) {
      const amountTolerance = matchedRecurring.amount * 0.1;
      if (Math.abs(e.amount - matchedRecurring.amount) <= amountTolerance) {
        classification = "fixed";
      } else {
        classification = "semi_fixed";
      }
    }

    return {
      id: e.id,
      amount: e.amount,
      date: e.date,
      categoryId: e.category_id ?? "",
      merchantNormalized: normalized,
      accountId: e.account_id,
      paymentMode: e.payment_mode_id,
      classification,
      isRightSpend: e.is_right_spend === 1,
    };
  });
}

// ─── Helpers ───

function getPreviousMonth(month: string): string {
  return getMonthOffset(month, -1);
}

function getMonthOffset(month: string, offset: number): string {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(year, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function estimateDataMonths(expenses: Expense[]): number {
  if (expenses.length === 0) return 0;
  const months = new Set(expenses.map((e) => e.date.slice(0, 7)));
  return months.size;
}
