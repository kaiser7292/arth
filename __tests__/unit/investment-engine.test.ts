/**
 * Investment engine (FD math) — pure functions, no DB.
 */

import {
  computeFDMaturityValue,
  computeFDInterest,
  generateFDSchedule,
  currentFDValue,
  addMonthsClamped,
  addFDTerm,
  fdTermBetween,
  formatFDTerm,
} from "../../services/investment-engine";

describe("computeFDMaturityValue", () => {
  it("computes simple interest for exactly one year", () => {
    const value = computeFDMaturityValue({
      principal: 100000,
      interest_rate_pa: 7,
      start_date: "2025-01-01",
      maturity_date: "2026-01-01",
      interest_method: "simple",
    });
    // 365 days at 365 days a year is exactly one year.
    expect(value).toBe(107000);
  });

  it("compound interest yields more than simple interest for the same rate and term", () => {
    const simple = computeFDMaturityValue({
      principal: 100000,
      interest_rate_pa: 7,
      start_date: "2025-01-01",
      maturity_date: "2027-01-01",
      interest_method: "simple",
    });
    const compound = computeFDMaturityValue({
      principal: 100000,
      interest_rate_pa: 7,
      start_date: "2025-01-01",
      maturity_date: "2027-01-01",
      interest_method: "compound",
      compounding_freq: "quarterly",
    });
    expect(compound).toBeGreaterThan(simple);
  });

  it("returns the principal unchanged for a non-positive or invalid term", () => {
    expect(
      computeFDMaturityValue({
        principal: 50000,
        interest_rate_pa: 6,
        start_date: "2026-01-01",
        maturity_date: "2026-01-01",
        interest_method: "simple",
      }),
    ).toBe(50000);
  });

  it("defaults to quarterly compounding when none is specified", () => {
    const withDefault = computeFDMaturityValue({
      principal: 100000,
      interest_rate_pa: 7,
      start_date: "2025-01-01",
      maturity_date: "2026-01-01",
      interest_method: "compound",
    });
    const withQuarterly = computeFDMaturityValue({
      principal: 100000,
      interest_rate_pa: 7,
      start_date: "2025-01-01",
      maturity_date: "2026-01-01",
      interest_method: "compound",
      compounding_freq: "quarterly",
    });
    expect(withDefault).toBe(withQuarterly);
  });
});

describe("generateFDSchedule", () => {
  it("produces exactly one maturity row carrying both principal and interest", () => {
    const schedule = generateFDSchedule({
      principal: 100000,
      interest_rate_pa: 7,
      start_date: "2025-01-01",
      maturity_date: "2026-01-01",
      interest_method: "simple",
    });
    expect(schedule).toHaveLength(1);
    expect(schedule[0].kind).toBe("maturity");
    expect(schedule[0].event_date).toBe("2026-01-01");
    expect(schedule[0].principal_component).toBe(100000);
    expect(schedule[0].interest_component).toBeGreaterThan(6900);
    expect(schedule[0].status).toBe("scheduled");
  });

  it("gives every generated entry a unique id", () => {
    const a = generateFDSchedule({
      principal: 1000, interest_rate_pa: 5, start_date: "2025-01-01",
      maturity_date: "2026-01-01", interest_method: "simple",
    });
    const b = generateFDSchedule({
      principal: 1000, interest_rate_pa: 5, start_date: "2025-01-01",
      maturity_date: "2026-01-01", interest_method: "simple",
    });
    expect(a[0].id).not.toBe(b[0].id);
  });
});

describe("computeFDInterest — whole-rupee rounding, half rounds down", () => {
  // Solve for the interest_rate_pa that makes simple interest land on an exact
  // target raw value, given the engine's days / 365 year fraction — lets us hit
  // the exact .5 boundaries the rounding rule cares about.
  function rateForTargetInterest(principal: number, days: number, targetInterest: number): number {
    const t = days / 365;
    return (targetInterest / (principal * t)) * 100;
  }

  it("rounds exactly 0.5 down, not up", () => {
    const principal = 1_000_000;
    const days = 365;
    const rate = rateForTargetInterest(principal, days, 100.5);
    const interest = computeFDInterest({
      principal,
      interest_rate_pa: rate,
      start_date: "2025-01-01",
      maturity_date: "2026-01-01",
      interest_method: "simple",
    });
    expect(interest).toBe(100);
  });

  it("rounds just above 0.5 up", () => {
    const principal = 1_000_000;
    const days = 365;
    const rate = rateForTargetInterest(principal, days, 100.500001);
    const interest = computeFDInterest({
      principal,
      interest_rate_pa: rate,
      start_date: "2025-01-01",
      maturity_date: "2026-01-01",
      interest_method: "simple",
    });
    expect(interest).toBe(101);
  });

  it("rounds just below 0.5 down", () => {
    const principal = 1_000_000;
    const days = 365;
    const rate = rateForTargetInterest(principal, days, 100.499999);
    const interest = computeFDInterest({
      principal,
      interest_rate_pa: rate,
      start_date: "2025-01-01",
      maturity_date: "2026-01-01",
      interest_method: "simple",
    });
    expect(interest).toBe(100);
  });

  it("computeFDMaturityValue equals principal + the same whole-rupee interest", () => {
    const params = {
      principal: 250000,
      interest_rate_pa: 7.25,
      start_date: "2025-03-01",
      maturity_date: "2026-09-01",
      interest_method: "compound" as const,
      compounding_freq: "quarterly" as const,
    };
    const interest = computeFDInterest(params);
    expect(Number.isInteger(interest)).toBe(true);
    expect(computeFDMaturityValue(params)).toBe(params.principal + interest);
  });
});

