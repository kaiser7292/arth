/**
 * SMS Scan Orchestrator
 *
 * Single entry point for running an end-to-end SMS scan:
 *   read → parse → filter (account) → process → log → (optional) notify.
 *
 * v17.6.6: Account filtering moved HERE from sms-reader.ts so that user
 * templates get a chance to match before any filtering. The scan run is
 * logged with per-SMS detail for the Scan Runs UI.
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
  getSmsScanAccountIds,
  getSmsStartDate,
  getSmsEndDate,
} from "@/services/sms";
import {
  isNotificationEnabled,
  sendLocalNotification,
  formatSmsScanBody,
  hasNotificationPermission,
} from "@/services/notifications";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { parseBankSMS } from "./bank-patterns";
import type { ParsedSMS } from "./bank-patterns";
import type { ParsedItem } from "./sms-parser";
import {
  saveScanRun,
  type ScanDetail,
  type ScanDetailCategory,
} from "./sms-scan-logging";

export interface ScanOutcome {
  ran: boolean;
  created: number;
  credits: number;
  skipped: number;
  totalScanned: number;
  scanRunId?: string | null;
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
 *   If provided, only parsed SMS matching these accounts will be processed.
 */
export async function runSmsScan(
  options: { manual?: boolean; notify?: boolean; accountIds?: string[] } = {},
): Promise<ScanOutcome> {
  const manual = options.manual ?? false;
  const notify = options.notify ?? true;
  const accountIds = options.accountIds;
  const startTime = Date.now();

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
    // Phase 1: Read SMS from device (no account filtering here anymore)
    const readResult = manual ? await manualReadSms() : await checkForNewBankSMS();
    if (readResult.error) {
      const scanRunId = await saveScanRun({
        userId: DEFAULT_USER_ID,
        isManual: manual,
        startDate: manual ? getSmsStartDate() : null,
        endDate: manual ? getSmsEndDate() : null,
        accountIds: accountIds ?? null,
        smsReadCount: 0,
        hardcodedMatchCount: 0,
        templateMatchCount: 0,
        filteredCount: 0,
        unrecognizedCount: 0,
        skippedCount: 0,
        expenseCreatedCount: 0,
        creditCreatedCount: 0,
        durationMs: Date.now() - startTime,
        error: readResult.error,
        details: [],
      });
      return {
        ran: false,
        created: 0,
        credits: 0,
        skipped: 0,
        totalScanned: 0,
        scanRunId,
        reason: "error",
        error: readResult.error,
      };
    }

    if (readResult.count === 0) {
      setLastAutoScanRun(Date.now());
      const scanRunId = await saveScanRun({
        userId: DEFAULT_USER_ID,
        isManual: manual,
        startDate: manual ? getSmsStartDate() : null,
        endDate: manual ? getSmsEndDate() : null,
        accountIds: accountIds ?? null,
        smsReadCount: 0,
        hardcodedMatchCount: 0,
        templateMatchCount: 0,
        filteredCount: 0,
        unrecognizedCount: 0,
        skippedCount: 0,
        expenseCreatedCount: 0,
        creditCreatedCount: 0,
        durationMs: Date.now() - startTime,
        details: [],
      });
      return { ran: true, created: 0, credits: 0, skipped: 0, totalScanned: 0, scanRunId, reason: "no_new_sms" };
    }

    // Phase 2: Parse SMS (hardcoded + template matching)
    const parseResult = await parseSmsBatch(DEFAULT_USER_ID, readResult.messages);

    // Phase 3: Account filtering (post-parse, so templates had their chance)
    const { passed, filtered, filterDetails } = await filterByAccount(
      parseResult.items,
      accountIds,
    );

    // Phase 4: Process (create expenses/credits)
    let processResult = { created: 0, credits: 0, skipped: 0, errors: [] as string[] };
    if (passed.length > 0) {
      processResult = await processParseResults(
        DEFAULT_USER_ID,
        passed.map((item) => ({
          pendingSmsId: item.pendingSmsId,
          parsed: item.parsed,
          rawBody: item.rawBody,
          smsDate: item.smsDate,
        })),
      );
    }

    // Phase 5: Build scan details for logging
    const details: ScanDetail[] = [];

    for (const item of passed) {
      const cat: ScanDetailCategory = item.parsed._matchSource === "template"
        ? "template"
        : "hardcoded";
      details.push({
        pendingSmsId: item.pendingSmsId,
        smsBodyPreview: item.rawBody,
        smsDate: item.smsDate,
        category: cat,
        matchedTemplateId: item.parsed._matchedTemplateId ?? null,
        parsedAmount: item.parsed.amount ?? null,
        parsedMerchant: item.parsed.merchant ?? null,
        parsedType: item.parsed.type ?? null,
      });
    }

    for (const fd of filterDetails) {
      details.push({
        pendingSmsId: fd.pendingSmsId,
        smsBodyPreview: fd.rawBody,
        smsDate: fd.smsDate,
        category: "filtered",
        filterReason: fd.reason,
        parsedAmount: fd.parsed?.amount ?? null,
        parsedMerchant: fd.parsed?.merchant ?? null,
        parsedType: fd.parsed?.type ?? null,
      });
    }

    for (const sms of parseResult.unrecognizedSms) {
      details.push({
        smsBodyPreview: sms.body,
        smsDate: sms.smsDate,
        smsAddress: sms.address,
        category: "unrecognized",
      });
    }

    for (const sms of parseResult.skippedSms) {
      details.push({
        smsBodyPreview: sms.body,
        smsDate: sms.smsDate,
        smsAddress: sms.address,
        category: "skipped",
      });
    }

    const durationMs = Date.now() - startTime;
    const scanRunId = await saveScanRun({
      userId: DEFAULT_USER_ID,
      isManual: manual,
      startDate: manual ? getSmsStartDate() : null,
      endDate: manual ? getSmsEndDate() : null,
      accountIds: accountIds ?? null,
      smsReadCount: readResult.count,
      hardcodedMatchCount: passed.filter(
        (i) => i.parsed._matchSource !== "template",
      ).length,
      templateMatchCount: passed.filter(
        (i) => i.parsed._matchSource === "template",
      ).length,
      filteredCount: filtered.length,
      unrecognizedCount: parseResult.unrecognized,
      skippedCount: parseResult.skipped,
      expenseCreatedCount: processResult.created,
      creditCreatedCount: processResult.credits,
      durationMs,
      details,
    });

    // Only auto-scan sends a notification — manual scans surface results in-UI.
    if (!manual && notify && processResult.created > 0) {
      const canNotify = await hasNotificationPermission();
      if (canNotify) {
        const notifItems = passed
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
      scanRunId,
    };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    await saveScanRun({
      userId: DEFAULT_USER_ID,
      isManual: manual,
      startDate: manual ? getSmsStartDate() : null,
      endDate: manual ? getSmsEndDate() : null,
      accountIds: accountIds ?? null,
      smsReadCount: 0,
      hardcodedMatchCount: 0,
      templateMatchCount: 0,
      filteredCount: 0,
      unrecognizedCount: 0,
      skippedCount: 0,
      expenseCreatedCount: 0,
      creditCreatedCount: 0,
      durationMs: Date.now() - startTime,
      error: errorMsg,
      details: [],
    }).catch(() => {});
    return {
      ran: false,
      created: 0,
      credits: 0,
      skipped: 0,
      totalScanned: 0,
      reason: "error",
      error: errorMsg,
    };
  }
}

