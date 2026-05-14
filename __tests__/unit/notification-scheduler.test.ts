/**
 * Notification Scheduler tests — V3-2.5
 *
 * Tests overdue check, upcoming due check, and combined daily check.
 * Mocks notifications service and expense queries.
 */

// ─── Mock MMKV ───
const mockStorage: Record<string, unknown> = {};
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: (key: string) => mockStorage[key] as boolean | undefined,
    getNumber: (key: string) => mockStorage[key] as number | undefined,
    set: (key: string, value: unknown) => { mockStorage[key] = value; },
    getString: (key: string) => mockStorage[key] as string | undefined,
    delete: (key: string) => { delete mockStorage[key]; },
  })),
}));

// ─── Mock expo-notifications ───
jest.mock("expo-notifications", () => ({
  scheduleNotificationAsync: jest.fn(async () => "notif-id-1"),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {}),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: "timeInterval" },
}));

jest.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

// ─── Mock expo-task-manager + expo-background-fetch ───
jest.mock("expo-task-manager", () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));

jest.mock("expo-background-fetch", () => ({
  registerTaskAsync: jest.fn(async () => {}),
  unregisterTaskAsync: jest.fn(async () => {}),
  BackgroundFetchResult: { NewData: 1, NoData: 2, Failed: 3 },
}));

jest.mock("../../constants/app", () => ({
  DEFAULT_USER_ID: "user-1",
}));

// ─── Mock expense service ───
type ForecastItem = {
  id: string;
  amount: number;
  merchant_name: string;
  description: string | null;
  due_date: string;
};

const mockOverdueForecasts = jest.fn(async (): Promise<ForecastItem[]> => []);
const mockGetForecastExpenses = jest.fn(async (): Promise<ForecastItem[]> => []);

jest.mock("../../services/expense", () => ({
  getOverdueForecasts: (...args: unknown[]) => mockOverdueForecasts(...args as []),
  getForecastExpenses: (...args: unknown[]) => mockGetForecastExpenses(...args as []),
  // v14.7.0 recurring-reminders check — default to empty so existing tests
  // don't need to change.
  getRecurringReminders: jest.fn(async () => []),
}));

import * as Notifications from "expo-notifications";
const mockSchedule = Notifications.scheduleNotificationAsync as jest.Mock;

import {
    checkAndNotifyOverdue,
    checkAndNotifyUpcoming,
    runDailyNotificationCheck,
} from "../../services/notification-scheduler";
import { setNotificationEnabled } from "../../services/notifications";

beforeEach(() => {
  Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
  jest.clearAllMocks();
  mockOverdueForecasts.mockResolvedValue([]);
  mockGetForecastExpenses.mockResolvedValue([]);
});

/**
 * Local-date helper — matches the service's `daysFromNow`, which pads local
 * time to midnight. Tests originally used `new Date().toISOString().split("T")[0]`,
 * which returns UTC-date. In timezones east of UTC late at night (e.g. IST
 * 00:30), that produces "yesterday" while the service sees "today" — causing
 * `days = -1` filtering and phantom zero-count failures. This helper gives
 * the same local date the service uses.
 */
