import { calculateMonthlySavingsTrend, calculateSavingsSnapshot } from "@/utils/savings-calculations";
import { formatAsOf, formatRelativeDateTime, parseSqliteUtc } from "@/utils/date";

describe("EMI interest in the savings rate", () => {
  const base = {
    annualSalary: 2400000,
    expectedBonus: 0,
    targetSavingsRatePct: 25,
    totalExpenses: 900000,
    monthsElapsed: 6,
  };

  test("interest comes out of what was saved, expenses stay as they are", () => {
    const r = calculateSavingsSnapshot({ ...base, loanInterest: 60000 });
    expect(r.totalExpenses).toBe(900000);
    expect(r.loanInterest).toBe(60000);
    // 12L income - 9L spent - 60k interest
    expect(r.actualSaved).toBe(240000);
    expect(r.actualSavingsRatePct).toBe(20);
  });

  test("no interest leaves the snapshot unchanged", () => {
    const r = calculateSavingsSnapshot(base);
    expect(r.loanInterest).toBe(0);
    expect(r.actualSaved).toBe(300000);
  });

  test("monthly trend takes each month's interest off saved", () => {
    const trend = calculateMonthlySavingsTrend({
      annualSalary: 1200000,
      monthlyExpenses: new Map([[1, 50000], [2, 50000]]),
      monthsToShow: 2,
      monthlyLoanInterest: new Map([[2, 10000]]),
    });
    expect(trend[0].saved).toBe(50000);
    expect(trend[1].saved).toBe(40000);
    expect(trend[1].expenses).toBe(50000);
    expect(trend[1].savingsRatePct).toBe(40);
  });
});

describe("dates with times", () => {
  test("SQLite timestamps are read as UTC", () => {
    expect(parseSqliteUtc("2026-11-05 11:42:10")?.toISOString()).toBe("2026-11-05T11:42:10.000Z");
    expect(parseSqliteUtc("2026-11-05T11:42:10.000Z")?.toISOString()).toBe("2026-11-05T11:42:10.000Z");
    expect(parseSqliteUtc(null)).toBeNull();
    expect(parseSqliteUtc("nonsense")).toBeNull();
  });

  test("as of: time only when the value was saved on its own day", () => {
    const saved = new Date(2026, 10, 5, 17, 12);
    const savedSql = saved.toISOString().replace("T", " ").slice(0, 19);
    expect(formatAsOf("2026-11-05", savedSql)).toMatch(/^5 Nov 2026, 5:12\s?pm$/);
    // A value typed in on the 5th for the 3rd has no time of its own.
    expect(formatAsOf("2026-11-03", savedSql)).toBe("3 Nov 2026");
    expect(formatAsOf("2026-11-03", null)).toBe("3 Nov 2026");
  });

  test("relative date and time", () => {
    const now = new Date(2026, 10, 6, 10, 0);
    expect(formatRelativeDateTime(new Date(2026, 10, 6, 9, 5).toISOString(), now)).toMatch(/^today, 9:05\s?am$/);
    expect(formatRelativeDateTime(new Date(2026, 10, 5, 17, 12).toISOString(), now)).toMatch(/^yesterday, 5:12\s?pm$/);
    expect(formatRelativeDateTime(new Date(2026, 10, 3, 17, 12).toISOString(), now)).toMatch(/^3 Nov, 5:12\s?pm$/);
    expect(formatRelativeDateTime(new Date(2025, 10, 3, 17, 12).toISOString(), now)).toMatch(/^3 Nov 2025, /);
    expect(formatRelativeDateTime("bad", now)).toBe("");
  });
});
