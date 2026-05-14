export {
  hasSmsPermission,
  requestSmsPermission,
  enableSmsDetection,
  disableSmsDetection,
  isSmsDetectionEnabled,
  setSmsDetectionEnabled,
  isSmsAutoEnabled,
  setSmsAutoEnabled,
  hasAskedSmsPermission,
  getLastSmsCheckTimestamp,
  setLastSmsCheckTimestamp,
  getSmsStartDate,
  setSmsStartDate,
  getSmsStartTimestamp,
  getSmsEndDate,
  setSmsEndDate,
  getSmsEndTimestamp,
  getLastAutoScanRun,
  setLastAutoScanRun,
} from "./sms-permissions";

export {
  manualScan,
  checkForNewBankSMS,
  fetchBankSMSForRange,
} from "./sms-reader";
export type { RawSMS, FetchSMSResult } from "./sms-reader";

// Removed in v11.1.9: sms-listener (the ARTHA_SMS_CHECK background task).
// Replaced by runSmsScan() called from app startup + manual button.
// See cleanupLegacyScheduledScan() in app/_layout.tsx for the one-time
// OS-level task unregister.

export {
  isBankSender,
  identifyBank,
  looksLikeTransaction,
  BANK_SENDERS,
  BANK_SENDER_CODES,
} from "./bank-senders";
export type { BankSender } from "./bank-senders";

export { parseBankSMS, BANK_PATTERNS } from "./bank-patterns";
export type { ParsedSMS, TransactionType, BankPattern } from "./bank-patterns";

export {
  parseSmsBatch,
  getPendingSmsEntries,
  getPendingSmsCount,
  getAllSmsRecords,
  getSmsLinkedExpenseInfo,
  deleteSmsRecord,
  deleteAllSmsRecords,
  markSmsProcessed,
  markSmsFailed,
  markSmsIgnored,
} from "./sms-parser";
export type { ParseResult, ParsedItem } from "./sms-parser";

export {
  createExpenseFromSms,
  processParseResults,
} from "./sms-to-expense";
export type { SmsExpenseResult } from "./sms-to-expense";

export { runSmsScan, SCAN_COOLDOWN_MS } from "./sms-orchestrator";
export type { ScanOutcome } from "./sms-orchestrator";
