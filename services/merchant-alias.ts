/**
 * Merchant Alias Service
 *
 * Normalizes raw SMS merchant names into clean, user-friendly names.
 * Uses a two-step process:
 *   1. Strip known SMS prefixes/noise (PYU*, CAS*, InfoEBA*, etc.)
 *   2. Look up in merchant_aliases table for user-defined canonical names
 *
 * Also auto-learns aliases when users edit merchant names on expenses.
 */

import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { bumpDataVersion } from "@/services/settings";

/** Known SMS merchant name prefixes to strip */
const STRIP_PREFIXES = [
  /^PYU\*/i,
  /^CAS\*/i,
  /^InfoEBA\*/i,
  /^PAY\*/i,
  /^BIL\*/i,
  /^CLR\*/i,
  /^INF\*/i,
  /^RAZORPAY\*/i,
  /^PAYU\*/i,
  /^PHONEPE\*/i,
  /^GPAY\*/i,
];

/** Common corporate suffixes to strip */
const STRIP_SUFFIXES = [
  /\s+(limited|ltd|pvt|private|inc|corp|llp|llc)\.?$/gi,
  /\s+india$/gi,
  /\s+online$/gi,
  /\s+payments?$/gi,
  /\s+technologies$/gi,
];

/**
 * Clean a raw SMS merchant name by stripping prefixes, suffixes, and noise.
 * Does NOT do alias lookup — just string cleaning.
 */
export function cleanMerchantName(rawName: string): string {
  let cleaned = rawName.trim();

  // Strip known prefixes
  for (const prefix of STRIP_PREFIXES) {
    cleaned = cleaned.replace(prefix, "").trim();
  }

  // Strip corporate suffixes (multiple passes)
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of STRIP_SUFFIXES) {
      const before = cleaned;
      cleaned = cleaned.replace(suffix, "").trim();
      if (cleaned !== before) changed = true;
    }
  }

  return cleaned;
}

/**
 * Normalized Levenshtein similarity (0-1, 1 = identical).
 * Uses standard dynamic-programming edit distance.
 */
function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;

  // Single-row DP
  let prev = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= la; i++) {
    const curr = [i];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return 1 - prev[lb] / Math.max(la, lb);
}

/**
 * Compute fuzzy similarity between two merchant names (0-1).
 * Combines multiple signals:
 *  - Exact case-insensitive match → 1.0
 *  - One is a prefix of the other (min 3 chars) → 0.85-0.95
 *  - One is a substring of the other → 0.80
 *  - Levenshtein similarity on lowercased alphanumeric chars
 */
function merchantFuzzyScore(a: string, b: string): number {
  const la = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const lb = b.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (la === lb) return 1.0;
  if (la.length < 3 || lb.length < 3) return levenshteinSimilarity(la, lb);

  // Prefix check: one is the start of the other (common with truncated SMS names)
  if (la.startsWith(lb) || lb.startsWith(la)) {
    const shorter = Math.min(la.length, lb.length);
    const longer = Math.max(la.length, lb.length);
    return 0.85 + 0.10 * (shorter / longer);
  }

  // Substring check: one is contained in the other
  if (la.includes(lb) || lb.includes(la)) return 0.80;

  return levenshteinSimilarity(la, lb);
}

/** Minimum fuzzy score to consider a match */
const FUZZY_MATCH_THRESHOLD = 0.75;

/**
 * Normalize a merchant name for a user:
 *   1. Clean the raw name (strip prefixes/suffixes)
 *   2. Look up in merchant_aliases (exact case-insensitive)
 *   3. If no exact match, try fuzzy matching against all aliases
 *   4. If fuzzy match found, auto-learn a new alias for future exact matches
 *   5. Return canonical name if found, cleaned name otherwise
 */
