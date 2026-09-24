/**
 * Transaction alerts: "₹1,240 at Swiggy" with Approve / Reject buttons, straight from the
 * notification shade.
 *
 * Arth reads SMS only when it runs, so a background-fetch task runs the normal SMS scan roughly
 * every 30 minutes (Android decides the exact time and may stretch it on low battery). Anything
 * the scan adds to the review queue becomes a notification:
 *   - up to MAX_INDIVIDUAL items → one notification each, with Approve / Reject buttons
 *   - more than that → a single "N new transactions" notification that opens Catch Up
 *
 * Tapping a button runs without opening the app: on Android, expo-notifications hands the
 * response to the TaskManager task registered below when the app isn't in the foreground, and
 * to the response listener in app/_layout.tsx when it is. Both go through handleAlertAction.
 *
 * With the app lock on, alerts carry no amount or merchant and no buttons — they'd otherwise
 * show money on the lock screen and let anyone holding the phone approve items.
 */

import * as BackgroundFetch from "expo-background-fetch";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { DEFAULT_USER_ID } from "@/constants/app";
import { initDatabase } from "@/database";
import { isLockEnabled } from "@/services/biometric-lock";
import { approveExpense, rejectExpense } from "@/services/expense";
import { refreshHomeWidget } from "@/services/home-widget";
import { syncCalendarIfDue } from "@/services/calendar-sync";
import { runSmsScan } from "@/services/sms/sms-orchestrator";
import { hasNotificationPermission, isNotificationEnabled } from "@/services/notifications";
import { logger } from "@/utils/logger";
import { formatAmount } from "@/utils/format";

export const SCAN_TASK = "ARTHA_SMS_BACKGROUND_SCAN";
export const ACTION_TASK = "ARTHA_TRANSACTION_ALERT_ACTION";
export const ALERT_CATEGORY = "transaction_review";
export const MAX_INDIVIDUAL = 3;
const SUMMARY_ID = "transaction_review_summary";

export function alertId(expenseId: string): string {
  return `txn-review-${expenseId}`;
}

export interface AlertItem {
  id: string;
  amount: number;
  merchant_name: string | null;
  nature: string;
  matched_forecast_id: string | null;
}

// ─── Building the notifications (pure, tested) ───

export interface AlertRequest {
  identifier: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  withActions: boolean;
}

export function buildAlertRequests(items: AlertItem[], locked: boolean): AlertRequest[] {
  if (items.length === 0) return [];
  const catchUp = { screen: "expense/catch-up" };
  if (items.length > MAX_INDIVIDUAL || locked) {
    const n = items.length;
    return [
      {
        identifier: SUMMARY_ID,
        title: n === 1 ? "New transaction to review" : `${n} new transactions to review`,
        body: locked ? "Open Arth to review." : "Tap to catch up, one card at a time.",
        data: catchUp,
        withActions: false,
      },
    ];
  }
  return items.map((e) => {
    const isCredit = e.nature === "credit";
    const merchant = e.merchant_name || (isCredit ? "a credit" : "a transaction");
    // Card-repayment credits need a "paid from" account, which a notification button can't ask.
    const needsInput = isCredit && e.matched_forecast_id != null;
    return {
      identifier: alertId(e.id),
      title: isCredit ? `+${formatAmount(e.amount)} received` : `${formatAmount(e.amount)} at ${merchant}`,
      body: needsInput ? "Tap to choose the account you paid from." : isCredit ? `From ${merchant}. Approve it?` : "Approve it?",
      data: { ...catchUp, expenseId: e.id },
      withActions: !needsInput,
    };
  });
}

// ─── Setup ───

/** Registers the Approve / Reject button set. Safe to call on every start. */
export async function setupTransactionAlertCategory(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(ALERT_CATEGORY, [
    { identifier: "approve", buttonTitle: "Approve", options: { opensAppToForeground: false } },
    { identifier: "reject", buttonTitle: "Reject", options: { opensAppToForeground: false, isDestructive: true } },
  ]);
}

export async function postTransactionAlerts(items: AlertItem[]): Promise<void> {
  if (!isNotificationEnabled("new_transaction")) return;
  if (!(await hasNotificationPermission())) return;
  for (const req of buildAlertRequests(items, isLockEnabled())) {
    await Notifications.scheduleNotificationAsync({
      identifier: req.identifier,
      content: {
        title: req.title,
        body: req.body,
        data: req.data,
        sound: true,
        ...(req.withActions ? { categoryIdentifier: ALERT_CATEGORY } : {}),
        ...(Platform.OS === "android" ? { channelId: "artha-default" } : {}),
      },
      trigger: null,
    });
  }
}

/** Clear an item's alert once it's been handled anywhere (app, Catch Up, or the button). */
export async function dismissTransactionAlert(expenseId: string): Promise<void> {
  await Notifications.dismissNotificationAsync(alertId(expenseId)).catch(() => {});
}

