/**
 * S3-4: Monthly summary deduplication test.
 * Verifies that sendMonthlySummaryNow is called at most once per calendar
 * month even if runDailyNotificationCheck fires multiple times on day 1.
 */

const mockStorage = new Map<string, unknown>();

jest.mock("../../services/storage", () => ({
  settingsStorage: {
    getNumber: jest.fn((key: string) => mockStorage.get(key) as number ?? undefined),
    getString: jest.fn((key: string) => mockStorage.get(key) as string ?? undefined),
    getBoolean: jest.fn((key: string) => mockStorage.get(key) as boolean ?? undefined),
    set: jest.fn((key: string, value: unknown) => { mockStorage.set(key, value); }),
  },
}));

jest.mock("../../services/notifications", () => ({
  hasNotificationPermission: jest.fn(async () => true),
  isNotificationEnabled: jest.fn(() => true),
  sendLocalNotification: jest.fn(async () => {}),
}));

jest.mock("../../services/expense", () => ({
  getOverdueForecasts: jest.fn(async () => []),
  getForecastExpenses: jest.fn(async () => []),
  getRecurringReminders: jest.fn(async () => []),
}));

jest.mock("../../services/expense-queries", () => ({
  getDailySpendingSummary: jest.fn(async () => ({ total: 0, count: 0 })),
}));

jest.mock("../../database", () => ({
  getDatabase: jest.fn(() => ({
    getAllAsync: jest.fn(async () => []),
    getFirstAsync: jest.fn(async () => null),
    execAsync: jest.fn(async () => {}),
  })),
}));

jest.mock("expo-task-manager", () => ({
  isTaskRegisteredAsync: jest.fn(async () => false),
  defineTask: jest.fn(),
}));

jest.mock("expo-background-fetch", () => ({
  BackgroundFetchResult: { NewData: "newData", NoData: "noData", Failed: "failed" },
  registerTaskAsync: jest.fn(async () => {}),
  unregisterTaskAsync: jest.fn(async () => {}),
}));

jest.mock("expo-notifications", () => ({
  scheduleNotificationAsync: jest.fn(async () => "id"),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {}),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
}));

import { runDailyNotificationCheck } from "../../services/notification-scheduler";

describe("Monthly summary deduplication", () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-01T10:00:00"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("sends monthly summary only once on day 1", async () => {
    const notifMock = require("../../services/notifications");

    await runDailyNotificationCheck("default-user");
    await runDailyNotificationCheck("default-user");

    const monthlyCalls = (notifMock.sendLocalNotification as jest.Mock).mock.calls.filter(
      (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).toLowerCase().includes("month"),
    );

    expect(monthlyCalls.length).toBeLessThanOrEqual(1);
  });

  it("does not send monthly summary on day 2", async () => {
    jest.setSystemTime(new Date("2026-06-02T10:00:00"));
    const notifMock = require("../../services/notifications");

    await runDailyNotificationCheck("default-user");

    const monthlyCalls = (notifMock.sendLocalNotification as jest.Mock).mock.calls.filter(
      (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).toLowerCase().includes("month"),
    );

    expect(monthlyCalls.length).toBe(0);
  });
});
