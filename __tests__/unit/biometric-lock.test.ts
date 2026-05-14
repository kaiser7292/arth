/**
 * v15.2.0 — Biometric lock service tests.
 *
 * Exercise: settings getters/setters, timeout option <-> seconds roundtrip,
 * shouldShowLock() decision tree, and promptUnlock() flows (mocked
 * expo-local-authentication). DOES NOT verify the actual biometric prompt
 * UI — that requires a real device.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface MmkvBacking {
  [key: string]: unknown;
}

const store: MmkvBacking = {};

jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getBoolean: jest.fn((k: string) => store[k] as boolean | undefined),
    getNumber: jest.fn((k: string) => store[k] as number | undefined),
    getString: jest.fn((k: string) => store[k] as string | undefined),
    set: jest.fn((k: string, v: unknown) => {
      store[k] = v;
    }),
    delete: jest.fn((k: string) => {
      delete store[k];
    }),
  })),
}));

const mockAuth = jest.fn();
const mockHasHardware = jest.fn();
const mockIsEnrolled = jest.fn();
const mockSupportedTypes = jest.fn();

jest.mock("expo-local-authentication", () => ({
  authenticateAsync: (...args: unknown[]) => mockAuth(...args),
  hasHardwareAsync: () => mockHasHardware(),
  isEnrolledAsync: () => mockIsEnrolled(),
  supportedAuthenticationTypesAsync: () => mockSupportedTypes(),
  AuthenticationType: {
    FINGERPRINT: 1,
    FACIAL_RECOGNITION: 2,
    IRIS: 3,
  },
}));

import {
    describeBiometricType,
    getBiometricCapability,
    getLastUnlockAt,
    getLockTimeout,
    isLockEnabled,
    LOCK_TIMEOUT_OPTIONS,
    markUnlocked,
    promptUnlock,
    setLockEnabled,
    setLockTimeout,
    shouldShowLock,
} from "../../services/biometric-lock";

describe("biometric-lock settings", () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
  });

  it("isLockEnabled defaults to false on fresh device", () => {
    expect(isLockEnabled()).toBe(false);
  });

  it("setLockEnabled(true) marks unlocked so current session isn't locked immediately", () => {
    setLockEnabled(true);
    expect(isLockEnabled()).toBe(true);
    expect(getLastUnlockAt()).not.toBeNull();
  });

  it("setLockEnabled(false) clears the unlock stamp", () => {
    setLockEnabled(true);
    expect(getLastUnlockAt()).not.toBeNull();
    setLockEnabled(false);
    expect(isLockEnabled()).toBe(false);
    expect(getLastUnlockAt()).toBeNull();
  });

  it("getLockTimeout defaults to 5m", () => {
    expect(getLockTimeout()).toBe("5m");
  });

  it("setLockTimeout roundtrips for every option", () => {
    for (const opt of LOCK_TIMEOUT_OPTIONS) {
      setLockTimeout(opt);
      expect(getLockTimeout()).toBe(opt);
    }
  });
});

describe("shouldShowLock()", () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
  });

  it("returns false when lock is disabled", () => {
    expect(shouldShowLock()).toBe(false);
  });

  it("returns true on cold start when lock is enabled and no prior unlock", () => {
    setLockEnabled(true);
    // setLockEnabled writes a lastUnlock stamp — clear it to simulate cold start
    delete store["biometric_last_unlock_at"];
    expect(shouldShowLock()).toBe(true);
  });

  it("returns false when timeout=never and at least one prior unlock", () => {
    setLockEnabled(true);
    setLockTimeout("never");
    markUnlocked();
    expect(shouldShowLock(Date.now() + 365 * 24 * 3600_000)).toBe(false);
  });

  it("returns true when seconds-since-unlock >= timeout", () => {
    setLockEnabled(true);
    setLockTimeout("1m");
    const now = 1_000_000_000_000;
    store["biometric_last_unlock_at"] = now - 61_000; // 61s ago
    expect(shouldShowLock(now)).toBe(true);
  });

  it("returns false when still within timeout window", () => {
    setLockEnabled(true);
    setLockTimeout("5m");
    const now = 1_000_000_000_000;
    store["biometric_last_unlock_at"] = now - 120_000; // 2 min ago
    expect(shouldShowLock(now)).toBe(false);
  });

  it("immediate option locks on any re-entry (after grace period)", () => {
    setLockEnabled(true);
    setLockTimeout("immediate");
    const now = 1_000_000_000_000;
    store["biometric_last_unlock_at"] = now - 1500; // 1500 ms ago (after grace period)
    expect(shouldShowLock(now)).toBe(true);
  });

  it("immediate option has 1 second grace period to prevent loop", () => {
    setLockEnabled(true);
    setLockTimeout("immediate");
    const now = 1_000_000_000_000;
    store["biometric_last_unlock_at"] = now - 500; // 500 ms ago
    expect(shouldShowLock(now)).toBe(false); // Within grace period
  });

  it("immediate option locks after grace period expires", () => {
    setLockEnabled(true);
    setLockTimeout("immediate");
    const now = 1_000_000_000_000;
    store["biometric_last_unlock_at"] = now - 1500; // 1500 ms ago
    expect(shouldShowLock(now)).toBe(true); // After grace period
  });
});

describe("getBiometricCapability()", () => {
  it("reports hardware + enrollment + supported types", async () => {
    mockHasHardware.mockResolvedValueOnce(true);
    mockIsEnrolled.mockResolvedValueOnce(true);
    mockSupportedTypes.mockResolvedValueOnce([2]); // FACIAL_RECOGNITION

    const cap = await getBiometricCapability();
    expect(cap.hasHardware).toBe(true);
    expect(cap.isEnrolled).toBe(true);
    expect(cap.supportedTypes).toEqual([2]);
  });
});

describe("describeBiometricType()", () => {
  it("prefers Face ID when available", () => {
    expect(describeBiometricType([1, 2])).toBe("Face ID");
  });
  it("falls back to Fingerprint", () => {
    expect(describeBiometricType([1])).toBe("Fingerprint");
  });
  it("handles iris", () => {
    expect(describeBiometricType([3])).toBe("Iris");
  });
  it("defaults to generic 'Biometric' label", () => {
    expect(describeBiometricType([])).toBe("Biometric");
  });
});

describe("promptUnlock()", () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    mockAuth.mockReset();
    mockHasHardware.mockResolvedValue(true);
    mockIsEnrolled.mockResolvedValue(true);
  });

  it("returns no_hardware when device has no biometric support", async () => {
    mockHasHardware.mockResolvedValueOnce(false);
    const r = await promptUnlock();
    expect(r).toEqual({ ok: false, reason: "no_hardware" });
  });

  it("returns not_enrolled when device has hardware but nothing enrolled", async () => {
    mockIsEnrolled.mockResolvedValueOnce(false);
    const r = await promptUnlock();
    expect(r).toEqual({ ok: false, reason: "not_enrolled" });
  });

  it("returns ok and stamps unlocked on success", async () => {
    mockAuth.mockResolvedValueOnce({ success: true });
    const r = await promptUnlock();
    expect(r.ok).toBe(true);
    expect(getLastUnlockAt()).not.toBeNull();
  });

  it("returns cancelled on user cancel", async () => {
    mockAuth.mockResolvedValueOnce({ success: false, error: "user_cancel" });
    const r = await promptUnlock();
    expect(r).toEqual({ ok: false, reason: "cancelled" });
  });

  it("returns failed on generic auth failure", async () => {
    mockAuth.mockResolvedValueOnce({ success: false, error: "authentication_failed" });
    const r = await promptUnlock();
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe("failed");
  });

  it("returns error when the native call throws", async () => {
    mockAuth.mockRejectedValueOnce(new Error("unknown native error"));
    const r = await promptUnlock();
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe("error");
  });
});
