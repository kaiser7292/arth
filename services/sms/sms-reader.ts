/**
 * SMS Reader Service — reads bank transaction SMS from Android inbox.
 *
 * Uses react-native-get-sms-android to query the SMS content provider.
 * Filters by known bank sender IDs to avoid reading personal messages.
 *
 * Two entry points:
 *  - manualScan(): user taps "Scan Now", reads from user-configured start date
 *  - checkForNewBankSMS(): background polling, reads since last check
 *
 * Security: SMS text is processed locally. Never logged. Only last 4 digits
 * of card/account numbers are stored.
 */

import { DEFAULT_USER_ID } from "@/constants/app";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { Platform } from "react-native";
import { parseBankSMS } from "./bank-patterns";
import { isBankSender, looksLikeTransaction } from "./bank-senders";
import {
    getLastSmsCheckTimestamp,
    getSmsEndTimestamp,
    getSmsStartTimestamp,
    hasSmsPermission,
    setLastSmsCheckTimestamp,
} from "./sms-permissions";
import {
    loadUserSenderClaims,
    matchesAnyUserSenderPattern,
} from "./user-sms-templates";

// ─── Types ───

export interface RawSMS {
  /** Android SMS _id */
  _id: string;
  /** Sender address (e.g. "AD-ICICIB", "VM-HDFCBK") */
  address: string;
  /** Full SMS body text */
  body: string;
  /** Timestamp in milliseconds */
  date: number;
  /** SMS type: 1=inbox, 2=sent */
  type: number;
  /** Whether the SMS has been read */
  read: number;
}

export interface FetchSMSResult {
  messages: RawSMS[];
  count: number;
  error: string | null;
}

// ─── Native Module Bridge ───

/**
 * Read SMS from the Android inbox using react-native-get-sms-android.
 * This module is Android-only; returns empty on iOS.
 *
 * The native module uses a JSON filter string to query the SMS content provider.
 */
async function readSmsFromDevice(filter: Record<string, unknown>): Promise<RawSMS[]> {
  if (Platform.OS !== "android") return [];

  // Dynamic require to avoid crash on iOS
  const SmsAndroid = require("react-native-get-sms-android");

  return new Promise((resolve, reject) => {
    SmsAndroid.list(
      JSON.stringify(filter),
      (fail: string) => reject(new Error(fail)),
      (_count: number, smsList: string) => {
        try {
          const messages: RawSMS[] = JSON.parse(smsList);
          resolve(messages);
        } catch {
          resolve([]);
        }
      },
    );
  });
}

// ─── Core fetch function ───

/**
 * Fetch bank SMS from inbox within a time range.
 *
 * @param sinceTimestamp - Only fetch SMS newer than this (ms).
 * @param maxCount - Maximum SMS to read. Default 500.
 * @param untilTimestamp - Only fetch SMS older than this (ms). 0 = no upper limit.
 * @param accountIds - optional list of account IDs to filter SMS by
 */
