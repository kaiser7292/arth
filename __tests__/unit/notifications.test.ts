/**
 * Notification service unit tests — V3-0.6
 *
 * Tests notification preferences (MMKV), permission flow,
 * and notification content formatting.
 */

// ─── Mock MMKV ───
const mockStorage: Record<string, unknown> = {};
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: (key: string) => mockStorage[key] as boolean | undefined,
    set: (key: string, value: unknown) => { mockStorage[key] = value; },
    getString: (key: string) => mockStorage[key] as string | undefined,
    getNumber: (key: string) => mockStorage[key] as number | undefined,
    delete: (key: string) => { delete mockStorage[key]; },
  })),
}));

// ─── Mock expo-notifications (must use factory — hoisted before imports) ───
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

// Import the mocked module to get references for assertions
import * as Notifications from "expo-notifications";
const mockSchedule = Notifications.scheduleNotificationAsync as jest.Mock;
const mockCancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;
const mockCancelAll = Notifications.cancelAllScheduledNotificationsAsync as jest.Mock;
const mockGetAll = Notifications.getAllScheduledNotificationsAsync as jest.Mock;
const mockGetPermissions = Notifications.getPermissionsAsync as jest.Mock;
const mockRequestPermissions = Notifications.requestPermissionsAsync as jest.Mock;

import {
  isNotificationEnabled,
  setNotificationEnabled,
  getNotificationPreferences,
  requestNotificationPermissions,
  hasNotificationPermission,
  sendLocalNotification,
  scheduleDelayedNotification,
  cancelNotification,
  cancelAllNotifications,
  getPendingNotificationCount,
  formatSmsScanBody,
} from "../../services/notifications";

beforeEach(() => {
  // Clear MMKV mock
  Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
  jest.clearAllMocks();
});

describe("Notification Preferences", () => {
  it("returns true by default for all categories", () => {
    expect(isNotificationEnabled("overdue_forecast")).toBe(true);
    expect(isNotificationEnabled("upcoming_due")).toBe(true);
    expect(isNotificationEnabled("scheduled_backup")).toBe(true);
  });

  it("persists preference changes", () => {
    setNotificationEnabled("overdue_forecast", false);
    expect(isNotificationEnabled("overdue_forecast")).toBe(false);
    expect(isNotificationEnabled("upcoming_due")).toBe(true);
  });

  it("getNotificationPreferences returns all categories", () => {
    setNotificationEnabled("upcoming_due", false);
    const prefs = getNotificationPreferences();
    expect(prefs).toEqual({
      overdue_forecast: true,
      upcoming_due: false,
      monthly_summary: true,
      scheduled_backup: true,
    });
  });
});

describe("Notification Permissions", () => {
  it("returns true when permission already granted", async () => {
    mockGetPermissions.mockResolvedValueOnce({ status: "granted" });
    const result = await requestNotificationPermissions();
    expect(result).toBe(true);
  });

  it("requests permission when not granted", async () => {
    mockGetPermissions.mockResolvedValueOnce({ status: "undetermined" });
    mockRequestPermissions.mockResolvedValueOnce({ status: "granted" });
    const result = await requestNotificationPermissions();
    expect(result).toBe(true);
    expect(mockRequestPermissions).toHaveBeenCalled();
  });

  it("returns false when permission denied", async () => {
    mockGetPermissions.mockResolvedValueOnce({ status: "undetermined" });
    mockRequestPermissions.mockResolvedValueOnce({ status: "denied" });
    const result = await requestNotificationPermissions();
    expect(result).toBe(false);
  });

  it("hasNotificationPermission checks current status", async () => {
    mockGetPermissions.mockResolvedValueOnce({ status: "granted" });
    expect(await hasNotificationPermission()).toBe(true);
    mockGetPermissions.mockResolvedValueOnce({ status: "denied" });
    expect(await hasNotificationPermission()).toBe(false);
  });
});

describe("Send/Schedule Notifications", () => {
  it("sends immediate notification", async () => {
    const id = await sendLocalNotification("Title", "Body", { screen: "/test" });
    expect(id).toBe("notif-id-1");
    expect(mockSchedule).toHaveBeenCalledWith({
      content: {
        title: "Title",
        body: "Body",
        data: { screen: "/test" },
        sound: true,
        channelId: "artha-default",
      },
      trigger: null,
    });
  });

  it("schedules delayed notification", async () => {
    await scheduleDelayedNotification("Delayed", "Body", 60, { screen: "/delayed" });
    expect(mockSchedule).toHaveBeenCalledWith({
      content: {
        title: "Delayed",
        body: "Body",
        data: { screen: "/delayed" },
        sound: true,
        channelId: "artha-default",
      },
      trigger: { type: "timeInterval", seconds: 60 },
    });
  });

  it("cancels a notification by ID", async () => {
    await cancelNotification("notif-123");
    expect(mockCancel).toHaveBeenCalledWith("notif-123");
  });

  it("cancels all notifications", async () => {
    await cancelAllNotifications();
    expect(mockCancelAll).toHaveBeenCalled();
  });

  it("returns pending notification count", async () => {
    mockGetAll.mockResolvedValueOnce([{}, {}, {}]);
    const count = await getPendingNotificationCount();
    expect(count).toBe(3);
  });
});

describe("formatSmsScanBody", () => {
  it("handles empty items", () => {
    expect(formatSmsScanBody([])).toBe("No new transactions found.");
  });

  it("formats single item", () => {
    const body = formatSmsScanBody([{ merchant: "Swiggy", amount: 450 }]);
    expect(body).toContain("Swiggy");
    expect(body).toContain("450");
  });

  it("formats two items", () => {
    const body = formatSmsScanBody([
      { merchant: "Swiggy", amount: 450 },
      { merchant: "Amazon", amount: 1200 },
    ]);
    expect(body).toContain("Swiggy");
    expect(body).toContain("Amazon");
    expect(body).not.toContain("+");
  });

  it("formats more than two items with +N more", () => {
    const body = formatSmsScanBody([
      { merchant: "Swiggy", amount: 450 },
      { merchant: "Amazon", amount: 1200 },
      { merchant: "Uber", amount: 300 },
      { merchant: "Zomato", amount: 250 },
    ]);
    expect(body).toContain("Swiggy");
    expect(body).toContain("Amazon");
    expect(body).toContain("+2 more");
    expect(body).not.toContain("Uber");
  });
});
