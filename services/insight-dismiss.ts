/**
 * "Worth a look" answers (docs/INSIGHTS_STREAMLINE_PROPOSAL.md §2.2): "Not now" hides one card
 * for the rest of this month; "Don't show these" switches its kind off until switched back on.
 * Kept in settings, backed up with them.
 */

import type { Insight, InsightType } from "@/services/insight-engine";
import { settingsStorage } from "@/services/storage";
import { bumpDataVersion } from "@/services/settings";

const SNOOZED_KEY = "insights_snoozed";
const KINDS_OFF_KEY = "insights_kinds_off";

const thisMonth = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = settingsStorage.getString(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Card id → the month it was hidden in. */
function snoozed(): Record<string, string> {
  const v = readJson<Record<string, string>>(SNOOZED_KEY, {});
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

export function kindsOff(): InsightType[] {
  const v = readJson<unknown>(KINDS_OFF_KEY, []);
  return Array.isArray(v) ? (v.filter((x) => typeof x === "string") as InsightType[]) : [];
}

/** Hide this card for the rest of the month. Older months' answers are dropped as it goes. */
export function snoozeInsight(id: string, now: Date = new Date()): void {
  const month = thisMonth(now);
  const kept = Object.fromEntries(Object.entries(snoozed()).filter(([, m]) => m === month));
  settingsStorage.set(SNOOZED_KEY, JSON.stringify({ ...kept, [id]: month }));
  bumpDataVersion();
}

export function setKindOff(type: InsightType, off: boolean): void {
  const now = new Set(kindsOff());
  if (off) now.add(type);
  else now.delete(type);
  settingsStorage.set(KINDS_OFF_KEY, JSON.stringify([...now]));
  bumpDataVersion();
}

/** The insights still to show: not hidden this month, and not of a kind switched off. Pure apart from reading settings. */
export function visibleInsights(list: Insight[], now: Date = new Date()): Insight[] {
  const month = thisMonth(now);
  const hidden = snoozed();
  const off = new Set(kindsOff());
  return list.filter((i) => hidden[i.id] !== month && !off.has(i.type));
}

/** Show every kind again (the "Show again" line under Worth a look). */
export function showAllKinds(): void {
  settingsStorage.set(KINDS_OFF_KEY, JSON.stringify([]));
  bumpDataVersion();
}
