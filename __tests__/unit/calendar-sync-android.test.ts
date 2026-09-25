/**
 * Calendar sync against a fake of Android's calendar store that reproduces expo-calendar's id
 * typing: create* RETURNS numeric ids, get* LISTS string ids. The bugs this guards:
 *   - a second sync deleted every event the first had written ("duplicates" by id mismatch)
 *   - a chosen "Arth" calendar (numeric id) was never found, so nothing was written
 *   - the Arth calendar was created with sync off, so Google Calendar hid it
 */

const mockStore: Record<string, unknown> = {};
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: (k: string) => mockStore[k] as boolean | undefined,
    getNumber: (k: string) => mockStore[k] as number | undefined,
    getString: (k: string) => mockStore[k] as string | undefined,
    set: (k: string, v: unknown) => { mockStore[k] = v; },
    delete: (k: string) => { delete mockStore[k]; },
  })),
}));

type FakeCal = { id: number; title: string; name: string; isVisible: boolean; isSynced: boolean; local: boolean };
type FakeEvent = { id: number; calendarId: string; title: string; notes: string; startDate: Date };
const mockCals: FakeCal[] = [];
const mockEvents: FakeEvent[] = [];
const mockState = { nextId: 100 };
const mockDeleted: string[] = [];

jest.mock("expo-calendar", () => ({
  CalendarAccessLevel: { OWNER: "owner", EDITOR: "editor", CONTRIBUTOR: "contributor", ROOT: "root" },
  EntityTypes: { EVENT: "event" },
  SourceType: { LOCAL: "local" },
  getCalendarPermissionsAsync: async () => ({ status: "granted" }),
  getCalendarsAsync: async () =>
    mockCals.map((c) => ({
      id: String(c.id),
      title: c.title,
      name: c.name,
      isVisible: c.isVisible,
      isSynced: c.isSynced,
      allowsModifications: true,
      accessLevel: "owner",
      source: { name: c.local ? "Arth" : "me@gmail.com", type: c.local ? "LOCAL" : "com.google", isLocalAccount: c.local },
    })),
  createCalendarAsync: async (d: { title: string; name: string; isVisible?: boolean; isSynced?: boolean }) => {
    const id = mockState.nextId++;
    mockCals.push({ id, title: d.title, name: d.name, isVisible: d.isVisible ?? true, isSynced: d.isSynced ?? false, local: true });
    return id; // number, like Android
  },
  updateCalendarAsync: async (id: string, d: { isVisible?: boolean; isSynced?: boolean }) => {
    const c = mockCals.find((x) => String(x.id) === id)!;
    Object.assign(c, d);
    return c.id;
  },
  createEventAsync: async (calendarId: string, d: { title: string; notes: string; startDate: Date }) => {
    const id = mockState.nextId++;
    mockEvents.push({ id, calendarId: String(calendarId), title: d.title, notes: d.notes, startDate: d.startDate });
    return id; // number, like Android
  },
  updateEventAsync: async (id: string, d: { title: string; notes: string; startDate: Date }) => {
    const e = mockEvents.find((x) => String(x.id) === String(id));
    if (!e) throw new Error("no such event");
    Object.assign(e, d);
    return e.id;
  },
  deleteEventAsync: async (id: string) => {
    mockDeleted.push(String(id));
    const i = mockEvents.findIndex((x) => String(x.id) === String(id));
    if (i >= 0) mockEvents.splice(i, 1);
  },
  getEventsAsync: async (ids: string[]) =>
    mockEvents.filter((e) => ids.includes(e.calendarId)).map((e) => ({ ...e, id: String(e.id) })), // strings
}));
jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock("../../database", () => ({ initDatabase: async () => ({ getAllAsync: async () => [] }) }));

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const mockDues = [
  { id: "f1", merchant_name: "HDFC", description: null, forecast_type: "repayment", amount: 42310, due_date: inDays(10) },
  { id: "f2", merchant_name: "Rent", description: null, forecast_type: "expense", amount: 25000, due_date: inDays(-3) },
];
jest.mock("../../services/expense", () => ({ getForecastExpenses: async () => mockDues }));
jest.mock("../../services/recurring-rules", () => ({ getReminders: async () => [] }));

import { ensureArthCalendar, getLastSync, setCalendarPrefs, syncCalendar } from "../../services/calendar-sync";

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  mockState.nextId = 100;
  mockCals.length = 0;
  mockEvents.length = 0;
  mockDeleted.length = 0;
});

describe("calendar sync on Android", () => {
  it("keeps its events on the next sync instead of deleting them as duplicates", async () => {
    mockCals.push({ id: 7, title: "me@gmail.com", name: "me@gmail.com", isVisible: true, isSynced: true, local: false });
    setCalendarPrefs({ enabled: true, calendarId: "7" });

    const first = await syncCalendar("u");
    expect(first.ok).toBe(true);
    expect(mockEvents).toHaveLength(1); // the overdue Rent isn't added
    expect(mockEvents[0].title).toContain("HDFC card bill");

    const second = await syncCalendar("u");
    expect(second.ok).toBe(true);
    expect(mockDeleted).toEqual([]);
    expect(mockEvents).toHaveLength(1);
  });

  it("finds a calendar id stored as a number by an older build", async () => {
    mockCals.push({ id: 7, title: "me@gmail.com", name: "me@gmail.com", isVisible: true, isSynced: true, local: false });
    mockStore["calendar_sync_prefs"] = JSON.stringify({ enabled: true, calendarId: 7 });
    const r = await syncCalendar("u");
    expect(r.error).toBeUndefined();
    expect(mockEvents).toHaveLength(1);
  });

  it("writes into a newly created Arth calendar", async () => {
    const id = await ensureArthCalendar();
    expect(typeof id).toBe("string");
    setCalendarPrefs({ enabled: true, calendarId: id });
    const r = await syncCalendar("u");
    expect(r.ok).toBe(true);
    expect(mockEvents).toHaveLength(1);
  });

  it("creates the Arth calendar visible and synced, and repairs an old hidden one", async () => {
    await ensureArthCalendar();
    expect(mockCals[0]).toMatchObject({ isVisible: true, isSynced: true });

    mockCals.length = 0;
    mockCals.push({ id: 9, title: "Arth", name: "arth", isVisible: true, isSynced: false, local: true });
    await ensureArthCalendar();
    expect(mockCals[0].isSynced).toBe(true);
  });

  it("reports what it added and how many dues were overdue", async () => {
    mockCals.push({ id: 7, title: "Personal", name: "me@gmail.com", isVisible: true, isSynced: true, local: false });
    setCalendarPrefs({ enabled: true, calendarId: "7" });
    await syncCalendar("u");
    expect(getLastSync()).toMatchObject({
      ok: true,
      total: 1,
      byKind: { due: 1, emi: 0, reminder: 0, fd: 0 },
      overdueDues: 1,
      calendarTitle: "Personal",
    });
  });
});
