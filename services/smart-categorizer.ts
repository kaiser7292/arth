/**
 * Smart Categorization Engine
 *
 * Two-layer approach:
 *   Layer 1 (Rules): Pre-built keyword → category mappings for 200+ Indian merchants.
 *   Layer 2 (Learning): User corrections are tracked. After N corrections for the
 *     same merchant, the learned mapping takes priority over rules.
 *
 * Flow:
 *   1. Normalize the merchant string (lowercase, strip suffixes)
 *   2. Check merchant_corrections for this user + merchant (learned mapping)
 *   3. If learned (count >= threshold) → use it
 *   4. Else check merchant_mappings (rule-based) → find best keyword match
 *   5. Look up the user's category by name → return category_id
 *   6. If no match → return null (uncategorized)
 */

import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { BUILT_IN_MERCHANT_MAPPINGS } from "@/database/defaults/merchant-mappings";
import { bumpDataVersion } from "@/services/settings";
import { getFlag } from "@/services/feature-flags";
import { resolveMerchantBrand } from "@/services/public-data/lookup";
import { settingsStorage } from "@/services/storage";

const MERCHANT_MAPPINGS_SEEDED_KEY = "merchant_mappings_seeded";

/** Minimum corrections before a learned mapping overrides rules */
const LEARNING_THRESHOLD = 3;

export interface CategorizationResult {
  categoryId: string | null;
  categoryName: string | null;
  confidence: number;
  source: "learned" | "rule" | "fallback" | "none";
}

// ─── Merchant normalization ───

/** Common suffixes to strip from merchant names */
const STRIP_SUFFIXES = [
  /\s+(limited|ltd|pvt|private|inc|corp|llp|llc)\.?$/gi,
  /\s+india$/gi,
  /\s+online$/gi,
  /\s+payments?$/gi,
  /\s+services?$/gi,
];

/**
 * Normalize a merchant string for matching:
 * lowercase, trim whitespace, remove corporate suffixes.
 * Runs multiple passes until no more suffixes match.
 */
export function normalizeMerchant(merchant: string): string {
  let normalized = merchant.toLowerCase().trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of STRIP_SUFFIXES) {
      const before = normalized;
      normalized = normalized.replace(suffix, "").trim();
      if (normalized !== before) changed = true;
    }
  }
  return normalized;
}

/**
 * Extract merchant name from an expense description.
 * Description format: "MERCHANT via BANK ****1234 (type)"
 */
export function extractMerchantFromDescription(description: string): string {
  // Strip trailing type annotations
  let cleaned = description
    .replace(/\s*\(Standing Instruction\)$/i, "")
    .replace(/\s*\(Upcoming SI\)$/i, "")
    .replace(/\s*\(EMI Due\)$/i, "")
    .replace(/\s*\(Amount Due\)$/i, "")
    .trim();

  // Split on " via " — merchant is before it
  const viaIdx = cleaned.indexOf(" via ");
  if (viaIdx > 0) {
    cleaned = cleaned.substring(0, viaIdx).trim();
  }

  return cleaned;
}

// ─── Layer 2: User-learned mappings ───

interface MerchantCorrection {
  category_id: string;
  correction_count: number;
}

/**
 * Check if the user has a learned mapping for this merchant.
 * Returns the correction if count >= threshold.
 */
async function getLearnedMapping(
  userId: string,
  normalizedMerchant: string,
): Promise<MerchantCorrection | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<MerchantCorrection>(
    `SELECT category_id, correction_count FROM merchant_corrections
     WHERE user_id = ? AND merchant_keyword = ? AND correction_count >= ?;`,
    userId,
    normalizedMerchant,
    LEARNING_THRESHOLD,
  );
  return row ?? null;
}

// ─── Layer 1: Rule-based mappings ───

interface RuleMatch {
  keyword: string;
  categoryName: string;
  confidence: number;
}

/** How a keyword rule matches: anywhere in the merchant ("contains") or as whole words ("word"). */
export type MatchMode = "contains" | "word";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does a keyword rule match this (already normalized) merchant? "contains" suits app brands that
 * SMS glue to other text (PYU*SWIGGY); "word" keeps short store names (More, Metro) from matching
 * inside other words.
 */
