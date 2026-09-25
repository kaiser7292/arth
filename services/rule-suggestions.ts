import { getDatabase } from "@/database";
import { categorizeByMerchant } from "@/services/smart-categorizer";
import { createRule, getActiveRules } from "@/services/smart-rules";
import type { SmartRule } from "@/services/smart-rules";
import { settingsStorage } from "@/services/storage";

/**
 * "You've filed Swiggy as Food 7 times. Make it automatic?"
 *
 * A suggestion is a merchant the user keeps filing under the same category, with no Smart Rule
 * covering it yet, and that the built-in auto-categorization doesn't already get right. Dismissals are device-local (MMKV) — a lost dismissal only means the card
 * comes back once, so it isn't worth a table.
 */

export interface RuleSuggestion {
  /** Lower-cased, trimmed merchant — the identity of the suggestion. */
  key: string;
  /** Merchant as the user sees it. */
  merchant: string;
  categoryId: string;
  count: number;
  total: number;
}

const DISMISSED_KEY = "rule_suggestions_dismissed";
const LOOKBACK_DAYS = 180;
export const MIN_OCCURRENCES = 4;
/** Share of the merchant's spend that must be in one category for it to count as a habit. */
export const MIN_SHARE = 0.8;

export interface MerchantCategoryRow {
  mkey: string;
  merchant: string;
  category_id: string;
  n: number;
  total: number;
}

function loadDismissed(): Set<string> {
  try {
    const raw = settingsStorage.getString(DISMISSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function dismissRuleSuggestion(key: string): void {
  const set = loadDismissed();
  set.add(key);
  settingsStorage.set(DISMISSED_KEY, JSON.stringify([...set]));
}

/** True when an active rule already sets a category for this merchant. */
export function isCoveredByRule(key: string, rules: SmartRule[]): boolean {
  return rules.some(
    (r) =>
      r.actions.some((a) => a.type === "category") &&
      r.conditions.some(
        (c) =>
          c.field === "merchant" &&
          typeof c.value === "string" &&
          c.value.trim() !== "" &&
          (key.includes(c.value.toLowerCase().trim()) || c.value.toLowerCase().trim().includes(key)),
      ),
  );
}

/** Pure: turn per-(merchant, category) counts into suggestions. */
export function pickSuggestions(
  rows: MerchantCategoryRow[],
  rules: SmartRule[],
  dismissed: ReadonlySet<string>,
): RuleSuggestion[] {
  const byMerchant = new Map<string, MerchantCategoryRow[]>();
  for (const r of rows) {
    const list = byMerchant.get(r.mkey) ?? [];
    list.push(r);
    byMerchant.set(r.mkey, list);
  }
  const out: RuleSuggestion[] = [];
  for (const [key, list] of byMerchant) {
    if (dismissed.has(key) || isCoveredByRule(key, rules)) continue;
    const all = list.reduce((s, r) => s + r.n, 0);
    const top = list.reduce((a, b) => (b.n > a.n ? b : a));
    if (top.n < MIN_OCCURRENCES || top.n / all < MIN_SHARE) continue;
    out.push({ key, merchant: top.merchant, categoryId: top.category_id, count: top.n, total: top.total });
  }
  return out.sort((a, b) => b.count - a.count);
}

export async function getRuleSuggestions(userId: string): Promise<RuleSuggestion[]> {
  const db = getDatabase();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().split("T")[0];
  const rows = await db.getAllAsync<MerchantCategoryRow>(
    `SELECT LOWER(TRIM(merchant_name)) AS mkey, MAX(TRIM(merchant_name)) AS merchant,
            category_id, COUNT(*) AS n, SUM(amount) AS total
       FROM expenses
      WHERE user_id = ? AND status = 'approved' AND nature = 'realized' AND deleted_at IS NULL
        AND merchant_name IS NOT NULL AND TRIM(merchant_name) != ''
        AND category_id IS NOT NULL AND date >= ?
      GROUP BY mkey, category_id;`,
    userId,
    since,
  );
  const rules = await getActiveRules();
  const candidates = pickSuggestions(rows, rules, loadDismissed());
  return dropAlreadyAutomatic(candidates, async (merchant) =>
    (await categorizeByMerchant(userId, merchant)).categoryId,
  );
}

/**
 * Drop merchants Arth already files automatically. The smart categorizer (built-in keyword list
 * of 200+ Indian merchants, the merchant-brand registry, and mappings learned from the user's
 * own corrections) runs on every new SMS transaction; if it already picks the suggested
 * category, a Smart Rule would change nothing - "Swiggy -> Food" is noise.
 */
export async function dropAlreadyAutomatic(
  suggestions: RuleSuggestion[],
  autoCategoryFor: (merchant: string) => Promise<string | null>,
): Promise<RuleSuggestion[]> {
  const keep: RuleSuggestion[] = [];
  for (const s of suggestions) {
    let auto: string | null = null;
    try {
      auto = await autoCategoryFor(s.merchant);
    } catch {
      // If the lookup fails, err on the side of still suggesting.
    }
    if (auto !== s.categoryId) keep.push(s);
  }
  return keep;
}

/** Creates "Merchant → Category" (merchant contains X, applies to debits). */
export async function createRuleFromSuggestion(s: RuleSuggestion, categoryName: string): Promise<string> {
  return createRule({
    name: `${s.merchant} → ${categoryName}`,
    match_mode: "all",
    applies_to: "expense",
    conditions: [{ field: "merchant", operator: "contains", value: s.merchant }],
    actions: [{ type: "category", category_id: s.categoryId }],
  });
}
