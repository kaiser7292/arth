jest.mock("../../database", () => ({ getDatabase: () => ({}) }));

import { carryForward, lastNMonths } from "../../services/investment-trend";

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
