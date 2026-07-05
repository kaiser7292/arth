/**
 * Demat transfer side-effects.
 *
 * When money is transferred INTO a demat account, the user can declare:
 *   - whether it lands as "fund" (idle cash with the broker) or "portfolio"
 *     (already invested in this amount), and
 *   - optionally which investment_bucket the transfer contributes to.
 *
 * These decisions are persisted on the account_transfers row (migration 011),
 * which makes the "delete transfer → reverse every side-effect" path trivially
 * correct: the row tells us exactly what snapshot it touched and what
 * contribution to unwind.
 *
 * Contract:
 *   - This module does NOT create the transfer row itself — callers already
 *     do that via createTransfer. It applies the demat-specific side-effects
 *     and annotates the existing row.
 *   - Safe to call only on demat-destination transfers. Caller should guard.
 *   - Idempotent-ish: re-applying on a transfer that already has demat_target
 *     set will first reverse the prior side-effect, then apply the new one.
 *     (Useful if the user changes their mind via an "edit transfer" flow
 *     later; not used in this release.)
 */

import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import {
  createInvestmentContribution,
  deleteInvestmentContribution,
} from "@/services/yearly-plan";

export type DematTarget = "fund" | "portfolio" | "withdrawal";

export interface DematTargetInput {
  target: DematTarget;
  /** Optional — links the transfer to an active bucket so it shows up in yearly plan progress. */
  bucketId?: string | null;
}

type SnapshotTable = "demat_fund_snapshots" | "demat_portfolio_snapshots";
type ValueColumn = "fund_value" | "portfolio_value";

function resolveTable(target: DematTarget): {
  table: SnapshotTable;
  column: ValueColumn;
} {
  return target === "fund"
    ? { table: "demat_fund_snapshots", column: "fund_value" }
    : { table: "demat_portfolio_snapshots", column: "portfolio_value" };
}

/**
 * Apply the demat side-effects of a transfer that just landed in a demat
 * account. Updates the chosen snapshot table additively on `date` and — if a
 * bucket is provided — also creates an investment_contributions row. Stamps
 * demat_target + investment_bucket_id onto the transfer row so the reverse
 * operation knows what to undo.
 */
export async function handleDematTransferSideEffects(
  transferId: string,
  dematAccountId: string,
  amount: number,
  date: string,
  input: DematTargetInput,
): Promise<void> {
  if (!(amount > 0)) {
    throw new Error("Transfer amount must be positive.");
  }
  const db = getDatabase();
  const { table, column } = resolveTable(input.target);
  const month = date.slice(0, 7); // YYYY-MM

  await db.withTransactionAsync(async () => {
    // 1. Same-date snapshot: additive upsert.
    //    If a snapshot already exists for this (account, date), add the amount
    //    to it. Otherwise take the most recent snapshot on-or-before this date
    //    as the baseline and insert a new row at `baseline + amount`.
    const existing = await db.getFirstAsync<{ id: string; value: number }>(
      `SELECT id, ${column} as value FROM ${table}
       WHERE account_id = ? AND snapshot_date = ?;`,
      dematAccountId,
      date,
    );

    if (existing) {
      await db.runAsync(
        `UPDATE ${table} SET ${column} = ?, updated_at = datetime('now') WHERE id = ?;`,
        existing.value + amount,
        existing.id,
      );
    } else {
      const baselineRow = await db.getFirstAsync<{ value: number }>(
        `SELECT ${column} as value FROM ${table}
         WHERE account_id = ? AND snapshot_date <= ?
         ORDER BY snapshot_date DESC LIMIT 1;`,
        dematAccountId,
        date,
      );
      const baseline = baselineRow?.value ?? 0;
      await db.runAsync(
        `INSERT INTO ${table} (id, account_id, snapshot_date, ${column})
         VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' ||
                 lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' ||
                 lower(hex(randomblob(6))), ?, ?, ?);`,
        dematAccountId,
        date,
        baseline + amount,
      );
    }

    // 2. Optional: record an investment_contributions row so the yearly plan +
    //    linked milestone reflect this transfer as progress. createInvestmentContribution
    //    already updates current_contributed and the linked milestone's current_saved.
    //    Capture the contribution id so the reverse path can delete it by PK
    //    (deterministic; survives duplicate amounts on the same date).
    const bucketId: string | null = input.bucketId ?? null;
    let contributionId: string | null = null;
    if (bucketId) {
      contributionId = await createInvestmentContribution({
        investment_bucket_id: bucketId,
        month,
        amount,
        date,
        notes: `Auto from transfer (${input.target})`,
      });
    }

    // 3. Stamp the decisions on the transfer row so reverse can undo them.
    await db.runAsync(
      `UPDATE account_transfers
       SET demat_target = ?, investment_bucket_id = ?, linked_contribution_id = ?,
           updated_at = datetime('now')
       WHERE id = ?;`,
      input.target,
      bucketId,
      contributionId,
      transferId,
    );
  });
  bumpDataVersion();
}

