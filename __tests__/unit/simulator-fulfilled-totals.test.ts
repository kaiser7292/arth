import { fulfilledTotals } from "../../services/simulator";

jest.mock("@/database", () => ({ getDatabase: jest.fn() }));

describe("fulfilledTotals", () => {
  it("adds up planned and actual, and the difference", () => {
    expect(fulfilledTotals([{ planned: 100, actual: 150 }, { planned: 200, actual: 180 }])).toEqual({
      planned: 300,
      actual: 330,
      variance: 30,
      count: 2,
    });
  });

  it("leaves out an entry with nothing linked, which has no actual to compare", () => {
    expect(fulfilledTotals([{ planned: 100, actual: 100 }, { planned: 500, actual: 0 }])).toEqual({
      planned: 100,
      actual: 100,
      variance: 0,
      count: 1,
    });
  });

  it("is empty with no entries", () => {
    expect(fulfilledTotals([])).toEqual({ planned: 0, actual: 0, variance: 0, count: 0 });
  });
});
