/**
 * Pure logic behind the check-in decks: rule suggestions, subscription check, month-end
 * check, and settle-up reminders.
 */

jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => {
    const store: Record<string, unknown> = {};
    return {
      getBoolean: (k: string) => store[k] as boolean | undefined,
      getNumber: (k: string) => store[k] as number | undefined,
      getString: (k: string) => store[k] as string | undefined,
      set: (k: string, v: unknown) => { store[k] = v; },
      delete: (k: string) => { delete store[k]; },
    };
  }),
}));
jest.mock("../../database", () => ({ getDatabase: jest.fn(), initDatabase: jest.fn() }));
jest.mock("../../services/smart-rules", () => ({ createRule: jest.fn(), getActiveRules: jest.fn(async () => []) }));
jest.mock("../../services/recurring-detector", () => ({
  confirmRecurring: jest.fn(),
  dismissRecurring: jest.fn(),
  getRecurringTransactions: jest.fn(async () => []),
}));
jest.mock("../../services/hisaab", () => ({ getPersonsWithBalances: jest.fn(), recordSettlement: jest.fn() }));
jest.mock("../../services/balance-source", () => ({ getBalanceSourceInfo: jest.fn() }));
jest.mock("../../services/financial-account", () => ({ getActiveAccounts: jest.fn() }));
jest.mock("../../services/settings", () => ({ bumpDataVersion: jest.fn() }));

import type { SmartRule } from "../../services/smart-rules";
import type { RecurringTransaction } from "../../services/recurring-detector";
import { isCoveredByRule, pickSuggestions } from "../../services/rule-suggestions";
import { REVIEW_EVERY_DAYS, classifySubscription, yearlyCost } from "../../services/subscription-check";
import { classifyBalance, getCycleMonth, isMonthEndWindow } from "../../services/month-end-check";
import { reminderMessage } from "../../services/settle-up-check";
import { pickNextCheckIn } from "../../services/check-ins";

const rule = (merchant: string, withCategory = true): SmartRule =>
  ({
    conditions: [{ field: "merchant", operator: "contains", value: merchant }],
    actions: withCategory ? [{ type: "category", category_id: "c" }] : [{ type: "tags", tag_ids: [] }],
  }) as unknown as SmartRule;

describe("rule suggestions", () => {
  const row = (mkey: string, category_id: string, n: number) => ({ mkey, merchant: mkey, category_id, n, total: n * 100 });

  it("suggests a merchant filed the same way at least 4 times", () => {
    const out = pickSuggestions([row("swiggy", "food", 5)], [], new Set());
    expect(out).toEqual([{ key: "swiggy", merchant: "swiggy", categoryId: "food", count: 5, total: 500 }]);
  });

  it("needs 4 occurrences and an 80% share in one category", () => {
    expect(pickSuggestions([row("uber", "travel", 3)], [], new Set())).toEqual([]);
    expect(pickSuggestions([row("amazon", "shopping", 4), row("amazon", "groceries", 2)], [], new Set())).toEqual([]);
    expect(pickSuggestions([row("zomato", "food", 8), row("zomato", "gifts", 1)], [], new Set())).toHaveLength(1);
  });

  it("skips merchants a category rule already covers, or that were dismissed", () => {
    expect(pickSuggestions([row("swiggy instamart", "food", 5)], [rule("Swiggy")], new Set())).toEqual([]);
    expect(pickSuggestions([row("swiggy", "food", 5)], [], new Set(["swiggy"]))).toEqual([]);
  });

  it("a rule that doesn't set a category doesn't count as coverage", () => {
    expect(isCoveredByRule("swiggy", [rule("swiggy", false)])).toBe(false);
  });
});

