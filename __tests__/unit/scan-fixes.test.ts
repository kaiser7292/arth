import { angelFailureMessage } from "../../utils/angel-failure";
import { isoDate, todayIso } from "../../utils/local-date";
import { netSpend, signedNet } from "../../utils/expense-grouping";
import type { Expense } from "../../services/expense-types";

describe("local dates", () => {
  it("reads the date as the phone shows it, not UTC", () => {
    // Built from local parts: 00:30 local is the 3rd here wherever the tests run.
    expect(isoDate(new Date(2026, 10, 3, 0, 30))).toBe("2026-11-03");
    expect(isoDate(new Date(2026, 0, 1, 0, 1))).toBe("2026-01-01");
  });
  it("gives today as YYYY-MM-DD", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("Angel One failure message", () => {
  it("passes on what Angel One said, with its code", () => {
    expect(angelFailureMessage([{ sessionEnded: false, reason: "Invalid API key (AG8004)" }])).toContain("Invalid API key (AG8004)");
  });
  it("says it's the sign-in when the session was refused", () => {
    const text = angelFailureMessage([{ sessionEnded: true, reason: "Invalid Token (AG8001)" }]);
    expect(text).toContain("sign-in");
    expect(text).toContain("AG8001");
  });
  it("only blames the connection when nothing came back", () => {
    expect(angelFailureMessage([{ sessionEnded: false, reason: null }])).toMatch(/Couldn't reach Angel One/);
  });
});

describe("what a row adds to a total", () => {
  const e = (over: Partial<Expense>) => ({ nature: "realized", amount: 100, split_original_amount: null, ...over }) as Expense;
  it("takes refunds off, as the summary card does", () => {
    expect(netSpend(e({}), 30)).toBe(70);
    expect(signedNet(e({}), 30)).toBe(-70);
  });
  it("takes only your share of a refund on a split", () => {
    expect(netSpend(e({ amount: 50, split_original_amount: 100 }), 40)).toBe(30);
  });
  it("never goes below zero", () => {
    expect(netSpend(e({}), 500)).toBe(0);
  });
  it("adds credits as they are", () => {
    expect(signedNet(e({ nature: "credit", amount: 40 }), 0)).toBe(40);
  });
});
