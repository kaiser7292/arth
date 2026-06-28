/**
 * Notification Scheduler — v17.5.25
 *
 * Two-layer notification architecture:
 *
 * Layer 1 (RELIABLE): Pre-scheduled system alarms via expo-notifications triggers.
 *   - Daily check at 8:30 AM (DailyTriggerInput) — fires regardless of battery optimization
 *   - Monthly summary on the 1st at 9:00 AM (MonthlyTriggerInput)
 *   - Per-EMI notifications scheduled at specific dates (DateTriggerInput)
 *   These use the OS alarm system and fire even if the app hasn't been opened.
 *
 * Layer 2 (SUPPLEMENTARY): App-open check with 6-hour cooldown.
 *   Catches anything that changed since the last scheduled fire.
 *   Also re-schedules Layer 1 notifications when data changes.
 *
 * Background-fetch is kept as a legacy fallback but is NOT the primary mechanism.
 *
 * Non-Play Store App Considerations:
 * - Android is more aggressive with battery optimization for sideloaded apps
 * - Users may need to manually disable battery optimization for reliable notifications
 * - The app has SCHEDULE_EXACT_ALARM and USE_EXACT_ALARM permissions
 */

import { DEFAULT_USER_ID } from "@/constants/app";
import type { Expense } from "@/services/expense";
import { getForecastExpenses, getOverdueForecasts, getRecurringReminders as getReminders } from "@/services/expense";
import {
    hasNotificationPermission,
    isNotificationEnabled,
    sendLocalNotification,
} from "@/services/notifications";
import { settingsStorage as storage } from "@/services/storage";
import { formatAmount } from "@/utils/format";
import { logger } from "@/utils/logger";
import * as BackgroundFetch from "expo-background-fetch";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

const LAST_NOTIF_CHECK_KEY = "notif_last_check_ts";
const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours (reduced from 12)
const LAST_SCHEDULE_SYNC_KEY = "notif_last_schedule_sync_ts";
const LAST_MONTHLY_SUMMARY_SENT_KEY = "notif_monthly_summary_last_sent_month";
const EMI_LAST_NOTIFIED_PREFIX = "notif_emi_last_notified_";

const NOTIF_CHECK_TASK = "ARTHA_NOTIF_CHECK";

// Identifiers for scheduled system notifications
const DAILY_CHECK_ID = "artha_daily_830am";
const MONTHLY_SUMMARY_NOTIF_ID = "artha_monthly_summary";
const EMI_NOTIF_PREFIX = "artha_emi_";
const REMINDER_NOTIF_PREFIX = "artha_reminder_";

// ─── Background Task Definition (Layer 2 fallback) ───

