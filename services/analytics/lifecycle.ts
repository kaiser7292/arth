import { DEFAULT_USER_ID } from "@/constants/app";
import { settingsStorage } from "@/services/storage";
import { logger } from "@/utils/logger";
import { rebuildPatterns } from "./pattern-learner";

/**
 * Keeps the learned bill patterns (expense_classifications) current. They feed the month-end
 * projection's fixed bills and the "Is this a monthly bill?" check-in.
 *
 * Runs in the background after startup, at most once a day — the rebuild is idempotent, so
 * skipping a day only means slightly older patterns. (The previous startup hook was removed at
 * some point, which left patterns frozen; this restores it without blocking launch.)
 */
const LAST_REBUILD_KEY = "patterns_rebuilt_on";

export async function refreshPatternsIfDue(now: Date = new Date()): Promise<void> {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (settingsStorage.getString(LAST_REBUILD_KEY) === today) return;
  try {
    const n = await rebuildPatterns(DEFAULT_USER_ID, now);
    settingsStorage.set(LAST_REBUILD_KEY, today);
    logger.info(`Patterns rebuilt: ${n} active`);
  } catch (e) {
    logger.warn("Pattern rebuild failed (non-fatal):", e);
  }
}

/** After you confirm or correct a pattern, rebuild so the answer applies right away. */
export async function refreshPatternsNow(): Promise<void> {
  settingsStorage.delete(LAST_REBUILD_KEY);
  await refreshPatternsIfDue();
}
