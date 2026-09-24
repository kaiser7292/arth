/**
 * Transaction alerts: which notifications get built, and what the Approve / Reject buttons do.
 */

const mockLockEnabled = jest.fn(() => false);
const mockApprove = jest.fn(async (_id: string) => {});
const mockReject = jest.fn(async (_id: string) => {});
const mockGetFirst = jest.fn(async (): Promise<unknown> => ({ status: "pending_review", deleted_at: null }));
const mockDismiss = jest.fn(async (_id: string) => {});

jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: () => undefined,
    getNumber: () => undefined,
    getString: () => undefined,
    set: () => {},
    delete: () => {},
  })),
}));
jest.mock("expo-notifications", () => ({
  dismissNotificationAsync: (id: string) => mockDismiss(id),
  scheduleNotificationAsync: jest.fn(),
  setNotificationCategoryAsync: jest.fn(),
  getPresentedNotificationsAsync: jest.fn(async () => []),
  registerTaskAsync: jest.fn(async () => null),
}));
jest.mock("expo-task-manager", () => ({ defineTask: jest.fn(), isTaskRegisteredAsync: jest.fn(async () => false) }));
jest.mock("expo-background-fetch", () => ({
  registerTaskAsync: jest.fn(),
  unregisterTaskAsync: jest.fn(),
  BackgroundFetchResult: { NewData: 1, NoData: 2, Failed: 3 },
}));
jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock("../../constants/app", () => ({ DEFAULT_USER_ID: "user-1" }));
jest.mock("../../database", () => ({ initDatabase: async () => ({ getFirstAsync: mockGetFirst, getAllAsync: jest.fn(async () => []) }) }));
jest.mock("../../services/biometric-lock", () => ({ isLockEnabled: () => mockLockEnabled() }));
jest.mock("../../services/notifications", () => ({ hasNotificationPermission: jest.fn(async () => true), isNotificationEnabled: () => true }));
jest.mock("../../services/expense", () => ({
  approveExpense: (id: string) => mockApprove(id),
  rejectExpense: (id: string) => mockReject(id),
}));
jest.mock("../../services/home-widget", () => ({ refreshHomeWidget: jest.fn(async () => {}) }));
jest.mock("../../services/calendar-sync", () => ({ syncCalendarIfDue: jest.fn(async () => {}) }));
jest.mock("../../services/sms/sms-orchestrator", () => ({ runSmsScan: jest.fn() }));

import { MAX_INDIVIDUAL, alertId, buildAlertRequests, handleAlertAction } from "../../services/transaction-alerts";
import type { AlertItem } from "../../services/transaction-alerts";

const item = (id: string, over: Partial<AlertItem> = {}): AlertItem => ({
  id,
  amount: 1240,
  merchant_name: "Swiggy",
  nature: "realized",
  matched_forecast_id: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLockEnabled.mockReturnValue(false);
  mockGetFirst.mockResolvedValue({ status: "pending_review", deleted_at: null });
});

describe("buildAlertRequests", () => {
  it("one alert per item, with buttons, up to the limit", () => {
    const reqs = buildAlertRequests([item("a"), item("b", { nature: "credit", merchant_name: "Rahul" })], false);
    expect(reqs).toHaveLength(2);
    expect(reqs[0]).toMatchObject({ identifier: alertId("a"), withActions: true, data: { expenseId: "a" } });
    expect(reqs[0].title).toContain("Swiggy");
    expect(reqs[1].title).toMatch(/^\+.*received$/);
  });

  it("collapses into one summary past the limit", () => {
    const many = Array.from({ length: MAX_INDIVIDUAL + 1 }, (_, i) => item(String(i)));
    const reqs = buildAlertRequests(many, false);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].title).toBe(`${MAX_INDIVIDUAL + 1} new transactions to review`);
    expect(reqs[0].withActions).toBe(false);
    expect(reqs[0].data.screen).toBe("expense/catch-up");
  });

  it("with the app lock on, shows no amounts and no buttons", () => {
    const [req] = buildAlertRequests([item("a")], true);
    expect(req.withActions).toBe(false);
    expect(req.title).not.toContain("Swiggy");
    expect(`${req.title} ${req.body}`).not.toMatch(/1,240/);
  });

  it("card-repayment credits open the app instead of offering buttons", () => {
    const [req] = buildAlertRequests([item("a", { nature: "credit", matched_forecast_id: "f" })], false);
    expect(req.withActions).toBe(false);
  });
});

describe("handleAlertAction", () => {
  it("approves a still-pending item and clears its alert", async () => {
    expect(await handleAlertAction("approve", { expenseId: "a" })).toBe(true);
    expect(mockApprove).toHaveBeenCalledWith("a");
    expect(mockDismiss).toHaveBeenCalledWith(alertId("a"));
  });

  it("rejects", async () => {
    await handleAlertAction("reject", { expenseId: "a" });
    expect(mockReject).toHaveBeenCalledWith("a");
  });

  it("does nothing to an item already reviewed in the app, but still clears the alert", async () => {
    mockGetFirst.mockResolvedValueOnce({ status: "approved", deleted_at: null });
    await handleAlertAction("reject", { expenseId: "a" });
    expect(mockReject).not.toHaveBeenCalled();
    expect(mockDismiss).toHaveBeenCalledWith(alertId("a"));
  });

  it("refuses while the app lock is on", async () => {
    mockLockEnabled.mockReturnValue(true);
    expect(await handleAlertAction("approve", { expenseId: "a" })).toBe(false);
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it("ignores taps that aren't Approve / Reject", async () => {
    expect(await handleAlertAction("expo.modules.notifications.actions.DEFAULT", { expenseId: "a" })).toBe(false);
  });
});
