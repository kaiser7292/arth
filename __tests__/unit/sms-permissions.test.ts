/**
 * Tests for SMS permission service.
 * Mocks MMKV and PermissionsAndroid since these are native modules.
 */

const mockStore: Record<string, unknown> = {};
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: (key: string) => mockStore[key] as boolean | undefined,
    getNumber: (key: string) => mockStore[key] as number | undefined,
    getString: (key: string) => mockStore[key] as string | undefined,
    set: (key: string, value: unknown) => {
      mockStore[key] = value;
    },
    delete: (key: string) => {
      delete mockStore[key];
    },
  })),
}));

jest.mock("react-native", () => ({
  Platform: { OS: "android" },
  PermissionsAndroid: {
    PERMISSIONS: { READ_SMS: "android.permission.READ_SMS" },
    RESULTS: { GRANTED: "granted", DENIED: "denied" },
    check: jest.fn(),
    request: jest.fn(),
  },
  Alert: { alert: jest.fn() },
}));

import { PermissionsAndroid } from "react-native";
import {
  isSmsDetectionEnabled,
  setSmsDetectionEnabled,
  isSmsAutoEnabled,
  setSmsAutoEnabled,
  hasSmsPermission,
  getLastSmsCheckTimestamp,
  setLastSmsCheckTimestamp,
  getSmsStartDate,
  setSmsStartDate,
  getSmsStartTimestamp,
  hasAcceptedSmsDisclosure,
  acceptSmsDisclosure,
  requestSmsPermission,
} from "../../services/sms/sms-permissions";

describe("sms-permissions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear mock store
    for (const key in mockStore) delete mockStore[key];
  });

  describe("isSmsDetectionEnabled / setSmsDetectionEnabled", () => {
    it("defaults to false", () => {
      expect(isSmsDetectionEnabled()).toBe(false);
    });

    it("can be enabled", () => {
      setSmsDetectionEnabled(true);
      expect(isSmsDetectionEnabled()).toBe(true);
    });

    it("can be disabled after enabling", () => {
      setSmsDetectionEnabled(true);
      setSmsDetectionEnabled(false);
      expect(isSmsDetectionEnabled()).toBe(false);
    });
  });

  describe("isSmsAutoEnabled / setSmsAutoEnabled", () => {
    it("defaults to false (auto off by default)", () => {
      expect(isSmsAutoEnabled()).toBe(false);
    });

    it("can be toggled on", () => {
      setSmsAutoEnabled(true);
      expect(isSmsAutoEnabled()).toBe(true);
    });

    it("can be toggled off", () => {
      setSmsAutoEnabled(true);
      setSmsAutoEnabled(false);
      expect(isSmsAutoEnabled()).toBe(false);
    });
  });

  describe("lastSmsCheckTimestamp", () => {
    it("defaults to 0", () => {
      expect(getLastSmsCheckTimestamp()).toBe(0);
    });

    it("persists timestamp", () => {
      const ts = 1712678400000;
      setLastSmsCheckTimestamp(ts);
      expect(getLastSmsCheckTimestamp()).toBe(ts);
    });
  });

  describe("smsStartDate", () => {
    it("defaults to 7 days ago if not set", () => {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      expect(getSmsStartDate()).toBe(expected);
    });

    it("persists a custom start date", () => {
      setSmsStartDate("2025-10-01");
      expect(getSmsStartDate()).toBe("2025-10-01");
    });

    it("converts start date to timestamp", () => {
      setSmsStartDate("2026-01-15");
      const ts = getSmsStartTimestamp();
      const expected = new Date("2026-01-15").getTime();
      expect(ts).toBe(expected);
    });

    it("falls back to now for invalid date", () => {
      setSmsStartDate("invalid-date");
      const ts = getSmsStartTimestamp();
      // Should fall back to Date.now()
      expect(ts).toBeGreaterThan(0);
      expect(Math.abs(ts - Date.now())).toBeLessThan(1000);
    });
  });

  describe("hasSmsPermission", () => {
    it("returns true when permission granted", async () => {
      (PermissionsAndroid.check as jest.Mock).mockResolvedValue(true);
      expect(await hasSmsPermission()).toBe(true);
    });

    it("returns false when permission denied", async () => {
      (PermissionsAndroid.check as jest.Mock).mockResolvedValue(false);
      expect(await hasSmsPermission()).toBe(false);
    });
  });

  describe("SMS disclosure gate", () => {
    it("has no disclosure acceptance by default", () => {
      expect(hasAcceptedSmsDisclosure()).toBe(false);
    });

    it("records acceptance", () => {
      acceptSmsDisclosure();
      expect(hasAcceptedSmsDisclosure()).toBe(true);
    });

    it("does not show the OS prompt before the disclosure is accepted", async () => {
      (PermissionsAndroid.check as jest.Mock).mockResolvedValue(false);
      const granted = await requestSmsPermission();
      expect(granted).toBe(false);
      expect(PermissionsAndroid.request).not.toHaveBeenCalled();
    });

    it("shows the OS prompt once the disclosure is accepted", async () => {
      (PermissionsAndroid.check as jest.Mock).mockResolvedValue(false);
      (PermissionsAndroid.request as jest.Mock).mockResolvedValue("granted");
      acceptSmsDisclosure();
      const granted = await requestSmsPermission();
      expect(granted).toBe(true);
      expect(PermissionsAndroid.request).toHaveBeenCalledTimes(1);
    });

    it("returns true without prompting when permission is already granted", async () => {
      (PermissionsAndroid.check as jest.Mock).mockResolvedValue(true);
      expect(await requestSmsPermission()).toBe(true);
      expect(PermissionsAndroid.request).not.toHaveBeenCalled();
    });
  });
});
