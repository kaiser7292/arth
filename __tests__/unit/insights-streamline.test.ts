/** Insights, streamlined (docs/INSIGHTS_STREAMLINE_PROPOSAL.md): the pure parts. Made-up data only. */
const mockStore = new Map<string, string>();
jest.mock("@/services/storage", () => ({
  settingsStorage: {
    getString: (k: string) => mockStore.get(k),
    set: (k: string, v: string) => mockStore.set(k, v),
  },
}));
jest.mock("@/services/settings", () => ({ bumpDataVersion: jest.fn() }));

import { summarise } from "@/services/regulars";
import { setKindOff, snoozeInsight, visibleInsights } from "@/services/insight-dismiss";
import { perDayFrom, shadeOf } from "@/components/insights/SpendCalendar";
import type { ExpenseClassificationRow } from "@/services/analytics/classifier";
import type { Insight } from "@/services/insight-engine";

const pattern = (over: Partial<ExpenseClassificationRow>): ExpenseClassificationRow =>
  ({
    id: "p1",
    user_id: "u",
    merchant_normalized: "test internet",
    category_id: null,
    amount_range_low: 790,
    amount_range_high: 800,
    classification: "fixed",
    frequency: "monthly",
    expected_day_of_month: 3,
    confidence: 1,
    source: "auto_detected",
    occurrence_count: 4,
    last_seen_date: "2026-10-03",
    last_confirmed_date: null,
    is_active: 1,
    deactivated_reason: null,
    created_at: "",
    updated_at: "",
    ...over,
  }) as ExpenseClassificationRow;

describe("bills and subscriptions", () => {
  const today = new Date(2026, 10, 20);
  it("adds up the usual monthly cost and flags a price rise", () => {
    const s = summarise(
      [pattern({}), pattern({ id: "p2", merchant_normalized: "test music", amount_range_high: 1200, frequency: "yearly", expected_day_of_month: null })],
      new Map([["test internet", [{ date: "2026-10-03", amount: 800 }, { date: "2026-11-03", amount: 900 }]]]),
      today,
    );
    expect(Math.round(s.monthlyTotal)).toBe(900);
    expect(s.wentUp).toBe(1);
    expect(s.regulars[0]).toMatchObject({ name: "test internet", wentUp: true, lastAmount: 900 });
  });
  it("a monthly one paid last month but not this month, past its day, may have stopped", () => {
    const s = summarise([pattern({})], new Map([["test internet", [{ date: "2026-10-03", amount: 800 }]]]), today);
    expect(s.stopped).toBe(1);
    // Before its day (plus a few days' grace) it's just not due yet.
    expect(summarise([pattern({})], new Map([["test internet", [{ date: "2026-10-03", amount: 800 }]]]), new Date(2026, 10, 6)).stopped).toBe(0);
  });
  it("everyday spending and paused patterns aren't bills", () => {
    expect(summarise([pattern({ classification: "variable" }), pattern({ id: "x", is_active: 0 })], new Map(), today).regulars).toHaveLength(0);
  });
});

describe("Worth a look answers", () => {
  const ins = (id: string, type: Insight["type"]): Insight => ({ id, type, severity: "warning", title: id, detail: "", score: 1 }) as Insight;
  beforeEach(() => mockStore.clear());
  it("Not now hides a card for the rest of the month only", () => {
    snoozeInsight("a", new Date(2026, 10, 5));
    expect(visibleInsights([ins("a", "micro_leaks"), ins("b", "micro_leaks")], new Date(2026, 10, 25)).map((i) => i.id)).toEqual(["b"]);
    expect(visibleInsights([ins("a", "micro_leaks")], new Date(2026, 11, 1)).map((i) => i.id)).toEqual(["a"]);
  });
  it("Don't show these switches a kind off, and back on", () => {
    setKindOff("card_use", true);
    expect(visibleInsights([ins("a", "card_use"), ins("b", "idle_cash")]).map((i) => i.id)).toEqual(["b"]);
    setKindOff("card_use", false);
    expect(visibleInsights([ins("a", "card_use")])).toHaveLength(1);
  });
  it("a broken saved answer is ignored, never thrown", () => {
    mockStore.set("insights_snoozed", "{not json");
    mockStore.set("insights_kinds_off", '"oops"');
    expect(visibleInsights([ins("a", "card_use")])).toHaveLength(1);
  });
});

describe("spending calendar", () => {
  it("adds up each day and shades by rank", () => {
    const per = perDayFrom([{ date: "2026-11-01", amount: 100 }, { date: "2026-11-01", amount: 50 }, { date: "2026-11-03", amount: 900 }], 30);
    expect(per[0]).toBe(150);
    expect(per[1]).toBe(0);
    expect(shadeOf(0, per)).toBe(0);
    expect(shadeOf(900, per)).toBeGreaterThan(shadeOf(150, per));
  });
});
