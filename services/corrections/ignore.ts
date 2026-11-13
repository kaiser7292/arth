import { settingsStorage } from "@/services/storage";
import type { HealthCheckId } from "./health";

/**
 * Data health findings the user chose to ignore ("this one is fine"). Each check keeps its own
 * list of item keys; an ignored item stops counting in that check, in the tidy score, and in the
 * Fix my data export. A group whose make-up changes (a new copy of a duplicate, a new spelling)
 * gets a new key and shows again, the way kept duplicates do. Backed up: it's the user's decision.
 *
 * Keys: a transaction's id; an account's id (a balance gap also carries the bank's date, so a newer
 * bank figure is checked again); a merchant's name; a group's sorted members joined with "|".
 */

const KEY = "fix_my_data_ignored";

type Ignored = Partial<Record<HealthCheckId, string[]>>;

function read(): Ignored {
  try {
    const v = JSON.parse(settingsStorage.getString(KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Ignored) : {};
  } catch {
    return {};
  }
}

function write(all: Ignored): void {
  const kept = Object.fromEntries(Object.entries(all).filter(([, keys]) => keys && keys.length > 0));
  if (Object.keys(kept).length === 0) settingsStorage.delete(KEY);
  else settingsStorage.set(KEY, JSON.stringify(kept));
}

export function getIgnored(check: HealthCheckId): Set<string> {
  return new Set(read()[check] ?? []);
}

export function ignoreItems(check: HealthCheckId, keys: string[]): void {
  const all = read();
  all[check] = [...new Set([...(all[check] ?? []), ...keys])];
  write(all);
}

export function unignoreItems(check: HealthCheckId, keys?: string[]): void {
  const all = read();
  all[check] = keys ? (all[check] ?? []).filter((k) => !keys.includes(k)) : [];
  write(all);
}

/** The key for a group of names or ids: the same members in any order give the same key. */
export function groupKey(members: string[]): string {
  return [...members].map((m) => m.trim().toLowerCase()).sort().join("|");
}