export async function normalizeMerchantName(
  userId: string,
  rawName: string | null,
): Promise<string | null> {
  if (!rawName) return null;

  const cleaned = cleanMerchantName(rawName);
  if (!cleaned) return null;

  const db = getDatabase();

  // Step 1: Exact alias lookup by cleaned SMS name (case-insensitive)
  const alias = await db.getFirstAsync<{ canonical_name: string; category_id: string | null }>(
    `SELECT canonical_name, category_id FROM merchant_aliases
     WHERE user_id = ? AND LOWER(sms_name) = LOWER(?)
     LIMIT 1;`,
    userId,
    cleaned,
  );

  if (alias) {
    return alias.canonical_name;
  }

  // Step 2: Also try the raw name directly (some aliases match original format)
  const rawAlias = await db.getFirstAsync<{ canonical_name: string }>(
    `SELECT canonical_name FROM merchant_aliases
     WHERE user_id = ? AND LOWER(sms_name) = LOWER(?)
     LIMIT 1;`,
    userId,
    rawName.trim(),
  );

  if (rawAlias) {
    return rawAlias.canonical_name;
  }

  // Step 3: Fuzzy match against all known aliases
  const allAliases = await db.getAllAsync<{ id: string; sms_name: string; canonical_name: string; category_id: string | null }>(
    `SELECT id, sms_name, canonical_name, category_id FROM merchant_aliases WHERE user_id = ?;`,
    userId,
  );

  // Also fuzzy-match against canonical names (user may have typed "Zomato" as canonical)
  let bestScore = 0;
  let bestCanonical: string | null = null;
  let bestCategoryId: string | null = null;

  for (const a of allAliases) {
    // Match against the sms_name
    const smsScore = merchantFuzzyScore(cleaned, a.sms_name);
    if (smsScore > bestScore) {
      bestScore = smsScore;
      bestCanonical = a.canonical_name;
      bestCategoryId = a.category_id;
    }
    // Match against the canonical name
    const canonScore = merchantFuzzyScore(cleaned, a.canonical_name);
    if (canonScore > bestScore) {
      bestScore = canonScore;
      bestCanonical = a.canonical_name;
      bestCategoryId = a.category_id;
    }
  }

  if (bestScore >= FUZZY_MATCH_THRESHOLD && bestCanonical) {
    // Auto-learn: create a new exact alias so future lookups are instant
    const existingExact = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM merchant_aliases WHERE user_id = ? AND LOWER(sms_name) = LOWER(?);`,
      userId,
      cleaned,
    );
    if (!existingExact) {
      const id = generateUUID();
      await db.runAsync(
        `INSERT INTO merchant_aliases (id, user_id, sms_name, canonical_name, category_id)
         VALUES (?, ?, ?, ?, ?);`,
        id,
        userId,
        cleaned,
        bestCanonical,
        bestCategoryId,
      );
    }
    return bestCanonical;
  }

  // Auto-seed: first-time merchant with no match — create a self-referencing alias
  // so future fuzzy matches have something to compare against
  if (cleaned.length >= 3) {
    const alreadyExists = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM merchant_aliases WHERE user_id = ? AND LOWER(sms_name) = LOWER(?);`,
      userId,
      cleaned,
    );
    if (!alreadyExists) {
      const id = generateUUID();
      await db.runAsync(
        `INSERT INTO merchant_aliases (id, user_id, sms_name, canonical_name, category_id)
         VALUES (?, ?, ?, ?, ?);`,
        id,
        userId,
        cleaned,
        cleaned,
        null,
      );
    }
  }

  return cleaned;
}

/**
 * Auto-learn a merchant alias when user edits a merchant name.
 * If the original (SMS) name differs from the user's edit, create an alias.
 * If an alias for this sms_name already exists, update it.
 */
