import { monthsToFYEnd } from "../../utils/fiscal-year";

describe("monthsToFYEnd", () => {
  it("runs from this month to March for an April financial year", () => {
    expect(monthsToFYEnd(new Date(2026, 9, 2), 4)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
  });
  it("is just March when it's March", () => {
    expect(monthsToFYEnd(new Date(2027, 2, 15), 4)).toEqual(["2027-03"]);
  });
  it("covers the whole year in April", () => {
    expect(monthsToFYEnd(new Date(2026, 3, 1), 4)).toHaveLength(12);
  });
  it("works for a calendar-year financial year", () => {
    expect(monthsToFYEnd(new Date(2026, 9, 2), 1)).toEqual(["2026-10", "2026-11", "2026-12"]);
  });
});
