import { Linking, Platform } from "react-native";
import Constants from "expo-constants";
import { installerPackage, playUpdate, startPlayUpdate } from "../modules/arth-app-updates";
import { settingsStorage } from "@/services/storage";

/**
 * "A newer Arth is available", from wherever this copy came from:
 *
 *   Play Store install   Google Play's in-app update (the Play Store app on the phone answers; Arth
 *                        sends nothing). Update opens Play's own update screen.
 *   APK from GitHub      the latest release on github.com/kaiser7292/arth, at most once a day - the
 *                        same check the website's download button makes. Download opens the APK.
 *
 * Android only (the iPhone has no store listing yet). Off with Settings → Tell me about new versions.
 */

const ENABLED_KEY = "app_update_check_enabled";
const DISMISSED_KEY = "app_update_dismissed_version";
const LAST_CHECK_KEY = "app_update_last_check";
const LATEST_KEY = "app_update_latest";

const PLAY_INSTALLER = "com.android.vending";
const RELEASES_URL = "https://api.github.com/repos/kaiser7292/arth/releases/latest";
const DAY_MS = 24 * 60 * 60 * 1000;

export type UpdateSource = "play" | "github";

export interface AvailableUpdate {
  source: UpdateSource;
  version: string;
  /** GitHub: the APK (or the release page when there's no APK). */
  url?: string;
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

export function updateSource(): UpdateSource {
  return installerPackage() === PLAY_INSTALLER ? "play" : "github";
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

async function latestFromGithub(): Promise<AvailableUpdate | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(RELEASES_URL, { headers: { Accept: "application/vnd.github+json" }, signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: string; html_url?: string; assets?: { name: string; browser_download_url: string }[] };
    if (!body.tag_name) return null;
    const apk = body.assets?.find((a) => a.name.toLowerCase().endsWith(".apk"));
    return { source: "github", version: body.tag_name.replace(/^v/i, ""), url: apk?.browser_download_url ?? body.html_url };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A newer version to tell the user about, or null: none, already dismissed, turned off, offline or
 * not Android. `force` skips the once-a-day limit (Settings → Check now).
 */
export async function checkForUpdate(opts: { force?: boolean; now?: number } = {}): Promise<AvailableUpdate | null> {
  if (!isUpdateCheckEnabled()) return null;
  const now = opts.now ?? Date.now();
  const mine = currentVersion();
  let found: AvailableUpdate | null = null;
  try {
    if (updateSource() === "play") {
      const code = await playUpdate();
      if (code) found = { source: "play", version: versionFromCode(code) };
    } else {
      const last = Number(settingsStorage.getString(LAST_CHECK_KEY) ?? 0);
      if (opts.force || !last || now - last > DAY_MS) {
        found = await latestFromGithub();
        settingsStorage.set(LAST_CHECK_KEY, String(now));
        settingsStorage.set(LATEST_KEY, found ? JSON.stringify(found) : "");
      } else {
        const cached = settingsStorage.getString(LATEST_KEY);
        found = cached ? (JSON.parse(cached) as AvailableUpdate) : null;
      }
    }
  } catch {
    return null; // offline or the store couldn't say: try again next time
  }
  if (!found || compareVersions(found.version, mine) <= 0) return null;
  if (!opts.force && settingsStorage.getString(DISMISSED_KEY) === found.version) return null;
  return found;
}

/** Play: its update screen. GitHub: the APK download. */
export async function installUpdate(u: AvailableUpdate): Promise<boolean> {
  if (u.source === "play") return startPlayUpdate();
  if (!u.url) return false;
  await Linking.openURL(u.url);
  return true;
}
