import { settingsStorage } from "@/services/storage";
import type { ApiBroker } from "./types";

/**
 * Each broker syncs by itself once a day after 5 pm, unless switched off on its own screen. A phone
 * can't promise an exact time, so this runs at the first chance after 5: the background task, or
 * opening Arth, whichever comes first.
 */

export const AUTO_SYNC_HOUR = 17;

const OFF_KEY = "broker_autosync_off__";
const DONE_KEY = "broker_autosync_done__";

export function isAutoSyncOn(broker: ApiBroker): boolean {
  return !settingsStorage.getBoolean(OFF_KEY + broker);
}

export function setAutoSyncOn(broker: ApiBroker, on: boolean): void {
  settingsStorage.set(OFF_KEY + broker, !on);
}

export function markAutoSynced(broker: ApiBroker, date: string): void {
  settingsStorage.set(DONE_KEY + broker, date);
}

/** Markets close at 3:30 pm. Crypto trades all week, so ZebPay isn't kept to weekdays. */
export function isAutoSyncDue(broker: ApiBroker, now: Date, today: string): boolean {
  if (!isAutoSyncOn(broker) || now.getHours() < AUTO_SYNC_HOUR) return false;
  const weekend = now.getDay() === 0 || now.getDay() === 6;
  if (weekend && broker !== "zebpay") return false;
  return settingsStorage.getString(DONE_KEY + broker) !== today;
}
