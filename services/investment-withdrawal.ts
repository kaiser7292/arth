/**
 * Investment withdrawal — money coming back from any investment (mutual fund
 * redemption, demat payout, PPF/NPS/EPF withdrawal, gold, bonds…) into a bank
 * account, recorded against the investment instead of as income.
 *
 * A bank credit of A is split by the user into:
 *   P  taken out of the investment (defaults to A)
 *   A−P gain, which stays a credit (credit_kind 'gain') and so still counts as income
 *
 * Effects:
 *   - P becomes a transfer investment → bank, so the investment's balance drops
 *     and the bank's doesn't change twice.
 *       P = A: the credit itself is reclassified (reclassifyCreditAsTransfer).
 *       P < A: a separate transfer of P; the credit is lowered to A−P and points
 *              at the transfer via linked_transfer_id with reclassified_as_transfer = 0.
 *              Undo / delete of that transfer adds P back to the credit
 *              (see account-transfer.ts restoreGainCreditsInTxn).
 *   - Market-valued accounts (demat, mutual fund, gold…) also lose P from their
 *     idle-fund snapshot (handleDematWithdrawalSideEffects), reversed on delete.
 *   - Optional bucket: a negative investment_contributions row of −P, stamped on
 *     the transfer so delete removes it.
 *   - Optional close: the investment account is closed (drops out of net worth).
 *
 * FDs keep their own closure flow (MoneyEventPanel → closeFdWithCredit).
 */

import { DEFAULT_USER_ID } from "@/constants/app";
import { getDatabase } from "@/database";
import { createTransfer, reclassifyCreditAsTransfer } from "@/services/account-transfer";
import { seedOpeningBalance } from "@/services/account-balance";
import { handleDematWithdrawalSideEffects } from "@/services/demat-transfer";
import type { FinancialAccount } from "@/services/financial-account";
import { addOrUpdateFundSnapshot, closeAccount, createManualAccount } from "@/services/financial-account";
import type { InvestmentInstrument, InvestmentProduct, InvestmentValuation } from "@/services/investment-accounts";
import {
  INSTRUMENT_LABELS,
  batchInvestmentProducts,
  createInvestmentProductForAccount,
  isDematLikeAccount,
  isFinishedInvestment,
} from "@/services/investment-accounts";
import { clearMoneyEvent } from "@/services/money-events";
import { bumpDataVersion } from "@/services/settings";
import { createInvestmentContribution } from "@/services/yearly-plan";
import { round2 } from "@/utils/math";
import { getAccountGains } from "@/services/realized-gains";
import { updateInvestmentContribution } from "@/services/yearly-plan";

// ─── Which accounts can money come back from ─────────────────────────────────

export interface WithdrawableInvestment {
  account: FinancialAccount;
  product: InvestmentProduct | null;
  /** An FD — handled by the FD closure flow, not here. */
  isFd: boolean;
  /** Snapshot-valued (demat / MF / gold): the withdrawal also lowers its fund value. */
  isMarket: boolean;
  label: string;
  kindLabel: string;
}

const INVESTMENT_TYPES = new Set(["demat", "pension", "investment"]);

export function isInvestmentAccountType(type: string): boolean {
  return INVESTMENT_TYPES.has(type);
}

function kindLabelFor(account: FinancialAccount, product: InvestmentProduct | null): string {
  if (product) return INSTRUMENT_LABELS[product.instrument];
  if (account.account_type === "demat") return "Demat";
  if (account.account_type === "pension") return "Pension";
  return "Investment";
}

/** Open investment accounts, for the "Which investment?" picker. */
export async function getWithdrawableInvestments(accounts: FinancialAccount[]): Promise<WithdrawableInvestment[]> {
  const candidates = accounts.filter((a) => isInvestmentAccountType(a.account_type) && a.closed_at == null);
  const products = await batchInvestmentProducts(candidates.filter((a) => a.account_type === "investment").map((a) => a.id));
  return candidates
    .filter((a) => !isFinishedInvestment(a, products.get(a.id)))
    .map((a) => {
      const product = products.get(a.id) ?? null;
      return {
        account: a,
        product,
        isFd: product?.valuation === "contract",
        isMarket: isDematLikeAccount(a, product),
        label: a.account_label || a.bank_name,
        kindLabel: kindLabelFor(a, product),
      };
    });
}

// ─── Quick-add an investment that isn't in Arth yet ──────────────────────────

