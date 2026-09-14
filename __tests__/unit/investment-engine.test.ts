/**
 * Investment engine (FD math) — pure functions, no DB.
 */

import { computeFDMaturityValue, computeFDInterest, generateFDSchedule, currentFDValue } from "../../services/investment-engine";

describe("computeFDMaturityValue", () => {
  it("computes simple interest for exactly one year", () => {
    const value = computeFDMaturityValue({
      principal: 100000,
      interest_rate_pa: 7,
      start_date: "2025-01-01",
      maturity_date: "2026-01-01",
      interest_method: "simple",
    });
    // 100000 * (1 + 0.07 * 1) ≈ 107000, within rounding of the 365.25-day year fraction.
    expect(value).toBeGreaterThan(106900);
    expect(value).toBeLessThan(107100);
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
  const DAY_MS = 24 * 60 * 60 * 1000;
  const YEAR_MS = 365.25 * DAY_MS;

  // Solve for the interest_rate_pa that makes simple-interest land on an exact
  // target raw value, given the same days/365.25 year-fraction math the engine
  // uses internally — lets us hit exact .5 boundaries the rounding rule cares
  // about, which real calendar-date spans can't produce directly (a whole
  // number of days is never exactly N.5 years).
  function rateForTargetInterest(principal: number, days: number, targetInterest: number): number {
    const t = (days * DAY_MS) / YEAR_MS;
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
