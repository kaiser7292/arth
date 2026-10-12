import { DEFAULT_USER_ID } from "@/constants/app";
import { getComputedBalances } from "@/services/account-balance";
import type { FinancialAccount } from "@/services/financial-account";
import { getActiveAccounts } from "@/services/financial-account";
import { formatAmount } from "@/utils/format";

/**
 * The one number shown next to an account wherever the user picks one.
 *
 * Bank / wallet / everything else: the ledger-computed current balance, falling back to
 * last_known_balance (latest SMS) while the account is unseeded.
 * Credit card: the limit still available — the bank's shared limit minus what every card of
 * that bank has used (same pool maths as the Credit Cards screen). Null when no limit is set.
 */

type PickerAccount = Pick<
  FinancialAccount,
  "id" | "account_type" | "bank_name" | "credit_limit" | "last_known_balance"
>;

export function resolvePickerBalances(
  accounts: PickerAccount[],
  allCreditCards: PickerAccount[],
  computed: Record<string, number | null>,
): Record<string, number | null> {
  const pools = new Map<string, { limit: number; used: number }>();
  for (const cc of allCreditCards) {
    const pool = pools.get(cc.bank_name) ?? { limit: 0, used: 0 };
    pool.limit = Math.max(pool.limit, cc.credit_limit ?? 0);
    pool.used += computed[cc.id] ?? 0;
    pools.set(cc.bank_name, pool);
  }

  const result: Record<string, number | null> = {};
  for (const a of accounts) {
    if (a.account_type === "credit_card") {
      const pool = pools.get(a.bank_name);
      result[a.id] = pool && pool.limit > 0 ? pool.limit - pool.used : null;
    } else {
      result[a.id] = computed[a.id] ?? a.last_known_balance ?? null;
    }
  }
  return result;
}

export async function getPickerBalances(accounts: PickerAccount[]): Promise<Record<string, number | null>> {
  if (accounts.length === 0) return {};
  // A card's available limit depends on its siblings, which the picker may not be listing.
  const allCreditCards: PickerAccount[] = accounts.some((a) => a.account_type === "credit_card")
    ? (await getActiveAccounts(DEFAULT_USER_ID)).filter((a) => a.account_type === "credit_card")
    : [];
  const ids = Array.from(new Set([...accounts, ...allCreditCards].map((a) => a.id)));
  const computed = await getComputedBalances(ids);
  return resolvePickerBalances(accounts, allCreditCards, computed);
}

/** "Savings · HDFC" → "Savings · HDFC · ₹12,340". Unchanged when there is no balance to show. */
export function withPickerBalance(text: string, balance: number | null | undefined): string {
  if (balance == null) return text;
  return text ? `${text} · ${formatAmount(balance)}` : formatAmount(balance);
}
