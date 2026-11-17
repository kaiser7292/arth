import { autoGroupFor } from "../../utils/auto-group";

describe("autoGroupFor (Transactions grouping from the date range)", () => {
  it("groups day ranges by day", () => {
    expect(autoGroupFor("today")).toBe("date");
    expect(autoGroupFor("last_7_days")).toBe("date");
    expect(autoGroupFor("last_30_days")).toBe("date");
  });
  it("groups month ranges by month, including the default rolling 12 months", () => {
    for (const p of ["this_month", "last_month", "last_3_months", "last_12_months", "this_quarter", "this_fy", "last_fy"] as const) {
      expect(autoGroupFor(p)).toBe("month");
    }
  });
  it("groups all time by year", () => {
    expect(autoGroupFor("all")).toBe("year");
  });
  it("sizes a custom range", () => {
    expect(autoGroupFor("custom", "2026-11-01", "2026-11-20")).toBe("date");
    expect(autoGroupFor("custom", "2026-01-01", "2026-12-31")).toBe("month");
    expect(autoGroupFor("custom", "2025-06-01", "2026-11-30")).toBe("year");
  });
});
