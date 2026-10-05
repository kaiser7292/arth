jest.mock("../../database", () => ({ getDatabase: jest.fn() }));
jest.mock("../../services/settings", () => ({ bumpDataVersion: jest.fn() }));
jest.mock("../../services/smart-categorizer", () => ({ normalizeMerchant: (m: string) => m.toUpperCase() }));

import {
  clusterByAmount,
  frequencyFor,
  learnMerchant,
  rhythm,
  usualDay,
  type Sighting,
} from "../../services/analytics/pattern-learner";

const monthly = (day: string, amount: number, months: string[]): Sighting[] =>
  months.map((m) => ({ date: `${m}-${day}`, amount, categoryId: "c" }));
const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

describe("rhythm and frequency", () => {
  it("monthly bills have a ~30-day steady gap", () => {
    const r = rhythm(MONTHS.map((m) => `${m}-05`))!;
    expect(frequencyFor(r.gap)).toBe("monthly");
    expect(r.steady).toBe(true);
  });

  it("an often-used merchant with irregular gaps isn't steady (the old learner called it weekly)", () => {
    const r = rhythm(["2026-09-01", "2026-09-02", "2026-09-09", "2026-09-10", "2026-09-25", "2026-09-27", "2026-10-03"])!;
    expect(r.steady).toBe(false);
  });

  it("same-day duplicates count once", () => {
    expect(rhythm(["2026-09-01", "2026-09-01", "2026-09-02"])).toBeNull();
  });
});

describe("usual day", () => {
  it("is the median, not the average (28th and 2nd aren't 'the 15th')", () => {
    expect(usualDay(["2026-06-02", "2026-07-02", "2026-08-28"])).toBe(2);
  });
  it("recognises end of month", () => {
    expect(usualDay(["2026-06-30", "2026-07-31", "2026-08-31", "2026-09-29"])).toBe(31);
  });
});

describe("amount groups", () => {
  it("splits two policies with one insurer", () => {
    const groups = clusterByAmount([
      { date: "2026-05-01", amount: 1200, categoryId: null },
      { date: "2026-05-03", amount: 5400, categoryId: null },
      { date: "2026-06-01", amount: 1210, categoryId: null },
      { date: "2026-06-03", amount: 5400, categoryId: null },
    ]);
    expect(groups.map((g) => g.length)).toEqual([2, 2]);
  });
});

describe("learnMerchant", () => {
  const today = "2026-10-05";

  it("a steady same-amount payment is a fixed monthly bill", () => {
    const [p] = learnMerchant("NETFLIX", monthly("05", 649, MONTHS), today);
    expect(p).toMatchObject({ classification: "fixed", frequency: "monthly", expectedDay: 5, occurrences: 5 });
  });

  it("a steady payment whose amount varies is semi-fixed", () => {
    const s = MONTHS.map((m, i) => ({ date: `${m}-10`, amount: [1800, 2100, 1950, 2300, 2000][i], categoryId: null }));
    expect(learnMerchant("ELECTRICITY", s, today)[0].classification).toBe("semi_fixed");
  });

  it("a bill that stopped isn't learned", () => {
    expect(learnMerchant("GYM", monthly("01", 1500, ["2026-04", "2026-05", "2026-06"]), today)).toEqual([]);
  });

  it("two payments aren't enough", () => {
    expect(learnMerchant("NEW", monthly("05", 999, ["2026-08", "2026-09"]), today)).toEqual([]);
  });
});
