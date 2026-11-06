import Constants from "expo-constants";
import { Platform } from "react-native";
import { installerPackage, playUpdate, startPlayUpdate } from "../modules/arth-app-updates";
import { settingsStorage } from "@/services/storage";

/**
 * "A newer Arth is available", through Google Play's in-app update: the Play Store app on the phone
 * answers and Arth sends nothing. Update opens Play's own update screen.
 *
 * Arth is distributed only through Google Play, so a copy installed any other way doesn't check.
 * Android only. Off with Settings → Tell me about new versions.
 */

const ENABLED_KEY = "app_update_check_enabled";
const DISMISSED_KEY = "app_update_dismissed_version";

const PLAY_INSTALLER = "com.android.vending";

export interface AvailableUpdate {
  source: "play";
  version: string;
}

/** This build's version, "4.28.1". */
export function currentVersion(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}

/** major*10000 + minor*100 + patch, the scheme Arth's versionCode follows. */
export function versionFromCode(code: number): string {
  return `${Math.floor(code / 10000)}.${Math.floor((code % 10000) / 100)}.${code % 100}`;
}

/** Negative, zero or positive, like a comparator. Ignores a leading "v" and anything after "-". */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Installed from Google Play, so Play can say when there's a newer version. */
export function isPlayInstall(): boolean {
  return Platform.OS === "android" && installerPackage() === PLAY_INSTALLER;
}

export function isUpdateCheckEnabled(): boolean {
  return Platform.OS === "android" && settingsStorage.getBoolean(ENABLED_KEY) !== false;
}

export function setUpdateCheckEnabled(on: boolean): void {
  settingsStorage.set(ENABLED_KEY, on);
}

/** Hide the banner for this version; a later one shows it again. */
export function dismissUpdate(version: string): void {
  settingsStorage.set(DISMISSED_KEY, version);
}

/**
 * A newer version to tell the user about, or null: none, already dismissed, turned off, offline,
 * not installed from Google Play, or not Android. `force` also shows a dismissed one (Check now).
 */
export async function checkForUpdate(opts: { force?: boolean } = {}): Promise<AvailableUpdate | null> {
  if (!isUpdateCheckEnabled() || !isPlayInstall()) return null;
  let found: AvailableUpdate | null = null;
  try {
    const code = await playUpdate();
    if (code) found = { source: "play", version: versionFromCode(code) };
  } catch {
    return null; // offline or the store couldn't say: try again next time
  }
  if (!found || compareVersions(found.version, currentVersion()) <= 0) return null;
  if (!opts.force && settingsStorage.getString(DISMISSED_KEY) === found.version) return null;
  return found;
}

/** Opens Play's update screen. */
export async function installUpdate(_u: AvailableUpdate): Promise<boolean> {
  return startPlayUpdate();
}
