/**
 * Money moving between the user's own accounts, decided from either side.
 *
 * Before this, a debit only became a transfer when its credit was already in Arth (paired by
 * money-events.resolveSelfTransfer); otherwise it stayed spending - often filed under a
 * "Transfers" category, which still counts as spending. Card bill payments seen from the bank
 * side ("Credit Card Bil ****322", "InfoBIL*INFT…", CRED, CheQ) weren't recognised at all.
 *
 * Now:
 *  - A debit that names one of the user's accounts (IMPS to A/c XX0006), or a card bill payment
 *    that names one of their cards, becomes a transfer straight away - paired with the credit
 *    when that's already here.
 *  - A credit that arrives later joins the transfer waiting for it instead of counting as income.
 *  - After a scan, every new debit and credit gets the same treatment, so the order messages are
 *    read in doesn't matter.
 *  - findTransferCandidates lists past ones for review without changing anything.
 */

import { DEFAULT_USER_ID } from "@/constants/app";
import { getDatabase } from "@/database";
import { reclassifyExpenseAsTransfer } from "@/services/account-transfer";
import { bumpDataVersion } from "@/services/settings";
import { parseBankSMS } from "@/services/sms/bank-patterns";
import { logger } from "@/utils/logger";

/** Days either side a transfer's two halves can be apart. */
const WINDOW_DAYS = 3;

/** Words that make a debit a credit card bill payment. */
const CARD_BILL = /credit\s*card|card\s*bil|\bcc\s*(?:bill|pay|payment)|\bbil\s*\*|billpay|bill\s*desk|\bcred\b|\bcheq\b|card\s*payment|card\s*dues/i;

interface Account {
  id: string;
  account_identifier: string | null;
  account_type: string;
  bank_name: string | null;
  account_label: string | null;
}

async function openAccounts(userId: string): Promise<Account[]> {
  return getDatabase().getAllAsync<Account>(
    `SELECT id, account_identifier, account_type, bank_name, account_label FROM financial_accounts
      WHERE user_id = ? AND is_active = 1 AND closed_at IS NULL
        AND account_identifier IS NOT NULL AND LENGTH(TRIM(account_identifier)) >= 3;`,
    userId,
  );
}

/** Masked account digits in a message or merchant name: XX0006, ****322, ending 4421, A/c 1234. */
export function digitsIn(text: string): string[] {
  const out = new Set<string>();
  const re = /(?:[x*•·]{2,}\s*|ending\s*(?:with\s*)?|a\/c\s*(?:no\.?\s*)?|acct?\s*|card\s*(?:no\.?\s*)?)(\d{3,6})\b/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) out.add(m[1].slice(-4));
  return [...out];
}

/**
 * Same account digits: the last 3 or 4 match. Banks shorten the same number differently - one
 * HDFC message says card XX322, another XX7322 - so the shorter of the two is compared, never
 * fewer than 3 digits. A match only counts when exactly one of the user's accounts fits.
 */
function endsWithDigits(identifier: string | null, d: string): boolean {
  if (!identifier) return false;
  const id = identifier.replace(/\D/g, "");
  const n = Math.min(4, id.length, d.length);
  return n >= 3 && id.slice(-n) === d.slice(-n);
}

/** Is this a credit card bill payment, going by its words? */
export function isCardBillText(text: string): boolean {
  return CARD_BILL.test(text);
}

/**
 * The other account's digits as the user sees them: from the merchant name ("IMPS to A/c XX0006")
 * first, then from the message. Both the transaction and its "Add account" button use this, so
 * they can't disagree.
 */
export function otherAccountDigits(merchant: string | null, raw: string | null): string | null {
  const fromMerchant = digitsIn(merchant ?? "")[0];
  if (fromMerchant) return fromMerchant;
  return raw ? parseBankSMS(raw)?.counterpartyAcctLast4 ?? null : null;
}

export interface Destination {
  accountId: string;
  /** "card" for a card bill payment, "account" for an account-to-account transfer. */
  kind: "card" | "account";
}

/**
 * Where a debit's money went, if it was to one of the user's own accounts. Null when it isn't
 * clear (no digits, digits matching nothing or more than one account).
 */
