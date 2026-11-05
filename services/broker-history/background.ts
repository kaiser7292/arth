import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";

import { initDatabase } from "@/database";
import { logger } from "@/utils/logger";
import { syncBroker } from "@/services/broker-sync";
import { todayIso } from "@/utils/local-date";
import { isAutoSyncDue, markAutoSynced } from "./auto-sync";
import { captureBroker, connectedApiBrokers } from "./capture";
import { syncBrokerReminders } from "./reminders";
import type { ApiBroker } from "./types";

/**
 * Saving the day's trades while Arth is closed. Android runs this when it chooses, so it's a help
 * and not a promise: the reminder and a report import are what make a missed day recoverable.
 */

const TASK = "broker-day-capture";

/** Trades are worth saving at any run from when the market's closed. Crypto trades all week. */
export function brokersDueNow(now: Date, connected: ApiBroker[]): ApiBroker[] {
  if (now.getHours() < 16) return [];
  const weekday = now.getDay() !== 0 && now.getDay() !== 6;
  return connected.filter((b) => b === "zebpay" || weekday);
}

/**
 * The day's automatic sync, for each broker due and not switched off. Done once a day; a broker that
 * needs a login or fails stays due, so a later run or opening Arth tries again. A sync saves the
 * day's trades as well.
 */
export async function runAutoSyncDue(now: Date = new Date(), today: string = todayIso()): Promise<boolean> {
  let changed = false;
  for (const broker of await connectedApiBrokers()) {
    if (!isAutoSyncDue(broker, now, today)) continue;
    const r = await syncBroker(broker);
    if (r.status === "saved") {
      markAutoSynced(broker, today);
      changed = true;
    }
  }
  return changed;
}

export async function runBrokerCaptureDue(now: Date = new Date()): Promise<boolean> {
  let changed = await runAutoSyncDue(now);
  for (const broker of brokersDueNow(now, await connectedApiBrokers())) {
    const r = await captureBroker(broker);
    if (r.status === "saved" && r.newTrades > 0) changed = true;
  }
  await syncBrokerReminders(now);
  return changed;
}

TaskManager.defineTask(TASK, async () => {
  try {
    await initDatabase();
    const changed = await runBrokerCaptureDue();
    return changed ? BackgroundFetch.BackgroundFetchResult.NewData : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (e) {
    logger.warn("[broker-history] background capture failed", e);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/** Registered only while a broker is connected. */
export async function syncBrokerCaptureTask(): Promise<void> {
  try {
    const connected = (await connectedApiBrokers()).length > 0;
    const registered = await TaskManager.isTaskRegisteredAsync(TASK);
    if (!connected) {
      if (registered) await BackgroundFetch.unregisterTaskAsync(TASK);
      return;
    }
    if (!registered) {
      await BackgroundFetch.registerTaskAsync(TASK, { minimumInterval: 2 * 60 * 60, stopOnTerminate: false, startOnBoot: true });
    }
  } catch (e) {
    logger.warn("[broker-history] background task registration failed", e);
  }
}
