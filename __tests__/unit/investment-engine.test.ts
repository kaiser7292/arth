/**
 * Investment engine (FD math) — pure functions, no DB.
 */

import { computeFDMaturityValue, generateFDSchedule, currentFDValue } from "../../services/investment-engine";

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
