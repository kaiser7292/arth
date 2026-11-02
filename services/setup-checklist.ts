import { Platform } from "react-native";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getDatabase } from "@/database";
import { getBudgetsForMonth, getCurrentMonth } from "@/services/budget";
import { getActiveAccounts } from "@/services/financial-account";
import { getLifeMilestones } from "@/services/life-milestone";
import { getMessageStats } from "@/services/message-inbox";
import { getSalaryProfileByFY } from "@/services/salary-profile";
import { getFYStartMonth } from "@/services/settings";
import { hasSmsPermission } from "@/services/sms/sms-permissions";
import { settingsStorage } from "@/services/storage";
import { getAllActiveBuckets } from "@/services/yearly-plan";
import { getCurrentFY } from "@/utils/fiscal-year";

/** Registered in SETTINGS_REGISTRY (services/backup-settings.ts). */
const CLOSED_KEY = "setup_checklist_closed";

export interface SetupStep {
  id: string;
  label: string;
  done: boolean;
  route: string;
}

/**
 * "Finish setting up" on Home. Each step reads what's actually there rather than remembering a tap,
 * so doing it anywhere in the app ticks it, and a step that can't be read just stays open.
 */
export async function getSetupSteps(): Promise<SetupStep[]> {
  const check = (work: () => Promise<boolean> | boolean) => Promise.resolve().then(work).catch(() => false);
  const user = DEFAULT_USER_ID;

  const [messages, accounts, income, reviewed, budget, goal] = await Promise.all([
    check(() => (Platform.OS === "ios" ? getMessageStats().lastMessageAt != null : hasSmsPermission())),
    check(async () => (await getActiveAccounts(user)).length > 0),
    check(async () => {
      const profile = await getSalaryProfileByFY(user, String(getCurrentFY(getFYStartMonth())));
      return (profile?.computed_monthly_in_hand ?? 0) > 0;
    }),
    check(async () => {
      const row = await getDatabase().getFirstAsync<{ id: string }>(
        `SELECT id FROM expenses WHERE user_id = ? AND status = 'approved' AND deleted_at IS NULL LIMIT 1;`,
        user,
      );
      return row != null;
    }),
    check(async () => (await getBudgetsForMonth(user, getCurrentMonth())).length > 0),
    check(async () => (await getAllActiveBuckets(user)).length > 0 || (await getLifeMilestones(user)).length > 0),
  ]);

  return [
    { id: "messages", label: "Connect bank messages", done: messages, route: "/settings/transaction-messages" },
    { id: "accounts", label: "Add your accounts", done: accounts, route: "/settings/account-add" },
    { id: "income", label: "Add your income", done: income, route: "/goals/salary-calculator" },
    { id: "review", label: "Review your first transactions", done: reviewed, route: "/expense/review-queue" },
    { id: "budget", label: "Set a budget", done: budget, route: "/settings/budget-config" },
    { id: "goal", label: "Create a goal", done: goal, route: "/goals/investment-buckets" },
  ];
}

/** Closed for good: dismissed, or everything was done once. Undoing a step later won't bring it back. */
export function isSetupChecklistClosed(): boolean {
  return settingsStorage.getBoolean(CLOSED_KEY) === true;
}

export function closeSetupChecklist(): void {
  settingsStorage.set(CLOSED_KEY, true);
}