export function keywordMatches(normalizedMerchant: string, keyword: string, mode: MatchMode | string = "contains"): boolean {
  if (mode !== "word") return normalizedMerchant.includes(keyword);
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(keyword)}($|[^a-z0-9])`).test(normalizedMerchant);
}

/**
 * Find the best rule-based match for a merchant string: the longest matching keyword wins
 * (more specific), then the higher confidence. Turned-off rules take part too: if the best match
 * is one the user switched off, `blocked` is set so the caller files nothing rather than falling
 * through to the brand registry (which would put Swiggy back in Food).
 */
async function getRuleMatch(normalizedMerchant: string): Promise<{ match: RuleMatch | null; blocked: boolean }> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{
    keyword: string; category_name: string; confidence: number; is_active: number; match_mode: string | null;
  }>(`SELECT keyword, category_name, confidence, is_active, match_mode FROM merchant_mappings;`);

  let best: (RuleMatch & { active: boolean }) | null = null;

  for (const row of rows) {
    if (!keywordMatches(normalizedMerchant, row.keyword, row.match_mode ?? "contains")) continue;
    if (
      !best ||
      row.keyword.length > best.keyword.length ||
      (row.keyword.length === best.keyword.length && row.confidence > best.confidence)
    ) {
      best = { keyword: row.keyword, categoryName: row.category_name, confidence: row.confidence, active: row.is_active === 1 };
    }
  }

  if (!best) return { match: null, blocked: false };
  if (!best.active) return { match: null, blocked: true };
  return { match: { keyword: best.keyword, categoryName: best.categoryName, confidence: best.confidence }, blocked: false };
}

/**
 * Look up a user's category ID by category name.
 * Returns null if the user doesn't have a category with that name.
 */
async function getCategoryIdByName(
  userId: string,
  categoryName: string,
): Promise<string | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM categories WHERE user_id = ? AND name = ? AND is_active = 1;`,
    userId,
    categoryName,
  );
  return row?.id ?? null;
}

// ─── Main categorization function ───

/**
 * Categorize a merchant string for a user.
 * Checks learned corrections first, then rule-based mappings.
 * Falls back to "Unknown" category if no match is found.
 */
export async function categorizeByMerchant(
  userId: string,
  merchant: string | null,
): Promise<CategorizationResult> {
  const none: CategorizationResult = {
    categoryId: null,
    categoryName: null,
    confidence: 0,
    source: "none",
  };

  if (!merchant) return none;

  const normalized = normalizeMerchant(merchant);
  if (!normalized) return none;

  // Layer 2: Check user-learned mapping first
  const learned = await getLearnedMapping(userId, normalized);
  if (learned) {
    return {
      categoryId: learned.category_id,
      categoryName: null, // Already have the ID
      confidence: 0.98,
      source: "learned",
    };
  }

  // Layer 1: Check rule-based mapping
  const { match: rule, blocked } = await getRuleMatch(normalized);
  // The user turned off the rule that covers this merchant: leave it for them to categorise.
  if (blocked) return none;
  if (rule) {
    const categoryId = await getCategoryIdByName(userId, rule.categoryName);
    if (categoryId) {
      return {
        categoryId,
        categoryName: rule.categoryName,
        confidence: rule.confidence,
        source: "rule",
      };
    }
  }

  // Layer 1b (v15): merchant-brand registry. Handles SMS-specific aliases
  // (PYU*Swiggy Food, AMZN*MKTPLACE, IND*LinkedI) that keyword substring
  // matching misses. Lower confidence than the keyword rules so a future
  // keyword-table update can supersede a brand-registry hit without
  // surgery.
  if (getFlag("v15_merchant_brand_lookup")) {
    const brand = await resolveMerchantBrand(merchant);
    if (brand?.category) {
      const categoryId = await getCategoryIdByName(userId, brand.category);
      if (categoryId) {
        return {
          categoryId,
          categoryName: brand.category,
          confidence: 0.85,
          source: "rule",
        };
      }
    }
  }

  // Intentionally leave uncategorized when no rule or learned match is found.
  // The review queue's Uncategorized section surfaces these for the user to
  // categorize manually. Do NOT auto-fallback to Unknown — that would hide
  // items from the review flow.
  return none;
}

