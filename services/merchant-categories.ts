/**
 * Merchant → category rules the user can see and change (Settings → Merchant categories).
 *
 * Arth ships ~300 built-in keyword rules (database/defaults/merchant-mappings.ts, seeded into
 * `merchant_mappings`) and learns from repeated corrections (`merchant_corrections`). This
 * service exposes both so a user can change a built-in ("swiggy" → Dining), turn one off, add
 * their own, reset to the built-in, and undo what Arth learned.
 *
 * Categorization order (smart-categorizer.ts): Smart Rules override everything → learned
 * corrections (3+) → these keyword rules (longest keyword wins) → brand registry.
 * Setting a rule here clears any learned correction for the same keyword, so the user's
 * explicit choice isn't shadowed by an older habit.
 *
 * Rules point at a category by NAME. renameCategoryInMerchantRules keeps them pointing at a
 * renamed category; rules whose category is gone show `categoryMissing` so the user can move them.
 */
import { DEFAULT_USER_ID } from "@/constants/app";
import { getDatabase } from "@/database";
import { BUILT_IN_MERCHANT_MAPPINGS } from "@/database/defaults/merchant-mappings";
import { bumpDataVersion } from "@/services/settings";
import { keywordMatches, normalizeMerchant, type MatchMode } from "@/services/smart-categorizer";
import { generateUUID } from "@/utils/uuid";

export type MerchantRuleSource = "builtin" | "edited" | "custom";

export interface MerchantRule {
  keyword: string;
  /** "word" rules (store brands from OpenStreetMap) only match whole words. */
  matchMode: MatchMode;
  categoryName: string;
  isActive: boolean;
  source: MerchantRuleSource;
  /** The built-in category, when this keyword ships with Arth. */
  builtInCategory: string | null;
  /** No active category with this name, so the rule can't file anything. */
  categoryMissing: boolean;
}

export interface LearnedMerchant {
  id: string;
  keyword: string;
  categoryId: string;
  categoryName: string | null;
  count: number;
}

/** Learned corrections only take effect at this count (smart-categorizer LEARNING_THRESHOLD). */
export const LEARNED_THRESHOLD = 3;

const BUILT_IN = new Map(BUILT_IN_MERCHANT_MAPPINGS.map((m) => [m.keyword, m.categoryName]));

export function normalizeKeyword(input: string): string {
  return normalizeMerchant(input).replace(/\s+/g, " ");
}

/**
 * Turn an SMS merchant string into a keyword worth saving as a rule: drop payment-gateway prefixes
 * ("RSP*", "PYU*", "CAS*", "IND*"), trailing numbers (pincodes, terminal IDs) and corporate suffixes,
 * so "RSP*KAURS KITCHEN 560102" becomes "kaurs kitchen", not a rule that only ever matches itself.
 */
export function keywordFromMerchant(merchant: string): string {
  let k = normalizeKeyword(merchant);
  k = k.replace(/^[a-z]{2,5}\*\s*/, "");
  k = k.replace(/(\s+[\d-]+)+$/, "");
  return normalizeKeyword(k);
}

async function activeCategoryNames(userId: string): Promise<Set<string>> {
  const rows = await getDatabase().getAllAsync<{ name: string }>(
    "SELECT name FROM categories WHERE user_id = ? AND is_active = 1;",
    userId,
  );
  return new Set(rows.map((r) => r.name));
}

export async function listMerchantRules(userId: string = DEFAULT_USER_ID): Promise<MerchantRule[]> {
  const rows = await getDatabase().getAllAsync<{ keyword: string; category_name: string; is_active: number; match_mode: string | null }>(
    "SELECT keyword, category_name, is_active, match_mode FROM merchant_mappings ORDER BY keyword;",
  );
  const names = await activeCategoryNames(userId);
  return rows.map((r) => {
    const builtInCategory = BUILT_IN.get(r.keyword) ?? null;
    const source: MerchantRuleSource =
      builtInCategory == null ? "custom" : builtInCategory === r.category_name && r.is_active === 1 ? "builtin" : "edited";
    return {
      keyword: r.keyword,
      matchMode: r.match_mode === "word" ? "word" : "contains",
      categoryName: r.category_name,
      isActive: r.is_active === 1,
      source,
      builtInCategory,
      categoryMissing: !names.has(r.category_name),
    };
  });
}

/** The rule that covers this merchant (longest matching keyword, switched on or off), or null. */
export function pickRule(rules: MerchantRule[], merchant: string): MerchantRule | null {
  const normalized = normalizeKeyword(merchant);
  if (!normalized) return null;
  let best: MerchantRule | null = null;
  for (const r of rules) {
    if (keywordMatches(normalized, r.keyword, r.matchMode) && (!best || r.keyword.length > best.keyword.length)) best = r;
  }
  return best;
}

export async function findRuleForMerchant(merchant: string): Promise<MerchantRule | null> {
  return pickRule(await listMerchantRules(), merchant);
}

/**
 * The keyword "Always file this merchant as …" should change: the rule that covers the merchant
 * today (so "always file Swiggy" moves every Swiggy, not one SMS spelling), or a clean keyword
 * from the merchant name when nothing covers it.
 */
export async function keywordForAlwaysFile(merchant: string): Promise<string> {
  return (await findRuleForMerchant(merchant))?.keyword ?? keywordFromMerchant(merchant);
}

