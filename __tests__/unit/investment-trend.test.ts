jest.mock("../../database", () => ({ getDatabase: () => ({}) }));

import { balancesAt, periodPoints, valuesAt } from "../../services/investment-trend";

describe("periodPoints", () => {
  const today = new Date(2026, 9, 13); // 13 Oct 2026

  it("5D and 1M show each day, starting the period's length ago", () => {
    expect(periodPoints("5D", today)).toEqual({
      dates: ["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"],
      unit: "day",
    });
    const m1 = periodPoints("1M", today);
    expect(m1.unit).toBe("day");
    expect(m1.dates).toHaveLength(31);
    expect(m1.dates[0]).toBe("2026-09-13");
    expect(m1.dates[30]).toBe("2026-10-13");
  });

  it("6M shows each week, back from today", () => {
    const m6 = periodPoints("6M", today);
    expect(m6.unit).toBe("week");
    expect(m6.dates).toHaveLength(27);
    expect(m6.dates.slice(-2)).toEqual(["2026-10-06", "2026-10-13"]);
  });

  it("year periods show each month end, then today", () => {
    expect(periodPoints("YTD", today)).toEqual({
      dates: [
        "2025-12-31", "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31",
        "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-13",
      ],
      unit: "month",
    });
    const y1 = periodPoints("1Y", today).dates;
    expect(y1).toHaveLength(13);
    expect(y1[0]).toBe("2025-10-31");
    const y5 = periodPoints("5Y", today).dates;
    expect(y5).toHaveLength(61);
    expect(y5[0]).toBe("2021-10-31");
    expect(y5[59]).toBe("2026-09-30");
  });

  it("YTD in January still has a starting point", () => {
    expect(periodPoints("YTD", new Date(2027, 0, 5)).dates).toEqual(["2026-12-31", "2027-01-05"]);
  });

  it("Max picks daily, weekly or monthly by how far back the history goes", () => {
    const short = periodPoints("Max", today, "2026-09-01");
    expect(short.unit).toBe("day");
    expect(short.dates[0]).toBe("2026-09-01");
    expect(periodPoints("Max", today, "2026-03-01").unit).toBe("week");
    const long = periodPoints("Max", today, "2023-05-10");
    expect(long.unit).toBe("month");
    expect(long.dates[0]).toBe("2023-04-30");
    expect(long.dates[long.dates.length - 1]).toBe("2026-10-13");
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

describe("balancesAt", () => {
  const flows = [
    { date: "2026-07-15", amount: 1000 },
    { date: "2026-08-15", amount: 1000 },
    { date: "2026-09-15", amount: -500 },
  ];

  it("with no anchors, runs from zero", () => {
    expect(balancesAt(flows, [], ["2026-07-01", "2026-07-31", "2026-08-31", "2026-09-30"])).toEqual([0, 1000, 2000, 1500]);
  });

  it("adds flows since an anchor's month began, and works back before the first anchor", () => {
    const anchors = [{ month: "2026-08", opening: 50000 }];
    expect(balancesAt(flows, anchors, ["2026-07-10", "2026-07-31", "2026-08-31", "2026-09-30"])).toEqual([49000, 50000, 51000, 50500]);
  });
});
