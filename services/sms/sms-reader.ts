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

import { Platform } from "react-native";
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
  /** Total raw SMS returned by the native module (before bank filtering). */
  rawCount: number;
  /** Oldest timestamp among ALL raw SMS (before filtering). Used for pagination. */
  oldestRawTimestamp: number;
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
 */
async function fetchBankSMSRange(
  sinceTimestamp: number,
  maxCount: number = 500,
  untilTimestamp: number = 0,
): Promise<FetchSMSResult> {
  if (Platform.OS !== "android") {
    return { messages: [], count: 0, rawCount: 0, oldestRawTimestamp: 0, error: "SMS reading is Android-only" };
  }

  const hasPermission = await hasSmsPermission();
  if (!hasPermission) {
    return { messages: [], count: 0, rawCount: 0, oldestRawTimestamp: 0, error: "SMS permission not granted" };
  }

  try {
    const filter: Record<string, unknown> = {
      box: "inbox",
      maxCount,
      ...(sinceTimestamp > 0 ? { minDate: sinceTimestamp } : {}),
      ...(untilTimestamp > 0 ? { maxDate: untilTimestamp } : {}),
    };

    const allSms = await readSmsFromDevice(filter);
    const rawCount = allSms.length;
    const oldestRawTimestamp = rawCount > 0
      ? Math.min(...allSms.map((m) => m.date))
      : 0;

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

    // Account filtering removed in v17.6.6 — moved to the orchestrator
    // (sms-orchestrator.ts) so that user templates get a chance to match
    // before any account-based filtering discards SMS.

    return {
      messages: bankSms,
      count: bankSms.length,
      rawCount,
      oldestRawTimestamp,
      error: null,
    };
  } catch (e) {
    return {
      messages: [],
      count: 0,
      rawCount: 0,
      oldestRawTimestamp: 0,
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
 * Uses pagination (500 per batch, oldest-first via shrinking the window)
 * so that long date ranges (e.g. 2 years) aren't silently truncated by
 * the native module's maxCount cap.
 */
export async function manualScan(): Promise<FetchSMSResult> {
  const startTimestamp = getSmsStartTimestamp();
  const endTimestamp = getSmsEndTimestamp();

  const allMessages: RawSMS[] = [];
  let currentEnd = endTimestamp;
  const MAX_BATCHES = 20;

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const result = await fetchBankSMSRange(startTimestamp, 500, currentEnd);
    if (result.error) {
      return { messages: allMessages, count: allMessages.length, rawCount: 0, oldestRawTimestamp: 0, error: result.error };
    }
    if (result.rawCount === 0) break;

    allMessages.push(...result.messages);

    // Use rawCount (pre-filter) to decide if the native module hit its cap.
    // If raw < 500, the inbox is exhausted for this window regardless of
    // how many passed the bank filter.
    if (result.rawCount < 500) break;

    // Shrink window using the oldest timestamp from the FULL raw batch
    // (not just filtered results). This correctly pages past non-bank SMS.
    currentEnd = result.oldestRawTimestamp - 1;
    if (currentEnd <= startTimestamp) break;
  }

  // Deduplicate by SMS _id (batches may overlap at boundaries)
  const seen = new Set<string>();
  const deduped = allMessages.filter((m) => {
    if (seen.has(m._id)) return false;
    seen.add(m._id);
    return true;
  });

  if (deduped.length > 0) {
    const newestTimestamp = Math.max(...deduped.map((m) => m.date));
    setLastSmsCheckTimestamp(newestTimestamp);
  } else {
    setLastSmsCheckTimestamp(Date.now());
  }

  return { messages: deduped, count: deduped.length, rawCount: deduped.length, oldestRawTimestamp: 0, error: null };
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
