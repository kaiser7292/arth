import type { ExpenseClassificationRow } from "@/services/analytics/classifier";
import { formatAmount } from "@/utils/format";

/**
 * How a learned bill pattern (expense_classifications) reads on screen, and how the Patterns
 * screen sorts them. Shared by the "Monthly bills" check-in and Insights → Patterns so both
 * describe the same pattern the same way.
 */

export const EVERY: Record<string, string> = {
  weekly: "every week",
  monthly: "every month",
  quarterly: "every 3 months",
  yearly: "every year",
};

export function dayText(day: number | null): string {
  if (!day) return "—";
  if (day >= 31) return "End of the month";
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `Around the ${day}${suffix}`;
}

export function amountText(c: Pick<ExpenseClassificationRow, "amount_range_low" | "amount_range_high">): string {
  return Math.round(c.amount_range_low) === Math.round(c.amount_range_high)
    ? formatAmount(c.amount_range_low)
    : `${formatAmount(c.amount_range_low)}–${formatAmount(c.amount_range_high)}`;
}

const PER_MONTH: Record<string, number> = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

/** What a pattern costs in an average month (a yearly ₹12,000 bill is ₹1,000 a month). */
export function monthlyEquivalent(
  c: Pick<ExpenseClassificationRow, "amount_range_low" | "amount_range_high" | "frequency">,
): number {
  const each = (c.amount_range_low + c.amount_range_high) / 2;
  return each * (PER_MONTH[c.frequency ?? "monthly"] ?? 1);
}

export interface PatternGroups {
  /** Spotted automatically, not yet answered. Already counted in the projection. */
  toConfirm: ExpenseClassificationRow[];
  /** Bills you confirmed or edited. */
  yours: ExpenseClassificationRow[];
  /** Your bills that haven't been seen lately — left out of the projection until they return. */
  paused: ExpenseClassificationRow[];
  /** Merchants you said aren't bills. */
  notBills: ExpenseClassificationRow[];
}

export function groupPatterns(rows: ExpenseClassificationRow[]): PatternGroups {
  const groups: PatternGroups = { toConfirm: [], yours: [], paused: [], notBills: [] };
  for (const c of rows) {
    if (c.classification === "variable") groups.notBills.push(c);
    else if (c.is_active !== 1) groups.paused.push(c);
    else if (c.source === "auto_detected") groups.toConfirm.push(c);
    else groups.yours.push(c);
  }
  const byCost = (a: ExpenseClassificationRow, b: ExpenseClassificationRow) => monthlyEquivalent(b) - monthlyEquivalent(a);
  groups.toConfirm.sort(byCost);
  groups.yours.sort(byCost);
  groups.paused.sort(byCost);
  groups.notBills.sort((a, b) => a.merchant_normalized.localeCompare(b.merchant_normalized));
  return groups;
}

/** The bills the month-end projection counts: active, fixed or semi-fixed. */
export function countedBills(rows: ExpenseClassificationRow[]): ExpenseClassificationRow[] {
  return rows.filter((c) => c.is_active === 1 && c.classification !== "variable");
}
