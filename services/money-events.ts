/**
 * Money events — SMS rows that aren't really spending or income:
 *
 *   fd_open        a debit that funds a fixed deposit
 *   fd_closure     a credit from a closed FD that Arth couldn't match to one
 *   self_transfer  money to/from your own account whose other side isn't in Arth yet
 *   sip            a mutual-fund auto-debit
 *
 * The SMS pipeline (sms-to-expense) stamps `expenses.money_event`; the review
 * queue shows a one-tap card for it; acting on the card clears the stamp.
 *
 * Self-transfers are paired here: when both the debit and the credit are in
 * Arth they become ONE transfer, with both rows flagged reclassified_as_transfer
 * so neither counts as spending/credit and the receiving account isn't
 * credited twice (transfer-in + credit).
 */

import { getDatabase } from "@/database";
import { reclassifyExpenseAsTransfer } from "@/services/account-transfer";
import type { MoneyEvent } from "@/services/expense-types";
import { linkClosureCreditToFD } from "@/services/investment-accounts";
import { bumpDataVersion } from "@/services/settings";
import { isSelfName } from "@/services/self-names";
import { parseBankSMS, type ParsedSMS } from "@/services/sms/bank-patterns";
import { logger } from "@/utils/logger";

/** Days either side of a transfer's date the other side may land on. */
export const SELF_TRANSFER_WINDOW_DAYS = 2;

