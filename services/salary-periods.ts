import { getDatabase } from "@/database";
import { computeIncomeProfile, deriveDirectBaseMonthly } from "@/services/income-calculation";
import { MONEY_IN_FROM } from "@/services/money-in-sql";
import { getSalaryProfileByFY, updateSalaryProfile, type SalaryProfile } from "@/services/salary-profile";
import { bumpDataVersion, getFYStartMonth } from "@/services/settings";
import { settingsStorage } from "@/services/storage";
import { getCurrentFY } from "@/utils/fiscal-year";

/**
 * Which month each salary credit belongs to, and how that compares with the Income Calculator. What
 * was actually credited is what counts for a period: the yearly plan, My month and the salary check
 * all read from here. Salary only; business income has no salary-tagged credits to compare.
 */

export type SalaryMonthOffset = -1 | 0 | 1;
export type SalaryMonthStatus = "match" | "more" | "less" | "missing" | "upcoming";

export interface SalaryMonth {
  month: string;
  /** 0-based position in the financial year, the key of monthly_overrides. */
  index: number;
  expected: number;
  credited: number;
  status: SalaryMonthStatus;
  /** The day this month's salary should arrive (YYYY-MM-DD). */
  dueDate: string;
}

/** Days after pay day before a month with no salary is called out. */
const GRACE_DAYS = 3;

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The month a credit counts for: its own choice if it has one, otherwise the setting. */
export function creditPeriod(date: string, override: string | null | undefined, offset: number): string {
  return override || shiftMonth(date.slice(0, 7), offset);
}

/** Small differences aren't news: rounding, a rupee of interest. */
export function salaryStatus(expected: number, credited: number): "match" | "more" | "less" {
  const difference = credited - expected;
  if (Math.abs(difference) <= Math.max(100, expected * 0.005)) return "match";
  return difference > 0 ? "more" : "less";
}

/** The salary the calculator expects for each month of the year, or null when there's no salary to compare. */
export function expectedSalaryByMonth(profile: SalaryProfile, fyYear: number): number[] | null {
  if (profile.income_type === "business") return null;
  const income = computeIncomeProfile(profile, fyYear);
  if (income.kind === "business") return null;
  if (income.kind === "direct") {
    let overrides: Record<number, string> = {};
    try {
      overrides = profile.monthly_overrides ? JSON.parse(profile.monthly_overrides) : {};
    } catch {
      overrides = {};
    }
    const base = deriveDirectBaseMonthly(profile.computed_monthly_in_hand ?? 0, overrides);
    return Array.from({ length: 12 }, (_, i) => (overrides[i] !== undefined ? parseFloat(overrides[i]) || 0 : base));
  }
  // Salary only: side income in the in-hand figure wouldn't arrive as a salary credit.
  return Array.from({ length: 12 }, () => income.primaryAnnualInHand / 12);
}

async function salaryCredits(userId: string, from: string, to: string) {
  return getDatabase().getAllAsync<{ amount: number; date: string; salary_for_month: string | null }>(
    `SELECT e.amount, e.date, e.salary_for_month ${MONEY_IN_FROM} AND e.credit_kind = 'salary';`,
    userId, from, to,
  );
}

const firstDay = (month: string) => `${month}-01`;
const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
};

/** Every month of a financial year, with what was expected and credited. Empty without a salary to compare. */
export async function getSalaryMonths(
  userId: string,
  financialYear: string,
  today: Date = new Date(),
  knownProfile?: SalaryProfile | null,
): Promise<SalaryMonth[]> {
  const profile = knownProfile === undefined ? await getSalaryProfileByFY(userId, financialYear) : knownProfile;
  if (!profile || !(profile.computed_monthly_in_hand > 0)) return [];
  const fyYear = parseInt(financialYear, 10);
  const expected = expectedSalaryByMonth(profile, fyYear);
  if (!expected) return [];

  const startMonth = getFYStartMonth();
  const first = `${fyYear}-${String(startMonth).padStart(2, "0")}`;
  const months = expected.map((_, i) => shiftMonth(first, i));
  const offset = profile.salary_month_offset ?? 0;

  // A wider window: a credit either side of the year can belong to it.
  const credits = await salaryCredits(userId, firstDay(shiftMonth(first, -2)), lastDay(shiftMonth(first, 13)));
  const byPeriod = new Map<string, number>();
  for (const c of credits) {
    const period = creditPeriod(c.date, c.salary_for_month, offset);
    byPeriod.set(period, (byPeriod.get(period) ?? 0) + c.amount);
  }

  return months.map((month, index) => {
    const credited = byPeriod.get(month) ?? 0;
    const creditMonth = shiftMonth(month, -offset);
    const [y, m] = creditMonth.split("-").map(Number);
    const payDay = Math.min(profile.salary_credit_day ?? 25, new Date(y, m, 0).getDate());
    let status: SalaryMonthStatus;
    if (credited > 0) {
      status = salaryStatus(expected[index], credited);
    } else {
      status = today > new Date(y, m - 1, payDay + GRACE_DAYS, 23, 59, 59) ? "missing" : "upcoming";
    }
    return { month, index, expected: expected[index], credited, status, dueDate: `${creditMonth}-${String(payDay).padStart(2, "0")}` };
  });
}

/**
 * How far actual salary moves the year from plan. Months with a credit count as credited; a past
 * month with none keeps its planned figure, because one forgotten tag shouldn't wipe a month's income.
 */
export function salaryPlanAdjustment(rows: SalaryMonth[]): { months: number; difference: number; missing: number } {
  const actual = rows.filter((r) => r.credited > 0);
  return {
    months: actual.length,
    difference: Math.round(actual.reduce((s, r) => s + r.credited - r.expected, 0) * 100) / 100,
    missing: rows.filter((r) => r.status === "missing").length,
  };
}

