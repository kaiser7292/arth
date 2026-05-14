import {
  getMonthDateRange,
  getDaysRemaining,
  getTotalDaysInMonth,
  getBudgetStatus,
  getBudgetStatusColor,
  getPerDayRemaining,
} from "../../utils/budget-helpers";

describe("getMonthDateRange", () => {
  it("returns correct range for April 2026", () => {
    const range = getMonthDateRange("2026-04");
    expect(range.startDate).toBe("2026-04-01");
    expect(range.endDate).toBe("2026-04-30");
  });

  it("returns correct range for February (non-leap year)", () => {
    const range = getMonthDateRange("2025-02");
    expect(range.startDate).toBe("2025-02-01");
    expect(range.endDate).toBe("2025-02-28");
  });

  it("returns correct range for February (leap year)", () => {
    const range = getMonthDateRange("2028-02");
    expect(range.startDate).toBe("2028-02-01");
    expect(range.endDate).toBe("2028-02-29");
  });

  it("returns correct range for December", () => {
    const range = getMonthDateRange("2026-12");
    expect(range.startDate).toBe("2026-12-01");
    expect(range.endDate).toBe("2026-12-31");
  });
});

describe("getTotalDaysInMonth", () => {
  it("returns 30 for April", () => {
    expect(getTotalDaysInMonth("2026-04")).toBe(30);
  });

  it("returns 31 for January", () => {
    expect(getTotalDaysInMonth("2026-01")).toBe(31);
  });

  it("returns 28 for Feb non-leap", () => {
    expect(getTotalDaysInMonth("2025-02")).toBe(28);
  });

  it("returns 29 for Feb leap", () => {
    expect(getTotalDaysInMonth("2028-02")).toBe(29);
  });
});

describe("getDaysRemaining", () => {
  it("returns 0 for past months", () => {
    expect(getDaysRemaining("2020-01")).toBe(0);
  });

  it("returns full month days for future months", () => {
    expect(getDaysRemaining("2099-06")).toBe(30);
  });
});

describe("getBudgetStatus", () => {
  it("returns 'under' when spent < 70% of budget", () => {
    expect(getBudgetStatus(5000, 10000)).toBe("under");
    expect(getBudgetStatus(6999, 10000)).toBe("under");
  });

  it("returns 'warning' when spent is 70-90% of budget", () => {
    expect(getBudgetStatus(7000, 10000)).toBe("warning");
    expect(getBudgetStatus(8500, 10000)).toBe("warning");
    expect(getBudgetStatus(9000, 10000)).toBe("warning");
  });

  it("returns 'over' when spent > 90% of budget", () => {
    expect(getBudgetStatus(9001, 10000)).toBe("over");
    expect(getBudgetStatus(10000, 10000)).toBe("over");
    expect(getBudgetStatus(15000, 10000)).toBe("over");
  });

  it("returns 'over' when budget is 0 but spent > 0", () => {
    expect(getBudgetStatus(100, 0)).toBe("over");
  });

  it("returns 'under' when both are 0", () => {
    expect(getBudgetStatus(0, 0)).toBe("under");
  });
});

describe("getBudgetStatusColor", () => {
  it("returns green for under", () => {
    expect(getBudgetStatusColor("under")).toBe("#22C55E");
  });

  it("returns yellow for warning", () => {
    expect(getBudgetStatusColor("warning")).toBe("#F59E0B");
  });

  it("returns red for over", () => {
    expect(getBudgetStatusColor("over")).toBe("#EF4444");
  });
});

describe("getPerDayRemaining", () => {
  it("calculates remaining per day", () => {
    expect(getPerDayRemaining(10000, 5000, 10)).toBe(500);
  });

  it("returns 0 when no days remaining", () => {
    expect(getPerDayRemaining(10000, 5000, 0)).toBe(0);
  });

  it("returns 0 when over budget", () => {
    expect(getPerDayRemaining(10000, 12000, 5)).toBe(0);
  });

  it("rounds to 2 decimal places", () => {
    expect(getPerDayRemaining(10000, 3000, 7)).toBe(1000);
  });
});
