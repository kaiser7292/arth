jest.mock("../../database", () => ({ getDatabase: () => ({}) }));

import { carryForward, lastNMonths, periodPoints, valuesAt } from "../../services/investment-trend";

describe("lastNMonths", () => {
  it("ends at the current month, oldest first", () => {
    expect(lastNMonths(3, new Date(2026, 0, 15))).toEqual(["2025-11", "2025-12", "2026-01"]);
  });
});

describe("carryForward", () => {
  const months = ["2026-06", "2026-07", "2026-08", "2026-09"];

  it("takes the latest reading on or before each month end and carries it", () => {
    const readings = [
      { date: "2026-07-31", value: 100 },
      { date: "2026-07-10", value: 80 },
      { date: "2026-09-02", value: 140 },
    ];
    expect(carryForward(readings, months)).toEqual([0, 100, 100, 140]);
  });

  it("is zero everywhere with no readings", () => {
    expect(carryForward([], months)).toEqual([0, 0, 0, 0]);
  });
});

describe("periodPoints", () => {
  const today = new Date(2026, 9, 13); // 13 Oct 2026

  it("day periods show each day, starting the period's length ago", () => {
    expect(periodPoints("5D", today)).toEqual(["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"]);
    const d30 = periodPoints("30D", today);
    expect(d30).toHaveLength(31);
    expect(d30[0]).toBe("2026-09-13");
    expect(d30[30]).toBe("2026-10-13");
  });

  it("month periods show each week, back from today", () => {
    const m3 = periodPoints("3M", today);
    expect(m3).toHaveLength(14);
    expect(m3.slice(-3)).toEqual(["2026-09-29", "2026-10-06", "2026-10-13"]);
    expect(m3[0]).toBe("2026-07-14");
    expect(periodPoints("6M", today)).toHaveLength(27);
  });

  it("year periods show each month end, then today", () => {
    expect(periodPoints("YTD", today)).toEqual([
      "2025-12-31", "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31",
      "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-13",
    ]);
    const y5 = periodPoints("5Y", today);
    expect(y5).toHaveLength(61);
    expect(y5[0]).toBe("2021-10-31");
    expect(y5[59]).toBe("2026-09-30");
    expect(periodPoints("10Y", today)).toHaveLength(121);
  });

  it("YTD in January still has a starting point", () => {
    expect(periodPoints("YTD", new Date(2027, 0, 5))).toEqual(["2026-12-31", "2027-01-05"]);
  });
});

describe("valuesAt", () => {
  it("uses the latest reading on or before each date", () => {
    const readings = [
      { date: "2026-10-09", value: 120 },
      { date: "2026-10-06", value: 100 },
      { date: "2026-10-12", value: 90 },
    ];
    expect(valuesAt(readings, ["2026-10-05", "2026-10-06", "2026-10-08", "2026-10-09", "2026-10-13"])).toEqual([0, 100, 100, 120, 90]);
  });
});