export async function destinationForDebit(
  userId: string,
  debit: { account_id: string; merchant_name: string | null; raw_source_text: string | null },
  accounts?: Account[],
): Promise<Destination | null> {
  const list = (accounts ?? (await openAccounts(userId))).filter((a) => a.id !== debit.account_id);
  const text = `${debit.merchant_name ?? ""} ${debit.raw_source_text ?? ""}`;
  const parsed = debit.raw_source_text ? parseBankSMS(debit.raw_source_text) : null;

  // 1. The message names the other account outright ("To A/c xxxx0006").
  const named = parsed?.counterpartyAcctLast4 ?? null;
  if (named) {
    const hits = list.filter((a) => endsWithDigits(a.account_identifier, named));
    if (hits.length === 1) return { accountId: hits[0].id, kind: hits[0].account_type === "credit_card" ? "card" : "account" };
  }

  // 2. A card bill payment that names one of the user's cards.
  if (CARD_BILL.test(text)) {
    const cards = list.filter((a) => a.account_type === "credit_card");
    const hits = cards.filter((c) => digitsIn(text).some((d) => endsWithDigits(c.account_identifier, d)));
    if (hits.length === 1) return { accountId: hits[0].id, kind: "card" };
  }

  // 3. Masked digits in the merchant name that match exactly one of the user's accounts
  //    ("IMPS to A/c XX0006").
  const fromMerchant = digitsIn(debit.merchant_name ?? "");
  if (fromMerchant.length > 0 && /\b(?:imps|neft|rtgs|upi|transfer|trf|to\s+a\/c)\b/i.test(text)) {
    const hits = list.filter((a) => fromMerchant.some((d) => endsWithDigits(a.account_identifier, d)));
    if (hits.length === 1) return { accountId: hits[0].id, kind: hits[0].account_type === "credit_card" ? "card" : "account" };
  }
  return null;
}

/** Digits a debit names for an account the user hasn't added yet ("IMPS to A/c XX0006" with no ··0006 account). */
export async function missingAccountDigits(
  userId: string,
  debit: { account_id: string; merchant_name: string | null; raw_source_text: string | null },
  accounts?: Account[],
): Promise<string | null> {
  const list = accounts ?? (await openAccounts(userId));
  const parsed = debit.raw_source_text ? parseBankSMS(debit.raw_source_text) : null;
  const text = `${debit.merchant_name ?? ""} ${debit.raw_source_text ?? ""}`;
  const own = list.find((a) => a.id === debit.account_id)?.account_identifier ?? null;
  const candidates = [parsed?.counterpartyAcctLast4 ?? null, ...digitsIn(debit.merchant_name ?? "")].filter((d): d is string => !!d);
  if (!/\b(?:imps|neft|rtgs|transfer|trf|to\s+a\/c)\b/i.test(text) && !CARD_BILL.test(text)) return null;
  for (const d of candidates) {
    if (endsWithDigits(own, d)) continue;
    if (!list.some((a) => endsWithDigits(a.account_identifier, d))) return d;
  }
  return null;
}

/** A credit on `accountId` that is the other half of this debit, if exactly one fits. */
async function matchingCredit(userId: string, debit: { id: string; amount: number; date: string }, accountId: string): Promise<string | null> {
  const rows = await getDatabase().getAllAsync<{ id: string }>(
    `SELECT id FROM expenses
      WHERE user_id = ? AND account_id = ? AND nature = 'credit' AND deleted_at IS NULL
        AND status IN ('approved', 'pending_review') AND ABS(amount - ?) < 0.01
        AND date >= date(?, '-${WINDOW_DAYS} day') AND date <= date(?, '+${WINDOW_DAYS} day')
        AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0)
        AND refund_of_expense_id IS NULL AND split_person_id IS NULL AND split_mode IS NULL;`,
    userId,
    accountId,
    debit.amount,
    debit.date,
    debit.date,
  );
  return rows.length === 1 ? rows[0].id : null;
}

/** Fold a credit into a transfer: it stops counting as income. */
async function attachCredit(creditId: string, transferId: string): Promise<void> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ status: string }>(`SELECT status FROM expenses WHERE id = ?;`, creditId);
  await db.runAsync(
    `UPDATE expenses SET reclassified_as_transfer = 1, linked_transfer_id = ?, money_event = NULL, updated_at = datetime('now') WHERE id = ?;`,
    transferId,
    creditId,
  );
  if (row?.status === "pending_review") {
    const { approveExpense } = await import("@/services/expense-crud");
    await approveExpense(creditId);
  }
}

/** Make a debit a transfer to `dest`, folding in its credit if that's already here. Returns the transfer id. */
export async function convertDebitToTransfer(userId: string, debitId: string, destAccountId: string): Promise<string> {
  const db = getDatabase();
  const debit = await db.getFirstAsync<{ id: string; amount: number; date: string }>(
    `SELECT id, amount, date FROM expenses WHERE id = ?;`,
    debitId,
  );
  if (!debit) throw new Error("Transaction not found");
  const transferId = await reclassifyExpenseAsTransfer(debitId, destAccountId);
  const credit = await matchingCredit(userId, debit, destAccountId);
  if (credit) await attachCredit(credit, transferId);
  bumpDataVersion();
  return transferId;
}

/**
 * A credit arriving on an account a transfer already went to (the debit side was read first):
 * fold it into that transfer. Returns true when it did.
 */
