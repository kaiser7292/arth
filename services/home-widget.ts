import { createElement } from "react";
import { Platform } from "react-native";
import { requestWidgetUpdate } from "react-native-android-widget";
import type { WidgetInfo } from "react-native-android-widget";
import { CatchUpWidget, MonthWidget, ReviewWidget } from "@/components/widget/ArthWidgets";
import type { WidgetData } from "@/components/widget/ArthWidgets";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getCurrencyDef } from "@/constants/currencies";
import { initDatabase } from "@/database";
import { isLockEnabled } from "@/services/biometric-lock";
import { getCurrentMonth } from "@/services/budget";
import { getExpenseTotal, getPendingExpenseCount, getUncategorizedCount } from "@/services/expense";
import { getCurrency } from "@/services/locale-preferences";
import { isAmountsHidden } from "@/services/privacy-mode";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { todayIso } from "@/utils/date";
import { formatAmount } from "@/utils/format";
import { logger } from "@/utils/logger";

/**
 * Data + refresh for Arth's home-screen widgets (Android).
 *
 *   ArthCatchUp  (2×2) - what's waiting in Catch Up, with Add and Voice buttons
 *   ArthSummary  (4×2) - budget left this month against the pace of the month, with quick-add
 *                        buttons. Keeps the old one-line widget's name, so widgets people already
 *                        placed turn into this one instead of breaking.
 *   ArthReview   (4×4) - the next items to review with Approve / Reject, and payments due soon
 *
 * "To catch up" is pending review + uncategorized, like Catch Up, minus duplicates: the duplicate
 * scan grows with history and widgets render headlessly on a timer, so this has to stay cheap.
 *
 * Amounts are masked only when "Hide amounts" is on in Arth. With the app lock on, Approve / Reject
 * open Catch Up instead of acting, so items are only approved after unlocking (the notification
 * buttons follow the same rule).
 */

export const WIDGET_NAMES = { catchUp: "ArthCatchUp", month: "ArthSummary", review: "ArthReview" } as const;

/** Items the large widget lists. */
export const REVIEW_ROWS = 3;
/** Payments due within this many days (and overdue ones) show under "Due soon". */
export const DUE_WINDOW_DAYS = 10;

export interface WidgetReviewItem {
  id: string;
  title: string;
  detail: string;
  amount: string;
  isCredit: boolean;
}

export interface WidgetDueItem {
  title: string;
  when: string;
  overdue: boolean;
  amount: string;
}

// ─── Pure helpers (tested) ───

export type Pace = "none" | "under" | "on" | "over" | "exceeded";

export interface MonthPace {
  pace: Pace;
  /** Share of the budget used, 0-1+ (0 when there's no budget). */
  used: number;
  /** Where the month is, 0-1: today's position for the pace marker. */
  elapsed: number;
  daysLeft: number;
  /** Spend per day that keeps the month inside the budget; 0 once it's gone. */
  perDay: number;
}

/**
 * Where the month stands against its budget. "on" pace allows 5% either side of where an even
 * spread would be by today.
 */
export function monthPace(spent: number, budget: number, today: string): MonthPace {
  const [y, m, d] = today.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const daysLeft = daysInMonth - d + 1;
  const elapsed = d / daysInMonth;
  if (budget <= 0) return { pace: "none", used: 0, elapsed, daysLeft, perDay: 0 };
  const used = spent / budget;
  const remaining = budget - spent;
  const perDay = remaining > 0 ? remaining / daysLeft : 0;
  const pace: Pace = used > 1 ? "exceeded" : used > elapsed + 0.05 ? "over" : used < elapsed - 0.05 ? "under" : "on";
  return { pace, used, elapsed, daysLeft, perDay };
}

/** "today", "tomorrow", "in 4 days", "overdue". */
export function dueLabel(dueDate: string, today: string): { when: string; overdue: boolean } {
  const days = Math.round((Date.parse(dueDate) - Date.parse(today)) / 86_400_000);
  if (days < 0) return { when: "overdue", overdue: true };
  if (days === 0) return { when: "today", overdue: false };
  if (days === 1) return { when: "tomorrow", overdue: false };
  return { when: `in ${days} days`, overdue: false };
}

/** "HDFC ••4417", "SBI", or "" - the account an item came through. */
export function accountShort(bank: string | null, identifier: string | null): string {
  const last4 = identifier ? identifier.replace(/\D/g, "").slice(-4) : "";
  return [bank?.trim(), last4 ? `••${last4}` : ""].filter(Boolean).join(" ");
}

function money(amount: number, masked: boolean): string {
  if (!masked) return formatAmount(amount);
  const symbol = getCurrencyDef(getCurrency()).symbol;
  return `${symbol ?? ""}••••`;
}

// ─── Loading ───

