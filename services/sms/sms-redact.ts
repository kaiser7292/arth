/**
 * Hide personal details in a bank SMS before the user sends it to the developer
 * ("Help Arth read this message"). Keeps what's needed to write a parser —
 * the wording, amounts, dates — and replaces names, account/card/phone/ref
 * numbers, UPI IDs, links and balances. The user sees and can edit the result
 * before anything leaves the phone (it goes out from their own email app).
 */

import { AI_REPORT_EMAIL } from "@/services/ai-report";

/** Where SMS reports go — the same inbox as Arth AI reports. */
export const SMS_REPORT_EMAIL = AI_REPORT_EMAIL;

const NAME = "NAME";

export function redactSms(body: string): string {
  let s = body;

  // Links and UPI IDs.
  s = s.replace(/\bhttps?:\/\/\S+/gi, "https://link");
  s = s.replace(/\b[\w.-]+@[A-Za-z][\w.-]*\b/g, "upi@handle");

  // Balances: "Avl Bal INR 62,305.01", "Avl bal:INR 0.00", "Available balance Rs 1,500".
  s = s.replace(
    /((?:Avl\.?|Avail(?:able)?\.?)\s*(?:Bal(?:ance)?|Lmt|Limit)\s*:?\s*(?:is\s+)?(?:INR|Rs\.?|₹)?\s*)[\d,]+(?:\.\d+)?/gi,
    "$1X",
  );

  // Names after the phrases banks put them behind.
  s = s.replace(/(linked\s+to\s+mobile\s+)[\dX*x]+(\s*-\s*)[A-Za-z][A-Za-z .]*?(?=\s*\(|\.|,|$)/gi, `$1XXXXXXXXXX$2${NAME}`);
  s = s.replace(
    /((?:transfer(?:red)?\s+(?:from|to)|trf\s+(?:from|to)|deposit\s+by\s+transfer\s+from|(?:sent|paid|received)\s+(?:to|from)|by)\s+)(?:(?:Mr|Mrs|Ms|Shri|Smt)\.?\s*)?[A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){0,3}/g,
    `$1${NAME}`,
  );
  // HDFC "Info: … :SOURAV BAID" — the account holder after the last colon.
  s = s.replace(/(Info:[^\n]*?:)\s*[A-Za-z][A-Za-z .]*?(?=\.\s*Avl|\s+Avl|\.?\s*$)/i, `$1${NAME}`);

  // Masked account / card numbers: "XX0221", "XXXXX790006", "xxxxxxxxxx0006", "**1234".
  s = s.replace(/\b[Xx*]{2,}\d{2,}\b/g, "XXXX");
  s = s.replace(/\*{2,}\d{2,}/g, "XXXX");
  // "Card 9628", "A/c 1234", "a/c no. 1234".
  s = s.replace(/\b((?:card|a\/c|acct|account)(?:\s+no\.?)?\s+)\d{3,}\b/gi, "$1XXXX");

  // Long digit runs (refs, phone numbers, UANs) — but never an amount or a date.
  s = s.replace(/(^|[^\d.,/:])(\d{6,})(?![\d.,/:-]*\d)/g, (_m, pre: string) => `${pre}XXXXXX`);

  return s;
}

export function buildSmsReportMailto(redactedBody: string, sender: string, appVersion: string): string {
  const subject = `Arth: unrecognised SMS (${sender.replace(/^[A-Z]{2}-/, "")})`;
  const body = [
    "Arth couldn't read this bank message. Personal details are hidden.",
    "",
    redactedBody.trim(),
    "",
    `Sender: ${sender}`,
    `App version: ${appVersion}`,
  ].join("\n");
  return `mailto:${SMS_REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