export async function setMoneyEvent(expenseId: string, event: MoneyEvent | null): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE expenses SET money_event = ?, updated_at = datetime('now') WHERE id = ?;`,
    event,
    expenseId,
  );
  bumpDataVersion();
}

export async function clearMoneyEvent(expenseId: string): Promise<void> {
  await setMoneyEvent(expenseId, null);
}

// ─── Own accounts ────────────────────────────────────────────────────────────

export interface OwnAccount {
  id: string;
  account_identifier: string | null;
  account_label: string | null;
  bank_name: string | null;
  account_type: string;
}

/** The user's open account whose number ends in these digits, or null (none / ambiguous). */
export async function findOwnAccountByLast4(userId: string, last4: string): Promise<OwnAccount | null> {
  const db = getDatabase();
  const rows = await db.getAllAsync<OwnAccount>(
    `SELECT id, account_identifier, account_label, bank_name, account_type FROM financial_accounts
      WHERE user_id = ? AND is_active = 1 AND closed_at IS NULL
        AND account_identifier IS NOT NULL AND account_identifier != ''
        AND (account_identifier = ? OR account_identifier LIKE '%' || ?);`,
    userId,
    last4,
    last4,
  );
  return rows.length === 1 ? rows[0] : null;
}

// ─── Signals from the SMS ────────────────────────────────────────────────────

export interface TransferSignals {
  /** The SMS names the user ("Transferred to Mr. SOURAVBAID"). */
  selfName: boolean;
  /** The SMS names another account, and it's one of the user's. */
  ownCounterpartyAccountId: string | null;
  /** IMPS/NEFT/net-banking or UPI person-to-account — the shape a self-transfer has. */
  transferLike: boolean;
}

export async function readTransferSignals(userId: string, parsed: ParsedSMS): Promise<TransferSignals> {
  const own = parsed.counterpartyAcctLast4 ? await findOwnAccountByLast4(userId, parsed.counterpartyAcctLast4) : null;
  return {
    selfName: isSelfName(parsed.counterpartyName),
    ownCounterpartyAccountId: own?.id ?? null,
    transferLike: parsed.paymentMode === "net_banking" || parsed.upiSubtype === "p2a",
  };
}

/** Signals for a row already in the DB, re-read from its SMS body. */
async function signalsForRow(userId: string, rawSourceText: string | null): Promise<TransferSignals | null> {
  if (!rawSourceText) return null;
  const parsed = parseBankSMS(rawSourceText);
  return parsed ? readTransferSignals(userId, parsed) : null;
}

const strong = (s: TransferSignals | null) => !!s && (s.selfName || s.ownCounterpartyAccountId != null);

// ─── Self-transfer pairing ───────────────────────────────────────────────────

interface Candidate {
  id: string;
  account_id: string;
  raw_source_text: string | null;
}

/**
 * The other side of a self-transfer: same amount, another of the user's open
 * accounts, within ±2 days, approved or still in review, not already used.
 * Returns it only when exactly one candidate qualifies.
 */
async function findCounterpart(
  userId: string,
  side: "debit" | "credit",
  row: { id: string; account_id: string; amount: number; date: string },
  signals: TransferSignals,
): Promise<Candidate | null> {
  const db = getDatabase();
  const otherNature = side === "debit" ? "credit" : "realized";
  const rows = await db.getAllAsync<Candidate>(
    `SELECT e.id, e.account_id, e.raw_source_text FROM expenses e
       JOIN financial_accounts fa ON fa.id = e.account_id
      WHERE e.user_id = ? AND fa.is_active = 1 AND fa.closed_at IS NULL
        AND e.nature = ? AND e.status IN ('approved', 'pending_review') AND e.deleted_at IS NULL
        AND e.account_id != ? AND e.id != ?
        AND e.amount = ?
        AND e.date >= date(?, '-${SELF_TRANSFER_WINDOW_DAYS} day') AND e.date <= date(?, '+${SELF_TRANSFER_WINDOW_DAYS} day')
        AND (e.reclassified_as_transfer IS NULL OR e.reclassified_as_transfer = 0)
        AND e.refund_of_expense_id IS NULL AND e.matched_forecast_id IS NULL
        AND e.split_person_id IS NULL AND e.split_mode IS NULL
        AND (e.money_event IS NULL OR e.money_event = 'self_transfer')
        AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM investment_schedule_entries se WHERE se.linked_expense_id = e.id);`,
    userId,
    otherNature,
    row.account_id,
    row.id,
    row.amount,
    row.date,
    row.date,
  );

  let pool = rows;
  // The debit SMS named the destination account — only that account's credit can be the other side.
  if (side === "debit" && signals.ownCounterpartyAccountId) {
    pool = pool.filter((c) => c.account_id === signals.ownCounterpartyAccountId);
  }

  // Pair on a strong signal from either side, or when both sides are transfer-shaped.
  const qualified: Candidate[] = [];
  for (const c of pool) {
    const other = await signalsForRow(userId, c.raw_source_text);
    if (side === "credit" && other?.ownCounterpartyAccountId && other.ownCounterpartyAccountId !== row.account_id) continue;
    if (strong(signals) || strong(other) || (signals.transferLike && (other?.transferLike ?? false))) qualified.push(c);
  }
  return qualified.length === 1 ? qualified[0] : null;
}

/**
 * Turn a debit + credit into one transfer. The debit becomes the transfer
 * (reclassifyExpenseAsTransfer), the credit is flagged as part of it.
 * Undo from either row's transfer restores both (undoTransfer).
 */
export async function pairSelfTransfer(debitId: string, creditId: string): Promise<string> {
  const db = getDatabase();
  const credit = await db.getFirstAsync<{ account_id: string | null; status: string }>(
    `SELECT account_id, status FROM expenses WHERE id = ? AND nature = 'credit' AND deleted_at IS NULL;`,
    creditId,
  );
  if (!credit?.account_id) throw new Error("Credit has no account");

  const transferId = await reclassifyExpenseAsTransfer(debitId, credit.account_id);
  await db.runAsync(
    `UPDATE expenses SET reclassified_as_transfer = 1, linked_transfer_id = ?, money_event = NULL, updated_at = datetime('now')
      WHERE id IN (?, ?);`,
    transferId,
    debitId,
    creditId,
  );
  if (credit.status === "pending_review") {
    const { approveExpense } = await import("@/services/expense-crud");
    await approveExpense(creditId);
  }
  bumpDataVersion();
  return transferId;
}

/**
 * After an SMS debit or credit lands: pair it with its other side if that's
 * already in Arth, otherwise flag it 'self_transfer' when the SMS clearly
 * says it's the user's own money. Returns what happened.
 */
export async function resolveSelfTransfer(
  userId: string,
  expenseId: string,
  side: "debit" | "credit",
  parsed: ParsedSMS,
): Promise<"paired" | "flagged" | "none"> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ id: string; account_id: string | null; amount: number; date: string }>(
    `SELECT id, account_id, amount, date FROM expenses WHERE id = ? AND deleted_at IS NULL;`,
    expenseId,
  );
  if (!row?.account_id) return "none";

  const signals = await readTransferSignals(userId, parsed);
  if (!strong(signals) && !signals.transferLike) return "none";

  const counterpart = await findCounterpart(userId, side, { ...row, account_id: row.account_id }, signals);
  if (counterpart) {
    try {
      if (side === "debit") await pairSelfTransfer(row.id, counterpart.id);
      else await pairSelfTransfer(counterpart.id, row.id);
      return "paired";
    } catch (e) {
      logger.warn("Self-transfer pairing failed (non-fatal):", e);
    }
  }

  if (strong(signals)) {
    await setMoneyEvent(row.id, "self_transfer");
    return "flagged";
  }
  return "none";
}

// ─── FD closure ──────────────────────────────────────────────────────────────

export interface FdCandidate {
  financialAccountId: string;
  label: string;
  principal: number;
  startDate: string | null;
  accountIdentifier: string | null;
  sourceAccountId: string | null;
}

/** Active FDs this closure credit could belong to (for the matcher and the "Close one of my FDs" picker). */
export async function getActiveFDs(userId: string, beforeDate?: string): Promise<FdCandidate[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{
    financial_account_id: string;
    account_label: string | null;
    bank_name: string | null;
    account_identifier: string | null;
    principal: number | null;
    start_date: string | null;
    source_account_id: string | null;
  }>(
    `SELECT ip.financial_account_id, fa.account_label, fa.bank_name, fa.account_identifier,
            ip.principal, ip.start_date, ip.source_account_id
       FROM investment_products ip
       JOIN financial_accounts fa ON fa.id = ip.financial_account_id
      WHERE fa.user_id = ? AND fa.is_active = 1 AND fa.closed_at IS NULL
        AND ip.instrument = 'fd' AND ip.status = 'active'
        AND (? IS NULL OR ip.start_date IS NULL OR ip.start_date <= ?)
      ORDER BY ip.start_date DESC;`,
    userId,
    beforeDate ?? null,
    beforeDate ?? null,
  );
  return rows.map((r) => ({
    financialAccountId: r.financial_account_id,
    label: r.account_label || `${r.bank_name ?? ""} FD`.trim(),
    principal: r.principal ?? 0,
    startDate: r.start_date,
    accountIdentifier: r.account_identifier,
    sourceAccountId: r.source_account_id,
  }));
}

/** Largest payout we'll read as principal + interest on an early or on-time closure. */
const MAX_PAYOUT_MULTIPLE = 1.5;

/**
 * Which FD does this closure credit close? Pure.
 *   1. The SMS's deposit number matches the FD's account number (last 4).
 *   2. Exactly one FD funded from this savings account (or with no source
 *      recorded) has principal ≤ amount ≤ principal × 1.5.
 */
export function pickFdForClosure(
  fds: readonly FdCandidate[],
  credit: { amount: number; accountId: string | null; fdNumber: string | null },
): { fd: FdCandidate; by: "number" | "amount" } | null {
  if (credit.fdNumber) {
    const want = credit.fdNumber.replace(/\D/g, "").slice(-4);
    const byNumber = fds.filter((f) => {
      const have = (f.accountIdentifier ?? "").replace(/\D/g, "");
      return want.length >= 3 && have.length >= 3 && (have.endsWith(want) || want.endsWith(have.slice(-4)));
    });
    if (byNumber.length === 1) return { fd: byNumber[0], by: "number" };
  }
  const byAmount = fds.filter(
    (f) =>
      f.principal > 0 &&
      credit.amount >= f.principal &&
      credit.amount <= f.principal * MAX_PAYOUT_MULTIPLE &&
      (!f.sourceAccountId || !credit.accountId || f.sourceAccountId === credit.accountId),
  );
  return byAmount.length === 1 ? { fd: byAmount[0], by: "amount" } : null;
}

/**
 * A just-inserted SMS credit that says an FD/TD closed. Matched → linked as the
 * FD's payout (auto-approved, closing the FD, when matched by deposit number).
 * Not matched → flagged 'fd_closure' for the review card.
 */
export async function resolveFdClosure(
  userId: string,
  creditId: string,
  parsed: ParsedSMS,
): Promise<"closed" | "linked" | "flagged"> {
  const db = getDatabase();
  const credit = await db.getFirstAsync<{ amount: number; date: string; account_id: string | null }>(
    `SELECT amount, date, account_id FROM expenses WHERE id = ?;`,
    creditId,
  );
  if (!credit) return "flagged";
  const fds = await getActiveFDs(userId, credit.date);
  const pick = pickFdForClosure(fds, { amount: credit.amount, accountId: credit.account_id, fdNumber: parsed.fdNumber ?? null });
  if (!pick) {
    await setMoneyEvent(creditId, "fd_closure");
    return "flagged";
  }
  try {
    await db.runAsync(`UPDATE expenses SET description = ? WHERE id = ?;`, `${pick.fd.label} closed`, creditId);
    await linkClosureCreditToFD(pick.fd.financialAccountId, creditId);
    if (pick.by === "number") {
      const { approveExpense } = await import("@/services/expense-crud");
      await approveExpense(creditId);
      return "closed";
    }
    return "linked";
  } catch (e) {
    logger.warn("FD closure match failed (non-fatal):", e);
    await setMoneyEvent(creditId, "fd_closure");
    return "flagged";
  }
}

/** From the review card: this closure credit closes that FD. */
export async function closeFdWithCredit(financialAccountId: string, creditId: string): Promise<void> {
  await linkClosureCreditToFD(financialAccountId, creditId);
  await clearMoneyEvent(creditId);
  const db = getDatabase();
  const row = await db.getFirstAsync<{ status: string }>(`SELECT status FROM expenses WHERE id = ?;`, creditId);
  if (row?.status === "pending_review") {
    const { approveExpense } = await import("@/services/expense-crud");
    await approveExpense(creditId);
  }
}

export interface DepositDebit {
  id: string;
  account_id: string;
  amount: number;
  date: string;
  updated_at: string;
  merchant_name: string | null;
}

/**
 * The debit that most likely funded the FD this closure credit came from —
 * for "Record this FD" when the FD was never added. Same account, before the
 * credit (≤ 400 days), amount between credit/1.5 and the credit, flagged as an
 * FD deposit or a transfer to the user's own name. Closest amount wins.
 */
export async function findDepositDebitForClosure(creditId: string): Promise<DepositDebit | null> {
  const db = getDatabase();
  const credit = await db.getFirstAsync<{ user_id: string; account_id: string | null; amount: number; date: string }>(
    `SELECT user_id, account_id, amount, date FROM expenses WHERE id = ?;`,
    creditId,
  );
  if (!credit?.account_id) return null;
  return (
    (await db.getFirstAsync<DepositDebit>(
      `SELECT id, account_id, amount, date, updated_at, merchant_name FROM expenses
        WHERE user_id = ? AND account_id = ? AND nature = 'realized' AND deleted_at IS NULL
          AND status IN ('approved', 'pending_review')
          AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
          AND money_event IN ('fd_open', 'self_transfer')
          AND date <= ? AND date >= date(?, '-400 day')
          AND amount <= ? AND amount >= ?
        ORDER BY ? - amount ASC, date DESC
        LIMIT 1;`,
      credit.user_id,
      credit.account_id,
      credit.date,
      credit.date,
      credit.amount,
      credit.amount / MAX_PAYOUT_MULTIPLE,
      credit.amount,
    )) ?? null
  );
}

/**
 * Re-run self-transfer detection over SMS rows still waiting for review — after the user
 * confirms their name, so transfers already in the queue get paired/flagged without a rescan.
 * Only rows whose SMS names the user or one of their accounts; approved rows are left alone
 * (the user already decided what they are). Returns how many changed.
 */
export async function recheckSelfTransfers(userId: string): Promise<number> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ id: string; nature: string; raw_source_text: string }>(
    `SELECT id, nature, raw_source_text FROM expenses
      WHERE user_id = ? AND source = 'sms_auto' AND status = 'pending_review' AND deleted_at IS NULL
        AND nature IN ('realized', 'credit') AND raw_source_text IS NOT NULL
        AND money_event IS NULL AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
        AND refund_of_expense_id IS NULL
      ORDER BY date ASC, created_at ASC;`,
    userId,
  );
  let changed = 0;
  for (const r of rows) {
    const parsed = parseBankSMS(r.raw_source_text);
    if (!parsed || parsed.fdEvent) continue;
    const signals = await readTransferSignals(userId, parsed);
    if (!strong(signals)) continue;
    // Skip a row a previous iteration already paired as the other side.
    const still = await db.getFirstAsync<{ r: number | null }>(
      `SELECT reclassified_as_transfer AS r FROM expenses WHERE id = ?;`,
      r.id,
    );
    if (still?.r === 1) continue;
    const outcome = await resolveSelfTransfer(userId, r.id, r.nature === "credit" ? "credit" : "debit", parsed);
    if (outcome !== "none") changed++;
  }
  return changed;
}