export async function loadWidgetData(): Promise<WidgetData | null> {
  try {
    const db = await initDatabase();
    const today = todayIso();
    const month = getCurrentMonth();
    const { startDate, endDate } = getMonthDateRange(month);
    const locked = isLockEnabled();
    const masked = isAmountsHidden();
    const dueUntil = new Date(Date.parse(today) + DUE_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

    const [pending, uncategorized, spent, budgetRow, reviewRows, dueRows] = await Promise.all([
      getPendingExpenseCount(DEFAULT_USER_ID),
      getUncategorizedCount(DEFAULT_USER_ID),
      getExpenseTotal(DEFAULT_USER_ID, startDate, endDate),
      // Same total as Home's budget card: active categories' budgets for this month.
      db.getFirstAsync<{ total: number | null }>(
        `SELECT SUM(b.amount) AS total FROM budgets b
           JOIN categories c ON c.id = b.category_id AND c.is_active = 1
          WHERE b.user_id = ? AND b.month = ?;`,
        DEFAULT_USER_ID,
        month,
      ),
      db.getAllAsync<{
        id: string;
        amount: number;
        nature: string;
        merchant_name: string | null;
        description: string | null;
        category: string | null;
        bank_name: string | null;
        account_identifier: string | null;
      }>(
        `SELECT e.id, e.amount, e.nature, e.merchant_name, e.description, c.name AS category,
                a.bank_name, a.account_identifier
           FROM expenses e
           LEFT JOIN categories c ON c.id = e.category_id
           LEFT JOIN financial_accounts a ON a.id = e.account_id
          WHERE e.user_id = ? AND e.status = 'pending_review' AND e.nature IN ('realized', 'credit')
            AND e.deleted_at IS NULL
            -- Same as getPendingExpenseCount: items reclassified as a transfer between your own
            -- accounts keep pending_review but aren't waiting for review.
            AND (e.reclassified_as_transfer IS NULL OR e.reclassified_as_transfer = 0)
          ORDER BY e.date DESC, e.created_at DESC
          LIMIT ?;`,
        DEFAULT_USER_ID,
        REVIEW_ROWS,
      ),
      // Committed payments (the forecasts Home lists under dues) due soon or already overdue.
      db.getAllAsync<{ amount: number; due_date: string; merchant_name: string | null; description: string | null }>(
        `SELECT amount, due_date, merchant_name, description FROM expenses
          WHERE user_id = ? AND nature = 'forecast' AND status != 'rejected' AND deleted_at IS NULL
            AND due_date IS NOT NULL AND due_date <= ?
          ORDER BY due_date ASC
          LIMIT 2;`,
        DEFAULT_USER_ID,
        dueUntil,
      ),
    ]);

    const budget = budgetRow?.total ?? 0;
    const pace = monthPace(spent, budget, today);
    return {
      masked,
      locked,
      toCatchUp: pending + uncategorized,
      spent: money(spent, masked),
      budget: money(budget, masked),
      left: money(Math.abs(budget - spent), masked),
      // An allowance, not a balance: whole rupees read better than "₹11,225.27 a day".
      perDay: money(Math.floor(pace.perDay), masked),
      pace,
      review: reviewRows.map((r) => ({
        id: r.id,
        title: r.merchant_name?.trim() || r.description?.trim() || (r.nature === "credit" ? "Money in" : "Payment"),
        detail: [accountShort(r.bank_name, r.account_identifier), r.category].filter(Boolean).join(" · "),
        amount: (r.nature === "credit" ? "+" : "") + money(r.amount, masked),
        isCredit: r.nature === "credit",
      })),
      due: dueRows.map((r) => ({
        title: r.merchant_name?.trim() || r.description?.trim() || "Payment",
        ...dueLabel(r.due_date, today),
        amount: money(r.amount, masked),
      })),
      updatedAt: new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }),
    };
  } catch (e) {
    logger.warn("Widget data load failed", e);
    return null;
  }
}

// ─── Rendering ───

/** The widget for a placed instance: by name, and by size for the month widget. */
export function renderWidget(info: Pick<WidgetInfo, "widgetName" | "width" | "height">, data: WidgetData | null) {
  const make = (scheme: "light" | "dark") => {
    switch (info.widgetName) {
      case WIDGET_NAMES.catchUp:
        return createElement(CatchUpWidget, { data, scheme });
      case WIDGET_NAMES.review:
        return createElement(ReviewWidget, { data, scheme });
      default:
        // Placed before this update, the summary widget was one row high: keep a one-row layout
        // there (and whenever someone shrinks it) rather than squeezing the full one in.
        return createElement(MonthWidget, { data, scheme, compact: info.height < 100, width: info.width });
    }
  };
  return { light: make("light"), dark: make("dark") };
}

/** Push fresh numbers to every Arth widget on the home screen. Cheap no-op when none is placed. */
export async function refreshHomeWidget(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const data = await loadWidgetData();
    for (const widgetName of Object.values(WIDGET_NAMES)) {
      await requestWidgetUpdate({ widgetName, renderWidget: (info) => renderWidget(info, data) });
    }
  } catch (e) {
    logger.warn("Widget refresh failed", e);
  }
}
