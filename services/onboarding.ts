/**
 * v15 onboarding migration + gating.
 *
 * The onboarding wizard should ONLY show on fresh installs. Existing users
 * who upgrade from <=14.7 to 15.x must not see it (their setup is already
 * done). We detect "existing user" by looking for any user-authored row
 * the app has produced historically:
 *   - any expense
 *   - any financial account (even auto-discovered from SMS)
 *   - any category they added beyond the seeded defaults
 *
 * If any exists, we stamp onboarding as "pre-existing" so getOnboarding
 * CompletedVersion() is non-null and the root layout skips the wizard
 * redirect.
 *
 * This runs exactly once per device (idempotent via the same MMKV stamp).
 */

import { getDatabase } from "@/database";
import {
  getOnboardingCompletedVersion,
  setOnboardingCompletedVersion,
} from "@/services/settings";

/**
 * Returns the current app version string from expo-constants, or "15.x" as a
 * safe fallback if the Expo config isn't available (e.g. in tests).
 */
export function getCurrentAppVersion(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const config = require("expo-constants").default.expoConfig;
  return config?.version ?? "15.x";
}

export async function migrateExistingUser(): Promise<void> {
  if (getOnboardingCompletedVersion()) {
    return;
  }

  const db = getDatabase();

  const hasExpenses = await db.getFirstAsync<{ n: number }>(
    "SELECT 1 AS n FROM expenses LIMIT 1;",
  );
  if (hasExpenses) {
    setOnboardingCompletedVersion("pre-existing");
    return;
  }

  const hasAccount = await db.getFirstAsync<{ n: number }>(
    "SELECT 1 AS n FROM financial_accounts LIMIT 1;",
  );
  if (hasAccount) {
    setOnboardingCompletedVersion("pre-existing");
    return;
  }

  // No user data found — this looks like a genuine fresh install. Leave the
  // stamp null so the wizard redirects.
}
