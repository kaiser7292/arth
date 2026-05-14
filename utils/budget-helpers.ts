/**
 * Get the first and last date of a month (YYYY-MM format).
 */
export function getMonthDateRange(month: string): {
  startDate: string;
  endDate: string;
} {
  const [year, m] = month.split("-").map(Number);
  const startDate = `${year}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(year, m, 0).getDate();
  const endDate = `${year}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { startDate, endDate };
}

/**
 * Get days remaining in the current month (including today).
 * Returns 0 if the month is in the past.
 */
export function getDaysRemaining(month: string): number {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  if (month < currentMonth) return 0;
  if (month > currentMonth) {
    const [year, m] = month.split("-").map(Number);
    return new Date(year, m, 0).getDate();
  }

  const [year, m] = month.split("-").map(Number);
  const lastDay = new Date(year, m, 0).getDate();
  return lastDay - now.getDate() + 1;
}

/**
 * Get total days in a month.
 */
export function getTotalDaysInMonth(month: string): number {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m, 0).getDate();
}

export type BudgetStatus = "under" | "warning" | "over";

/**
 * Determine budget status based on percentage spent.
 * under: < 70%, warning: 70-90%, over: > 90%
 */
export function getBudgetStatus(spent: number, budget: number): BudgetStatus {
  if (budget <= 0) return spent > 0 ? "over" : "under";
  const pct = spent / budget;
  if (pct > 0.9) return "over";
  if (pct >= 0.7) return "warning";
  return "under";
}

/**
 * Get the color for a budget status.
 */
export function getBudgetStatusColor(status: BudgetStatus): string {
  switch (status) {
    case "under":
      return "#22C55E";
    case "warning":
      return "#F59E0B";
    case "over":
      return "#EF4444";
  }
}

/**
 * Calculate per-day budget remaining.
 */
export function getPerDayRemaining(
  budget: number,
  spent: number,
  daysRemaining: number,
): number {
  if (daysRemaining <= 0) return 0;
  const remaining = budget - spent;
  if (remaining <= 0) return 0;
  return Math.round((remaining / daysRemaining) * 100) / 100;
}