TaskManager.defineTask(NOTIF_CHECK_TASK, async () => {
  try {
    if (!(await hasNotificationPermission())) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    storage.set(LAST_NOTIF_CHECK_KEY, Date.now());

    const overdue = await checkAndNotifyOverdue(DEFAULT_USER_ID);
    const upcoming = await checkAndNotifyUpcoming(DEFAULT_USER_ID);

    return overdue + upcoming > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (e) {
    logger.warn("notification background task failed", e);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ─── Layer 1: System Alarm Scheduling ───

/**
 * Send a daily summary notification with actual data.
 * This replaces the generic "good morning" notification.
 */
export async function sendDailySummaryNotification(userId: string): Promise<void> {
  if (!(await hasNotificationPermission())) return;

  try {
    const overdue = await getOverdueForecasts(userId, todayString());
    const forecasts = await getForecastExpenses(userId, "approved");
    const reminders = await getReminders(userId);

    const today = todayString();
    const upcoming = forecasts.filter((e) => {
      if (!e.due_date) return false;
      const days = daysFromNow(e.due_date);
      return days >= 0 && days <= 2;
    });

    const dueReminders = reminders.filter(
      (r) => r.state === "due_soon" || r.state === "overdue",
    );

    // Get yesterday's actual spending
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const { getDatabase } = await import("@/database");
    const db = getDatabase();

    const yesterdaySpending = await db.getFirstAsync<{ total: number; count: number }>(
      `SELECT SUM(amount) as total, COUNT(*) as count
       FROM expenses
       WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
         AND date = ?;`,
      userId, yesterday,
    );

    const yesterdayTotal = yesterdaySpending?.total ?? 0;
    const yesterdayCount = yesterdaySpending?.count ?? 0;

    let title = "Your daily financial summary";
    let body = "";

    // Add yesterday's spending first
    if (yesterdayCount > 0) {
      body += `Yesterday: ${formatAmount(yesterdayTotal)} spent in ${yesterdayCount} transaction${yesterdayCount > 1 ? "s" : ""}. `;
    }

    // Add dues and reminders
    if (overdue.length === 0 && upcoming.length === 0 && dueReminders.length === 0) {
      body += "No dues or reminders today. You're all caught up!";
    } else {
      const parts: string[] = [];
      if (overdue.length > 0) {
        parts.push(`${overdue.length} overdue payment${overdue.length > 1 ? "s" : ""}`);
      }
      if (upcoming.length > 0) {
        parts.push(`${upcoming.length} upcoming payment${upcoming.length > 1 ? "s" : ""}`);
      }
      if (dueReminders.length > 0) {
        parts.push(`${dueReminders.length} reminder${dueReminders.length > 1 ? "s" : ""}`);
      }
      body += parts.join(", ") + ". Tap to view details.";
    }

    await sendLocalNotification(title, body, { screen: "/(tabs)" });
  } catch (e) {
    logger.warn("sendDailySummaryNotification failed", e);
  }
}

/**
 * Schedule the daily 8:30 AM notification that provides a morning summary.
 * Uses DailyTriggerInput — fires via system alarm regardless of app state.
 * The notification handler will call sendDailySummaryNotification to show actual data.
 */
async function scheduleDailyMorningCheck(): Promise<void> {
  if (!(await hasNotificationPermission())) return;

  const overdueEnabled = isNotificationEnabled("overdue_forecast");
  const upcomingEnabled = isNotificationEnabled("upcoming_due");
  if (!overdueEnabled && !upcomingEnabled) return;

  await Notifications.cancelScheduledNotificationAsync(DAILY_CHECK_ID).catch(() => {});

  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_CHECK_ID,
    content: {
      title: "Your daily financial summary",
      body: "Tap to see today's dues, reminders, and upcoming payments.",
      data: { screen: "/(tabs)", action: "daily_summary" },
      sound: true,
      ...(Platform.OS === "android" ? { channelId: "artha-default" } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 8,
      minute: 30,
    },
  });
}

/**
 * Schedule per-EMI notifications 1 day before each upcoming due date.
 * Clears old EMI notifications first, then schedules the next 30 days of EMIs.
 */
async function scheduleUpcomingEMINotifications(userId: string): Promise<void> {
  if (!isNotificationEnabled("upcoming_due")) return;
  if (!(await hasNotificationPermission())) return;

  try {
    const { getDatabase } = await import("@/database");
    const db = getDatabase();
    const today = todayString();
    const thirtyDaysOut = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

    // Cancel all existing EMI notifications
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of pending) {
      if (n.identifier.startsWith(EMI_NOTIF_PREFIX)) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }

    const emis = await db.getAllAsync<{
      id: string;
      due_date: string;
      emi_amount: number;
      bank_name: string;
    }>(
      `SELECT se.id, se.due_date, se.emi_amount, fa.bank_name
       FROM loan_schedule_entries se
       JOIN loan_accounts la ON la.id = se.loan_account_id
       JOIN financial_accounts fa ON fa.id = la.financial_account_id
       WHERE fa.user_id = ? AND la.status = 'active' AND se.status = 'scheduled'
         AND se.due_date >= ? AND se.due_date <= ?
       ORDER BY se.due_date ASC;`,
      userId, today, thirtyDaysOut,
    );

    for (const emi of emis) {
      const dueDate = new Date(emi.due_date + "T00:00:00");
      // Schedule 1 day before at 9 AM
      const notifDate = new Date(dueDate);
      notifDate.setDate(notifDate.getDate() - 1);
      notifDate.setHours(9, 0, 0, 0);

      if (notifDate.getTime() <= Date.now()) continue;

      await Notifications.scheduleNotificationAsync({
        identifier: `${EMI_NOTIF_PREFIX}${emi.id}`,
        content: {
          title: `EMI due tomorrow: ${emi.bank_name}`,
          body: `${formatAmount(emi.emi_amount)} due on ${emi.due_date}. Ensure your account has funds.`,
          data: { screen: "/goals/loans" },
          sound: true,
          ...(Platform.OS === "android" ? { channelId: "artha-default" } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: notifDate,
        },
      });
    }
  } catch (e) {
    logger.warn("scheduleUpcomingEMINotifications failed", e);
  }
}

/**
 * Schedule per-reminder notifications for the next 14 days of due reminders.
 * Fires on the due date at 8:00 AM.
 */
async function scheduleUpcomingReminderNotifications(userId: string): Promise<void> {
  if (!isNotificationEnabled("upcoming_due")) return;
  if (!(await hasNotificationPermission())) return;

  try {
    // Cancel all existing reminder notifications
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of pending) {
      if (n.identifier.startsWith(REMINDER_NOTIF_PREFIX)) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }

    const reminders = await getReminders(userId);
    const today = todayString();
    const fourteenDaysOut = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];

    for (const r of reminders) {
      const dueDate = r.rule.next_due_date;
      if (!dueDate || dueDate < today || dueDate > fourteenDaysOut) continue;

      const notifDate = new Date(dueDate + "T08:00:00");
      if (notifDate.getTime() <= Date.now()) continue;

      const description = r.source?.merchant_name ?? r.source?.description ?? "Recurring expense";

      await Notifications.scheduleNotificationAsync({
        identifier: `${REMINDER_NOTIF_PREFIX}${r.rule.id}`,
        content: {
          title: `Due today: ${description}`,
          body: `Your ${r.rule.frequency} reminder is due. Log or link an expense.`,
          data: { screen: "/(tabs)" },
          sound: true,
          ...(Platform.OS === "android" ? { channelId: "artha-default" } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: notifDate,
        },
      });
    }
  } catch (e) {
    logger.warn("scheduleUpcomingReminderNotifications failed", e);
  }
}

/**
 * Schedule monthly summary on the 1st at 9:00 AM.
 */
export async function scheduleMonthlySummaryNotification(): Promise<void> {
  if (!isNotificationEnabled("monthly_summary")) return;
  if (!(await hasNotificationPermission())) return;

  await cancelMonthlySummaryNotification();

  await Notifications.scheduleNotificationAsync({
    identifier: MONTHLY_SUMMARY_NOTIF_ID,
    content: {
      title: "Your monthly spending summary is ready",
      body: "Open Artha to see how last month went — total spent, top categories, and budget performance.",
      data: { screen: "/insights/compare" },
      sound: true,
      ...(Platform.OS === "android" ? { channelId: "artha-default" } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.MONTHLY,
      day: 1,
      hour: 9,
      minute: 0,
    },
  });
}

export async function cancelMonthlySummaryNotification(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(MONTHLY_SUMMARY_NOTIF_ID).catch(() => {});
}

// ─── Master Schedule Sync ───

/**
 * Re-schedule ALL Layer 1 notifications from current data.
 * Call this on app startup and after any data mutation that affects dues
 * (new expense, new reminder, prepayment, etc.).
 * Debounced internally — won't re-schedule if synced within the last 5 minutes.
 */
export async function syncAllScheduledNotifications(userId: string): Promise<void> {
  const lastSync = storage.getNumber(LAST_SCHEDULE_SYNC_KEY) ?? 0;
  // 1 hour — was 5 minutes, which on frequent app-opens churned (cancel +
  // reschedule) every Layer 1 EMI/reminder/daily alarm several times an hour.
  // forceSyncScheduledNotifications() bypasses this for callers right after
  // a real data mutation, so this debounce only affects the "nothing
  // relevant changed" app-open case.
  if (Date.now() - lastSync < 60 * 60 * 1000) return;
  storage.set(LAST_SCHEDULE_SYNC_KEY, Date.now());

  if (!(await hasNotificationPermission())) return;

  await Promise.all([
    scheduleDailyMorningCheck(),
    scheduleUpcomingEMINotifications(userId),
    scheduleUpcomingReminderNotifications(userId),
    syncMonthlySummarySchedule(),
  ]);
}

/**
 * Force re-sync (bypasses the 5-minute debounce). Use after data mutations.
 */
export async function forceSyncScheduledNotifications(userId: string): Promise<void> {
  storage.set(LAST_SCHEDULE_SYNC_KEY, 0);
  await syncAllScheduledNotifications(userId);
}

// ─── Legacy Registration (kept for background-fetch fallback) ───

export async function registerNotifBackgroundTask(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(NOTIF_CHECK_TASK);
  if (isRegistered) return;

  await BackgroundFetch.registerTaskAsync(NOTIF_CHECK_TASK, {
    minimumInterval: 12 * 60 * 60,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

export async function unregisterNotifBackgroundTask(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(NOTIF_CHECK_TASK);
  if (!isRegistered) return;

  await BackgroundFetch.unregisterTaskAsync(NOTIF_CHECK_TASK);
}

export async function syncNotifBackgroundTask(): Promise<void> {
  const overdueEnabled = isNotificationEnabled("overdue_forecast");
  const upcomingEnabled = isNotificationEnabled("upcoming_due");

  if (overdueEnabled || upcomingEnabled) {
    await registerNotifBackgroundTask();
  } else {
    await unregisterNotifBackgroundTask();
  }
}

// ─── Helpers ───

function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

function daysFromNow(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function expenseLabel(e: Expense): string {
  return e.merchant_name || e.description || "Payment";
}

/**
 * App-open EMI checks (Layer 2) run on every app-open past the 6h cooldown,
 * independent of Layer 1's scheduled "due tomorrow" alarm — without this
 * guard, opening the app repeatedly in one day re-sends the same
 * upcoming/overdue EMI notification each time.
 */
function shouldNotifyEmiToday(emiId: string, today: string): boolean {
  return storage.getString(`${EMI_LAST_NOTIFIED_PREFIX}${emiId}`) !== today;
}

function markEmiNotifiedToday(emiId: string, today: string): void {
  storage.set(`${EMI_LAST_NOTIFIED_PREFIX}${emiId}`, today);
}

// ─── Layer 2: App-Open Immediate Checks ───

export async function checkAndNotifyOverdue(userId: string): Promise<number> {
  if (!isNotificationEnabled("overdue_forecast")) return 0;
  if (!(await hasNotificationPermission())) return 0;

  const today = todayString();
  const overdue = await getOverdueForecasts(userId, today);

  if (overdue.length === 0) return 0;

  const totalAmount = overdue.reduce((s, e) => s + e.amount, 0);

  let body: string;
  if (overdue.length === 1) {
    body = `${expenseLabel(overdue[0])} — ${formatAmount(overdue[0].amount)} was due ${overdue[0].due_date}`;
  } else if (overdue.length === 2) {
    body = `${expenseLabel(overdue[0])} and ${expenseLabel(overdue[1])} — total ${formatAmount(totalAmount)}`;
  } else {
    body = `${expenseLabel(overdue[0])}, ${expenseLabel(overdue[1])}, +${overdue.length - 2} more — total ${formatAmount(totalAmount)}`;
  }

  await sendLocalNotification(
    `${overdue.length} overdue payment${overdue.length > 1 ? "s" : ""}`,
    body,
    { screen: "/expense/review-queue" },
  );

  return overdue.length;
}

export async function checkAndNotifyUpcoming(userId: string): Promise<number> {
  if (!isNotificationEnabled("upcoming_due")) return 0;
  if (!(await hasNotificationPermission())) return 0;

  const forecasts = await getForecastExpenses(userId, "approved");
  const today = todayString();

  const upcoming = forecasts.filter((e) => {
    if (!e.due_date) return false;
    const days = daysFromNow(e.due_date);
    return days >= 0 && days <= 2;
  });

  if (upcoming.length === 0) return 0;

  const toNotify = upcoming.slice(0, 3);

  for (const expense of toNotify) {
    const days = daysFromNow(expense.due_date!);
    const urgency =
      days === 0 ? "Due today" : days === 1 ? "Due tomorrow" : "Due in 2 days";

    const isRepayment = expense.forecast_type === "repayment";
    const title = isRepayment
      ? `${urgency}: CC bill ${formatAmount(expense.amount)}`
      : `${urgency}: ${expenseLabel(expense)}`;
    const body = isRepayment
      ? `${expenseLabel(expense)} — ${expense.due_date}`
      : `${formatAmount(expense.amount)} — ${expense.due_date}`;

    await sendLocalNotification(title, body, { screen: "/expense/review-queue" });
  }

  return upcoming.length;
}

export async function checkAndNotifyRecurringReminders(userId: string): Promise<number> {
  if (!isNotificationEnabled("upcoming_due")) return 0;
  if (!(await hasNotificationPermission())) return 0;

  const reminders = await getReminders(userId);
  const due = reminders.filter(
    (r) => r.state === "due_soon" || r.state === "overdue",
  );
  if (due.length === 0) return 0;

  const toNotify = due.slice(0, 3);
  for (const r of toNotify) {
    const source = r.source;
    const description =
      source?.description ?? source?.merchant_name ?? "Recurring expense";
    const title =
      r.state === "overdue"
        ? `Overdue: ${description}`
        : `Due ${r.rule.next_due_date === todayString() ? "today" : "tomorrow"}: ${description}`;
    const body = `Log or link an expense to clear this ${r.rule.frequency} reminder.`;
    await sendLocalNotification(title, body, { screen: "/(tabs)" });
  }

  return due.length;
}

export async function checkAndNotifyLoanEMIs(userId: string): Promise<number> {
  if (!isNotificationEnabled("upcoming_due")) return 0;
  if (!(await hasNotificationPermission())) return 0;

  try {
    const { getDatabase } = await import("@/database");
    const db = getDatabase();
    const today = todayString();
    const twoDaysOut = new Date(Date.now() + 2 * 86400000).toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

    const upcoming = await db.getAllAsync<{
      id: string;
      due_date: string;
      emi_amount: number;
      bank_name: string;
    }>(
      `SELECT se.id, se.due_date, se.emi_amount, fa.bank_name
       FROM loan_schedule_entries se
       JOIN loan_accounts la ON la.id = se.loan_account_id
       JOIN financial_accounts fa ON fa.id = la.financial_account_id
       WHERE fa.user_id = ? AND la.status = 'active' AND se.status = 'scheduled'
         AND se.due_date >= ? AND se.due_date <= ?
       ORDER BY se.due_date ASC LIMIT 3;`,
      userId, today, twoDaysOut,
    );

    const overdue = await db.getAllAsync<{
      id: string;
      due_date: string;
      emi_amount: number;
      bank_name: string;
    }>(
      `SELECT se.id, se.due_date, se.emi_amount, fa.bank_name
       FROM loan_schedule_entries se
       JOIN loan_accounts la ON la.id = se.loan_account_id
       JOIN financial_accounts fa ON fa.id = la.financial_account_id
       WHERE fa.user_id = ? AND la.status = 'active' AND se.status = 'scheduled'
         AND se.due_date <= ?
       ORDER BY se.due_date ASC LIMIT 3;`,
      userId, yesterday,
    );

    let count = 0;
    for (const e of upcoming) {
      if (!shouldNotifyEmiToday(e.id, today)) continue;
      await sendLocalNotification(
        `EMI due ${e.due_date === today ? "today" : "soon"}: ${e.bank_name}`,
        `EMI of ${formatAmount(e.emi_amount)} on ${e.due_date}.`,
        { screen: "/goals/loans" },
      );
      markEmiNotifiedToday(e.id, today);
      count++;
    }
    for (const e of overdue) {
      if (!shouldNotifyEmiToday(e.id, today)) continue;
      await sendLocalNotification(
        `EMI overdue: ${e.bank_name}`,
        `${formatAmount(e.emi_amount)} was due ${e.due_date}. Link a payment or check with your bank.`,
        { screen: "/goals/loans" },
      );
      markEmiNotifiedToday(e.id, today);
      count++;
    }
    return count;
  } catch (e) {
    logger.warn("checkAndNotifyLoanEMIs failed", e);
    return 0;
  }
}

// ─── Monthly Summary ───

export async function sendMonthlySummaryNow(userId: string): Promise<void> {
  if (!isNotificationEnabled("monthly_summary")) return;
  if (!(await hasNotificationPermission())) return;

  try {
    const { getExpenseTotal } = await import("@/services/expense-queries");
    const { getDatabase } = await import("@/database");

    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const startDate = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0).getDate();
    const endDate = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthLabel = `${MONTHS[lastMonth.getMonth()]} ${lastMonth.getFullYear()}`;

    const total = await getExpenseTotal(userId, startDate, endDate);
    if (total === 0) return;

    const db = getDatabase();
    const txnCount = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) as c FROM expenses
       WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
         AND date >= ? AND date <= ?;`,
      userId, startDate, endDate,
    );

    const topCat = await db.getFirstAsync<{ name: string; total: number }>(
      `SELECT c.name, SUM(e.amount) as total FROM expenses e
       JOIN categories c ON e.category_id = c.id
       WHERE e.user_id = ? AND e.status = 'approved' AND e.nature = 'realized' AND e.deleted_at IS NULL
         AND e.date >= ? AND e.date <= ?
       GROUP BY c.id ORDER BY total DESC LIMIT 1;`,
      userId, startDate, endDate,
    );

    const count = txnCount?.c ?? 0;
    const topLine = topCat ? `Top: ${topCat.name} ${formatAmount(topCat.total)}` : "";

    await sendLocalNotification(
      `${monthLabel}: ${formatAmount(total)} spent`,
      `${count} transactions. ${topLine}`.trim(),
      { screen: "/insights/compare" },
    );
  } catch (e) {
    logger.warn("sendMonthlySummaryNow failed", e);
  }
}

export async function syncMonthlySummarySchedule(): Promise<void> {
  if (isNotificationEnabled("monthly_summary")) {
    await scheduleMonthlySummaryNotification();
  } else {
    await cancelMonthlySummaryNotification();
  }
}

// ─── Combined Check (Layer 2 — runs on app open) ───

/**
 * Run immediate checks + sync Layer 1 schedules. Call on app startup.
 * Cooldown reduced to 6h so opening the app twice a day catches changes.
 */
export async function runDailyNotificationCheck(userId: string): Promise<{
  overdue: number;
  upcoming: number;
  recurringReminders: number;
  loanEMIs: number;
  skipped: boolean;
}> {
  // Always sync scheduled notifications on app open (debounced internally)
  syncAllScheduledNotifications(userId).catch((e) => logger.warn("Schedule sync failed", e));

  const lastCheck = storage.getNumber(LAST_NOTIF_CHECK_KEY) ?? 0;
  if (Date.now() - lastCheck < COOLDOWN_MS) {
    return { overdue: 0, upcoming: 0, recurringReminders: 0, loanEMIs: 0, skipped: true };
  }

  storage.set(LAST_NOTIF_CHECK_KEY, Date.now());

  const overdue = await checkAndNotifyOverdue(userId);
  const upcoming = await checkAndNotifyUpcoming(userId);
  const recurringReminders = await checkAndNotifyRecurringReminders(userId);
  const loanEMIs = await checkAndNotifyLoanEMIs(userId);

  if (new Date().getDate() === 1) {
    const thisMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    if (storage.getString(LAST_MONTHLY_SUMMARY_SENT_KEY) !== thisMonth) {
      storage.set(LAST_MONTHLY_SUMMARY_SENT_KEY, thisMonth);
      sendMonthlySummaryNow(userId).catch((e) => logger.warn("Monthly summary failed", e));
    }
  }

  return { overdue, upcoming, recurringReminders, loanEMIs, skipped: false };
}