describe("subscription check", () => {
  const sub = (over: Partial<RecurringTransaction>): RecurringTransaction =>
    ({ id: "s", is_confirmed: 0, last_seen_date: "2026-09-01", cancel_requested_at: null, ...over }) as RecurringTransaction;
  const now = new Date("2026-09-24").getTime();

  it("new, unreviewed subscriptions get a card", () => {
    expect(classifySubscription(sub({}), 0, now)).toBe("new");
  });

  it("flags one marked to cancel that charged again, and stays quiet otherwise", () => {
    expect(classifySubscription(sub({ cancel_requested_at: "2026-08-10 09:00:00", last_seen_date: "2026-09-10" }), now, now)).toBe("still_charging");
    expect(classifySubscription(sub({ cancel_requested_at: "2026-09-15 09:00:00", last_seen_date: "2026-09-10" }), now, now)).toBeNull();
  });

  it("re-asks about kept subscriptions after the review period", () => {
    const kept = sub({ is_confirmed: 1 });
    expect(classifySubscription(kept, now - 10 * 86400000, now)).toBeNull();
    expect(classifySubscription(kept, now - (REVIEW_EVERY_DAYS + 1) * 86400000, now)).toBe("periodic");
  });

  it("estimates yearly cost from frequency", () => {
    expect(yearlyCost(199, "monthly")).toBe(2388);
    expect(yearlyCost(1000, "quarterly")).toBe(4000);
    expect(yearlyCost(100, "weekly")).toBe(5200);
  });
});

describe("month-end check", () => {
  it("closes last month during the first week, this month otherwise", () => {
    expect(getCycleMonth(new Date(2026, 9, 3))).toBe("2026-09");
    expect(getCycleMonth(new Date(2026, 0, 5))).toBe("2025-12");
    expect(getCycleMonth(new Date(2026, 8, 29))).toBe("2026-09");
  });

  it("is advertised from the 28th through the 7th", () => {
    expect(isMonthEndWindow(new Date(2026, 8, 28))).toBe(true);
    expect(isMonthEndWindow(new Date(2026, 9, 7))).toBe(true);
    expect(isMonthEndWindow(new Date(2026, 9, 15))).toBe(false);
  });

  it("compares Arth's balance with the bank's", () => {
    expect(classifyBalance({ calculatedBalance: 42310.4, autoDetectedBalance: 42310, isStale: false })).toEqual({ status: "match", difference: 0.4 });
    expect(classifyBalance({ calculatedBalance: 41000, autoDetectedBalance: 42310, isStale: false })).toEqual({ status: "differs", difference: -1310 });
    expect(classifyBalance({ calculatedBalance: 41000, autoDetectedBalance: 42310, isStale: true }).status).toBe("stale");
    expect(classifyBalance({ calculatedBalance: 41000, autoDetectedBalance: null, isStale: false }).status).toBe("no_sms");
  });
});

describe("settle-up reminder", () => {
  it("uses the first name and the amount", () => {
    const msg = reminderMessage("Rahul Sharma", 1500, "2026-09-01");
    expect(msg).toMatch(/^Hi Rahul,/);
    expect(msg).toContain("1,500");
    expect(msg).toContain("2026-09-01");
  });
});

describe("auto-advance between check-ins", () => {
  const counts = { monthEnd: 0, settleUp: 2, subscriptions: 17, ruleSuggestions: 3 };

  it("goes to the next deck in order that has items", () => {
    expect(pickNextCheckIn(counts, "settleUp", [])).toBe("subscriptions");
    expect(pickNextCheckIn(counts, "subscriptions", [])).toBe("ruleSuggestions");
  });

  it("wraps round but skips empty and already-done decks", () => {
    expect(pickNextCheckIn(counts, "ruleSuggestions", [])).toBe("settleUp");
    expect(pickNextCheckIn(counts, "ruleSuggestions", ["settleUp", "subscriptions"])).toBeNull();
  });

  it("stops when nothing else has items", () => {
    expect(pickNextCheckIn({ monthEnd: 0, settleUp: 1, subscriptions: 0, ruleSuggestions: 0 }, "settleUp", [])).toBeNull();
  });
});
