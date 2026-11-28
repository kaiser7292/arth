/**
 * Which of the person's categories a merchant belongs in (docs/GEMINI_NANO_PROPOSAL.md §6.3),
 * for onboarding's "Set up on this phone" route.
 *
 * Merchants go to the model a few at a time, with the person's own category names. An answer is
 * kept only when it names one of those categories exactly (ignoring case); anything else, or
 * "unsure", leaves the merchant for later. The answers then go through the same checks, review
 * screen and apply step as an AI assistant's reply (services/ai-suggestions.ts), so nothing
 * changes until the person approves it.
 */

import { askNano, extractJsonObject } from "../nano";

export const MERCHANTS_PER_PROMPT = 8;

export function buildMerchantCategoryPrompt(merchants: string[], categories: string[]): string {
  return [
    "You sort Indian bank transactions into spending categories. Reply with one JSON object and nothing else.",
    "For each numbered merchant, give the one category it belongs in, using a name from the list exactly as written.",
    'If you can\'t tell from the name, say "unsure". Never make up a category.',
    "",
    `Categories: ${categories.join(" | ")}`,
    "",
    'Example: {"1":"Food","2":"unsure"}',
    "",
    ...merchants.map((m, i) => `${i + 1}. ${m.replace(/\s+/g, " ").trim().slice(0, 60)}`),
    "",
    "JSON:",
  ].join("\n");
}

/** Read and check the answer. Pure. Returns merchant -> category (the category's real name). */
export function checkMerchantCategoryAnswer(answer: string, merchants: string[], categories: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const obj = extractJsonObject(answer);
  if (!obj) return out;
  const byLower = new Map(categories.map((c) => [c.toLowerCase().trim(), c]));
  merchants.forEach((m, i) => {
    const v = obj[String(i + 1)];
    if (typeof v !== "string") return;
    const real = byLower.get(v.toLowerCase().trim());
    if (real) out.set(m, real);
  });
  return out;
}

/** Ask the model about one batch. Throws when the model can't be asked. */
export async function fileMerchantsWithNano(merchants: string[], categories: string[]): Promise<Map<string, string>> {
  if (merchants.length === 0 || categories.length === 0) return new Map();
  const answer = await askNano(buildMerchantCategoryPrompt(merchants, categories), { maxOutputTokens: 160, timeoutMs: 15000 });
  return checkMerchantCategoryAnswer(answer.text, merchants, categories);
}
