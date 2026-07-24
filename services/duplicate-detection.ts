/**
 * Duplicate Expense Detection Service
 *
 * Scans realized expenses for potential duplicates based on:
 *  - Exact amount match (using split_original_amount when present)
 *  - Same or compatible account_id (null treated as wildcard)
 *  - Same or similar merchant name
 *  - Same transaction date
 *
 * Also scans forecast (upcoming) expenses for duplicate dues.
 *
 * Returns groups of potential duplicates for user review.
 * Can be triggered manually from settings or auto-run after SMS scan.
 */

import { duplicateDismissalsStorage as dismissStorage, settingsStorage } from "./storage";
import { getDatabase } from "@/database";
import type { Expense } from "@/services/expense";
import { getDataVersion, subscribeDataVersion } from "@/services/settings";

// ---------------------------------------------------------------------------
// Dismissed groups ("Keep both" state)
// ---------------------------------------------------------------------------
//
// When a user says "these aren't duplicates, keep them as-is" we store the
// canonical group-key (sorted expense IDs joined with ":") in MMKV. The next
// scan filters out any group whose key matches. If the group later grows
// (a 3rd duplicate appears), the key changes and the group re-surfaces — the
// scanner has never seen that exact cluster before, so it deserves a re-look.

const DISMISSED_KEY = "dismissed_groups";

