import { combineProjections, defaultReturnPct, projectInvestment } from "../../services/investment-projections";

const flat = { returnPct: 0, monthly: 0, lumpSums: [] };
const last = <T,>(a: T[]) => a[a.length - 1];

describe("projectInvestment", () => {
  it("with no return and nothing added, stays put", () => {
    expect(last(projectInvestment(1000, flat, 12, "2026-11"))).toEqual({ month: 12, value: 1000, putIn: 1000 });
  });

  it("a yearly return compounds to exactly that over 12 months", () => {
    const end = last(projectInvestment(100000, { ...flat, returnPct: 12 }, 12, "2026-11"));
    expect(end.value).toBeCloseTo(112000, 2);
    expect(end.putIn).toBe(100000);
  });

  it("and compounds across years", () => {
    expect(last(projectInvestment(100000, { ...flat, returnPct: 10 }, 24, "2026-11")).value).toBeCloseTo(121000, 2);
  });

  it("monthly additions count as put in, and grow", () => {
    const none = last(projectInvestment(0, { ...flat, monthly: 1000 }, 12, "2026-11"));
    expect(none).toMatchObject({ value: 12000, putIn: 12000 });
    const grown = last(projectInvestment(0, { ...flat, monthly: 1000, returnPct: 12 }, 12, "2026-11"));
    expect(grown.putIn).toBe(12000);
    expect(grown.value).toBeGreaterThan(12000);
    expect(grown.value).toBeLessThan(12000 * 1.12);
  });

  it("a lump sum lands in its month, and grows only from then", () => {
    const a = { ...flat, returnPct: 12, lumpSums: [{ month: "2027-11", amount: 50000 }] };
    const points = projectInvestment(0, a, 24, "2026-11");
    expect(points[12].value).toBe(0);
    expect(points[12].putIn).toBe(0);
    expect(points[13].putIn).toBe(50000);
    expect(last(points).value).toBeCloseTo(56000, 2);
  });

  it("a lump sum dated in the past is already in today's value", () => {
    const a = { ...flat, lumpSums: [{ month: "2026-01", amount: 50000 }] };
    expect(last(projectInvestment(1000, a, 12, "2026-11")).value).toBe(1000);
  });

  it("this month's lump sum counts", () => {
    const a = { ...flat, lumpSums: [{ month: "2026-11", amount: 500 }] };
    expect(last(projectInvestment(1000, a, 1, "2026-11")).value).toBe(1500);
  });
});

describe("combining and defaults", () => {
  it("adds investments together month by month", () => {
    const a = projectInvestment(1000, flat, 2, "2026-11");
    const b = projectInvestment(500, { ...flat, monthly: 100 }, 2, "2026-11");
    expect(last(combineProjections([a, b]))).toEqual({ month: 2, value: 1700, putIn: 1700 });
    expect(combineProjections([])).toEqual([]);
  });

  it("starts from a deposit's own rate, otherwise a plain assumption", () => {
    expect(defaultReturnPct("fd", 7.1)).toBe(7.1);
    expect(defaultReturnPct("fd", null)).toBe(7);
    expect(defaultReturnPct("pension")).toBe(8);
    expect(defaultReturnPct("market")).toBe(12);
  });
});