/** Add or change a rule. Clears a learned correction for the same keyword so this choice wins. */
export async function setMerchantRule(merchantOrKeyword: string, categoryName: string): Promise<string> {
  const keyword = normalizeKeyword(merchantOrKeyword);
  if (keyword.length < 2) throw new Error("Enter at least 2 characters of the merchant name.");
  const db = getDatabase();
  await db.runAsync(
    `INSERT INTO merchant_mappings (id, keyword, category_name, confidence, is_active)
     VALUES (?, ?, ?, 0.97, 1)
     ON CONFLICT(keyword) DO UPDATE SET category_name = excluded.category_name, is_active = 1;`,
    // match_mode is left alone on conflict, so a whole-word store brand stays whole-word.
    generateUUID(),
    keyword,
    categoryName,
  );
  await db.runAsync("DELETE FROM merchant_corrections WHERE merchant_keyword = ?;", keyword);
  bumpDataVersion();
  return keyword;
}

export async function setMerchantRuleActive(keyword: string, active: boolean): Promise<void> {
  await getDatabase().runAsync("UPDATE merchant_mappings SET is_active = ? WHERE keyword = ?;", active ? 1 : 0, keyword);
  bumpDataVersion();
}

/** Built-in keywords go back to their shipped category; your own rules are removed. */
export async function resetOrRemoveMerchantRule(keyword: string): Promise<void> {
  const db = getDatabase();
  const builtIn = BUILT_IN.get(keyword);
  if (builtIn) {
    await db.runAsync("UPDATE merchant_mappings SET category_name = ?, is_active = 1 WHERE keyword = ?;", builtIn, keyword);
  } else {
    await db.runAsync("DELETE FROM merchant_mappings WHERE keyword = ?;", keyword);
  }
  bumpDataVersion();
}

/** Keep rules pointing at a category when it's renamed. Called from updateCategory. */
export async function renameCategoryInMerchantRules(oldName: string, newName: string): Promise<void> {
  if (!oldName || oldName === newName) return;
  await getDatabase().runAsync("UPDATE merchant_mappings SET category_name = ? WHERE category_name = ?;", newName, oldName);
}

export async function countMerchantRulesForCategory(categoryName: string): Promise<number> {
  const row = await getDatabase().getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM merchant_mappings WHERE category_name = ? AND is_active = 1;",
    categoryName,
  );
  return row?.n ?? 0;
}

/** Move every rule from one category to another (used when hiding or deleting a category). */
export async function moveMerchantRules(fromCategory: string, toCategory: string): Promise<number> {
  const db = getDatabase();
  const n = await countMerchantRulesForCategory(fromCategory);
  await db.runAsync("UPDATE merchant_mappings SET category_name = ? WHERE category_name = ?;", toCategory, fromCategory);
  bumpDataVersion();
  return n;
}

export async function listLearnedMerchants(userId: string = DEFAULT_USER_ID): Promise<LearnedMerchant[]> {
  const rows = await getDatabase().getAllAsync<{
    id: string; merchant_keyword: string; category_id: string; name: string | null; correction_count: number;
  }>(
    `SELECT mc.id, mc.merchant_keyword, mc.category_id, c.name, mc.correction_count
     FROM merchant_corrections mc LEFT JOIN categories c ON c.id = mc.category_id
     WHERE mc.user_id = ? ORDER BY mc.correction_count DESC, mc.merchant_keyword;`,
    userId,
  );
  return rows.map((r) => ({
    id: r.id, keyword: r.merchant_keyword, categoryId: r.category_id, categoryName: r.name, count: r.correction_count,
  }));
}

export async function forgetLearnedMerchant(id: string): Promise<void> {
  await getDatabase().runAsync("DELETE FROM merchant_corrections WHERE id = ?;", id);
  bumpDataVersion();
}

// ─── Past transactions ───

interface PastRow { id: string; merchant_name: string; category_id: string | null }

/**
 * Transactions already filed whose merchant this rule now covers (it's the longest matching rule,
 * so "swiggy" never drags Swiggy Instamart along) and that sit in a different category. Rows a
 * Smart Rule categorised are left alone - Smart Rules outrank merchant rules.
 */
async function pastRowsForRule(userId: string, keyword: string, categoryName: string): Promise<{ ids: string[]; categoryId: string | null }> {
  const db = getDatabase();
  const cat = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM categories WHERE user_id = ? AND name = ? AND is_active = 1;",
    userId,
    categoryName,
  );
  if (!cat) return { ids: [], categoryId: null };
  const rules = (await listMerchantRules(userId)).filter((r) => r.isActive || r.keyword === keyword);
  const rows = await db.getAllAsync<PastRow>(
    `SELECT id, merchant_name, category_id FROM expenses
     WHERE user_id = ? AND deleted_at IS NULL AND nature = 'realized' AND merchant_name IS NOT NULL
       AND applied_rule_id IS NULL AND (category_id IS NULL OR category_id != ?);`,
    userId,
    cat.id,
  );
  const ids = rows.filter((r) => pickRule(rules, r.merchant_name)?.keyword === keyword).map((r) => r.id);
  return { ids, categoryId: cat.id };
}

export async function countPastTransactionsForRule(keyword: string, categoryName: string, userId: string = DEFAULT_USER_ID): Promise<number> {
  return (await pastRowsForRule(userId, keyword, categoryName)).ids.length;
}

/** Move earlier transactions this rule covers into its category. Returns how many moved. */
export async function applyRuleToPastTransactions(keyword: string, categoryName: string, userId: string = DEFAULT_USER_ID): Promise<number> {
  const { ids, categoryId } = await pastRowsForRule(userId, keyword, categoryName);
  if (!categoryId || ids.length === 0) return 0;
  const db = getDatabase();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await db.runAsync(
      `UPDATE expenses SET category_id = ?, updated_at = datetime('now') WHERE id IN (${chunk.map(() => "?").join(",")});`,
      categoryId,
      ...chunk,
    );
  }
  bumpDataVersion();
  return ids.length;
}
