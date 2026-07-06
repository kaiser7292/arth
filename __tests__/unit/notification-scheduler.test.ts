/**
 * Notification Scheduler tests
 *
 * Tests scheduleSmartDailyDigest — the single 9:10 AM daily digest.
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
  SchedulableTriggerInputTypes: { DATE: "date", MONTHLY: "monthly" },
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
  getRecurringReminders: jest.fn(async () => []),
}));

// ─── Mock database (for EMI query inside scheduleSmartDailyDigest) ───
jest.mock("../../database", () => ({
  getDatabase: () => ({
    getAllAsync: jest.fn(async () => []),
  }),
}));

import * as Notifications from "expo-notifications";
const mockSchedule = Notifications.scheduleNotificationAsync as jest.Mock;
const mockCancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;

import {
  scheduleSmartDailyDigest,
  runDailyNotificationCheck,
} from "../../services/notification-scheduler";
import { setNotificationEnabled } from "../../services/notifications";

function todayLocal(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

beforeEach(() => {
  Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
  jest.clearAllMocks();
  mockOverdueForecasts.mockResolvedValue([]);
  mockGetForecastExpenses.mockResolvedValue([]);
});

// ─── scheduleSmartDailyDigest ───

describe("scheduleSmartDailyDigest", () => {
  it("cancels existing and schedules nothing when nothing is due", async () => {
    await scheduleSmartDailyDigest("user-1");
    expect(mockCancel).toHaveBeenCalledWith("artha_daily_digest");
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("schedules a notification when overdue items exist", async () => {
    mockOverdueForecasts.mockResolvedValueOnce([
      { id: "e1", amount: 5000, merchant_name: "HDFC CC", description: null, due_date: "2026-04-10" },
    ]);
    await scheduleSmartDailyDigest("user-1");
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const call = mockSchedule.mock.calls[0][0];
    expect(call.identifier).toBe("artha_daily_digest");
    expect(call.content.body).toContain("1 overdue payment");
  });

  it("schedules a notification when upcoming dues exist", async () => {
    const today = todayLocal();
    mockGetForecastExpenses.mockResolvedValueOnce([
      { id: "e1", amount: 3000, merchant_name: "Netflix", description: null, due_date: today },
    ]);
    await scheduleSmartDailyDigest("user-1");
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSchedule.mock.calls[0][0].content.body).toContain("due soon");
  });

  it("combines multiple items into a single body with ·", async () => {
    mockOverdueForecasts.mockResolvedValueOnce([
      { id: "e1", amount: 5000, merchant_name: "HDFC CC", description: null, due_date: "2026-04-10" },
    ]);
    mockGetForecastExpenses.mockResolvedValueOnce([
      { id: "e2", amount: 3000, merchant_name: "Netflix", description: null, due_date: todayLocal() },
    ]);
    await scheduleSmartDailyDigest("user-1");
    const body = mockSchedule.mock.calls[0][0].content.body as string;
    expect(body).toContain("overdue");
    expect(body).toContain("due soon");
    expect(body).toContain("·");
  });

  it("skips when both categories are disabled", async () => {
    setNotificationEnabled("overdue_forecast", false);
    setNotificationEnabled("upcoming_due", false);
    mockOverdueForecasts.mockResolvedValueOnce([
      { id: "e1", amount: 5000, merchant_name: "HDFC CC", description: null, due_date: "2026-04-10" },
    ]);
    await scheduleSmartDailyDigest("user-1");
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});

// ─── runDailyNotificationCheck ───

describe("runDailyNotificationCheck", () => {
  it("resolves without throwing", async () => {
    await expect(runDailyNotificationCheck("user-1")).resolves.toBeUndefined();
  });
});
