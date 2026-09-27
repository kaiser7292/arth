/**
 * Clean, non-repetitive labels for upcoming dues (forecasts).
 *
 * SMS due reminders used to be described as "<merchant> via <bank> (<type>)", but for reminders
 * the parser's "merchant" is itself a generic phrase that already names the bank and the kind of
 * due, so the stored text repeated itself:
 *   "Credit Card Amount Due via HDFC Bank (Amount Due)"  ->  "HDFC credit card bill"
 *   "ICICI Credit Card Due via ICICI Bank (Amount Due)"  ->  "ICICI credit card bill"
 *   "EMI Payment via Axis Bank (EMI Due)"                ->  "Axis EMI"
 *   "Netflix via ICICI Bank (Upcoming SI)"               ->  "Netflix via ICICI Bank"
 *
 * Pure. Used when a forecast is created from an SMS and again when a due is displayed, so rows
 * stored before this existed read cleanly too.
 */

/** "HDFC Bank" -> "HDFC", "IDFC First Bank" -> "IDFC First". */
export function shortBank(bank: string): string {
  return bank.replace(/\s+bank$/i, "").trim();
}

const CARD_DUE = /^(?:(.+?)\s+)?credit\s*card\s*(?:amount\s*|total\s*|payment\s*|bill\s*)?(?:due|bill)$/i;
const GENERIC_EMI = /^(?:emi\s*payment|emi\s*due|emi)$/i;

export function cleanDueLabel(text: string | null | undefined): string {
  let t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "Upcoming payment";

  // Drop a trailing "(Type)": on a dues list "Amount Due" / "EMI Due" / "Upcoming SI" add
  // nothing, and most of the time they repeat the name. Then peel off " via Bank".
  t = t.replace(/\s*\([^()]+\)$/, "").trim();
  let bank: string | null = null;
  const vm = t.match(/^(.*?)\s+via\s+(.+)$/i);
  if (vm) {
    t = vm[1].trim();
    bank = vm[2].trim();
  }

  const card = t.match(CARD_DUE);
  if (card) {
    const who = card[1] ? card[1].trim() : bank ? shortBank(bank) : "";
    return who ? `${who} credit card bill` : "Credit card bill";
  }
  if (GENERIC_EMI.test(t)) {
    return bank ? `${shortBank(bank)} EMI` : "EMI";
  }

  // Keep "via Bank" only when the name doesn't already say which bank.
  const bankWord = bank ? shortBank(bank).split(" ")[0].toLowerCase() : "";
  const head = bank && !t.toLowerCase().includes(bankWord) ? `${t} via ${bank}` : t;
  return head || "Upcoming payment";
}

/**
 * "••4521" for a due, so two bills from the same bank can be told apart. Prefers the linked
 * account's identifier; falls back to the card digits in the reminder SMS ("ending 4521",
 * "XX4521", "**4521").
 */
export function dueCardSuffix(
  accountIdentifier: string | null | undefined,
  rawText: string | null | undefined,
): string | null {
  const fromAccount = (accountIdentifier ?? "").replace(/\D/g, "");
  if (fromAccount.length >= 4) return `••${fromAccount.slice(-4)}`;
  const m = (rawText ?? "").match(/(?:ending(?:\s+(?:in|with))?|[xX*]{2,})\s*:?\s*(\d{4})\b/);
  return m ? `••${m[1]}` : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * When a due falls, the way the Reminders card says it: "Due today", "Due tomorrow",
 * "Due in 4 days · 30 Sep", "Overdue by 2 days". Both dates are local YYYY-MM-DD.
 */
export function dueWhen(dueDate: string, today: string): { text: string; overdue: boolean } {
  const day = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  const diff = day(dueDate) - day(today);
  const [, mm, dd] = dueDate.slice(0, 10).split("-").map(Number);
  const short = `${dd} ${MONTHS[mm - 1]}`;
  if (diff < 0) return { text: `Overdue by ${-diff} day${diff === -1 ? "" : "s"} · ${short}`, overdue: true };
  if (diff === 0) return { text: "Due today", overdue: false };
  if (diff === 1) return { text: "Due tomorrow", overdue: false };
  return { text: `Due in ${diff} days · ${short}`, overdue: false };
}
