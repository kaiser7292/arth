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
import {
  DEFAULT_PREFS,
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
