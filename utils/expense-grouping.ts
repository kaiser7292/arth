import type { Category } from "@/services/category";
import { creditKindOf, creditLook, type Expense } from "@/services/expense-types";
import type { FinancialAccount } from "@/services/financial-account";
import type { PaymentMode } from "@/services/payment-mode";
import { formatMonthLabel } from "@/utils/date";
import { transactionDayLabel } from "@/utils/day-label";
import { groupRows, NO_GROUP, ungrouped, type GroupedRow } from "@/utils/group-rows";
import type { ListField } from "@/utils/list-tools";

export type ExpenseGroupBy = "none" | "date" | "month" | "category" | "merchant" | "account" | "payment_mode" | "person";

/** What a list shows, which decides what its "category" is called. */
export type ExpenseListKind = "spend" | "credit" | "all";

const CATEGORY_LABEL: Record<ExpenseListKind, string> = { spend: "Category", credit: "Type", all: "Category or type" };

export function expenseGroupLabels(kind: ExpenseListKind): Record<ExpenseGroupBy, string> {
  return {
    none: "None",
    date: "Date",
    month: "Month",
    category: CATEGORY_LABEL[kind],
    merchant: kind === "credit" ? "Merchant or payer" : "Merchant",
    account: "Account",
    payment_mode: "Payment mode",
    person: "Person",
  };
}

export interface ExpenseGroupNames {
  categoryMap: Map<string, Pick<Category, "name">>;
  accountMap: Map<string, FinancialAccount>;
  paymentModeMap: Map<string, Pick<PaymentMode, "name">>;
  /** Expense id → who it's with (getPeopleForExpenses). */
  people?: Map<string, string>;
}

/** A credit's "category" is its type, so a list of both keeps them apart with this prefix. */
const TYPE_PREFIX = "type:";

function keyOf(e: Expense, by: ExpenseGroupBy, names: ExpenseGroupNames): string | null {
  switch (by) {
    case "date":
      return e.date?.slice(0, 10) ?? null;
    case "month":
      return e.date?.slice(0, 7) ?? null;
    case "category":
      return e.nature === "credit" ? TYPE_PREFIX + creditKindOf(e.credit_kind) : e.category_id;
    case "merchant":
      return e.merchant_name?.trim() || null;
    case "account":
      return e.account_id ?? null;
    case "payment_mode":
      return e.payment_mode_id;
    case "person":
      return names.people?.get(e.id) ?? null;
    default:
      return null;
  }
}

const NOTHING: Partial<Record<ExpenseGroupBy, string>> = {
  category: "Uncategorized",
  merchant: "No merchant",
  account: "No account",
  payment_mode: "No payment mode",
  person: "Not shared",
};

function labelOf(key: string, by: ExpenseGroupBy, names: ExpenseGroupNames): string {
  if (key === NO_GROUP) return NOTHING[by] ?? "Other";
  switch (by) {
    case "date":
      return transactionDayLabel(key);
    case "month":
      return formatMonthLabel(key, "long");
    case "category":
      return key.startsWith(TYPE_PREFIX) ? creditLook(key.slice(TYPE_PREFIX.length)).name : (names.categoryMap.get(key)?.name ?? "Unknown");
    case "account": {
      const account = names.accountMap.get(key);
      return account ? account.account_label || `${account.bank_name} ****${account.account_identifier}` : "Unknown";
    }
    case "payment_mode":
      return names.paymentModeMap.get(key)?.name ?? "Unknown";
    default:
      return key;
  }
}

/** What a transaction list can filter and group on, for useListTools. Dates only group. */
export function expenseFields(
  kind: ExpenseListKind,
  available: readonly ExpenseGroupBy[],
  names: ExpenseGroupNames,
): ListField<Expense>[] {
  const labels = expenseGroupLabels(kind);
  return available
    .filter((by) => by !== "none")
    .map((by) => {
      const isDate = by === "date" || by === "month";
      return {
        id: by,
        label: labels[by],
        keyOf: (e: Expense) => keyOf(e, by, names),
        labelOf: (key: string) => labelOf(key, by, names),
        noneLabel: NOTHING[by],
        group: true,
        filter: !isDate,
        searchable: by === "merchant" || by === "category" || by === "person",
        groupOrder: isDate ? ("first" as const) : ("size" as const),
      };
    });
}

/** Money in adds, money out takes away, so a group with both comes to what it really moved. */
export const signedAmount = (e: Pick<Expense, "nature" | "amount">) => (e.nature === "credit" ? e.amount : -e.amount);

/** What a spend comes to after its refunds: your share of what's left, as its row shows it. */
export function netSpend(e: Pick<Expense, "amount" | "split_original_amount">, refunded: number): number {
  const original = e.split_original_amount ?? e.amount;
  const myProportion = original > 0 ? e.amount / original : 1;
  return Math.max(0, Math.round((original - refunded) * myProportion * 100) / 100);
}

/** The same with its direction, for spending lists. On a list with credits too, refunds are their own rows. */
export const signedNet = (e: Pick<Expense, "nature" | "amount" | "split_original_amount">, refunded: number) =>
  e.nature === "credit" ? e.amount : -netSpend(e, refunded);

export function groupExpenses(
  expenses: readonly Expense[],
  by: ExpenseGroupBy,
  names: ExpenseGroupNames,
  amountOf: (e: Expense) => number = signedAmount,
): GroupedRow<Expense>[] {
  if (by === "none") return ungrouped(expenses);
  return groupRows(expenses, {
    keyOf: (e) => keyOf(e, by, names),
    labelOf: (key) => labelOf(key, by, names),
    amountOf,
    order: by === "date" || by === "month" ? "first" : "size",
  });
}
