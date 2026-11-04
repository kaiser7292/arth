import { useCallback, useState } from "react";
import { logger } from "@/utils/logger";

/**
 * Wraps a screen's load so a failure can be shown. useDataRefresh doesn't catch anything, so a query
 * that throws otherwise leaves the screen looking empty, or stuck on its loading state.
 */
export function useGuardedLoad(load: () => Promise<unknown> | unknown) {
  const [failed, setFailed] = useState(false);
  const guarded = useCallback(async () => {
    try {
      await load();
      setFailed(false);
    } catch (e) {
      logger.warn("Screen load failed:", e);
      setFailed(true);
    }
  }, [load]);
  return { failed, load: guarded };
}