export async function attachCreditToWaitingTransfer(userId: string, creditId: string): Promise<boolean> {
  const db = getDatabase();
  const credit = await db.getFirstAsync<{ account_id: string | null; amount: number; date: string; reclassified_as_transfer: number | null }>(
    `SELECT account_id, amount, date, reclassified_as_transfer FROM expenses WHERE id = ? AND nature = 'credit' AND deleted_at IS NULL;`,
    creditId,
  );
  if (!credit?.account_id || credit.reclassified_as_transfer === 1) return false;
  const waiting = await db.getAllAsync<{ id: string }>(
    `SELECT t.id FROM account_transfers t
      WHERE t.user_id = ? AND t.to_account_id = ? AND t.deleted_at IS NULL AND ABS(t.amount - ?) < 0.01
        AND t.date >= date(?, '-${WINDOW_DAYS} day') AND t.date <= date(?, '+${WINDOW_DAYS} day')
        AND NOT EXISTS (
          SELECT 1 FROM expenses e WHERE e.linked_transfer_id = t.id AND e.nature = 'credit' AND e.deleted_at IS NULL
        );`,
    userId,
    credit.account_id,
    credit.amount,
    credit.date,
    credit.date,
  );
  if (waiting.length !== 1) return false;
  await attachCredit(creditId, waiting[0].id);
  bumpDataVersion();
  return true;
}

interface DebitRow {
  id: string;
  account_id: string;
  amount: number;
  date: string;
  merchant_name: string | null;
  raw_source_text: string | null;
}

/** Debits that could still be transfers: not already one, not split, not linked to something else. */
async function openDebits(userId: string, since: string | null): Promise<DebitRow[]> {
  return getDatabase().getAllAsync<DebitRow>(
    `SELECT e.id, e.account_id, e.amount, e.date, e.merchant_name, e.raw_source_text FROM expenses e
      WHERE e.user_id = ? AND e.nature = 'realized' AND e.deleted_at IS NULL AND e.account_id IS NOT NULL
        AND e.status IN ('approved', 'pending_review')
        AND (e.reclassified_as_transfer IS NULL OR e.reclassified_as_transfer = 0)
        AND e.split_person_id IS NULL AND e.split_mode IS NULL AND e.fulfills_rule_id IS NULL
        AND (e.money_event IS NULL OR e.money_event = 'self_transfer')
        ${since ? "AND e.date >= ?" : ""}
        AND NOT EXISTS (SELECT 1 FROM expense_investment_links l WHERE l.expense_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM expense_loan_links ll WHERE ll.expense_id = e.id)
      ORDER BY e.date;`,
    ...(since ? [userId, since] : [userId]),
  );
}

/**
 * After a scan: every debit since `since` that clearly went to one of the user's accounts becomes
 * a transfer, and every credit that's the other half of one joins it. Returns how many changed.
 */
export async function settleTransfersAfterScan(userId: string = DEFAULT_USER_ID, since: string | null = null): Promise<number> {
  const accounts = await openAccounts(userId);
  let changed = 0;
  for (const d of await openDebits(userId, since)) {
    try {
      const dest = await destinationForDebit(userId, d, accounts);
      if (!dest) continue;
      await convertDebitToTransfer(userId, d.id, dest.accountId);
      changed++;
    } catch (e) {
      logger.warn("Transfer after scan failed (non-fatal):", e);
    }
  }
  const credits = await getDatabase().getAllAsync<{ id: string }>(
    `SELECT id FROM expenses WHERE user_id = ? AND nature = 'credit' AND deleted_at IS NULL
       AND (reclassified_as_transfer IS NULL OR reclassified_as_transfer = 0) ${since ? "AND date >= ?" : ""};`,
    ...(since ? [userId, since] : [userId]),
  );
  for (const c of credits) {
    try {
      if (await attachCreditToWaitingTransfer(userId, c.id)) changed++;
    } catch (e) {
      logger.warn("Credit to transfer after scan failed (non-fatal):", e);
    }
  }
  return changed;
}

export interface TransferCandidate {
  expenseId: string;
  amount: number;
  date: string;
  merchant: string | null;
  fromAccountId: string;
  /** Set when the other account is in Arth. */
  toAccountId: string | null;
  kind: "card" | "account";
  /** Set when the other account isn't in Arth yet: the digits to add it with. */
  missingDigits: string | null;
}

/** Past debits that look like money between the user's own accounts - for review, changes nothing. */
export async function findTransferCandidates(userId: string = DEFAULT_USER_ID): Promise<TransferCandidate[]> {
  const accounts = await openAccounts(userId);
  const out: TransferCandidate[] = [];
  for (const d of await openDebits(userId, null)) {
    const dest = await destinationForDebit(userId, d, accounts);
    const missing = dest ? null : await missingAccountDigits(userId, d, accounts);
    if (!dest && !missing) continue;
    out.push({
      expenseId: d.id,
      amount: d.amount,
      date: d.date,
      merchant: d.merchant_name,
      fromAccountId: d.account_id,
      toAccountId: dest?.accountId ?? null,
      kind: dest?.kind ?? (CARD_BILL.test(`${d.merchant_name ?? ""} ${d.raw_source_text ?? ""}`) ? "card" : "account"),
      missingDigits: missing,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
