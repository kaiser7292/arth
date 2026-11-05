const mockStore = new Map<string, unknown>();
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: (k: string) => mockStore.get(k),
    getString: (k: string) => mockStore.get(k),
    getNumber: (k: string) => mockStore.get(k),
    set: (k: string, v: unknown) => { mockStore.set(k, v); },
    delete: (k: string) => { mockStore.delete(k); },
    getAllKeys: () => [...mockStore.keys()],
    contains: (k: string) => mockStore.has(k),
  })),
}));
jest.mock("expo-notifications", () => ({ SchedulableTriggerInputTypes: { DATE: "date" } }));
jest.mock("@/services/notifications", () => ({ hasNotificationPermission: async () => true }));
jest.mock("@/services/broker-history/capture", () => ({
  connectedApiBrokers: async () => [],
  isCapturedToday: async () => false,
  linkedAccountFor: () => null,
}));
jest.mock("expo-background-fetch", () => ({ BackgroundFetchResult: {} }));
jest.mock("expo-task-manager", () => ({ defineTask: jest.fn() }));
jest.mock("@/database", () => ({ initDatabase: jest.fn(), getDatabase: jest.fn() }));
jest.mock("@/services/broker-sync", () => ({ syncBroker: jest.fn() }));

import { isAutoSyncDue, isAutoSyncOn, markAutoSynced, setAutoSyncOn } from "@/services/broker-history/auto-sync";
import { brokersDueNow } from "@/services/broker-history/background";
import { isBrokerReminderOn, reminderDates, setBrokerReminderOn } from "@/services/broker-history/reminders";

// Wednesday 4 Nov 2026.
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0, 0);
const days = (list: Date[]) => list.map((d) => d.getDate());

describe("reminder switches", () => {
  beforeEach(() => mockStore.clear());
  it("are on until turned off", () => {
    expect(isBrokerReminderOn("kite")).toBe(true);
  });
  it("are each their own", () => {
    setBrokerReminderOn("kite", false);
    expect(isBrokerReminderOn("kite")).toBe(false);
    expect(isBrokerReminderOn("angel")).toBe(true);
    expect(isBrokerReminderOn("zebpay")).toBe(true);
    setBrokerReminderOn("kite", true);
    expect(isBrokerReminderOn("kite")).toBe(true);
  });
});

describe("when reminders fall", () => {
  it("Zerodha's come at 5 pm, while there's still time to log in", () => {
    const list = reminderDates(at(4, 10), false, "kite");
    expect(list[0].getHours()).toBe(17);
    expect(days(reminderDates(at(4, 18), false, "kite"))).toEqual([5, 6, 9, 10]);
  });
  it("weekdays at 8 pm, starting today if it isn't saved", () => {
    const list = reminderDates(at(4, 10), false);
    expect(days(list)).toEqual([4, 5, 6, 9, 10]);
    expect(list[0].getHours()).toBe(20);
  });
  it("skips today once it's saved", () => {
    expect(days(reminderDates(at(4, 10), true))).toEqual([5, 6, 9, 10]);
  });
  it("skips today once 8 pm has passed", () => {
    expect(days(reminderDates(at(4, 21), false))).toEqual([5, 6, 9, 10]);
  });
  it("never lands on a weekend, starting from one", () => {
    expect(days(reminderDates(at(7, 10), false))).toEqual([9, 10, 11, 12, 13]);
  });
});

describe("automatic sync", () => {
  beforeEach(() => mockStore.clear());
  const today = "2026-11-04";
  it("is on until switched off, and each broker's switch is its own", () => {
    expect(isAutoSyncOn("kite")).toBe(true);
    setAutoSyncOn("kite", false);
    expect(isAutoSyncOn("kite")).toBe(false);
    expect(isAutoSyncOn("angel")).toBe(true);
    expect(isAutoSyncOn("zebpay")).toBe(true);
  });
  it("is due from 5 pm, and not before", () => {
    expect(isAutoSyncDue("angel", at(4, 16), today)).toBe(false);
    expect(isAutoSyncDue("angel", at(4, 17), today)).toBe(true);
    expect(isAutoSyncDue("angel", at(4, 23), today)).toBe(true);
  });
  it("runs once a day", () => {
    markAutoSynced("angel", today);
    expect(isAutoSyncDue("angel", at(4, 18), today)).toBe(false);
    expect(isAutoSyncDue("zebpay", at(4, 18), today)).toBe(true);
    expect(isAutoSyncDue("angel", at(5, 18), "2026-11-05")).toBe(true);
  });
  it("leaves share brokers out at weekends, but not crypto", () => {
    expect(isAutoSyncDue("kite", at(7, 18), "2026-11-07")).toBe(false);
    expect(isAutoSyncDue("angel", at(8, 18), "2026-11-08")).toBe(false);
    expect(isAutoSyncDue("zebpay", at(7, 18), "2026-11-07")).toBe(true);
  });
  it("isn't due once switched off", () => {
    setAutoSyncOn("zebpay", false);
    expect(isAutoSyncDue("zebpay", at(4, 18), today)).toBe(false);
  });
});

describe("when the background save runs", () => {
  const all = ["kite", "angel", "zebpay"] as const;
  it("waits for the market to close", () => {
    expect(brokersDueNow(at(4, 15), [...all])).toEqual([]);
    expect(brokersDueNow(at(4, 16), [...all])).toEqual([...all]);
  });
  it("only keeps crypto going at weekends", () => {
    expect(brokersDueNow(at(7, 17), [...all])).toEqual(["zebpay"]);
  });
});