/** Bonus credits received in the financial year. */
export async function getBonusReceived(userId: string, from: string, to: string): Promise<number> {
  const row = await getDatabase().getFirstAsync<{ total: number | null }>(
    `SELECT COALESCE(SUM(e.amount), 0) AS total ${MONEY_IN_FROM} AND e.credit_kind = 'bonus';`,
    userId, from, to,
  );
  return row?.total ?? 0;
}

const financialYearOf = (month: string) => String(getCurrentFY(getFYStartMonth(), new Date(`${month}-15T12:00:00`)));

/** Salary counted for a month, and what arrived during it, for showing the month after the setting moves it. */
export async function getSalaryForMonth(userId: string, month: string): Promise<{ counted: number; arrived: number }> {
  const profile = await getSalaryProfileByFY(userId, financialYearOf(month)).catch(() => null);
  const offset = profile?.salary_month_offset ?? 0;
  const credits = await salaryCredits(userId, firstDay(shiftMonth(month, -2)), lastDay(shiftMonth(month, 2)));
  let counted = 0;
  let arrived = 0;
  for (const c of credits) {
    if (creditPeriod(c.date, c.salary_for_month, offset) === month) counted += c.amount;
    if (c.date.slice(0, 7) === month) arrived += c.amount;
  }
  return { counted, arrived };
}

/** Whether this month's salary is still on its way, or overdue. Null once it's in, or with no salary to compare. */
export async function getMonthSalaryState(
  userId: string,
  month: string,
  today: Date = new Date(),
): Promise<{ state: "due"; date: string; amount: number } | { state: "missing" } | null> {
  const rows = await getSalaryMonths(userId, financialYearOf(month), today);
  const row = rows.find((r) => r.month === month);
  if (row?.status === "upcoming") return { state: "due", date: row.dueDate, amount: row.expected };
  if (row?.status === "missing") return { state: "missing" };
  return null;
}

/** The month a credit counts for today, and the setting's default for it. */
export async function getCreditSalaryMonth(userId: string, date: string, override: string | null | undefined) {
  const month = date.slice(0, 7);
  const profile = await getSalaryProfileByFY(userId, financialYearOf(month)).catch(() => null);
  const fallback = shiftMonth(month, profile?.salary_month_offset ?? 0);
  return { month: override || fallback, fallback };
}

/** Moves one salary credit to a month; null puts it back on the setting. */
export async function setCreditSalaryMonth(expenseId: string, month: string | null): Promise<void> {
  await getDatabase().runAsync(
    "UPDATE expenses SET salary_for_month = ?, updated_at = datetime('now') WHERE id = ?;",
    month,
    expenseId,
  );
  bumpDataVersion();
}

// ── The salary check ──

const dismissKey = (month: string) => `salary_check_dismissed__${month}`;

export function dismissSalaryCheck(month: string): void {
  settingsStorage.set(dismissKey(month), true);
}

export interface SalaryCheck extends SalaryMonth {
  status: "more" | "less" | "missing";
  /** "month": the calculator can change just this month. "in_hand": it holds one figure for the year. */
  adopts: "month" | "in_hand";
}

/** Months that differ and haven't been dismissed, for one month or a whole financial year. */
export async function getSalaryChecks(userId: string, scope: { month: string } | { financialYear: string }): Promise<SalaryCheck[]> {
  const financialYear = "month" in scope ? financialYearOf(scope.month) : scope.financialYear;
  const profile = await getSalaryProfileByFY(userId, financialYear);
  const rows = await getSalaryMonths(userId, financialYear, new Date(), profile);
  const adopts = profile?.input_mode === "direct" ? "month" : "in_hand";
  return rows
    .filter((r) => r.status === "more" || r.status === "less" || r.status === "missing")
    .filter((r) => !("month" in scope) || r.month === scope.month)
    .filter((r) => settingsStorage.getBoolean(dismissKey(r.month)) !== true)
    .map((r) => ({ ...r, status: r.status as SalaryCheck["status"], adopts }));
}

/**
 * The credited amount, as what the calculator should expect. Direct: just that month. CTC: it holds
 * one in-hand figure, so that figure changes; months already credited still count as credited.
 */
export async function adoptCreditedSalary(userId: string, financialYear: string, check: SalaryCheck): Promise<void> {
  const profile = await getSalaryProfileByFY(userId, financialYear);
  if (!profile) return;
  if (check.adopts === "month") {
    const { overrides, average } = withMonthOverride(profile, check.index, check.credited);
    await updateSalaryProfile(profile.id, { monthly_overrides: JSON.stringify(overrides), computed_monthly_in_hand: average });
  } else {
    const income = computeIncomeProfile({ ...profile, manual_monthly_in_hand: check.credited }, parseInt(financialYear, 10));
    await updateSalaryProfile(profile.id, { manual_monthly_in_hand: check.credited, computed_monthly_in_hand: income.monthlyInHand });
  }
  bumpDataVersion();
}

/** Sets one month, leaving the others' amounts exactly as they were. */
export function withMonthOverride(profile: Pick<SalaryProfile, "monthly_overrides" | "computed_monthly_in_hand">, index: number, amount: number) {
  let overrides: Record<number, string> = {};
  try {
    overrides = profile.monthly_overrides ? JSON.parse(profile.monthly_overrides) : {};
  } catch {
    overrides = {};
  }
  const base = deriveDirectBaseMonthly(profile.computed_monthly_in_hand ?? 0, overrides);
  const next = { ...overrides, [index]: String(amount) };
  let total = 0;
  for (let i = 0; i < 12; i++) total += next[i] !== undefined ? parseFloat(next[i]) || 0 : base;
  return { overrides: next, average: total / 12 };
}
