import { getMonthDateRange } from "@/utils/budget-helpers";
import { formatLocalDate, getCurrentFY, getFYLabel, getFYRange } from "@/utils/fiscal-year";

/** The periods Budget vs actual and Money in and out both offer. */
export type InsightPeriod = "this_month" | "last_3m" | "last_6m" | "this_fy" | "last_fy" | "custom";

export const INSIGHT_PERIODS: InsightPeriod[] = ["this_month", "last_3m", "last_6m", "this_fy", "last_fy", "custom"];

export function isInsightPeriod(value: unknown): value is InsightPeriod {
  return INSIGHT_PERIODS.includes(value as InsightPeriod);
}

export function insightPeriodLabel(period: InsightPeriod, fyStartMonth: number): string {
  switch (period) {
    case "this_month":
      return "This Month";
    case "last_3m":
      return "Last 3M";
    case "last_6m":
      return "Last 6M";
    case "this_fy":
      return getFYLabel(getCurrentFY(fyStartMonth), fyStartMonth);
    case "last_fy":
      return getFYLabel(getCurrentFY(fyStartMonth) - 1, fyStartMonth);
    case "custom":
      return "Custom";
  }
}

export function insightPeriodRange(
  period: InsightPeriod,
  fyStartMonth: number,
  customStart?: string,
  customEnd?: string,
): { startMonth: string; endMonth: string; startDate: string; endDate: string } {
  const now = new Date();
  const todayStr = formatLocalDate(now);
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  const currentMonth = `${y}-${pad(m)}`;

  const toMonthStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

  switch (period) {
    case "this_month": {
      const { startDate } = getMonthDateRange(currentMonth);
      return { startMonth: currentMonth, endMonth: currentMonth, startDate, endDate: todayStr };
    }
    case "last_3m": {
      const sm = toMonthStr(new Date(y, m - 3, 1));
      return { startMonth: sm, endMonth: currentMonth, startDate: getMonthDateRange(sm).startDate, endDate: todayStr };
    }
    case "last_6m": {
      const sm = toMonthStr(new Date(y, m - 6, 1));
      return { startMonth: sm, endMonth: currentMonth, startDate: getMonthDateRange(sm).startDate, endDate: todayStr };
    }
    case "this_fy": {
      const fyYear = getCurrentFY(fyStartMonth);
      const { start } = getFYRange(fyYear, fyStartMonth);
      const sm = toMonthStr(start);
      return { startMonth: sm, endMonth: currentMonth, startDate: getMonthDateRange(sm).startDate, endDate: todayStr };
    }
    case "last_fy": {
      const fyYear = getCurrentFY(fyStartMonth) - 1;
      const { start, end } = getFYRange(fyYear, fyStartMonth);
      const sm = toMonthStr(start);
      const em = toMonthStr(end);
      return {
        startMonth: sm,
        endMonth: em,
        startDate: getMonthDateRange(sm).startDate,
        endDate: getMonthDateRange(em).endDate,
      };
    }
    case "custom": {
      const sm = customStart ?? currentMonth;
      const em = customEnd ?? currentMonth;
      const endIsCurrentMonth = em >= currentMonth;
      return {
        startMonth: sm,
        endMonth: em,
        startDate: getMonthDateRange(sm).startDate,
        endDate: endIsCurrentMonth ? todayStr : getMonthDateRange(em).endDate,
      };
    }
  }
}
