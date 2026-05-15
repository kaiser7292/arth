/**
 * SMS permission handling for Android.
 * Requests READ_SMS with a contextual explanation dialog.
 * Persists user's opt-in choice in MMKV.
 *
 * Two modes:
 *  - Manual: user taps "Scan Now" to read SMS on demand
 *  - Auto:   background task checks every ~15 min (opt-in)
 *
 * Start date: user picks from when to read SMS history.
 *  - If not set, defaults to 7 days ago
 *  - User can set an earlier date for historic data setup
 */

import { Platform, PermissionsAndroid } from "react-native";
import { settingsStorage as storage } from "@/services/storage";

const KEYS = {
  SMS_ENABLED: "sms_detection_enabled",
  SMS_AUTO_ENABLED: "sms_auto_mode_enabled",
  SMS_PERMISSION_ASKED: "sms_permission_asked",
  LAST_SMS_CHECK: "last_sms_check_timestamp",
  LAST_AUTO_SCAN_RUN: "last_auto_scan_run_timestamp",
  SMS_START_DATE: "sms_start_date",
  SMS_END_DATE: "sms_end_date",
  SMS_SCAN_ACCOUNT_IDS: "sms_scan_account_ids",
} as const;

// ─── Detection Enabled (permission granted + user opted in) ───

export function isSmsDetectionEnabled(): boolean {
  return storage.getBoolean(KEYS.SMS_ENABLED) ?? false;
}

export function setSmsDetectionEnabled(enabled: boolean): void {
  storage.set(KEYS.SMS_ENABLED, enabled);
}

// ─── Auto Mode (background polling — off by default) ───

export function isSmsAutoEnabled(): boolean {
  return storage.getBoolean(KEYS.SMS_AUTO_ENABLED) ?? false;
}

export function setSmsAutoEnabled(enabled: boolean): void {
  storage.set(KEYS.SMS_AUTO_ENABLED, enabled);
}

// ─── Permission Asked Flag ───

export function hasAskedSmsPermission(): boolean {
  return storage.getBoolean(KEYS.SMS_PERMISSION_ASKED) ?? false;
}

function markSmsPermissionAsked(): void {
  storage.set(KEYS.SMS_PERMISSION_ASKED, true);
}

// ─── Last Check Timestamp (for polling) ───

export function getLastSmsCheckTimestamp(): number {
  return storage.getNumber(KEYS.LAST_SMS_CHECK) ?? 0;
}

export function setLastSmsCheckTimestamp(timestamp: number): void {
  storage.set(KEYS.LAST_SMS_CHECK, timestamp);
}

// ─── Last Auto-Scan Run (for display in settings) ───

export function getLastAutoScanRun(): number {
  return storage.getNumber(KEYS.LAST_AUTO_SCAN_RUN) ?? 0;
}

export function setLastAutoScanRun(timestamp: number): void {
  storage.set(KEYS.LAST_AUTO_SCAN_RUN, timestamp);
}

// ─── SMS Start Date (user-configurable) ───

/**
 * Get the date from which to start reading SMS.
 * Returns an ISO date string (YYYY-MM-DD).
 * Defaults to 7 days ago if not set.
 */
export function getSmsStartDate(): string {
  return storage.getString(KEYS.SMS_START_DATE) ?? defaultStartDate();
}

/**
 * Set the date from which to start reading SMS.
 * @param date ISO date string (YYYY-MM-DD)
 */
export function setSmsStartDate(date: string): void {
  storage.set(KEYS.SMS_START_DATE, date);
}

// ─── SMS End Date (user-configurable) ───

/**
 * Get the end date for reading SMS.
 * Returns an ISO date string (YYYY-MM-DD).
 * Defaults to today if not set.
 */
export function getSmsEndDate(): string {
  return storage.getString(KEYS.SMS_END_DATE) ?? todayISO();
}

/**
 * Set the end date for reading SMS.
 * @param date ISO date string (YYYY-MM-DD)
 */
export function setSmsEndDate(date: string): void {
  storage.set(KEYS.SMS_END_DATE, date);
}

/**
 * Convert the stored end date to a timestamp in milliseconds.
 * Adds 1 day to include the full end date.
 */
export function getSmsEndTimestamp(): number {
  const dateStr = getSmsEndDate();
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1); // include entire end date
  const ts = d.getTime();
  return isNaN(ts) ? Date.now() : ts;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Default start date: 7 days ago */
function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Convert the stored start date to a timestamp in milliseconds.
 * Used by sms-reader to filter SMS from the inbox.
 */
export function getSmsStartTimestamp(): number {
  const dateStr = getSmsStartDate();
  const ts = new Date(dateStr).getTime();
  return isNaN(ts) ? Date.now() : ts;
}

// ─── Permission Check ───

/**
 * Check if READ_SMS permission is currently granted.
 * Returns false on iOS (SMS reading not supported).
 */
export async function hasSmsPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return false;

  const granted = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.READ_SMS,
  );
  return granted;
}

// ─── Permission Request ───

/**
 * Request READ_SMS permission.
 * Returns true if permission was granted, false otherwise.
 * Note: The explanation dialog should be shown in the UI layer before calling this.
 */
export async function requestSmsPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return false;

  // Already granted?
  const alreadyGranted = await hasSmsPermission();
  if (alreadyGranted) return true;

  markSmsPermissionAsked();

  // Request the actual OS permission
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.READ_SMS,
    {
      title: "SMS Permission",
      message:
        "Artha reads your bank transaction SMS to automatically detect expenses. " +
        "SMS data is processed locally on your device and never sent anywhere.",
      buttonPositive: "Allow",
      buttonNegative: "Deny",
    },
  );

  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Full enable flow: request permission + enable detection if granted.
 * Does NOT enable auto mode — that's a separate opt-in.
 * Returns true if successfully enabled.
 */
export async function enableSmsDetection(): Promise<boolean> {
  const granted = await requestSmsPermission();
  if (granted) {
    setSmsDetectionEnabled(true);
    return true;
  }
  return false;
}

/**
 * Disable SMS detection entirely. Also turns off auto mode.
 * Does not revoke the OS permission.
 */
export function disableSmsDetection(): void {
  setSmsDetectionEnabled(false);
  setSmsAutoEnabled(false);
}

// ─── SMS Account Filter (for manual historic scans) ───

/**
 * Get the list of account IDs to filter SMS scans by.
 * Returns empty array if no filter is set (scan all accounts).
 */
export function getSmsScanAccountIds(): string[] {
  const value = storage.getString(KEYS.SMS_SCAN_ACCOUNT_IDS);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Set the list of account IDs to filter SMS scans by.
 * Pass empty array to clear the filter (scan all accounts).
 */
export function setSmsScanAccountIds(accountIds: string[]): void {
  if (accountIds.length === 0) {
    storage.delete(KEYS.SMS_SCAN_ACCOUNT_IDS);
  } else {
    storage.set(KEYS.SMS_SCAN_ACCOUNT_IDS, JSON.stringify(accountIds));
  }
}