/** What each quick-add instrument is valued by. FDs have their own add flow. */
export const QUICK_ADD_INSTRUMENTS: { instrument: Exclude<InvestmentInstrument, "fd">; valuation: InvestmentValuation }[] = [
  { instrument: "mutual_fund", valuation: "market" },
  { instrument: "equity", valuation: "market" },
  { instrument: "gold", valuation: "market" },
  { instrument: "bond", valuation: "market" },
  { instrument: "ppf", valuation: "contribution" },
  { instrument: "nps", valuation: "contribution" },
  { instrument: "epf", valuation: "contribution" },
  { instrument: "other", valuation: "market" },
];

export interface QuickAddInvestmentInput {
  name: string;
  instrument: Exclude<InvestmentInstrument, "fd">;
  /** What's still in it after this withdrawal. 0 = all withdrawn (the account is closed). */
  leftAfter: number;
}

// ─── Record ──────────────────────────────────────────────────────────────────

export interface RecordWithdrawalInput {
  creditId: string;
  /** An existing investment account, or null with `quickAdd` set. */
  investmentAccountId: string | null;
  quickAdd?: QuickAddInvestmentInput;
  /** Amount taken out of the investment, 0 < P ≤ credit amount. The rest is gain. */
  withdrawnAmount: number;
  /** Lower this bucket's progress by the withdrawn amount. */
  bucketId?: string | null;
  /** All withdrawn: close the investment account. */
  closeInvestment?: boolean;
}

export interface RecordWithdrawalResult {
  transferId: string;
  investmentAccountId: string;
  gain: number;
}

interface CreditRow {
  id: string;
  user_id: string;
  account_id: string | null;
  amount: number;
  date: string;
  status: string;
  nature: string;
  description: string | null;
  merchant_name: string | null;
  split_mode: string | null;
  split_person_id: string | null;
  fulfills_rule_id: string | null;
  reclassified_as_transfer: number | null;
}

export async function recordInvestmentWithdrawal(input: RecordWithdrawalInput): Promise<RecordWithdrawalResult> {
  const db = getDatabase();
  const credit = await db.getFirstAsync<CreditRow>(
    `SELECT id, user_id, account_id, amount, date, status, nature, description, merchant_name,
            split_mode, split_person_id, fulfills_rule_id, reclassified_as_transfer
       FROM expenses WHERE id = ? AND deleted_at IS NULL;`,
    input.creditId,
  );
  if (!credit || credit.nature !== "credit") throw new Error("Only money received can be an investment withdrawal");
  if (credit.reclassified_as_transfer === 1) throw new Error("This is already recorded as a transfer");
  if (!credit.account_id) throw new Error("Pick the bank account this money landed in first");
  if (credit.split_mode || credit.split_person_id) throw new Error("This credit is split. Remove the split first.");
  if (credit.fulfills_rule_id) throw new Error("This credit fulfills a reminder. Unlink the reminder first.");

  const withdrawn = round2(input.withdrawnAmount);
  if (!(withdrawn > 0)) throw new Error("Enter the amount taken out of the investment");
  if (withdrawn > credit.amount + 0.001) throw new Error("Amount taken out can't be more than the money received");
  const gain = round2(credit.amount - withdrawn);

  // 1. The investment account.
  let investmentAccountId = input.investmentAccountId;
  let isMarket: boolean;
  let quickAdded = false;
  if (investmentAccountId) {
    const account = await db.getFirstAsync<{ id: string; account_type: string }>(
      `SELECT id, account_type FROM financial_accounts WHERE id = ?;`,
      investmentAccountId,
    );
    if (!account || !isInvestmentAccountType(account.account_type)) throw new Error("That isn't an investment account");
    const product = (await batchInvestmentProducts([account.id])).get(account.id) ?? null;
    if (product?.valuation === "contract") throw new Error("Use \"Choose the FD\" to close a fixed deposit");
    isMarket = isDematLikeAccount(account, product);
  } else {
    if (!input.quickAdd) throw new Error("Pick the investment this money came from");
    const q = input.quickAdd;
    const name = q.name.trim();
    if (!name) throw new Error("Give the investment a name");
    const spec = QUICK_ADD_INSTRUMENTS.find((s) => s.instrument === q.instrument);
    if (!spec) throw new Error("Pick what kind of investment it is");
    investmentAccountId = await createManualAccount({
      userId: credit.user_id || DEFAULT_USER_ID,
      bankName: name,
      accountType: "investment",
      // Unique per add so two "Groww" withdrawals don't collide on (identifier, bank, type).
      accountIdentifier: `wd-${Date.now().toString(36)}`,
      accountLabel: name,
    });
    await createInvestmentProductForAccount(investmentAccountId, spec.instrument, spec.valuation);
    isMarket = spec.valuation === "market";
    quickAdded = true;
    // Arth never saw what was in it, so start it at "what's left after this withdrawal".
    const left = Math.max(round2(q.leftAfter), 0);
    if (isMarket) {
      if (left > 0) await addOrUpdateFundSnapshot(investmentAccountId, credit.date, left);
    } else {
      // Contribution balances chain from an opening: opening − P = left.
      await seedOpeningBalance(investmentAccountId, credit.date.slice(0, 7), left + withdrawn);
    }
  }

  // 2. The transfer.
  const description = `Withdrawal${credit.merchant_name ? ` - ${credit.merchant_name}` : ""}`;
  let transferId: string;
  if (gain <= 0) {
    transferId = await reclassifyCreditAsTransfer(credit.id, investmentAccountId);
  } else {
    transferId = await createTransfer({
      userId: credit.user_id,
      fromAccountId: investmentAccountId,
      toAccountId: credit.account_id,
      amount: withdrawn,
      description,
      date: credit.date,
      source: "manual",
    });
    // The credit keeps only the gain. linked_transfer_id with reclassified = 0 marks it as the
    // gain half, so undo/delete of the transfer puts the withdrawn amount back on it.
    await db.runAsync(
      `UPDATE expenses
          SET amount = ?, credit_kind = 'gain', linked_transfer_id = ?, money_event = NULL,
              reclassified_as_transfer = 0, updated_at = datetime('now')
        WHERE id = ?;`,
      gain,
      transferId,
      credit.id,
    );
    if (credit.status === "pending_review") {
      const { approveExpense } = await import("@/services/expense-crud");
      await approveExpense(credit.id);
    }
  }
  await clearMoneyEvent(credit.id);

  // 3. Market value: take it off the fund. A just-added one already starts at what's left.
  if (isMarket && !quickAdded) {
    await handleDematWithdrawalSideEffects(transferId, investmentAccountId, withdrawn, credit.date);
  }

  // 4. Bucket progress: it tracks money put in, so it goes down by the cost of what was taken
  //    out (services/realized-gains.ts), never by the gain on top - that can't push it negative.
  if (input.bucketId) {
    const cost = await withdrawalCost(investmentAccountId, transferId, withdrawn);
    const contributionId = await createInvestmentContribution({
      investment_bucket_id: input.bucketId,
      month: credit.date.slice(0, 7),
      amount: -cost,
      date: credit.date,
      notes: "Auto from withdrawal",
    });
    await db.runAsync(
      `UPDATE account_transfers SET investment_bucket_id = ?, linked_contribution_id = ?, updated_at = datetime('now') WHERE id = ?;`,
      input.bucketId,
      contributionId,
      transferId,
    );
  }

  // 5. All withdrawn.
  if (input.closeInvestment || (quickAdded && (input.quickAdd?.leftAfter ?? 0) <= 0)) {
    await closeAccount(investmentAccountId, "Withdrawn");
  }

  bumpDataVersion();
  return { transferId, investmentAccountId, gain };
}