// ─── Correction recording ───

/**
 * Record a user's category correction for a merchant.
 * If a correction for this user+merchant already exists, increment the count.
 * Otherwise, create a new correction record.
 */
export async function recordCategoryCorrection(
  userId: string,
  merchant: string,
  categoryId: string,
): Promise<void> {
  const normalized = normalizeMerchant(merchant);
  if (!normalized) return;

  const db = getDatabase();

  const existing = await db.getFirstAsync<{ id: string; category_id: string; correction_count: number }>(
    `SELECT id, category_id, correction_count FROM merchant_corrections
     WHERE user_id = ? AND merchant_keyword = ?;`,
    userId,
    normalized,
  );

  if (existing) {
    if (existing.category_id === categoryId) {
      // Same category — increment count
      await db.runAsync(
        `UPDATE merchant_corrections SET correction_count = correction_count + 1, updated_at = datetime('now'), last_corrected_at = datetime('now') WHERE id = ?;`,
        existing.id,
      );
    } else {
      // Different category — reset count to 1 with new category
      await db.runAsync(
        `UPDATE merchant_corrections SET category_id = ?, correction_count = 1, updated_at = datetime('now'), last_corrected_at = datetime('now') WHERE id = ?;`,
        categoryId,
        existing.id,
      );
    }
  } else {
    const id = generateUUID();
    await db.runAsync(
      `INSERT INTO merchant_corrections (id, user_id, merchant_keyword, category_id) VALUES (?, ?, ?, ?);`,
      id,
      userId,
      normalized,
      categoryId,
    );
  }
  await bumpDataVersion();
}

// ─── Seed default mappings ───

/**
 * Version of the built-in rule set. Bump when BUILT_IN_MERCHANT_MAPPINGS gains rules so existing
 * installs top up on next launch. 2 = OpenStreetMap store brands (whole-word).
 */
export const MERCHANT_MAPPINGS_VERSION = 2;
const MERCHANT_MAPPINGS_VERSION_KEY = "merchant_mappings_version";

/**
 * Seed or top up the built-in merchant rules. INSERT OR IGNORE by keyword, so rules the user
 * changed, turned off or added are never touched; only keywords Arth doesn't have yet are added.
 */
export async function seedMerchantMappings(): Promise<void> {
  // Cheap skip on every cold start once this install has the current rule set.
  if (
    settingsStorage.getBoolean(MERCHANT_MAPPINGS_SEEDED_KEY) &&
    (settingsStorage.getNumber(MERCHANT_MAPPINGS_VERSION_KEY) ?? 1) >= MERCHANT_MAPPINGS_VERSION
  ) {
    return;
  }

  await insertBuiltInMerchantMappings();
  settingsStorage.set(MERCHANT_MAPPINGS_SEEDED_KEY, true);
  settingsStorage.set(MERCHANT_MAPPINGS_VERSION_KEY, MERCHANT_MAPPINGS_VERSION);
  await bumpDataVersion();
}

/**
 * Add any built-in rule the table is missing (INSERT OR IGNORE: user edits are kept). Restore
 * calls this too - a backup from before a rule-set update would otherwise leave the new built-ins
 * out, and the per-device version marker would stop seedMerchantMappings from adding them back.
 */
export async function insertBuiltInMerchantMappings(): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    for (const mapping of BUILT_IN_MERCHANT_MAPPINGS) {
      await db.runAsync(
        `INSERT OR IGNORE INTO merchant_mappings (id, keyword, category_name, confidence, match_mode) VALUES (?, ?, ?, ?, ?);`,
        generateUUID(),
        mapping.keyword,
        mapping.categoryName,
        mapping.confidence,
        mapping.matchMode ?? "contains",
      );
    }
  });
}
