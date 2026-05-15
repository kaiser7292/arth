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
import { logScanRun, logScanDetails, type ScanDetailInput } from "@/services/sms-scan-logging";

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
 * @param options.accountIds - optional list of account IDs to filter SMS scan by.
 *   If provided, only SMS matching these accounts will be processed.
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

  // v15.13.0: Initialize scan run ID for logging
  let scanRunId: string | null = null;
  let startDate: string | null = null;
  let endDate: string | null = null;
  
  try {
    const readResult = manual ? await manualReadSms(accountIds) : await checkForNewBankSMS();
    if (readResult.error) {
      // Log failed scan
      try {
        scanRunId = await logScanRun({
          userId: DEFAULT_USER_ID,
          isManual: manual,
          startDate: null,
          endDate: null,
          accountIds: accountIds ?? null,
          smsReadCount: 0,
          smsParsedCount: 0,
          smsFilteredCount: 0,
          smsHardcodedMatchCount: 0,
          smsTemplateMatchCount: 0,
          smsUnrecognizedCount: 0,
          smsSkippedCount: 0,
          expenseCreatedCount: 0,
          creditCreatedCount: 0,
          errorMessage: readResult.error,
        });
      } catch (logError) {
        // Non-fatal: logging failure shouldn't break the scan
        console.error("Failed to log scan run:", logError);
      }
      
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

    // v15.13.0: Get date range for logging
    if (manual) {
      const { getSmsStartTimestamp, getSmsEndTimestamp } = await import("./sms-permissions");
      const startTs = getSmsStartTimestamp();
      const endTs = getSmsEndTimestamp();
      startDate = new Date(startTs).toISOString().split("T")[0];
      endDate = new Date(endTs).toISOString().split("T")[0];
    }

    const parseResult = await parseSmsBatch(DEFAULT_USER_ID, readResult.messages);
    if (parseResult.items.length === 0) {
      setLastAutoScanRun(Date.now());
      return { ran: true, created: 0, credits: 0, skipped: 0, totalScanned: readResult.count };
    }

    // v15.13.0: Count parse sources for logging
    const parseSourceCounts = parseResult.items.reduce(
      (acc, item) => {
        acc[item.parseSource] = (acc[item.parseSource] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const processResult = await processParseResults(
      DEFAULT_USER_ID,
      parseResult.items.map((item) => ({
        pendingSmsId: item.pendingSmsId,
        parsed: item.parsed,
        rawBody: item.rawBody,
        smsDate: item.smsDate,
      })),
      accountIds,
    );

    // v15.13.0: Log scan run
    try {
      scanRunId = await logScanRun({
        userId: DEFAULT_USER_ID,
        isManual: manual,
        startDate,
        endDate,
        accountIds: accountIds ?? null,
        smsReadCount: readResult.count,
        smsParsedCount: parseResult.items.length,
        smsFilteredCount: parseResult.items.length - (processResult.created + processResult.credits + processResult.skipped),
        smsHardcodedMatchCount: parseSourceCounts.hardcoded || 0,
        smsTemplateMatchCount: parseSourceCounts.template || 0,
        smsUnrecognizedCount: parseSourceCounts.unrecognized || 0,
        smsSkippedCount: parseSourceCounts.skipped || 0,
        expenseCreatedCount: processResult.created,
        creditCreatedCount: processResult.credits,
      });

      // v15.13.0: Log scan details (per-SMS)
      const scanDetails: ScanDetailInput[] = parseResult.items.map((item) => ({
        scanRunId: scanRunId!,
        smsId: item.pendingSmsId,
        smsAddress: null, // Would need to extract from raw SMS if available
        smsBody: item.rawBody,
        smsDate: item.smsDate,
        parseSource: item.parseSource,
        parseResult: JSON.stringify(item.parsed),
        filterReason: null, // Would need to track during account filtering
      }));
      await logScanDetails(scanDetails);
    } catch (logError) {
      // Non-fatal: logging failure shouldn't break the scan
      console.error("Failed to log scan details:", logError);
    }

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
    // v15.13.0: Log failed scan
    try {
      scanRunId = await logScanRun({
        userId: DEFAULT_USER_ID,
        isManual: manual,
        startDate,
        endDate,
        accountIds: accountIds ?? null,
        smsReadCount: 0,
        smsParsedCount: 0,
        smsFilteredCount: 0,
        smsHardcodedMatchCount: 0,
        smsTemplateMatchCount: 0,
        smsUnrecognizedCount: 0,
        smsSkippedCount: 0,
        expenseCreatedCount: 0,
        creditCreatedCount: 0,
        errorMessage: e instanceof Error ? e.message : String(e),
      });
    } catch (logError) {
      // Non-fatal: logging failure shouldn't break the scan
      console.error("Failed to log scan run:", logError);
    }
    
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
