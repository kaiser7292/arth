/** The Budget tab's span on every page (owner, Nov 2026). */
import { budgetSpanOf, daysInclusive, monthsFrom } from "@/utils/budget-span";

describe("budget span", () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 10, 18, 12));
  });
  afterAll(() => jest.useRealTimers());

  it("Month is no span: pages use their month", () => {
    expect(budgetSpanOf("month", 4)).toBeUndefined();
  });

  it("3M: three months up to today, against the three before, same days", () => {
    const s = budgetSpanOf("last_3m", 4)!;
    expect(s.months).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(s).toMatchObject({ startDate: "2026-09-01", endDate: "2026-11-18", phrase: "these 3 months" });
    expect(s.previous).toMatchObject({ startDate: "2026-06-01", endDate: "2026-08-18", phrase: "the 3 months before" });
  });

  it("FY: April to today, against the same stretch last year", () => {
    const s = budgetSpanOf("this_fy", 4)!;
    expect(s.months[0]).toBe("2026-04");
    expect(s.months).toHaveLength(8);
    expect(s.previous).toMatchObject({ startDate: "2025-04-01", endDate: "2025-11-18" });
  });

  it("helpers", () => {
    expect(monthsFrom("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(daysInclusive("2026-11-01", "2026-11-18")).toBe(18);
  });
});