async function fetchBankSMSRange(
  sinceTimestamp: number,
  maxCount: number = 500,
  untilTimestamp: number = 0,
  accountIds?: string[],
): Promise<FetchSMSResult> {
  if (Platform.OS !== "android") {
    return { messages: [], count: 0, error: "SMS reading is Android-only" };
  }

  const hasPermission = await hasSmsPermission();
  if (!hasPermission) {
    return { messages: [], count: 0, error: "SMS permission not granted" };
  }

  try {
    const filter: Record<string, unknown> = {
      box: "inbox",
      maxCount,
      ...(sinceTimestamp > 0 ? { minDate: sinceTimestamp } : {}),
      ...(untilTimestamp > 0 ? { maxDate: untilTimestamp } : {}),
    };

    const allSms = await readSmsFromDevice(filter);

    // v15.11.2: pre-load user sender claims so the sync filter below can
    // include SMSes from brands the user has explicitly taught via the
    // SMS template tagger (wallets: TataNeu, Amazon Pay Rewards, etc.).
    // Without this, the read stage rejects wallet SMSes before the
    // parser ever sees them — the v15.11.1 parser-side fix was
    // defeated at this earlier gate.
    const userSenderClaims = await loadUserSenderClaims();

    // Filter to bank SMS only (plus user-claimed senders)
    let bankSms = allSms.filter((sms) => {
      if (isBankSender(sms.address)) return true;
      if (looksLikeTransaction(sms.body)) return true;
      if (matchesAnyUserSenderPattern(sms.address, userSenderClaims)) return true;
      return false;
    });

    // If maxDate isn't supported by the native module, filter in JS
    if (untilTimestamp > 0) {
      bankSms = bankSms.filter((sms) => sms.date <= untilTimestamp);
    }

    // Filter by account IDs if provided
    if (accountIds && accountIds.length > 0) {
      // Fetch account_identifier values for the selected account IDs
      const allAccounts = await getActiveAccounts(DEFAULT_USER_ID);
      const selectedAccounts = allAccounts.filter((acc: FinancialAccount) => accountIds.includes(acc.id));
      
      // Group accounts by type for different matching logic
      const pensionAccounts = selectedAccounts.filter((acc) => acc.account_type === "pension");
      const otherAccounts = selectedAccounts.filter((acc) => acc.account_type !== "pension");
      
      const otherAccountIdentifiers = otherAccounts.map((acc) => acc.account_identifier);
      const pensionAccountIdentifiers = pensionAccounts.map((acc) => acc.account_identifier);

      bankSms = bankSms.filter((sms) => {
        const parsed = parseBankSMS(sms.body);
        if (!parsed) return false;
        
        // For pension accounts (EPFO), match by merchant (passbook ID) in addition to cardLast4
        // This handles cases where user manually created account with passbook ID as account_identifier
        if (parsed.bank === "EPFO" && pensionAccountIdentifiers.length > 0) {
          // Try cardLast4 first (UAN last 4 digits)
          if (parsed.cardLast4 && pensionAccountIdentifiers.includes(parsed.cardLast4)) {
            return true;
          }
          // Try merchant field (passbook ID) for accounts created with passbook ID
          if (parsed.merchant) {
            return pensionAccountIdentifiers.some((id) => 
              parsed.merchant!.includes(id) || id.includes(parsed.merchant!)
            );
          }
          return false;
        }
        
        // For other accounts, match by cardLast4 only
        if (otherAccountIdentifiers.length > 0) {
          if (!parsed.cardLast4) return false;
          return otherAccountIdentifiers.includes(parsed.cardLast4);
        }
        
        return false;
      });
    }

    return {
      messages: bankSms,
      count: bankSms.length,
      error: null,
    };
  } catch (e) {
    return {
      messages: [],
      count: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─── Public API ───

/**
 * Manual SMS scan — user taps "Scan Now".
 *
 * Reads SMS from the user-configured start date (default: 7 days ago)
 * up to the configured end date (default: today).
 *
 * Respects both the start and end date configured by the user
 * (presets or custom range). Updates the last-check timestamp so
 * subsequent automatic checks don't re-process these messages.
 *
 * @param accountIds - optional list of account IDs to filter SMS by
 */
export async function manualScan(accountIds?: string[]): Promise<FetchSMSResult> {
  const startTimestamp = getSmsStartTimestamp();
  const endTimestamp = getSmsEndTimestamp();
  const result = await fetchBankSMSRange(startTimestamp, 500, endTimestamp, accountIds);

  if (result.messages.length > 0) {
    const newestTimestamp = Math.max(...result.messages.map((m) => m.date));
    setLastSmsCheckTimestamp(newestTimestamp);
  } else if (!result.error) {
    setLastSmsCheckTimestamp(Date.now());
  }

  return result;
}

/**
 * Automatic check: reads bank SMS since last check timestamp.
 * Called by the background task (sms-listener).
 *
 * On first run (no previous check), reads from the configured start date.
 * No end date limit for automatic checks — always reads up to now.
 */
export async function checkForNewBankSMS(): Promise<FetchSMSResult> {
  const lastCheck = getLastSmsCheckTimestamp();
  const since = lastCheck > 0 ? lastCheck : getSmsStartTimestamp();

  const result = await fetchBankSMSRange(since);

  if (result.messages.length > 0) {
    const newestTimestamp = Math.max(...result.messages.map((m) => m.date));
    setLastSmsCheckTimestamp(newestTimestamp);
  } else if (!result.error) {
    setLastSmsCheckTimestamp(Date.now());
  }

  return result;
}

/**
 * Fetch bank SMS for a specific date range.
 * Used for preview / historic scans where user picks a custom date.
 */
export async function fetchBankSMSForRange(
  sinceTimestamp: number,
  maxCount: number = 500,
  untilTimestamp: number = 0,
): Promise<FetchSMSResult> {
  return fetchBankSMSRange(sinceTimestamp, maxCount, untilTimestamp);
}