// ─── Account Filtering (post-parse) ───

interface FilterResult {
  passed: ParsedItem[];
  filtered: ParsedItem[];
  filterDetails: Array<{
    pendingSmsId: string;
    rawBody: string;
    smsDate: number;
    reason: string;
    parsed: ParsedSMS | null;
  }>;
}

async function filterByAccount(
  items: ParsedItem[],
  accountIds?: string[],
): Promise<FilterResult> {
  if (!accountIds || accountIds.length === 0) {
    return { passed: items, filtered: [], filterDetails: [] };
  }

  const allAccounts = await getActiveAccounts(DEFAULT_USER_ID);
  const selectedAccounts = allAccounts.filter((acc: FinancialAccount) =>
    accountIds.includes(acc.id),
  );

  const pensionAccounts = selectedAccounts.filter(
    (acc) => acc.account_type === "pension",
  );
  const otherAccounts = selectedAccounts.filter(
    (acc) => acc.account_type !== "pension",
  );

  const otherIdentifiers = otherAccounts.map((acc) => acc.account_identifier);
  const pensionIdentifiers = pensionAccounts.map((acc) => acc.account_identifier);

  const passed: ParsedItem[] = [];
  const filtered: ParsedItem[] = [];
  const filterDetails: FilterResult["filterDetails"] = [];

  for (const item of items) {
    const parsed = item.parsed;

    // EPFO/pension matching
    if (parsed.bank === "EPFO" && pensionIdentifiers.length > 0) {
      if (parsed.cardLast4 && pensionIdentifiers.includes(parsed.cardLast4)) {
        passed.push(item);
        continue;
      }
      if (
        parsed.merchant &&
        pensionIdentifiers.some(
          (id) => parsed.merchant!.includes(id) || id.includes(parsed.merchant!),
        )
      ) {
        passed.push(item);
        continue;
      }
      filtered.push(item);
      filterDetails.push({
        pendingSmsId: item.pendingSmsId,
        rawBody: item.rawBody,
        smsDate: item.smsDate,
        reason: "account_mismatch",
        parsed,
      });
      continue;
    }

    // Regular account matching via cardLast4
    if (!parsed.cardLast4) {
      filtered.push(item);
      filterDetails.push({
        pendingSmsId: item.pendingSmsId,
        rawBody: item.rawBody,
        smsDate: item.smsDate,
        reason: "no_card_identifier",
        parsed,
      });
      continue;
    }

    if (otherIdentifiers.includes(parsed.cardLast4)) {
      passed.push(item);
    } else {
      filtered.push(item);
      filterDetails.push({
        pendingSmsId: item.pendingSmsId,
        rawBody: item.rawBody,
        smsDate: item.smsDate,
        reason: `account_mismatch:${parsed.cardLast4}`,
        parsed,
      });
    }
  }

  return { passed, filtered, filterDetails };
}
