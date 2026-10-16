/**
 * Merchants, one place: the names a merchant appears under in bank messages (merchant_aliases)
 * and the category it's filed under (merchant rules / learned corrections), together.
 *
 * Read-only joins over existing services - the writes stay in merchant-alias.ts and
 * merchant-categories.ts. Used by app/settings/merchants.tsx and merchant-detail.tsx.
 */

import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getDistinctMerchantNames, getMerchantAliases } from "@/services/merchant-alias";
import {
  LEARNED_THRESHOLD,
  listLearnedMerchants,
  listMerchantRules,
  normalizeKeyword,
  pickRule,
  type LearnedMerchant,
  type MerchantRule,
} from "@/services/merchant-categories";

export interface MerchantName {
  /** merchant_aliases.id, or null for a name with no alias row (used as-is). */
  aliasId: string | null;
  smsName: string;
}

export interface MerchantSummary {
  /** The name it's shown under. */
  name: string;
  /** Names in bank messages that show as this merchant (always at least one). */
  names: MerchantName[];
  /** Transactions under this name (not deleted). */
  txCount: number;
  /** Where its new transactions get filed, if anywhere. */
  category: string | null;
  /** "rule" = a merchant rule (built-in or yours); "learned" = from your corrections. */
  categorySource: "rule" | "learned" | null;
  rule: MerchantRule | null;
  learned: LearnedMerchant | null;
}

export async function listMerchants(userId: string = DEFAULT_USER_ID): Promise<MerchantSummary[]> {
  const db = getDatabase();
  const [aliases, names, rules, learned, counts] = await Promise.all([
    getMerchantAliases(userId),
    getDistinctMerchantNames(userId),
    listMerchantRules(userId),
    listLearnedMerchants(userId),
    db.getAllAsync<{ name: string; n: number }>(
      `SELECT LOWER(merchant_name) AS name, COUNT(*) AS n FROM expenses
       WHERE user_id = ? AND deleted_at IS NULL AND merchant_name IS NOT NULL AND merchant_name != ''
       GROUP BY LOWER(merchant_name);`,
      userId,
    ),
  ]);

  const byName = new Map<string, MerchantSummary>();
  const ensure = (name: string): MerchantSummary => {
    const key = name.toLowerCase();
    let m = byName.get(key);
    if (!m) {
      m = { name, names: [], txCount: 0, category: null, categorySource: null, rule: null, learned: null };
      byName.set(key, m);
    }
    return m;
  };
  const covered = new Set<string>();
  for (const a of aliases) {
    const m = ensure(a.canonical_name);
    m.names.push({ aliasId: a.id, smsName: a.sms_name });
    covered.add(a.sms_name.toLowerCase());
    covered.add(a.canonical_name.toLowerCase());
  }
  for (const n of names) {
    if (covered.has(n.toLowerCase())) continue;
    ensure(n).names.push({ aliasId: null, smsName: n });
  }

  const countMap = new Map(counts.map((c) => [c.name, c.n]));
  const activeRules = rules.filter((r) => r.isActive && !r.categoryMissing);
  const learnedByKey = new Map(learned.filter((l) => l.count >= LEARNED_THRESHOLD).map((l) => [l.keyword, l]));

  for (const m of byName.values()) {
    m.txCount = countMap.get(m.name.toLowerCase()) ?? 0;
    // Merchant rules outrank learned corrections when filing, so they win here too.
    const rule = pickRule(activeRules, m.name);
    if (rule) {
      m.rule = rule;
      m.category = rule.categoryName;
      m.categorySource = "rule";
      continue;
    }
    const l = learnedByKey.get(normalizeKeyword(m.name));
    if (l && l.categoryName) {
      m.learned = l;
      m.category = l.categoryName;
      m.categorySource = "learned";
    }
  }

  return [...byName.values()].sort((a, b) => b.txCount - a.txCount || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

export async function getMerchant(name: string, userId: string = DEFAULT_USER_ID): Promise<MerchantSummary | null> {
  const all = await listMerchants(userId);
  return all.find((m) => m.name.toLowerCase() === name.toLowerCase()) ?? null;
}