describe("currentFDValue", () => {
  it("is the principal while active", () => {
    expect(currentFDValue(50000, "active")).toBe(50000);
  });

  it("is zero once closed", () => {
    expect(currentFDValue(50000, "closed")).toBe(0);
  });

  it("is zero once matured — the principal has already moved out via a real transfer", () => {
    expect(currentFDValue(50000, "matured")).toBe(0);
  });
});

describe("computeFDMaturityValue — bank method (completed quarters + broken days at 365)", () => {
  const fd = (principal: number, rate: number, start: string, maturity: string) =>
    computeFDMaturityValue({
      principal,
      interest_rate_pa: rate,
      start_date: start,
      maturity_date: maturity,
      interest_method: "compound",
      compounding_freq: "quarterly",
    });

  // Figures from docs/FD_IMPROVEMENTS_PROPOSAL.md section A (the "Bank" column).
  it("a 1-year FD is exactly four quarters", () => {
    expect(fd(100000, 7, "2026-01-01", "2027-01-01")).toBe(107186); // 100000 × 1.0175^4 = 107185.90
    expect(fd(10000, 7, "2026-02-10", "2027-02-10")).toBe(10719); // the ₹1 gap: 10718 under the old maths
  });

  it("a 366-day year across a leap day is still just four quarters", () => {
    expect(fd(100000, 7, "2027-03-01", "2028-03-01")).toBe(107186); // 2027-03-01 → 2028-03-01 = 4 quarters, 0 days
  });

  it("adds simple interest for the broken period after the last full quarter", () => {
    // 6 quarters to 2027-08-03, then 17 days.
    const quarters = 200000 * Math.pow(1 + 0.071 / 4, 6);
    const expected = Math.round(200000 + (quarters - 200000) + (quarters * 0.071 * 17) / 365);
    expect(fd(200000, 7.1, "2026-02-03", "2027-08-20")).toBe(expected);
  });

  it("a 400-day FD", () => {
    expect(fd(100000, 7, "2026-01-05", "2027-02-09")).toBe(107905);
  });

  it("pays simple interest under 6 months even when compounding is chosen", () => {
    // 90 days: 100000 × 0.07 × 90 / 365 = 1726.03
    expect(fd(100000, 7, "2026-01-05", "2026-04-05")).toBe(101726);
  });

  it("6 months exactly compounds two quarters", () => {
    expect(fd(100000, 7, "2026-01-05", "2026-07-05")).toBe(Math.round(100000 * Math.pow(1.0175, 2)));
  });

  it("counts quarters from a month-end start with clamping", () => {
    // 31 Jan → 30 Apr → 31 Jul → 31 Oct → 31 Jan: four quarters.
    expect(fd(100000, 7, "2026-01-31", "2027-01-31")).toBe(107186);
  });

  it("monthly and annual compounding use their own periods", () => {
    const monthly = computeFDMaturityValue({
      principal: 100000, interest_rate_pa: 7, start_date: "2026-01-01", maturity_date: "2027-01-01",
      interest_method: "compound", compounding_freq: "monthly",
    });
    const annually = computeFDMaturityValue({
      principal: 100000, interest_rate_pa: 7, start_date: "2026-01-01", maturity_date: "2027-01-01",
      interest_method: "compound", compounding_freq: "annually",
    });
    expect(monthly).toBe(Math.round(100000 * Math.pow(1 + 0.07 / 12, 12)));
    expect(annually).toBe(107000);
  });
});

describe("FD term helpers", () => {
  it("addMonthsClamped clamps to the month end", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonthsClamped("2026-05-20", 0)).toBe("2026-05-20");
  });

  it("addFDTerm adds months first, then days", () => {
    expect(addFDTerm("2026-11-13", { years: 1, months: 0, days: 0 })).toBe("2027-11-13");
    expect(addFDTerm("2026-01-05", { years: 0, months: 0, days: 400 })).toBe("2027-02-09");
    expect(addFDTerm("2026-01-31", { years: 0, months: 1, days: 1 })).toBe("2026-03-01");
  });

  it("fdTermBetween is the inverse of addFDTerm", () => {
    expect(fdTermBetween("2026-02-03", "2027-08-20")).toEqual({ years: 1, months: 6, days: 17 });
    expect(fdTermBetween("2026-11-13", "2027-11-13")).toEqual({ years: 1, months: 0, days: 0 });
    expect(fdTermBetween("2026-01-31", "2026-02-28")).toEqual({ years: 0, months: 1, days: 0 });
    expect(fdTermBetween("2026-05-01", "2026-04-01")).toEqual({ years: 0, months: 0, days: 0 });
    for (const [s, t] of [["2026-01-31", { years: 2, months: 1, days: 3 }], ["2026-08-30", { years: 0, months: 6, days: 0 }]] as const) {
      expect(fdTermBetween(s, addFDTerm(s, t))).toEqual(t);
    }
  });

  it("formatFDTerm leaves out zero parts", () => {
    expect(formatFDTerm({ years: 1, months: 6, days: 17 })).toBe("1 year 6 months 17 days");
    expect(formatFDTerm({ years: 0, months: 0, days: 400 })).toBe("400 days");
    expect(formatFDTerm({ years: 0, months: 0, days: 0 })).toBe("0 days");
  });
});
