/**
 * Adding a message the AI read to Arth, from the AI lab: the user saw the reading, judged it
 * right, and taps "Add to Catch Up".
 *
 * It goes through exactly the path a built-in bank pattern's reading takes (enrichParsedSms, then
 * processParseResults), so it gets the same ignored-account check, duplicate detection, account
 * linking, Smart Rules and own-transfer pairing, and lands in Catch Up as a pending detection the
 * user still approves. Phase 1 of docs/GEMINI_NANO_PROPOSAL.md does the same for every scan.
 */

import { DEFAULT_USER_ID } from "@/constants/app";
import type { ParsedSMS } from "@/services/sms/bank-patterns";
import { identifyBank } from "@/services/sms/bank-senders";
import { enrichParsedSms } from "@/services/sms/sms-parser";
import { processParseResults } from "@/services/sms/sms-to-expense";
import { formatLocalDate } from "@/utils/fiscal-year";
import type { MapAccount } from "./money-map";
import type { AiReadSms, Channel } from "./tasks/read-sms";

const ACCOUNT_TYPE: Record<string, ParsedSMS["accountType"]> = {
  savings: "savings",
  "credit card": "credit_card",
  loan: "loan",
  wallet: "wallet",
  "EPF/pension": "pension",
};

function paymentMode(channel: Channel | null, account: MapAccount | undefined, auto: boolean): ParsedSMS["paymentMode"] {
  if (auto) return "auto_debit";
  switch (channel) {
    case "card":
      return account?.kind === "credit card" ? "credit_card" : "debit_card";
    case "upi":
      return "upi";
    case "netbanking":
    case "neft":
    case "imps":
    case "rtgs":
      return "net_banking";
    case "wallet":
      return "wallet";
    case "nach":
      return "auto_debit";
    default:
      return account?.kind === "credit card" ? "credit_card" : null;
  }
}

/** Pure: an AI reading -> the same shape a bank pattern produces. */
export function aiReadToParsed(r: AiReadSms, sender: string, smsDate: number): ParsedSMS {
  // The user's own account the money moved on, and the other side when it's theirs too.
  const own = (r.type === "credit" ? r.to : r.from)?.account;
  const other = (r.type === "credit" ? r.from : r.to)?.account;
  const moved = r.event === "own_transfer" || r.event === "card_payment" || r.event === "fd_open" || r.event === "fd_close";
  return {
    amount: r.amount,
    merchant: r.merchant,
    cardLast4: r.last4 ?? own?.digits ?? null,
    date: formatLocalDate(new Date(smsDate)),
    bank: own?.name ?? identifyBank(sender)?.bank ?? "Unknown",
    type: r.type,
    skip: false,
    confidence: 0.6,
    dueDate: null,
    isForecast: false,
    upiRef: r.ref,
    availableBalance: r.balance,
    accountType: own ? (ACCOUNT_TYPE[own.kind] ?? null) : null,
    paymentMode: paymentMode(r.channel, own, r.auto != null && r.auto.sure),
    transactionTime: r.time ? `${r.time}:00` : null,
    fdEvent: r.event === "fd_open" ? "open" : r.event === "fd_close" ? "closure" : null,
    declaredTransfer: moved && other != null ? true : undefined,
    counterpartyAcctLast4: moved ? (other?.digits ?? null) : null,
  };
}

/**
 * Add one AI-read message (a pending_sms row) as a pending transaction. Returns the new
 * transaction's id, or null when Arth didn't add one (ignored account, before the start date,
 * a duplicate it already has).
 */
export async function addAiReadToCatchUp(
  pendingSmsId: string,
  r: AiReadSms,
  body: string,
  sender: string,
  smsDate: number,
): Promise<{ expenseId: string | null; error: string | null }> {
  const parsed = enrichParsedSms(aiReadToParsed(r, sender, smsDate), body);
  const res = await processParseResults(DEFAULT_USER_ID, [{ pendingSmsId, parsed, rawBody: body, smsDate }]);
  return { expenseId: res.itemResults[0]?.expenseId ?? null, error: res.errors[0] ?? null };
}
