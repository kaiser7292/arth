/**
 * What kind of account is this? For onboarding's balances step, when Arth's keyword count can't
 * tell (getAccountTypeDoubts says "not sure"): on-device AI reads a few of the account's own
 * messages and names the type.
 *
 * The model only proposes, and only from the types that step offers. The answer is kept only when
 * the messages carry a word for that type (a card is called a card, a wallet a wallet), so it
 * can't make one up. It's shown as a suggestion; nothing changes until the person taps it.
 */

import { getDatabase } from "@/database";
import { askNano, extractJsonObject } from "../nano";

export const GUESS_TYPES = ["savings", "credit_card", "wallet"] as const;
export type GuessType = (typeof GUESS_TYPES)[number];

/** The words that show a type is written in the messages, not guessed. */
const TYPE_WORDS: Record<GuessType, RegExp> = {
  savings: /\ba\/c\b|\bacct\b|\baccount\b|\bsavings\b|\bsb\b/i,
  credit_card: /\bcredit\s*card\b|\bcard\b/i,
  wallet: /\bwallet\b|paytm|phonepe|amazon\s*pay|mobikwik|freecharge|pluxee|sodexo/i,
};

const MAX_SAMPLES = 3;
const MAX_SAMPLE_CHARS = 300;

export function buildAccountTypePrompt(samples: string[], bank: string, digits: string | null): string {
  return [
    "You read Indian bank, card and wallet SMS. Reply with one JSON object and nothing else.",
    `These messages are about one of the user's accounts${bank ? ` at ${bank}` : ""}${digits ? `, the one ending ${digits}` : ""}.`,
    'Which kind is it? "type": savings (a bank account: savings or current), credit_card, wallet, or unsure.',
    "A debit card belongs to a bank account, so it is savings. Say unsure if the messages don't make it clear.",
    "",
    ...samples.map((m, i) => `SMS ${i + 1}: ${m.replace(/\s+/g, " ").trim().slice(0, MAX_SAMPLE_CHARS)}`),
    "",
    "JSON:",
  ].join("\n");
}

/** Read and check the answer. Pure. */
export function checkAccountTypeAnswer(answer: string, samples: string[]): GuessType | null {
  const obj = extractJsonObject(answer);
  const t = typeof obj?.type === "string" ? obj.type.toLowerCase().replace(/[\s-]+/g, "_") : "";
  const type = (t === "bank" || t === "current" ? "savings" : t) as GuessType;
  if (!(GUESS_TYPES as readonly string[]).includes(type)) return null;
  const text = samples.join("\n");
  if (!TYPE_WORDS[type].test(text)) return null;
  // "Debit card" is a bank account's card, never a credit card.
  if (type === "credit_card" && !/credit\s*card/i.test(text) && /debit\s*card/i.test(text)) return null;
  return type;
}

/** The account's newest messages (as the doubt check reads them). */
export async function accountSamples(accountId: string): Promise<string[]> {
  const rows = await getDatabase().getAllAsync<{ raw_source_text: string }>(
    `SELECT raw_source_text FROM expenses
      WHERE account_id = ? AND raw_source_text IS NOT NULL AND deleted_at IS NULL
      ORDER BY date DESC LIMIT ?;`,
    accountId,
    MAX_SAMPLES,
  );
  return rows.map((r) => r.raw_source_text).filter((t) => t.trim().length > 0);
}

/** Ask the model. Null when it isn't sure, can't be asked, or its answer doesn't hold up. */
export async function guessAccountType(accountId: string, bank: string, digits: string | null): Promise<GuessType | null> {
  const samples = await accountSamples(accountId);
  if (samples.length === 0) return null;
  const answer = await askNano(buildAccountTypePrompt(samples, bank, digits), { maxOutputTokens: 20 });
  return checkAccountTypeAnswer(answer.text, samples);
}
