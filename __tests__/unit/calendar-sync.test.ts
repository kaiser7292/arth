/**
 * Calendar sync: what gets created, updated, removed or left alone, and what events say.
 */

const store: Record<string, unknown> = {};
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: (k: string) => store[k] as boolean | undefined,
    getNumber: (k: string) => store[k] as number | undefined,
    getString: (k: string) => store[k] as string | undefined,
    set: (k: string, v: unknown) => { store[k] = v; },
    delete: (k: string) => { delete store[k]; },
  })),
}));
jest.mock("expo-calendar", () => ({
  CalendarAccessLevel: { OWNER: "owner", EDITOR: "editor", CONTRIBUTOR: "contributor", ROOT: "root" },
  EntityTypes: { EVENT: "event" },
  SourceType: { LOCAL: "local" },
}));
jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock("../../database", () => ({ initDatabase: jest.fn() }));
jest.mock("../../services/expense", () => ({ getForecastExpenses: jest.fn() }));
jest.mock("../../services/recurring-rules", () => ({ getReminders: jest.fn() }));

import type { CalendarItem, EventMap } from "../../services/calendar-sync";
import { initDatabase } from "../../database";
import { getForecastExpenses } from "../../services/expense";
import { getReminders } from "../../services/recurring-rules";
import {
  collectCalendarItems,
  DEFAULT_PREFS,
  eventDetails,
  eventNotes,
  eventTitle,
  getCalendarPrefs,
  itemHash,
  planSync,
  setCalendarPrefs,
} from "../../services/calendar-sync";

const item = (key: string, date: string, over: Partial<CalendarItem> = {}): CalendarItem => ({
  key,
  kind: "due",
  date,
  label: "HDFC card bill",
  amount: 42310,
  ...over,
});

const stored = (i: CalendarItem, eventId: string, show = true) => ({ eventId, date: i.date, hash: itemHash(i, show) });
const TODAY = "2026-09-24";