/** Cost of one withdrawal (what was put in that came out), falling back to the amount itself. */
async function withdrawalCost(accountId: string, transferId: string, amount: number): Promise<number> {
  try {
    const gains = await getAccountGains(accountId);
    const w = gains.withdrawals.find((x) => x.transferId === transferId);
    if (w) return w.cost;
  } catch {
    // fall through
  }
  return amount;
}

/**
 * Repair for withdrawals recorded before bucket amounts used cost: a bucket went down by the whole
 * withdrawal, gain included, and could go negative. Re-sets each "Auto from withdrawal" entry to
 * minus the withdrawal's cost. Idempotent - only entries that differ are changed.
 */
export async function repairWithdrawalBucketAmounts(userId: string): Promise<number> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{
    transfer_id: string;
    from_account_id: string;
    amount: number;
    contribution_id: string;
    bucket_id: string;
    c_amount: number;
    c_date: string;
    c_notes: string | null;
  }>(
    `SELECT t.id AS transfer_id, t.from_account_id, t.amount, c.id AS contribution_id, c.investment_bucket_id AS bucket_id,
            c.amount AS c_amount, c.date AS c_date, c.notes AS c_notes
       FROM account_transfers t
       JOIN investment_contributions c ON c.id = t.linked_contribution_id
      WHERE t.user_id = ? AND t.deleted_at IS NULL AND c.notes = 'Auto from withdrawal';`,
    userId,
  );
  let fixed = 0;
  for (const r of rows) {
    const cost = await withdrawalCost(r.from_account_id, r.transfer_id, r.amount);
    if (Math.abs(-cost - r.c_amount) < 0.01) continue;
    await updateInvestmentContribution(r.contribution_id, r.bucket_id, { amount: -cost, date: r.c_date, notes: r.c_notes ?? undefined });
    fixed++;
  }
  return fixed;
}
