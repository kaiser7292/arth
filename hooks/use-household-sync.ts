import { useEffect } from "react";
import { AppState } from "react-native";
import { getFlag } from "@/services/feature-flags";
import { subscribeDataVersion } from "@/services/settings";
import { syncHouseholdBackgroundTask } from "@/services/household/background";
import { requestSync, requestSyncAfterChange } from "@/services/household/sync";

/**
 * Keeps the household in sync while Arth is in use: a few seconds after opening or coming back,
 * and a few seconds after any change (which may change what this phone shares). Mounted once, in
 * the root layout, after the database is ready. Does nothing for a phone that isn't in a household
 * (each sync checks first).
 */
export function useHouseholdSync(ready: boolean): void {
  useEffect(() => {
    if (!ready || !getFlag("household")) return;
    requestSync(3000);
    void syncHouseholdBackgroundTask();
    const app = AppState.addEventListener("change", (s) => {
      if (s === "active") requestSync(1500);
    });
    const data = subscribeDataVersion(requestSyncAfterChange);
    return () => {
      app.remove();
      data.remove();
    };
  }, [ready]);
}