/**
 * Apply the demat side-effect of a transfer that came FROM a demat account
 * (redemption/withdrawal). Subtracts the transfer amount from the idle fund
 * snapshot on `date` and stamps demat_target = 'withdrawal' so deletion knows
 * to reverse it. Always subtracts from the fund (idle cash), never portfolio.
 */
export async function handleDematWithdrawalSideEffects(
  transferId: string,
  dematAccountId: string,
  amount: number,
  date: string,
): Promise<void> {
  if (!(amount > 0)) {
    throw new Error("Transfer amount must be positive.");
  }
  const db = getDatabase();

  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<{ id: string; fund_value: number }>(
      `SELECT id, fund_value FROM demat_fund_snapshots
       WHERE account_id = ? AND snapshot_date = ?;`,
      dematAccountId,
      date,
    );

    if (existing) {
      await db.runAsync(
        `UPDATE demat_fund_snapshots SET fund_value = ?, updated_at = datetime('now') WHERE id = ?;`,
        existing.fund_value - amount,
        existing.id,
      );
    } else {
      const baselineRow = await db.getFirstAsync<{ fund_value: number }>(
        `SELECT fund_value FROM demat_fund_snapshots
         WHERE account_id = ? AND snapshot_date <= ?
         ORDER BY snapshot_date DESC LIMIT 1;`,
        dematAccountId,
        date,
      );
      const baseline = baselineRow?.fund_value ?? 0;
      await db.runAsync(
        `INSERT INTO demat_fund_snapshots (id, account_id, snapshot_date, fund_value)
         VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' ||
                 lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' ||
                 lower(hex(randomblob(6))), ?, ?, ?);`,
        dematAccountId,
        date,
        baseline - amount,
      );
    }

    await db.runAsync(
      `UPDATE account_transfers
       SET demat_target = 'withdrawal', updated_at = datetime('now')
       WHERE id = ?;`,
      transferId,
    );
  });
  bumpDataVersion();
}

/**
 * Reverse every demat-specific side-effect of a transfer — called before the
 * transfer is soft-deleted so the snapshot + bucket + milestone numbers come
 * back to their pre-transfer state.
 *
 * Does NOT open its own transaction — the caller must already be inside one
 * (see `deleteTransfer` in `account-transfer.ts` for the composition). Atomic
 * guarantees depend on the outer txn rolling back if any step here fails.
 *
 * No-op for transfers with `demat_target = NULL` (never had side effects).
 */