function todayLocal(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Overdue Check ───

describe("checkAndNotifyOverdue", () => {
  it("returns 0 and skips notification when no overdue items", async () => {
    const count = await checkAndNotifyOverdue("user-1");
    expect(count).toBe(0);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("sends notification for single overdue item", async () => {
    mockOverdueForecasts.mockResolvedValueOnce([
      { id: "e1", amount: 5000, merchant_name: "HDFC CC", description: "Credit card", due_date: "2026-04-10" },
    ]);
    const count = await checkAndNotifyOverdue("user-1");
    expect(count).toBe(1);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const call = mockSchedule.mock.calls[0][0];
    expect(call.content.title).toContain("1 overdue payment");
    expect(call.content.body).toContain("HDFC CC");
    expect(call.content.data.screen).toBe("/expense/review-queue");
  });

  it("sends notification for multiple overdue items with total", async () => {
    mockOverdueForecasts.mockResolvedValueOnce([
      { id: "e1", amount: 5000, merchant_name: "HDFC CC", description: null, due_date: "2026-04-10" },
      { id: "e2", amount: 2000, merchant_name: "Airtel", description: null, due_date: "2026-04-11" },
      { id: "e3", amount: 1000, merchant_name: "Netflix", description: null, due_date: "2026-04-11" },
    ]);
    const count = await checkAndNotifyOverdue("user-1");
    expect(count).toBe(3);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const body = mockSchedule.mock.calls[0][0].content.body;
    expect(body).toContain("HDFC CC");
    expect(body).toContain("Airtel");
    expect(body).toContain("+1 more");
    expect(body).toContain("₹8,000");
  });

  it("skips notification when overdue_forecast notifications are disabled", async () => {
    setNotificationEnabled("overdue_forecast", false);
    mockOverdueForecasts.mockResolvedValueOnce([
      { id: "e1", amount: 5000, merchant_name: "HDFC CC", description: null, due_date: "2026-04-10" },
    ]);
    const count = await checkAndNotifyOverdue("user-1");
    expect(count).toBe(0);
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});

// ─── Upcoming Due Check ───

describe("checkAndNotifyUpcoming", () => {
  it("returns 0 when no upcoming dues", async () => {
    mockGetForecastExpenses.mockResolvedValueOnce([]);
    const count = await checkAndNotifyUpcoming("user-1");
    expect(count).toBe(0);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("sends notification for dues due today", async () => {
    const today = todayLocal();
    mockGetForecastExpenses.mockResolvedValueOnce([
      { id: "e1", amount: 3000, merchant_name: "Netflix", description: null, due_date: today },
    ]);
    const count = await checkAndNotifyUpcoming("user-1");
    expect(count).toBe(1);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const title = mockSchedule.mock.calls[0][0].content.title;
    expect(title).toContain("Due today");
    expect(title).toContain("Netflix");
  });

  it("sends notification for dues due tomorrow", async () => {
    const tomorrow = todayLocal(1);
    mockGetForecastExpenses.mockResolvedValueOnce([
      { id: "e1", amount: 1500, merchant_name: "Spotify", description: null, due_date: tomorrow },
    ]);
    const count = await checkAndNotifyUpcoming("user-1");
    expect(count).toBe(1);
    const title = mockSchedule.mock.calls[0][0].content.title;
    expect(title).toContain("Due tomorrow");
  });

  it("limits notifications to 3 even with more items", async () => {
    const today = todayLocal();
    mockGetForecastExpenses.mockResolvedValueOnce([
      { id: "e1", amount: 1000, merchant_name: "A", description: null, due_date: today },
      { id: "e2", amount: 2000, merchant_name: "B", description: null, due_date: today },
      { id: "e3", amount: 3000, merchant_name: "C", description: null, due_date: today },
      { id: "e4", amount: 4000, merchant_name: "D", description: null, due_date: today },
    ]);
    const count = await checkAndNotifyUpcoming("user-1");
    expect(count).toBe(4); // total found
    expect(mockSchedule).toHaveBeenCalledTimes(3); // max 3 notifications sent
  });

  it("skips dues more than 2 days away", async () => {
    const farFuture = todayLocal(5);
    mockGetForecastExpenses.mockResolvedValueOnce([
      { id: "e1", amount: 3000, merchant_name: "Far Due", description: null, due_date: farFuture },
    ]);
    const count = await checkAndNotifyUpcoming("user-1");
    expect(count).toBe(0);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("skips notification when upcoming_due notifications are disabled", async () => {
    setNotificationEnabled("upcoming_due", false);
    const today = todayLocal();
    mockGetForecastExpenses.mockResolvedValueOnce([
      { id: "e1", amount: 3000, merchant_name: "Netflix", description: null, due_date: today },
    ]);
    const count = await checkAndNotifyUpcoming("user-1");
    expect(count).toBe(0);
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});

// ─── Combined Daily Check ───

describe("runDailyNotificationCheck", () => {
  it("runs both overdue and upcoming checks", async () => {
    const today = todayLocal();
    mockOverdueForecasts.mockResolvedValueOnce([
      { id: "e1", amount: 5000, merchant_name: "HDFC CC", description: null, due_date: "2026-04-10" },
    ]);
    mockGetForecastExpenses.mockResolvedValueOnce([
      { id: "e2", amount: 1500, merchant_name: "Netflix", description: null, due_date: today },
    ]);

    const result = await runDailyNotificationCheck("user-1");
    expect(result.overdue).toBe(1);
    expect(result.upcoming).toBe(1);
    expect(mockSchedule.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