// ─── Handling a button ───

/**
 * Approve or reject from a notification button. Returns true when it acted.
 * Re-checks the row first: it may have been reviewed in the app since the alert went up.
 */
export async function handleAlertAction(actionIdentifier: string, data: unknown): Promise<boolean> {
  if (actionIdentifier !== "approve" && actionIdentifier !== "reject") return false;
  const expenseId = (data as { expenseId?: unknown } | null)?.expenseId;
  if (typeof expenseId !== "string") return false;
  if (isLockEnabled()) return false;

  try {
    const db = await initDatabase();
    const row = await db.getFirstAsync<{ status: string; deleted_at: string | null }>(
      `SELECT status, deleted_at FROM expenses WHERE id = ?;`,
      expenseId,
    );
    if (row && row.status === "pending_review" && !row.deleted_at) {
      if (actionIdentifier === "approve") await approveExpense(expenseId);
      else await rejectExpense(expenseId);
    }
    void refreshHomeWidget();
    return true;
  } catch (e) {
    logger.error("Transaction alert action failed", e);
    return false;
  } finally {
    await dismissTransactionAlert(expenseId);
  }
}

// ─── Background scan ───

async function pendingIds(): Promise<Set<string>> {
  const db = await initDatabase();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM expenses
      WHERE user_id = ? AND status = 'pending_review' AND nature IN ('realized', 'credit') AND deleted_at IS NULL;`,
    DEFAULT_USER_ID,
  );
  return new Set(rows.map((r) => r.id));
}

/** One background pass: scan, then alert on whatever the scan added. */
export async function runBackgroundScanAndAlert(): Promise<number> {
  const before = await pendingIds();
  const outcome = await runSmsScan({ manual: false });
  if (!outcome.ran || outcome.created + outcome.credits === 0) return 0;

  const db = await initDatabase();
  const fresh = [...(await pendingIds())].filter((id) => !before.has(id));
  if (fresh.length === 0) return 0;
  const ph = fresh.map(() => "?").join(",");
  const items = await db.getAllAsync<AlertItem>(
    `SELECT id, amount, merchant_name, nature, matched_forecast_id FROM expenses WHERE id IN (${ph}) ORDER BY date ASC;`,
    ...fresh,
  );
  await postTransactionAlerts(items);
  await refreshHomeWidget();
  return items.length;
}

TaskManager.defineTask(SCAN_TASK, async () => {
  try {
    const n = await runBackgroundScanAndAlert();
    // Piggyback: a background wake-up is a free chance to keep the calendar current.
    await syncCalendarIfDue(DEFAULT_USER_ID).catch(() => {});
    return n > 0 ? BackgroundFetch.BackgroundFetchResult.NewData : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (e) {
    logger.warn("Background SMS scan failed", e);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

TaskManager.defineTask(ACTION_TASK, async ({ data, error }) => {
  if (error) return;
  const response = data as Notifications.NotificationResponse | undefined;
  if (!response?.actionIdentifier) return;
  await handleAlertAction(response.actionIdentifier, response.notification?.request?.content?.data);
});

/** Start or stop the background scan to match the "New transactions" preference. */
export async function syncTransactionAlertTasks(): Promise<void> {
  if (Platform.OS !== "android") return;
  const enabled = isNotificationEnabled("new_transaction");
  const scanRegistered = await TaskManager.isTaskRegisteredAsync(SCAN_TASK);
  if (enabled && !scanRegistered) {
    await BackgroundFetch.registerTaskAsync(SCAN_TASK, {
      // The scan itself enforces a 30-minute cooldown; asking more often wouldn't help.
      minimumInterval: 30 * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  } else if (!enabled && scanRegistered) {
    await BackgroundFetch.unregisterTaskAsync(SCAN_TASK);
  }
  // The action task is cheap and must exist for any alert already on screen.
  await Notifications.registerTaskAsync(ACTION_TASK).catch(() => {});
}

/**
 * Take down alerts for items already reviewed in the app. Run when Arth comes to the
 * foreground, so the shade doesn't keep offering Approve on something already approved.
 */
export async function reconcilePresentedAlerts(): Promise<void> {
  const presented = await Notifications.getPresentedNotificationsAsync();
  const ours = presented.filter(
    (n) => n.request.identifier.startsWith("txn-review-") || n.request.identifier === SUMMARY_ID,
  );
  if (ours.length === 0) return;
  const pending = await pendingIds();
  for (const n of ours) {
    const id = n.request.identifier;
    const stillPending =
      id === SUMMARY_ID ? pending.size > 0 : pending.has(id.slice("txn-review-".length));
    if (!stillPending) await Notifications.dismissNotificationAsync(id).catch(() => {});
  }
}