async function reverseDematTransferSideEffectsInTxn(transferId: string): Promise<void> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{
    amount: number;
    date: string;
    from_account_id: string;
    to_account_id: string;
    demat_target: DematTarget | null;
    investment_bucket_id: string | null;
    linked_contribution_id: string | null;
  }>(
    `SELECT amount, date, from_account_id, to_account_id, demat_target, investment_bucket_id, linked_contribution_id
     FROM account_transfers WHERE id = ?;`,
    transferId,
  );
  if (!row || !row.demat_target) return;

  // Withdrawal: reverse by adding back the amount to the fund snapshot on from_account_id.
  if (row.demat_target === "withdrawal") {
    await db.runAsync(
      `UPDATE account_transfers SET demat_target = NULL, updated_at = datetime('now') WHERE id = ?;`,
      transferId,
    );
    const snap = await db.getFirstAsync<{ id: string; fund_value: number }>(
      `SELECT id, fund_value FROM demat_fund_snapshots
       WHERE account_id = ? AND snapshot_date = ?;`,
      row.from_account_id,
      row.date,
    );
    if (snap) {
      await db.runAsync(
        `UPDATE demat_fund_snapshots SET fund_value = ?, updated_at = datetime('now') WHERE id = ?;`,
        snap.fund_value + row.amount,
        snap.id,
      );
    }
    return;
  }

  const { table, column } = resolveTable(row.demat_target);
  {
    // Capture the contribution id to delete AFTER we clear the FK stamp —
    // otherwise foreign_keys = ON blocks DELETE on investment_contributions
    // while account_transfers.linked_contribution_id still points at it.
    //
    // Fallback: for transfers created before v14.5.0, linked_contribution_id
    // didn't exist as a column, so the stamp is null. Search for the matching
    // contribution by (bucket, amount, date, note-marker) instead. This
    // fallback triggers ONLY when the bucket is known but the contribution
    // id stamp is missing — so there's no ambiguity risk on fresh transfers.
    let contribToDelete:
      | { id: string; bucketId: string }
      | null = null;
    if (row.linked_contribution_id && row.investment_bucket_id) {
      contribToDelete = {
        id: row.linked_contribution_id,
        bucketId: row.investment_bucket_id,
      };
    } else if (row.investment_bucket_id) {
      const legacyMatch = await db.getFirstAsync<{ id: string }>(
        `SELECT id FROM investment_contributions
         WHERE investment_bucket_id = ? AND amount = ? AND date = ?
           AND notes LIKE 'Auto from transfer%'
         ORDER BY rowid DESC LIMIT 1;`,
        row.investment_bucket_id,
        row.amount,
        row.date,
      );
      if (legacyMatch) {
        contribToDelete = {
          id: legacyMatch.id,
          bucketId: row.investment_bucket_id,
        };
      }
    }

    // 1. Clear the stamps FIRST so no outbound FKs block subsequent deletes.
    //    (If the outer transaction rolls back, all of this is undone atomically.)
    await db.runAsync(
      `UPDATE account_transfers
       SET demat_target = NULL, investment_bucket_id = NULL, linked_contribution_id = NULL,
           updated_at = datetime('now')
       WHERE id = ?;`,
      transferId,
    );

    // 2. Subtract the amount from the snapshot on this date.
    const snap = await db.getFirstAsync<{ id: string; value: number }>(
      `SELECT id, ${column} as value FROM ${table}
       WHERE account_id = ? AND snapshot_date = ?;`,
      row.to_account_id,
      row.date,
    );
    if (snap) {
      const next = snap.value - row.amount;
      // Clean up phantom-zero snapshots: if this subtraction empties the row
      // to zero or below, delete it so history doesn't show a 0-value blip.
      if (next <= 0.0001) {
        await db.runAsync(`DELETE FROM ${table} WHERE id = ?;`, snap.id);
      } else {
        await db.runAsync(
          `UPDATE ${table} SET ${column} = ?, updated_at = datetime('now') WHERE id = ?;`,
          next,
          snap.id,
        );
      }
    }

    // 3. Remove the investment_contributions row we created, if any.
    //    Uses the stamped id (migration 011) — O(1) PK lookup, deterministic
    //    even when another manual contribution with identical amount/date
    //    exists. deleteInvestmentContribution auto-recalculates
    //    bucket.current_contributed and re-syncs the linked milestone.
    if (contribToDelete) {
      await deleteInvestmentContribution(
        contribToDelete.id,
        contribToDelete.bucketId,
      );
    }
  }
}

// Export the txn-less variant for callers that need atomic composition
// with their own wider transaction (e.g. deleteTransfer).
export { reverseDematTransferSideEffectsInTxn };
