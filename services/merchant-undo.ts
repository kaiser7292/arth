/**
 * Undo for the Merchants screens (app/settings/merchants.tsx, merchant-detail.tsx).
 *
 * Before a change - rename, merge, separate, set or reset a category, apply to past transactions,
 * forget what Arth learned - `withMerchantUndo` copies everything a merchant change can touch:
 * the merchant name tables (merchant_aliases, merchant_mappings, merchant_corrections, all small)
 * and each transaction's merchant name and category. Undo puts those back exactly, so it never has
 * to work out the reverse of an operation.
 *
 * Only the latest change can be undone. It stays offered until the user closes it (the cross on
 * the undo bar) or makes another change. Kept in memory: closing the app ends the offer.
 */

import { useSyncExternalStore } from "react";
import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { bumpDataVersion } from "@/services/settings";

type Row = Record<string, unknown>;

interface Snapshot {
  aliases: Row[];
  mappings: Row[];
  corrections: Row[];
  /** id → merchant name and category before the change. */
  expenses: Map<string, { merchant_name: string | null; category_id: string | null }>;
}

export interface PendingUndo {
  id: number;
  /** What changed, in plain words: "Renamed Zomato Ltd to Zomato". */
  message: string;
}

let pending: (PendingUndo & { snapshot: Snapshot }) | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function takeSnapshot(userId: string): Promise<Snapshot> {
  const db = getDatabase();
  const [aliases, mappings, corrections, expenses] = await Promise.all([
    db.getAllAsync<Row>("SELECT * FROM merchant_aliases WHERE user_id = ?;", userId),
    db.getAllAsync<Row>("SELECT * FROM merchant_mappings;"),
    db.getAllAsync<Row>("SELECT * FROM merchant_corrections WHERE user_id = ?;", userId),
    db.getAllAsync<{ id: string; merchant_name: string | null; category_id: string | null }>(
      "SELECT id, merchant_name, category_id FROM expenses WHERE user_id = ? AND deleted_at IS NULL;",
      userId,
    ),
  ]);
  return {
    aliases,
    mappings,
    corrections,
    expenses: new Map(expenses.map((e) => [e.id, { merchant_name: e.merchant_name, category_id: e.category_id }])),
  };
}

async function restoreTable(table: string, rows: Row[], where: string, params: unknown[]): Promise<void> {
  const db = getDatabase();
  await db.runAsync(`DELETE FROM ${table} ${where};`, ...(params as never[]));
  for (const r of rows) {
    const cols = Object.keys(r);
    await db.runAsync(
      `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")});`,
      ...(cols.map((c) => r[c]) as never[]),
    );
  }
}

/**
 * Run a merchant change so it can be undone. `describe` gets the change's result and returns the
 * message for the undo bar.
 */
export async function withMerchantUndo<T>(change: () => Promise<T>, describe: (result: T) => string, userId: string = DEFAULT_USER_ID): Promise<T> {
  const snapshot = await takeSnapshot(userId);
  const result = await change();
  pending = { id: nextId++, message: describe(result), snapshot };
  emit();
  return result;
}

/** Put everything back as it was before the latest change. */
export async function undoMerchantChange(userId: string = DEFAULT_USER_ID): Promise<void> {
  const p = pending;
  if (!p) return;
  const db = getDatabase();
  const s = p.snapshot;
  await db.withTransactionAsync(async () => {
    await restoreTable("merchant_aliases", s.aliases, "WHERE user_id = ?", [userId]);
    await restoreTable("merchant_mappings", s.mappings, "", []);
    await restoreTable("merchant_corrections", s.corrections, "WHERE user_id = ?", [userId]);
    // Only the transactions whose merchant name or category actually changed.
    const now = await db.getAllAsync<{ id: string; merchant_name: string | null; category_id: string | null }>(
      "SELECT id, merchant_name, category_id FROM expenses WHERE user_id = ? AND deleted_at IS NULL;",
      userId,
    );
    for (const e of now) {
      const before = s.expenses.get(e.id);
      if (!before || (before.merchant_name === e.merchant_name && before.category_id === e.category_id)) continue;
      await db.runAsync(
        "UPDATE expenses SET merchant_name = ?, category_id = ?, updated_at = datetime('now') WHERE id = ?;",
        before.merchant_name,
        before.category_id,
        e.id,
      );
    }
  });
  pending = null;
  emit();
  bumpDataVersion();
}

/** The cross on the undo bar: keep the change and stop offering to undo it. */
export function dismissMerchantUndo(): void {
  pending = null;
  emit();
}

export function getPendingMerchantUndo(): PendingUndo | null {
  return pending ? { id: pending.id, message: pending.message } : null;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

let cached: PendingUndo | null = null;
function snapshotForReact(): PendingUndo | null {
  // Same object while nothing changed, as useSyncExternalStore requires.
  if ((cached?.id ?? null) !== (pending?.id ?? null)) cached = getPendingMerchantUndo();
  return cached;
}

/** The change currently offered for undo, for the undo bar. */
export function usePendingMerchantUndo(): PendingUndo | null {
  return useSyncExternalStore(subscribe, snapshotForReact, snapshotForReact);
}
