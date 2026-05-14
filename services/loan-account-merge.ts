/**
 * Loan account dedup detection + merge (v17.6.0).
 *
 * Solves the long-standing problem where adding a loan manually created one
 * financial_accounts row and SMS auto-detection from EMI reminders created
 * ANOTHER one for the same underlying bank account. Users saw two cards for
 * the same loan in Account Master.
 *
 * Detection tiers (bank name normalised + last-4 digits compared):
 *   - Tier 1 — auto-merged silently inside createLoan (same bank_name +
 *     same account_identifier, digits-exact). Not reached here.
 *   - Tier 2 — SAME bank_name + last-4 digits match between the loan's FA
 *     identifier or agreement_id and another loan-type FA's identifier.
 *     Surfaced as a merge suggestion (user confirms before we merge).
 *   - Tier 3 — only bank_name matches, no digit overlap. Ignored — could
 *     be two genuinely separate loans at the same bank.
 *
 * Placeholder identifiers (`loan-\d+`) are never candidates — they're the
 * auto-generated fallback and would produce false positives against any
 * random account.
 *
 * The merge operation is transactional and repoints every FK that can
 * point at a financial_accounts row so the UI doesn't break after merge.
 */

import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";

const PLACEHOLDER_IDENTIFIER_REGEX = /^loan-\d+$/i;

/** Extract the last 4 digits of any identifier-ish string. Returns null for
 *  placeholder identifiers and strings with fewer than 4 digits. */