describe("planSync", () => {
  it("creates new items and leaves unchanged ones alone", () => {
    const a = item("due:a", "2026-10-05");
    const b = item("due:b", "2026-10-10");
    const plan = planSync([a, b], { "due:a": stored(a, "e1") }, TODAY, true);
    expect(plan.create.map((i) => i.key)).toEqual(["due:b"]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it("updates when the date or amount changes", () => {
    const a = item("due:a", "2026-10-05");
    const moved = { ...a, date: "2026-10-07" };
    const repriced = { ...a, amount: 40000 };
    expect(planSync([moved], { "due:a": stored(a, "e1") }, TODAY, true).update).toEqual([{ item: moved, eventId: "e1" }]);
    expect(planSync([repriced], { "due:a": stored(a, "e1") }, TODAY, true).update).toHaveLength(1);
  });

  it("updates everything when 'show amounts' is flipped", () => {
    const a = item("due:a", "2026-10-05");
    expect(planSync([a], { "due:a": stored(a, "e1", true) }, TODAY, false).update).toHaveLength(1);
  });

  it("removes future events for items that are gone (paid, rejected, deleted)", () => {
    const a = item("due:a", "2026-10-05");
    const plan = planSync([], { "due:a": stored(a, "e1") }, TODAY, true);
    expect(plan.remove).toEqual([{ key: "due:a", eventId: "e1" }]);
  });

  it("keeps past events in the calendar as history, just stops tracking them", () => {
    const old = item("due:old", "2026-09-10");
    const plan = planSync([], { "due:old": stored(old, "e9") }, TODAY, true);
    expect(plan.remove).toEqual([]);
    expect(plan.forget).toEqual(["due:old"]);
  });

  it("rewrites adopted events (unknown hash)", () => {
    const a = item("due:a", "2026-10-05");
    const map: EventMap = { "due:a": { eventId: "e1", date: a.date, hash: "" } };
    expect(planSync([a], map, TODAY, true).update).toHaveLength(1);
  });
});

describe("event content", () => {
  it("includes the amount only when asked", () => {
    expect(eventTitle(item("due:a", "2026-10-05"), true)).toBe("Arth · HDFC card bill · ₹42,310");
    expect(eventTitle(item("due:a", "2026-10-05"), false)).toBe("Arth · HDFC card bill");
    expect(eventTitle(item("fd:x", "2026-10-05", { label: "SBI FD matures", amount: null }), true)).toBe("Arth · SBI FD matures");
  });

  it("tags notes so Arth can find its own events again", () => {
    expect(eventNotes(item("emi:123", "2026-10-05"))).toContain("[arth:emi:123]");
  });

  it("describes the entry with no link or footer, ending with the tag", () => {
    const due = item("due:abc", "2026-10-05", {
      label: "Flat maintenance due",
      amount: 4500,
      details: ["Payment due", "Merchant: Greenwood Society", "Category: Rent & Utilities", "Account: HDFC ••4521"],
      link: "expense/abc",
    });
    expect(eventNotes(due, true).split(String.fromCharCode(10))).toEqual([
      "Payment due",
      "Merchant: Greenwood Society",
      "Category: Rent & Utilities",
      "Account: HDFC ••4521",
      "Amount: ₹4,500",
      "",
      "[arth:due:abc]",
    ]);
    expect(eventNotes(due, true)).not.toMatch(/Open in Arth|Added by Arth/);
    // with amounts hidden, the amount stays out of the description too
    expect(eventNotes(due, false)).not.toContain("4,500");
    // a change to the description alone is enough to rewrite the event
    expect(itemHash(due, true)).not.toBe(itemHash({ ...due, details: ["Payment due"] }, true));
  });

  it("is an all-day entry that doesn't block time", () => {
    const d = eventDetails(item("due:a", "2026-10-05"), true);
    expect(d).toMatchObject({ allDay: true, availability: "free", timeZone: "UTC" });
    expect((d.startDate as Date).toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect((d.endDate as Date).toISOString()).toBe("2026-10-06T00:00:00.000Z");
    // 9:00 the morning before, and 9:00 on the day
    expect(d.alarms).toEqual([{ relativeOffset: -900 }, { relativeOffset: 540 }]);
  });
});

describe("what goes in the title", () => {
  const rows: Record<string, unknown[]> = {
    categories: [{ id: "c1", name: "Rent & Utilities" }],
    financial_accounts: [{ id: "a1", account_label: null, bank_name: "HDFC", account_identifier: "4521" }],
  };
  const only = (kind: "due" | "reminder") => ({ due: false, emi: false, reminder: false, fd: false, [kind]: true });

  beforeEach(() => {
    (initDatabase as jest.Mock).mockResolvedValue({
      getAllAsync: async (sql: string) => rows[Object.keys(rows).find((t) => sql.includes(`FROM ${t}`)) ?? ""] ?? [],
    });
  });

  it("a due uses its description, and the merchant only when there is none", async () => {
    (getForecastExpenses as jest.Mock).mockResolvedValue([
      { id: "d1", due_date: "2026-10-05", amount: 4500, description: "Flat maintenance", merchant_name: "Greenwood Society", category_id: "c1", account_id: "a1" },
      { id: "d2", due_date: "2026-10-06", amount: 900, description: null, merchant_name: "Airtel" },
      { id: "d3", due_date: "2026-10-07", amount: 42310, description: "Credit Card Amount Due via HDFC Bank (Amount Due)", merchant_name: "HDFC", forecast_type: "repayment" },
    ]);
    const items = await collectCalendarItems("u", only("due"), TODAY);
    expect(items.map((i) => i.label)).toEqual(["Flat maintenance due", "Airtel due", "HDFC credit card bill"]);
    expect(items[0]).toMatchObject({
      details: ["Payment due", "Merchant: Greenwood Society", "Category: Rent & Utilities", "Account: HDFC ••4521"],
      link: "expense/d1",
    });
    // the merchant isn't repeated when the title already names it
    expect(items[1].details).toEqual(["Payment due"]);
    expect(items[2].details).toEqual(["Credit card bill to pay"]);
  });

  it("a reminder uses its description, and the merchant only when there is none", async () => {
    const rule = (id: string, over: object = {}) => ({ id, next_due_date: "2026-10-05", frequency: "monthly", amount: 1200, notes: null, ...over });
    (getReminders as jest.Mock).mockResolvedValue([
      { rule: rule("r1", { notes: "Pay by UPI" }), source: { description: "Maid salary", merchant_name: "Sunita", category_id: "c1" } },
      { rule: rule("r2", { frequency: "yearly" }), source: { description: "", merchant_name: "LIC" } },
      { rule: rule("r3"), source: null },
    ]);
    const items = await collectCalendarItems("u", only("reminder"), TODAY);
    expect(items.map((i) => i.label)).toEqual(["Maid salary", "LIC", "Reminder"]);
    expect(items[0]).toMatchObject({
      details: ["Reminder, repeats every month", "Merchant: Sunita", "Category: Rent & Utilities", "Note: Pay by UPI"],
      link: "settings/recurring-rules",
    });
    expect(items[1].details).toEqual(["Reminder, repeats every year"]);
  });
});

describe("prefs", () => {
  it("defaults to off with every kind on, and merges partial updates", () => {
    expect(getCalendarPrefs()).toEqual(DEFAULT_PREFS);
    setCalendarPrefs({ enabled: true, kinds: { ...DEFAULT_PREFS.kinds, fd: false } });
    const p = getCalendarPrefs();
    expect(p.enabled).toBe(true);
    expect(p.kinds).toEqual({ due: true, emi: true, reminder: true, fd: false });
    expect(p.showAmounts).toBe(true);
  });
});
