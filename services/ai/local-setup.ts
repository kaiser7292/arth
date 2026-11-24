/**
 * Onboarding's "Set up on this phone" route: on-device AI files the person's biggest
 * uncategorised merchants into their own categories, without sharing a file with anyone.
 *
 * Gemini Nano takes about 4,000 tokens a prompt, so it gets merchant names a few at a time, not
 * the transaction history; budgets and income come from the steps after (the budget step offers
 * figures from what was really spent). The answers are written as an Arth suggestions reply and
 * handed to the AI suggestions review screen, which checks each one against the data, shows it,
 * and applies only what the person ticks: the same path as a reply from Claude, ChatGPT or Gemini.
 */

import { DEFAULT_USER_ID } from "@/constants/app";
import { getCategories } from "@/services/category";
import { getUncategorizedExpenses } from "@/services/expense-queries";
import { fileMerchantsWithNano, MERCHANTS_PER_PROMPT } from "./tasks/merchant-category";

/** The biggest merchants, by money spent, that the person is asked about at most. */
export const MAX_MERCHANTS = 40;

export interface MerchantToFile {
  name: string;
  count: number;
  total: number;
}

/**
 * Uncategorised spends grouped by merchant, biggest first. Uses the review queue's own definition
 * of "uncategorised" (getUncategorizedExpenses), so the two can't disagree.
 */
export async function merchantsToFile(userId: string = DEFAULT_USER_ID, limit: number = MAX_MERCHANTS): Promise<MerchantToFile[]> {
  const rows = await getUncategorizedExpenses(userId);
  const byKey = new Map<string, MerchantToFile>();
  for (const r of rows) {
    const name = (r.merchant_name ?? "").replace(/\s+/g, " ").trim();
    if (name.length < 2) continue;
    const key = name.toLowerCase();
    const m = byKey.get(key) ?? { name, count: 0, total: 0 };
    m.count++;
    m.total += r.amount;
    byKey.set(key, m);
  }
  return [...byKey.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

/** Spending categories the model may pick from: active, by name. */
async function categoryNames(userId: string): Promise<string[]> {
  const cats = await getCategories(userId);
  return [...new Set(cats.map((c) => c.name.trim()).filter((n) => n.length > 0 && !/^uncategori[sz]ed$/i.test(n)))];
}

export interface LocalSetupProgress {
  done: number;
  total: number;
  filed: number;
  /** The merchant just filed, for a live list. */
  latest?: { merchant: string; category: string };
}

export interface LocalSetupResult {
  /** An Arth suggestions reply, ready for the review screen; null when nothing was filed. */
  reply: string | null;
  filed: number;
  asked: number;
  /** Batches the model didn't answer. */
  failedBatches: number;
}

/** Pure: filed merchants -> the reply text the review screen reads. Exported for tests. */
export function buildLocalReply(filed: Map<string, string>): string | null {
  if (filed.size === 0) return null;
  const suggestions = [...filed].map(([merchant, category]) => ({
    type: "merchant_category",
    merchant,
    category,
    why: "On-device AI, from the merchant's name",
  }));
  return JSON.stringify({ suggestions });
}

export async function runLocalSetup(
  onProgress?: (p: LocalSetupProgress) => void,
  shouldStop?: () => boolean,
  userId: string = DEFAULT_USER_ID,
): Promise<LocalSetupResult> {
  const [merchants, categories] = await Promise.all([merchantsToFile(userId), categoryNames(userId)]);
  const filed = new Map<string, string>();
  let done = 0;
  let failedBatches = 0;
  onProgress?.({ done, total: merchants.length, filed: 0 });
  for (let i = 0; i < merchants.length; i += MERCHANTS_PER_PROMPT) {
    if (shouldStop?.()) break;
    const batch = merchants.slice(i, i + MERCHANTS_PER_PROMPT).map((m) => m.name);
    try {
      const answers = await fileMerchantsWithNano(batch, categories);
      for (const [merchant, category] of answers) {
        filed.set(merchant, category);
        onProgress?.({ done, total: merchants.length, filed: filed.size, latest: { merchant, category } });
      }
    } catch {
      failedBatches++;
      // Two batches without an answer and nothing filed yet: the model isn't working right now.
      if (failedBatches >= 2 && filed.size === 0) break;
    }
    done += batch.length;
    onProgress?.({ done, total: merchants.length, filed: filed.size });
  }
  return { reply: buildLocalReply(filed), filed: filed.size, asked: merchants.length, failedBatches };
}

// ─── Handing the reply to the review screen ──────────────────────────────────
// Too big for a route param; held here for the one screen that takes it.

let handoff: string | null = null;

export function setLocalReply(reply: string): void {
  handoff = reply;
}

/** Single-use: the review screen takes it once. */
export function takeLocalReply(): string | null {
  const r = handoff;
  handoff = null;
  return r;
}