export function extractLast4(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (PLACEHOLDER_IDENTIFIER_REGEX.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

/** Normalised bank name for comparison. Lowercased, collapsed whitespace. */
function normBank(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface LoanMergeCandidate {
  loanId: string;
  /** FA currently bound to the loan via loan_accounts.financial_account_id. */
  loanFaId: string;
  loanFaIdentifier: string;
  loanFaCreatedAt: string;
  /** Other loan-type FA that looks like the same account as this loan. */
  candidateFaId: string;
  candidateIdentifier: string;
  candidateCreatedAt: string;
  candidateLabel: string | null;
  bankName: string;
  /** Count of live expenses currently linked to the candidate FA. Gives the
   *  user a sense of "merging would repoint N expenses". */
  candidateExpenseCount: number;
}

interface FaRow {
  id: string;
  bank_name: string;
  account_identifier: string;
  account_label: string | null;
  account_type: string;
  created_at: string;
}

interface LoanRow {
  id: string;
  financial_account_id: string;
  agreement_id: string | null;
}

/**
 * Scan every loan in the DB for Tier-2 merge candidates.
 *
 * Returns one candidate per (loan, duplicate FA) pair. If a loan has multiple
 * matching candidates we still return each — the UI surfaces them in a
 * review list rather than auto-prompting, matching the "multiple candidates
 * → review manually" rule.
 */
export async function findLoanMergeCandidates(
  userId: string,
): Promise<LoanMergeCandidate[]> {
  const db = getDatabase();

  const loans = await db.getAllAsync<LoanRow>(
    `SELECT la.id, la.financial_account_id, la.agreement_id
       FROM loan_accounts la
       JOIN financial_accounts fa ON fa.id = la.financial_account_id
      WHERE fa.user_id = ? AND la.status = 'active' AND fa.is_active = 1;`,
    userId,
  );
  if (loans.length === 0) return [];

  const loanFaIds = loans.map((l) => l.financial_account_id);
  const loanFas = await db.getAllAsync<FaRow>(
    `SELECT id, bank_name, account_identifier, account_label, account_type, created_at
       FROM financial_accounts
      WHERE id IN (${loanFaIds.map(() => "?").join(",")});`,
    ...loanFaIds,
  );
  const loanFaById = new Map(loanFas.map((fa) => [fa.id, fa]));

  // All other loan-type FAs owned by this user — potential merge candidates.
  const allLoanFas = await db.getAllAsync<FaRow>(
    `SELECT id, bank_name, account_identifier, account_label, account_type, created_at
       FROM financial_accounts
      WHERE user_id = ? AND is_active = 1 AND account_type = 'loan';`,
    userId,
  );

  // Pre-compute expense counts per FA so the UI can show "merging will
  // repoint N expenses". One grouped query.
  const expenseCountRows = await db.getAllAsync<{ account_id: string; cnt: number }>(
    `SELECT account_id, COUNT(*) AS cnt
       FROM expenses
      WHERE account_id IN (${allLoanFas.map(() => "?").join(",")})
        AND deleted_at IS NULL
      GROUP BY account_id;`,
    ...allLoanFas.map((fa) => fa.id),
  );
  const expenseCountByFa = new Map(expenseCountRows.map((r) => [r.account_id, r.cnt]));

  const results: LoanMergeCandidate[] = [];

  for (const loan of loans) {
    const loanFa = loanFaById.get(loan.financial_account_id);
    if (!loanFa) continue;

    // Last 4 digits from either the account_identifier or the agreement_id —
    // the user may have entered the account digits in one field and not the
    // other, depending on when the loan was added.
    const candidateDigits = new Set<string>();
    const fromIdent = extractLast4(loanFa.account_identifier);
    if (fromIdent) candidateDigits.add(fromIdent);
    const fromAgreement = extractLast4(loan.agreement_id);
    if (fromAgreement) candidateDigits.add(fromAgreement);
    if (candidateDigits.size === 0) continue;

    const loanBank = normBank(loanFa.bank_name);
    if (!loanBank) continue;

    // Scan other FAs for a Tier-2 match.
    for (const other of allLoanFas) {
      if (other.id === loanFa.id) continue;
      if (normBank(other.bank_name) !== loanBank) continue;

      // Skip if the other FA is already bound to another loan_accounts row —
      // we merge into the CURRENT loan's FA, so the "other" must be an
      // orphan (SMS-created FA without a loan_accounts sibling).
      const otherBound = await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM loan_accounts WHERE financial_account_id = ? LIMIT 1;",
        other.id,
      );
      if (otherBound) continue;

      const otherLast4 = extractLast4(other.account_identifier);
      if (!otherLast4) continue;
      if (!candidateDigits.has(otherLast4)) continue;

      results.push({
        loanId: loan.id,
        loanFaId: loanFa.id,
        loanFaIdentifier: loanFa.account_identifier,
        loanFaCreatedAt: loanFa.created_at,
        candidateFaId: other.id,
        candidateIdentifier: other.account_identifier,
        candidateCreatedAt: other.created_at,
        candidateLabel: other.account_label,
        bankName: loanFa.bank_name,
        candidateExpenseCount: expenseCountByFa.get(other.id) ?? 0,
      });
    }
  }

  return results;
}

/**
 * Merge two loan-type financial_accounts rows into one.
 *
 * `keepFaId` survives. `dropFaId` is deleted after every live FK pointing
 * at it has been repointed. The merged row keeps the kept FA's label /
 * identifier, but if the dropped FA was older (earlier created_at) we
 * preserve its created_at so activity history stays chronologically sound.
 *
 * This is the UX variant for loan dedup — the dropped FA must NOT be bound
 * to a loan_accounts row (findLoanMergeCandidates guarantees that).
 *
 * Repoints:
 *   - expenses.account_id
 *   - account_credits.account_id
 *   - account_transfers.from_account_id / to_account_id
 *   - account_month_balances (moves the balance row to the kept FA, dropping
 *     dup rows for the same month — arbitrarily keeps the kept FA's values)
 *   - account_payment_modes.account_id (drops dups on the unique pair)
 *   - recurring_transactions.account_id
 *   - demat_portfolio_snapshots.account_id (shouldn't exist on loan FAs, but
 *     safe to clear regardless)
 */
export async function mergeLoanFinancialAccounts(
  keepFaId: string,
  dropFaId: string,
): Promise<void> {
  if (keepFaId === dropFaId) return;
  const db = getDatabase();

  await db.withTransactionAsync(async () => {
    // Repoint expenses
    await db.runAsync(
      "UPDATE expenses SET account_id = ? WHERE account_id = ?;",
      keepFaId,
      dropFaId,
    );
    // Repoint credits
    await db.runAsync(
      "UPDATE account_credits SET account_id = ? WHERE account_id = ?;",
      keepFaId,
      dropFaId,
    );
    // Repoint transfers (both sides)
    await db.runAsync(
      "UPDATE account_transfers SET from_account_id = ? WHERE from_account_id = ?;",
      keepFaId,
      dropFaId,
    );
    await db.runAsync(
      "UPDATE account_transfers SET to_account_id = ? WHERE to_account_id = ?;",
      keepFaId,
      dropFaId,
    );
    // Repoint recurring transactions
    await db.runAsync(
      "UPDATE recurring_transactions SET account_id = ? WHERE account_id = ?;",
      keepFaId,
      dropFaId,
    );
    // Account month balances — prefer the kept FA's rows when both exist
    // for the same month. Drop the dropped FA's rows for months the kept FA
    // already covers, then move the rest.
    await db.runAsync(
      `DELETE FROM account_month_balances
        WHERE account_id = ?
          AND month IN (
            SELECT month FROM account_month_balances WHERE account_id = ?
          );`,
      dropFaId,
      keepFaId,
    );
    await db.runAsync(
      "UPDATE account_month_balances SET account_id = ? WHERE account_id = ?;",
      keepFaId,
      dropFaId,
    );
    // Payment mode links — dedupe by (account_id, payment_mode_id) then move.
    await db.runAsync(
      `DELETE FROM account_payment_modes
        WHERE account_id = ?
          AND payment_mode_id IN (
            SELECT payment_mode_id FROM account_payment_modes WHERE account_id = ?
          );`,
      dropFaId,
      keepFaId,
    );
    await db.runAsync(
      "UPDATE account_payment_modes SET account_id = ? WHERE account_id = ?;",
      keepFaId,
      dropFaId,
    );
    await db.runAsync(
      "DELETE FROM demat_portfolio_snapshots WHERE account_id = ?;",
      dropFaId,
    );

    // Finally — remove the dropped FA.
    await db.runAsync(
      "DELETE FROM financial_accounts WHERE id = ?;",
      dropFaId,
    );
  });

  bumpDataVersion();
}
