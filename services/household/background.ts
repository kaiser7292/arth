import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";
import { initDatabase } from "@/database";
import { logger } from "@/utils/logger";
import { getActiveHousehold } from "./store";
import { syncHousehold } from "./sync";

/**
 * Household sync while Arth is closed: about hourly on Android; on iPhone whenever iOS decides to run
 * background refresh (often less). Registered only while this phone is in a household.
 */

const HOUSEHOLD_TASK = "household-sync";

TaskManager.defineTask(HOUSEHOLD_TASK, async () => {
  try {
    await initDatabase();
    const r = await syncHousehold();
    if (r.error) return BackgroundFetch.BackgroundFetchResult.Failed;
    return r.changed ? BackgroundFetch.BackgroundFetchResult.NewData : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (e) {
    logger.warn("[household] background sync failed", e);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function syncHouseholdBackgroundTask(): Promise<void> {
  try {
    const active = !!(await getActiveHousehold());
    const registered = await TaskManager.isTaskRegisteredAsync(HOUSEHOLD_TASK);
    if (!active) {
      if (registered) await BackgroundFetch.unregisterTaskAsync(HOUSEHOLD_TASK);
      return;
    }
    if (!registered) {
      await BackgroundFetch.registerTaskAsync(HOUSEHOLD_TASK, {
        minimumInterval: 60 * 60,
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
  } catch (e) {
    logger.warn("[household] background task registration failed", e);
  }
}
