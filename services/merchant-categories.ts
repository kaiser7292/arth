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
import { DEFAULT_MERCHANT_MAPPINGS } from "@/database/defaults/merchant-mappings";
import { bumpDataVersion } from "@/services/settings";
import { normalizeMerchant } from "@/services/smart-categorizer";
import { generateUUID } from "@/utils/uuid";

export type MerchantRuleSource = "builtin" | "edited" | "custom";

export interface MerchantRule {
  keyword: string;
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

const BUILT_IN = new Map(DEFAULT_MERCHANT_MAPPINGS.map((m) => [m.keyword, m.categoryName]));

export function normalizeKeyword(input: string): string {
  return normalizeMerchant(input).replace(/\s+/g, " ");
}

async function activeCategoryNames(userId: string): Promise<Set<string>> {
  const rows = await getDatabase().getAllAsync<{ name: string }>(
    "SELECT name FROM categories WHERE user_id = ? AND is_active = 1;",
    userId,
  );
  return new Set(rows.map((r) => r.name));
}

export async function listMerchantRules(userId: string = DEFAULT_USER_ID): Promise<MerchantRule[]> {
  const rows = await getDatabase().getAllAsync<{ keyword: string; category_name: string; is_active: number }>(
    "SELECT keyword, category_name, is_active FROM merchant_mappings ORDER BY keyword;",
  );
  const names = await activeCategoryNames(userId);
  return rows.map((r) => {
    const builtInCategory = BUILT_IN.get(r.keyword) ?? null;
    const source: MerchantRuleSource =
      builtInCategory == null ? "custom" : builtInCategory === r.category_name && r.is_active === 1 ? "builtin" : "edited";
    return {
      keyword: r.keyword,
      categoryName: r.category_name,
      isActive: r.is_active === 1,
      source,
      builtInCategory,
      categoryMissing: !names.has(r.category_name),
    };
  });
}

/** The rule that would file this merchant today (longest active keyword contained in it). */
export async function findRuleForMerchant(merchant: string): Promise<MerchantRule | null> {
  const normalized = normalizeKeyword(merchant);
  if (!normalized) return null;
  const rules = (await listMerchantRules()).filter((r) => r.isActive && normalized.includes(r.keyword));
  rules.sort((a, b) => b.keyword.length - a.keyword.length);
  return rules[0] ?? null;
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