export async function learnMerchantAlias(
  userId: string,
  originalName: string,
  editedName: string,
  categoryId?: string | null,
): Promise<void> {
  if (!originalName || !editedName) return;

  const smsName = cleanMerchantName(originalName);
  const canonical = editedName.trim();

  // Don't create alias if they're the same after cleaning
  if (smsName.toLowerCase() === canonical.toLowerCase()) return;

  const db = getDatabase();

  // Check if alias already exists
  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM merchant_aliases
     WHERE user_id = ? AND LOWER(sms_name) = LOWER(?);`,
    userId,
    smsName,
  );

  if (existing) {
    // Update existing alias
    await db.runAsync(
      `UPDATE merchant_aliases SET canonical_name = ?, category_id = COALESCE(?, category_id)
       WHERE id = ?;`,
      canonical,
      categoryId ?? null,
      existing.id,
    );
  } else {
    // Create new alias
    const id = generateUUID();
    await db.runAsync(
      `INSERT INTO merchant_aliases (id, user_id, sms_name, canonical_name, category_id)
       VALUES (?, ?, ?, ?, ?);`,
      id,
      userId,
      smsName,
      canonical,
      categoryId ?? null,
    );
  }
  bumpDataVersion();
}

/**
 * Get all merchant aliases for a user (for settings/management screen).
 */
export async function getMerchantAliases(
  userId: string,
): Promise<Array<{ id: string; sms_name: string; canonical_name: string; category_id: string | null }>> {
  const db = getDatabase();
  return db.getAllAsync(
    `SELECT id, sms_name, canonical_name, category_id FROM merchant_aliases
     WHERE user_id = ? ORDER BY canonical_name;`,
    userId,
  );
}

/**
 * Get a deduplicated list of merchant names for autocomplete/picker.
 * Combines canonical names from merchant_aliases + distinct merchant_name from expenses.
 * Returns sorted, unique list.
 */
export async function getDistinctMerchantNames(
  userId: string,
): Promise<string[]> {
  const db = getDatabase();

  const aliasRows = await db.getAllAsync<{ canonical_name: string }>(
    `SELECT DISTINCT canonical_name FROM merchant_aliases WHERE user_id = ? AND canonical_name IS NOT NULL;`,
    userId,
  );

  // Exclude credit rows — credit merchants (salary senders, UPI payers) shouldn't
  // pollute the merchant picker for regular expenses.
  const expenseRows = await db.getAllAsync<{ merchant_name: string }>(
    `SELECT DISTINCT merchant_name FROM expenses
     WHERE user_id = ? AND merchant_name IS NOT NULL AND merchant_name != ''
       AND nature != 'credit' AND deleted_at IS NULL;`,
    userId,
  );

  const nameSet = new Set<string>();
  for (const r of aliasRows) nameSet.add(r.canonical_name);
  for (const r of expenseRows) nameSet.add(r.merchant_name);

  return Array.from(nameSet).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

/**
 * Propagate a merchant name change to all existing expenses.
 * When user renames "ZOMATO LTD" → "Zomato" in aliases,
 * this updates every expense that had the old merchant_name.
 * Returns the number of expenses updated.
 */
export async function propagateMerchantRename(
  userId: string,
  oldName: string,
  newName: string,
): Promise<number> {
  if (!oldName || !newName || oldName === newName) return 0;
  const db = getDatabase();
  const result = await db.runAsync(
    `UPDATE expenses SET merchant_name = ? WHERE user_id = ? AND LOWER(merchant_name) = LOWER(?) AND deleted_at IS NULL;`,
    newName,
    userId,
    oldName,
  );
  if (result.changes > 0) bumpDataVersion();
  return result.changes;
}

/**
 * Rename all aliases with oldCanonical to newCanonical.
 * This handles group-level rename AND auto-merge: if newCanonical already
 * exists as another group, the rows merge under the same canonical name.
 * Returns the number of alias rows updated.
 */
export async function renameCanonical(
  userId: string,
  oldCanonical: string,
  newCanonical: string,
): Promise<number> {
  if (!oldCanonical || !newCanonical || oldCanonical === newCanonical) return 0;
  const db = getDatabase();
  const result = await db.runAsync(
    `UPDATE merchant_aliases SET canonical_name = ? WHERE user_id = ? AND LOWER(canonical_name) = LOWER(?);`,
    newCanonical,
    userId,
    oldCanonical,
  );
  bumpDataVersion();
  return result.changes;
}

/**
 * Unmerge a merchant alias — reset its canonical_name back to its sms_name,
 * making it a standalone merchant group. Also renames expenses whose
 * raw_merchant_name matches the alias's sms_name (case-insensitive).
 * Returns { smsName, expensesUpdated }.
 */
export async function unmergeMerchantAlias(
  aliasId: string,
  userId: string,
): Promise<{ smsName: string; expensesUpdated: number } | null> {
  const db = getDatabase();
  const alias = await db.getFirstAsync<{ sms_name: string; canonical_name: string }>(
    `SELECT sms_name, canonical_name FROM merchant_aliases WHERE id = ?;`,
    aliasId,
  );
  if (!alias || alias.sms_name.toLowerCase() === alias.canonical_name.toLowerCase()) return null;

  await db.runAsync(
    `UPDATE merchant_aliases SET canonical_name = ? WHERE id = ?;`,
    alias.sms_name,
    aliasId,
  );

  const result = await db.runAsync(
    `UPDATE expenses SET merchant_name = ? WHERE user_id = ? AND LOWER(raw_merchant_name) = LOWER(?) AND deleted_at IS NULL;`,
    alias.sms_name,
    userId,
    alias.sms_name,
  );

  bumpDataVersion();
  return { smsName: alias.sms_name, expensesUpdated: result.changes };
}

/**
 * Delete a merchant alias.
 */
export async function deleteMerchantAlias(aliasId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(`DELETE FROM merchant_aliases WHERE id = ?;`, aliasId);
  bumpDataVersion();
}
