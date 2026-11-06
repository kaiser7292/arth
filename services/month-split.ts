import { DEFAULT_USER_ID } from "@/constants/app";
import { getBudgetsForMonth } from "@/services/budget";
import { getCategories } from "@/services/category";
import { getExpenseTotalsByCategoryAndClassification } from "@/services/expense";
import { getDebtServicing, type DebtServicingLoan } from "@/services/loan-accounts";
import { getFYStartMonth } from "@/services/settings";
import { getYearlyPlanByFY } from "@/services/yearly-plan";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { getCurrentFY } from "@/utils/fiscal-year";
import { calculateSplit, type SplitSnapshot } from "@/utils/unavoidable-split";

export interface MonthEmis {
  paid: number;
  prepaid: number;
  due: number;
  loans: DebtServicingLoan[];
}

export interface MonthSplit {
  /** Spending you choose, by unavoidable / discretionary. EMIs are never in here. */
  split: SplitSnapshot;
  /** Loan EMIs and prepayments: the budget's fixed part, from the loan schedules. */
  emis: MonthEmis;
  /** Monthly income from the plan of the financial year the month belongs to; null without a plan. */
  monthlyIncome: number | null;
}

const NO_EMIS: MonthEmis = { paid: 0, prepaid: 0, due: 0, loans: [] };

/**
 * One month's spending split plus its EMIs, for the Budget tab's summary and its Spending Split
 * page, so both show the same numbers. EMIs stay out of the split (so its percentages compare with
 * past months) but count against what the month could save, since they are paid whatever happens.
 */
export async function getMonthSplit(month: string, userId: string = DEFAULT_USER_ID): Promise<MonthSplit> {
  const { startDate, endDate } = getMonthDateRange(month);
  const [categories, budgets, actuals, emis] = await Promise.all([
    getCategories(userId),
    getBudgetsForMonth(userId, month),
    getExpenseTotalsByCategoryAndClassification(userId, startDate, endDate),
    // EMIs only add to the picture; a failure here mustn't hide the month's spending.
    getDebtServicing(userId, startDate, endDate).catch(() => NO_EMIS),
  ]);

  let monthlyIncome: number | null = null;
  try {
    const [y, m] = month.split("-").map(Number);
    const fy = getCurrentFY(getFYStartMonth(), new Date(y, m - 1, 1));
    const plan = await getYearlyPlanByFY(userId, String(fy));
    if (plan) monthlyIncome = (plan.annual_salary_in_hand + plan.expected_bonus) / 12;
  } catch {
    // No plan
  }

  const split = calculateSplit({
    items: actuals.map((a) => ({
      categoryId: a.category_id,
      spent: a.total,
      bucket: a.is_unavoidable === 1 ? "unavoidable" : a.is_unavoidable === 0 ? "discretionary" : "unclassified",
    })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, isUnavoidable: c.is_unavoidable === 1 })),
    categoryBudgets: new Map(budgets.map((b) => [b.category_id, b.amount])),
    monthlyIncome,
  });
  // An EMI is paid whatever else happens, so it comes off the most the month could save. The larger
  // of paid and due, like unavoidable costs: one not paid yet this month still counts.
  if (split.maxPossibleSavings !== null) {
    split.maxPossibleSavings -= Math.max(emis.paid, emis.due);
  }
  return { split, emis, monthlyIncome };
}
