/**
 * v15.2.0 — Biometric app lock.
 *
 * Gates the app behind FaceID / fingerprint / device passcode. Opt-in per
 * device via Settings → Security. Timeout configurable (Immediate / 1 /
 * 5 / 15 min / Never). Lock prefs live in MMKV — device-local only, never
 * part of backup/restore.
 *
 * Lock triggers (owned by app/_layout.tsx):
 *   1. Cold start while enabled → always locked
 *   2. App returns from background after > timeout → locked
 *   3. Manual lock from Settings → locked
 *
 * Unlock flow (app/(lock)/lock.tsx):
 *   LocalAuthentication.authenticateAsync({ fallbackLabel: 'Use Passcode' })
 *   success → markUnlocked() → router.replace('/(tabs)')
 *   fail    → stay on lock screen, allow retry
 */

import * as LocalAuthentication from "expo-local-authentication";
import { settingsStorage as storage } from "./storage";

const KEYS = {
  LOCK_ENABLED: "biometric_lock_enabled",
  LOCK_TIMEOUT: "biometric_lock_timeout_seconds",
  LAST_UNLOCK_AT: "biometric_last_unlock_at",
  APP_START_TIME: "biometric_app_start_time",
  HOME_SCREEN_LANDED: "biometric_home_screen_landed",
} as const;

export type LockTimeoutOption = "immediate" | "1m" | "5m" | "15m" | "never";

const TIMEOUT_SECONDS: Record<LockTimeoutOption, number> = {
  immediate: 0,
  "1m": 60,
  "5m": 300,
  "15m": 900,
  never: Number.POSITIVE_INFINITY,
};

export const LOCK_TIMEOUT_LABELS: Record<LockTimeoutOption, string> = {
  immediate: "Immediately",
  "1m": "After 1 minute",
  "5m": "After 5 minutes",
  "15m": "After 15 minutes",
  never: "Never (only on cold start)",
};

export const LOCK_TIMEOUT_OPTIONS: LockTimeoutOption[] = [
  "immediate",
  "1m",
  "5m",
  "15m",
  "never",
];

// ─── Settings getters/setters ───

export function isLockEnabled(): boolean {
  return storage.getBoolean(KEYS.LOCK_ENABLED) ?? false;
}

export function setLockEnabled(enabled: boolean): void {
  storage.set(KEYS.LOCK_ENABLED, enabled);
  if (enabled) {
    // Starting fresh — mark now so the next app-state check doesn't immediately
    // demand unlock right after the user just authenticated during enablement.
    markUnlocked();
  } else {
    storage.delete(KEYS.LAST_UNLOCK_AT);
  }
}

export function getLockTimeout(): LockTimeoutOption {
  const secs = storage.getNumber(KEYS.LOCK_TIMEOUT);
  if (secs === undefined) return "5m";
  for (const opt of LOCK_TIMEOUT_OPTIONS) {
    if (TIMEOUT_SECONDS[opt] === secs) return opt;
  }
  return "5m";
}

export function setLockTimeout(option: LockTimeoutOption): void {
  storage.set(KEYS.LOCK_TIMEOUT, TIMEOUT_SECONDS[option]);
}

// ─── Unlock tracking ───

export function markUnlocked(): void {
  storage.set(KEYS.LAST_UNLOCK_AT, Date.now());
}

export function getLastUnlockAt(): number | null {
  return storage.getNumber(KEYS.LAST_UNLOCK_AT) ?? null;
}

export function setAppStartTime(): void {
  storage.set(KEYS.APP_START_TIME, Date.now());
}

export function getAppStartTime(): number | null {
  return storage.getNumber(KEYS.APP_START_TIME) ?? null;
}

export function clearAppStartTime(): void {
  storage.delete(KEYS.APP_START_TIME);
}

export function setHasLandedOnHome(value: boolean): void {
  storage.set(KEYS.HOME_SCREEN_LANDED, value);
}