function loadDismissedSet(): Set<string> {
  const raw = dismissStorage.getString(DISMISSED_KEY);
  if (!raw) return new Set();
  try {
    const arr: string[] = JSON.parse(raw);
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function saveDismissedSet(set: Set<string>): void {
  dismissStorage.set(DISMISSED_KEY, JSON.stringify(Array.from(set)));
}

function groupKey(expenses: Expense[]): string {
  return expenses
    .map((e) => e.id)
    .sort()
    .join(":");
}

/** Add a duplicate group to the "Keep both" list. */
export function dismissDuplicateGroup(expenses: Expense[]): void {
  const set = loadDismissedSet();
  set.add(groupKey(expenses));
  saveDismissedSet(set);
  invalidateDuplicateScanCache();
}

/** Count of currently-dismissed groups (for the Settings surface). */
export function getDismissedDuplicateCount(): number {
  return loadDismissedSet().size;
}

/** Restore everything — groups will be flagged again on the next scan. */
export function clearDismissedDuplicates(): void {
  saveDismissedSet(new Set());
  invalidateDuplicateScanCache();
}

/** Restore a single dismissed group so it resurfaces on the next scan. */
export function restoreDismissedGroup(key: string): void {
  const set = loadDismissedSet();
  set.delete(key);
  saveDismissedSet(set);
  invalidateDuplicateScanCache();
}

export interface DismissedGroup {
  /** Canonical key (sorted expense IDs joined with ":") */
  key: string;
  /** Expenses still present in the DB (deleted/missing ones are filtered out) */
  expenses: Expense[];
}

/**
 * Load every dismissed group, resolving each stored key back to live expenses.
 * Drops groups whose expenses have all been deleted. If fewer than 2 expenses
 * remain, the group is no longer meaningful and is excluded.
 */
export async function getDismissedDuplicateGroups(
  userId: string,
): Promise<DismissedGroup[]> {
  const set = loadDismissedSet();
  if (set.size === 0) return [];

  const db = getDatabase();
  const result: DismissedGroup[] = [];
  // Perf (v14.8.0): garbage-collect stale keys as we resolve them. Over
  // time the MMKV set accumulates entries pointing at permanently-deleted
  // expenses; parsing a large stale set on every `scanAllDuplicates` call
  // adds up. Drop any key that no longer resolves to ≥2 live expenses.
  const liveKeys = new Set<string>();
  for (const key of set) {
    const ids = key.split(":").filter((s) => s.length > 0);
    if (ids.length < 2) continue;

    const placeholders = ids.map(() => "?").join(",");
    const expenses = await db.getAllAsync<Expense>(
      `SELECT * FROM expenses
       WHERE user_id = ? AND id IN (${placeholders}) AND deleted_at IS NULL;`,
      userId,
      ...ids,
    );
    if (expenses.length < 2) continue;
    liveKeys.add(key);
    result.push({ key, expenses });
  }
  // Only save back if something was pruned — avoid write churn when clean.
  if (liveKeys.size !== set.size) {
    saveDismissedSet(liveKeys);
  }
  return result;
}

export interface DuplicateGroup {
  /** All expenses in this duplicate group */
  expenses: Expense[];
  /** Why these were flagged (human-readable) */
  reason: string;
}

export interface DuplicateScanResult {
  /** Groups of potential duplicates found */
  groups: DuplicateGroup[];
  /** Total expenses scanned */
  scannedCount: number;
  /** How many duplicate groups found */
  duplicateGroupCount: number;
}

/**
 * Simple case-insensitive merchant comparison.
 * Returns true if the merchants are considered the same.
 * Handles nulls (both null = match), and does alphanumeric-only comparison.
 */
function merchantsMatch(a: string | null, b: string | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;

  const cleanA = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanB = b.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (cleanA === cleanB) return true;

  // Prefix match (one is truncated version of the other, min 3 chars)
  if (cleanA.length >= 3 && cleanB.length >= 3) {
    if (cleanA.startsWith(cleanB) || cleanB.startsWith(cleanA)) return true;
  }

  return false;
}

/**
 * Get the effective amount for duplicate comparison.
 * Uses split_original_amount when present (the full transaction amount before split),
 * so a split expense of 250 (from 500) correctly matches another 500 expense.
 */
function effectiveAmount(exp: Expense): number {
  return exp.split_original_amount ?? exp.amount;
}

/**
 * Check if two account_ids are compatible for duplicate detection.
 * null is treated as a wildcard — compatible with any account.
 * Two different non-null accounts are NOT compatible.
 */
function accountsCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return true; // null = unknown account, could match anything
  return a === b;
}

/**
 * Sign guardrail: a +500 and a -500 must never cluster as duplicates even if
 * merchant/date/account match. Sign(0) = 0 is treated as its own bucket.
 */
function sameSign(a: number, b: number): boolean {
  return Math.sign(a) === Math.sign(b);
}

/**
 * Two legs of the same split-tender purchase (same purchase_group_id) must
 * never be clustered as duplicates — they are deliberate siblings, not dupes.
 */
function sameSplitTenderGroup(a: Expense, b: Expense): boolean {
  return (
    a.purchase_group_id != null &&
    b.purchase_group_id != null &&
    a.purchase_group_id === b.purchase_group_id
  );
}

/**
 * Returns true if both expenses have non-empty descriptions that are
 * meaningfully different after normalization (lowercase, strip spaces and
 * special chars). Two expenses whose descriptions differ are genuinely
 * distinct transactions and must NOT be clustered as duplicates even if
 * amount/merchant/date match.
 *
 * Returns false (don't split the cluster) when either description is blank
 * — blank descriptions are intentionally neutral.
 */
function descriptionsDistinct(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(a) !== norm(b);
}

/**
 * Core grouping logic shared by realized and forecast scans.
 * Groups expenses by (effectiveAmount, date), then clusters by
 * merchant similarity + account compatibility.
 */
function findDuplicateGroups(
  expenses: Expense[],
  labelPrefix: string,
): DuplicateGroup[] {
  // Group by (effective amount, date) composite key
  const groupMap = new Map<string, Expense[]>();

  for (const exp of expenses) {
    // Defense-in-depth: refunds are filtered at the SQL layer too, but skip
    // here as well so a refund never reaches the clustering stage even if a
    // caller passes a non-filtered list.
    if (exp.refund_of_expense_id != null) continue;
    // Key includes nature so a debit and a credit with the same amount/date
    // on the same day don't cluster together (e.g. a ₹500 UPI send + ₹500
    // UPI receive on the same day are legitimate opposite transactions).
    const key = `${exp.nature}|${effectiveAmount(exp)}|${exp.date}`;
    const group = groupMap.get(key);
    if (group) {
      group.push(exp);
    } else {
      groupMap.set(key, [exp]);
    }
  }

  // Find groups with 2+ expenses that also have matching merchants + compatible accounts
  const duplicateGroups: DuplicateGroup[] = [];

  for (const [, group] of groupMap) {
    if (group.length < 2) continue;

    // Within this amount+date group, cluster by merchant similarity + account compatibility
    const clusters: Expense[][] = [];

    for (const exp of group) {
      let foundCluster = false;
      for (const cluster of clusters) {
        const representative = cluster[0];
        if (
          merchantsMatch(exp.merchant_name, representative.merchant_name) &&
          accountsCompatible(exp.account_id, representative.account_id) &&
          sameSign(effectiveAmount(exp), effectiveAmount(representative)) &&
          !sameSplitTenderGroup(exp, representative) &&
          !descriptionsDistinct(exp.description, representative.description)
        ) {
          cluster.push(exp);
          foundCluster = true;
          break;
        }
      }
      if (!foundCluster) {
        clusters.push([exp]);
      }
    }

    // Only flag clusters with 2+ expenses
    for (const cluster of clusters) {
      if (cluster.length >= 2) {
        const merchant = cluster[0].merchant_name ?? "Unknown";
        const amount = effectiveAmount(cluster[0]);
        const date = cluster[0].date;
        duplicateGroups.push({
          expenses: cluster,
          reason: `${labelPrefix}${cluster.length} transactions of ₹${amount} at ${merchant} on ${date}`,
        });
      }
    }
  }

  return duplicateGroups;
}

/**
 * Near-day duplicate detection (±3 day tolerance).
 * Flags clusters where the same merchant+account+amount+nature appears on
 * different dates within a 3-day window. Catches delayed SMS re-imports and
 * accidental double-entries without the false-positive noise of same-month
 * detection (which flags any identical-price recurring purchase).
 */
function findNearbyDuplicateGroups(
  expenses: Expense[],
  sameDayGroups: DuplicateGroup[],
  labelPrefix: string,
): DuplicateGroup[] {
  const alreadyFlagged = new Set<string>();
  for (const group of sameDayGroups) {
    for (const exp of group.expenses) alreadyFlagged.add(exp.id);
  }

  // Must have a merchant; refunds and same-day-flagged entries are excluded.
  const candidates = expenses.filter(
    (e) =>
      e.merchant_name &&
      e.refund_of_expense_id == null &&
      !alreadyFlagged.has(e.id),
  );

  // Group by (nature, effectiveAmount) — no date bucket; window handled below.
  const amountMap = new Map<string, Expense[]>();
  for (const exp of candidates) {
    const key = `${exp.nature}|${effectiveAmount(exp)}`;
    const existing = amountMap.get(key);
    if (existing) existing.push(exp);
    else amountMap.set(key, [exp]);
  }

  const duplicateGroups: DuplicateGroup[] = [];
  const usedIds = new Set<string>();

  for (const [, group] of amountMap) {
    if (group.length < 2) continue;

    // Cluster by merchant similarity + account compatibility (same as same-day).
    const clusters: Expense[][] = [];
    for (const exp of group) {
      let placed = false;
      for (const cluster of clusters) {
        const rep = cluster[0];
        if (
          merchantsMatch(exp.merchant_name, rep.merchant_name) &&
          accountsCompatible(exp.account_id, rep.account_id) &&
          sameSign(effectiveAmount(exp), effectiveAmount(rep)) &&
          !sameSplitTenderGroup(exp, rep) &&
          !descriptionsDistinct(exp.description, rep.description)
        ) {
          cluster.push(exp);
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push([exp]);
    }

    for (const cluster of clusters) {
      if (cluster.length < 2) continue;

      // Sort by date for the sliding window scan.
      const sorted = [...cluster]
        .filter((e) => !usedIds.has(e.id))
        .sort((a, b) => a.date.localeCompare(b.date));

      let i = 0;
      while (i < sorted.length) {
        const anchor = sorted[i];
        if (usedIds.has(anchor.id)) { i++; continue; }

        const anchorMs = new Date(anchor.date).getTime();
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;

        // Collect entries within 3 days of the anchor (different date only).
        const window: Expense[] = [anchor];
        for (let j = i + 1; j < sorted.length; j++) {
          const exp = sorted[j];
          if (usedIds.has(exp.id)) continue;
          const diffMs = new Date(exp.date).getTime() - anchorMs;
          if (diffMs > 0 && diffMs <= threeDaysMs) window.push(exp);
        }

        if (window.length >= 2) {
          const merchant = anchor.merchant_name ?? "Unknown";
          const amount = effectiveAmount(anchor);
          duplicateGroups.push({
            expenses: window,
            reason: `${labelPrefix}${window.length} transactions of ₹${amount} at ${merchant} within 3 days`,
          });
          for (const e of window) usedIds.add(e.id);
        }
        i++;
      }
    }
  }

  return duplicateGroups;
}

/**
 * Scan all realized expenses for a user and find potential duplicates.
 *
 * Algorithm:
 * 1. Load all non-rejected realized expenses
 * 2. Group by (effective amount, date) — effective amount uses split_original_amount if present
 * 3. Within each group, cluster by merchant similarity + account compatibility
 * 4. Groups with 2+ matching expenses are flagged as duplicates
 */
export async function scanForDuplicates(
  userId: string,
): Promise<DuplicateScanResult> {
  const db = getDatabase();

  // Load recent non-rejected realized expenses + credits. Duplicates older
  // than 6 months are historical — if the user hasn't flagged them by now
  // they're accepted state. Perf (v14.8.0): scoping this query prevents
  // unbounded growth; home screen loads this on every refresh.
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const windowStart = sixMonthsAgo.toISOString().slice(0, 10);
  // Exclude refunds (refund_of_expense_id IS NOT NULL). A refund is by
  // definition tied to a specific original expense — it's never a duplicate
  // of anything else, and clustering a refund with its own original (or with
  // another unrelated refund of the same amount/merchant/month) produces
  // noisy false positives in the review queue.
  const expenses = await db.getAllAsync<Expense>(
    `SELECT * FROM expenses
     WHERE user_id = ? AND nature IN ('realized', 'credit') AND status != 'rejected'
       AND deleted_at IS NULL AND date >= ?
       AND refund_of_expense_id IS NULL
     ORDER BY date DESC, created_at DESC;`,
    userId,
    windowStart,
  );

  const sameDayGroups = findDuplicateGroups(expenses, "");
  const monthlyGroups = findNearbyDuplicateGroups(expenses, sameDayGroups, "");
  const groups = [...sameDayGroups, ...monthlyGroups];

  return {
    groups,
    scannedCount: expenses.length,
    duplicateGroupCount: groups.length,
  };
}

/**
 * Scan forecast (upcoming) expenses for duplicate dues.
 * Same algorithm as realized scan but applied to forecasts only.
 * Flags cases like two identical CC bill forecasts for the same amount and date.
 */
export async function scanForDuplicateForecasts(
  userId: string,
): Promise<DuplicateScanResult> {
  const db = getDatabase();

  const forecasts = await db.getAllAsync<Expense>(
    `SELECT * FROM expenses
     WHERE user_id = ? AND nature = 'forecast' AND status != 'rejected' AND deleted_at IS NULL
       AND refund_of_expense_id IS NULL
     ORDER BY due_date ASC, created_at DESC;`,
    userId,
  );

  // For forecasts, use due_date as the comparison date
  const mapped = forecasts.map((f) => ({ ...f, date: f.due_date ?? f.date }));
  const sameDayGroups = findDuplicateGroups(mapped, "Upcoming: ");
  const monthlyGroups = findNearbyDuplicateGroups(mapped, sameDayGroups, "Upcoming: ");
  const groups = [...sameDayGroups, ...monthlyGroups];

  return {
    groups,
    scannedCount: forecasts.length,
    duplicateGroupCount: groups.length,
  };
}

/**
 * Combined scan: check both realized and forecast expenses for duplicates.
 * Returns merged results from both scans.
 */
export async function scanAllDuplicates(
  userId: string,
): Promise<DuplicateScanResult> {
  const [realized, forecast] = await Promise.all([
    scanForDuplicates(userId),
    scanForDuplicateForecasts(userId),
  ]);

  // Filter out groups the user has explicitly marked as "Keep both".
  // A group is considered dismissed only when the exact cluster of expense IDs
  // matches — if a new duplicate joins the cluster, the key changes and the
  // group re-surfaces for fresh review.
  const dismissed = loadDismissedSet();
  const merged = [...realized.groups, ...forecast.groups];
  const filtered = merged.filter((g) => !dismissed.has(groupKey(g.expenses)));

  return {
    groups: filtered,
    scannedCount: realized.scannedCount + forecast.scannedCount,
    duplicateGroupCount: filtered.length,
  };
}

// ---------------------------------------------------------------------------
// v17.5.9 — scanAllDuplicates cache
// ---------------------------------------------------------------------------
// scanAllDuplicates is expensive (180-day window × growing history) and used
// to run on every Home load + every Review Queue focus + cold-start splash.
// Cache the result in memory, invalidate after 60s OR explicitly via
// `invalidateDuplicateScanCache()` from expense mutation paths.
//
// Single in-flight promise guard prevents concurrent callers stampeding the
// scan — the second caller waits for the first rather than running its own.

const SCAN_CACHE_TTL_MS = 60_000;
const PERSISTED_SCAN_KEY = "duplicate_scan_cache_v1";
interface ScanCacheEntry {
  userId: string;
  at: number;
  result: DuplicateScanResult;
}
let scanCache: ScanCacheEntry | null = null;
let inFlight: Promise<DuplicateScanResult> | null = null;

/** Drop the cached scan. Call from any code path that mutates expenses. */
export function invalidateDuplicateScanCache(): void {
  scanCache = null;
  settingsStorage.delete(PERSISTED_SCAN_KEY);
}

// Cold-start variant of the cache above: scanCache resets to null on every
// JS reload, so without this, the first call after every app launch redid
// the full (expensive, history-scaling) scan even if nothing changed since
// the app was last closed. Persisted entry is only trusted if dataVersion
// hasn't moved since it was written — any mutation invalidates it via the
// subscribeDataVersion hook below, same as the in-memory cache.
interface PersistedScanEntry {
  userId: string;
  dataVersion: number;
  result: DuplicateScanResult;
}

function loadPersistedScan(userId: string): DuplicateScanResult | null {
  const raw = settingsStorage.getString(PERSISTED_SCAN_KEY);
  if (!raw) return null;
  try {
    const entry: PersistedScanEntry = JSON.parse(raw);
    if (entry.userId === userId && entry.dataVersion === getDataVersion()) {
      return entry.result;
    }
  } catch {
    // Corrupt/old-shape entry — ignore and let a fresh scan replace it.
  }
  return null;
}

function savePersistedScan(userId: string, result: DuplicateScanResult): void {
  const entry: PersistedScanEntry = { userId, dataVersion: getDataVersion(), result };
  settingsStorage.set(PERSISTED_SCAN_KEY, JSON.stringify(entry));
}

// Auto-invalidate whenever any expense mutation bumps the global data version.
// Single module-level subscription; no per-caller wiring needed. Guarded so
// tests whose MMKV mock lacks `addOnValueChangedListener` can still import
// the module without crashing — manual invalidation still works.
try {
  subscribeDataVersion(() => {
    scanCache = null;
    settingsStorage.delete(PERSISTED_SCAN_KEY);
  });
} catch {
  // No-op: test environment without a full MMKV listener surface.
}

/**
 * Cached variant of scanAllDuplicates. Returns the cached result if it's for
 * the same user and less than 60s old; otherwise runs a fresh scan.
 */
export async function scanAllDuplicatesCached(
  userId: string,
): Promise<DuplicateScanResult> {
  const now = Date.now();
  if (
    scanCache &&
    scanCache.userId === userId &&
    now - scanCache.at < SCAN_CACHE_TTL_MS
  ) {
    return scanCache.result;
  }
  // In-memory cache missed — likely a cold start. Check the persisted
  // cross-restart cache before paying for a fresh scan.
  const persisted = loadPersistedScan(userId);
  if (persisted) {
    scanCache = { userId, at: now, result: persisted };
    return persisted;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const result = await scanAllDuplicates(userId);
      scanCache = { userId, at: Date.now(), result };
      savePersistedScan(userId, result);
      return result;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
