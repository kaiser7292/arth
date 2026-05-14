/**
 * SMS Scan Orchestrator
 *
 * Single entry point for running an end-to-end SMS scan:
 *   read → parse → process → (optional) notify.
 *
 * Used by the app-open auto-scan (cooldown-gated) and by manual "Scan now"
 * buttons. Both paths share identical logic; only the cooldown behavior and
 * optional notification differ.
 */

import {
  checkForNewBankSMS,
  manualScan as manualReadSms,
  parseSmsBatch,
  processParseResults,
  isSmsDetectionEnabled,
  getLastAutoScanRun,
  setLastAutoScanRun,
  hasSmsPermission,
} from "@/services/sms";
import {
  isNotificationEnabled,
  sendLocalNotification,
  formatSmsScanBody,
  hasNotificationPermission,
} from "@/services/notifications";
import { DEFAULT_USER_ID } from "@/constants/app";

export interface ScanOutcome {
  ran: boolean;
  created: number;
  credits: number;
  skipped: number;
  totalScanned: number;
  reason?: "sms_disabled" | "no_permission" | "cooldown" | "no_new_sms" | "error";
  error?: string;
}

/** 30 minutes — cooldown between automatic scans on app open. */
export const SCAN_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * Run an SMS scan end-to-end.
 *
 * @param options.manual - true when invoked by a user button. Bypasses the
 *   30-min cooldown, reads SMS from the user-configured start date (via
 *   manualScan), and skips the auto-scan notification.
 * @param options.notify - default true. When true and new transactions are
 *   found, sends a local notification (subject to user notification prefs).
 *   Ignored when manual=true (the UI surfaces results directly).
 * @param options.accountIds - optional array of account IDs to filter SMS by.
 *   If provided, only SMS matching these accounts are processed.
 */
export async function runSmsScan(
  options: { manual?: boolean; notify?: boolean; accountIds?: string[] } = {},
): Promise<ScanOutcome> {
  const manual = options.manual ?? false;
  const notify = options.notify ?? true;
  const accountIds = options.accountIds;

  if (!isSmsDetectionEnabled()) {
    return { ran: false, created: 0, credits: 0, skipped: 0, totalScanned: 0, reason: "sms_disabled" };
  }

  if (!(await hasSmsPermission())) {
    return { ran: false, created: 0, credits: 0, skipped: 0, totalScanned: 0, reason: "no_permission" };
  }

  if (!manual) {
    const lastRun = getLastAutoScanRun();
    if (Date.now() - lastRun < SCAN_COOLDOWN_MS) {
      return { ran: false, created: 0, credits: 0, skipped: 0, totalScanned: 0, reason: "cooldown" };
    }
  }

  try {
    const readResult = manual ? await manualReadSms(accountIds) : await checkForNewBankSMS();
    if (readResult.error) {
      return {
        ran: false,
        created: 0,
        credits: 0,
        skipped: 0,
        totalScanned: 0,
        reason: "error",
        error: readResult.error,
      };
    }

    if (readResult.count === 0) {
      setLastAutoScanRun(Date.now());
      return { ran: true, created: 0, credits: 0, skipped: 0, totalScanned: 0, reason: "no_new_sms" };
    }

    const parseResult = await parseSmsBatch(DEFAULT_USER_ID, readResult.messages);
    if (parseResult.items.length === 0) {
      setLastAutoScanRun(Date.now());
      return { ran: true, created: 0, credits: 0, skipped: 0, totalScanned: readResult.count };
    }

    const processResult = await processParseResults(
      DEFAULT_USER_ID,
      parseResult.items.map((item) => ({
        pendingSmsId: item.pendingSmsId,
        parsed: item.parsed,
        rawBody: item.rawBody,
        smsDate: item.smsDate,
      })),
    );

    // Only auto-scan sends a notification — manual scans surface results in-UI.
    if (!manual && notify && processResult.created > 0) {
      const canNotify = isNotificationEnabled("sms_scan") && (await hasNotificationPermission());
      if (canNotify) {
        const notifItems = parseResult.items
          .filter((item) => item.parsed.merchant && item.parsed.amount > 0)
          .map((item) => ({ merchant: item.parsed.merchant!, amount: item.parsed.amount }));
        const body = formatSmsScanBody(notifItems);
        await sendLocalNotification(
          `${processResult.created} new transaction${processResult.created > 1 ? "s" : ""} found`,
          body,
          { screen: "/expense/review-queue" },
        );
      }
    }

    setLastAutoScanRun(Date.now());
    return {
      ran: true,
      created: processResult.created,
      credits: processResult.credits,
      skipped: processResult.skipped,
      totalScanned: readResult.count,
    };
  } catch (e) {
    return {
      ran: false,
      created: 0,
      credits: 0,
      skipped: 0,
      totalScanned: 0,
      reason: "error",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