export function getHasLandedOnHome(): boolean {
  return storage.getBoolean(KEYS.HOME_SCREEN_LANDED) ?? false;
}

/**
 * Should the app show the lock screen right now?
 *
 * Decision tree:
 *   1. Lock disabled           → false
 *   2. Cold start detection   → true (app start time > last unlock) with 10s grace period or home screen check
 *   3. No prior unlock         → true (first time ever)
 *   4. Timeout = "never"       → false (once unlocked, stays unlocked this session)
 *   5. Immediate timeout      → true after 1s grace period
 *   6. Seconds since unlock >= timeout → true
 *   7. Otherwise               → false
 */
export function shouldShowLock(now: number = Date.now()): boolean {
  if (!isLockEnabled()) return false;

  const lastUnlock = getLastUnlockAt();

  // Cold start detection: if app start time is more recent than last unlock,
  // this is a cold start and should lock only if:
  // 1. User has landed on home screen, OR
  // 2. More than 10 seconds have passed since app start
  const appStartTime = getAppStartTime();
  const hasLandedOnHome = getHasLandedOnHome();
  if (appStartTime && lastUnlock && appStartTime > lastUnlock) {
    const gracePeriodMs = 10000; // 10 second grace period
    const timeSinceAppStart = now - appStartTime;
    return hasLandedOnHome || timeSinceAppStart >= gracePeriodMs;
  }

  // No prior unlock (first time ever) → lock
  if (lastUnlock === null) return true;

  const option = getLockTimeout();
  const timeoutMs = TIMEOUT_SECONDS[option] * 1000;

  // "never" timeout → only lock on cold start (handled above)
  if (!Number.isFinite(timeoutMs)) return false;

  // For "immediate", add grace period to prevent loop
  if (option === "immediate") {
    const gracePeriodMs = 1000; // 1 second grace period
    return now - lastUnlock >= gracePeriodMs;
  }

  // Other timeouts (1m, 5m, 15m)
  return now - lastUnlock >= timeoutMs;
}

// ─── Hardware capability + biometric prompt ───

export interface BiometricCapability {
  hasHardware: boolean;
  isEnrolled: boolean;
  supportedTypes: LocalAuthentication.AuthenticationType[];
}

export async function getBiometricCapability(): Promise<BiometricCapability> {
  const [hasHardware, isEnrolled, supportedTypes] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);
  return { hasHardware, isEnrolled, supportedTypes };
}

export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: "no_hardware" | "not_enrolled" | "cancelled" | "failed" | "error"; detail?: string };

/**
 * Prompt the user to authenticate. Used both during enablement (verify the
 * user can authenticate before turning the feature on) and during unlock.
 */
export async function promptUnlock(options?: {
  promptMessage?: string;
  allowDeviceCredentials?: boolean;
}): Promise<UnlockResult> {
  const capability = await getBiometricCapability();
  if (!capability.hasHardware) {
    return { ok: false, reason: "no_hardware" };
  }
  if (!capability.isEnrolled) {
    return { ok: false, reason: "not_enrolled" };
  }

  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: options?.promptMessage ?? "Unlock Artha",
      fallbackLabel: "Use Passcode",
      disableDeviceFallback: options?.allowDeviceCredentials === false,
      cancelLabel: "Cancel",
    });
    if (result.success) {
      markUnlocked();
      return { ok: true };
    }
    if (result.error === "user_cancel" || result.error === "system_cancel") {
      return { ok: false, reason: "cancelled" };
    }
    return { ok: false, reason: "failed", detail: result.error };
  } catch (e) {
    return { ok: false, reason: "error", detail: e instanceof Error ? e.message : String(e) };
  }
}

export function describeBiometricType(types: LocalAuthentication.AuthenticationType[]): string {
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    return "Face ID";
  }
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return "Fingerprint";
  }
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
    return "Iris";
  }
  return "Biometric";
}
