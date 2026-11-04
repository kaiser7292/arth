import { useEffect, useMemo, useState } from "react";
import type { ToolbarChoice } from "@/components/ui";
import { useListTools } from "@/hooks/use-list-tools";
import { getPeopleForExpenses } from "@/services/expense-people";
import { creditLook, type Expense } from "@/services/expense-types";
import { expenseFields, signedNet, type ExpenseGroupBy, type ExpenseGroupNames, type ExpenseListKind } from "@/utils/expense-grouping";

/** The toolbar for a list of transactions that's all in memory. The rows come sorted by the screen. */
export function useExpenseTools({
  screen,
  kind,
  available,
  expenses,
  names,
  sort,
  refunds,
}: {
  screen: string;
  kind: ExpenseListKind;
  available: readonly ExpenseGroupBy[];
  expenses: readonly Expense[];
  names: Omit<ExpenseGroupNames, "people">;
  sort: ToolbarChoice<string>;
  /** Expense id → refunds linked to it, so group totals match the row and the summary. */
  refunds?: Map<string, number>;
}) {
  const [people, setPeople] = useState<Map<string, string>>(new Map());

  // Only a name to filter and group on, so failing leaves everything reading "Not shared".
  useEffect(() => {
    if (!available.includes("person")) return;
    let live = true;
    getPeopleForExpenses(expenses.map((e) => e.id))
      .then((map) => {
        if (live) setPeople(map);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [available, expenses]);

  const { categoryMap, accountMap, paymentModeMap } = names;
  const fields = useMemo(
    () => expenseFields(kind, available, { categoryMap, accountMap, paymentModeMap, people }),
    [kind, available, categoryMap, accountMap, paymentModeMap, people],
  );

  return useListTools<Expense>({
    screen,
    rows: expenses,
    fields,
    sort,
    amountOf: (e) => signedNet(e, refunds?.get(e.id) ?? 0),
    searchPlaceholder: "Search name or amount",
    search: (e) => ({
      texts: [
        e.merchant_name,
        e.description,
        e.nature === "credit" ? creditLook(e.credit_kind).name : e.category_id ? categoryMap.get(e.category_id)?.name : null,
      ],
      amounts: [e.amount, ...(e.split_original_amount != null ? [e.split_original_amount] : [])],
    }),
  });
}
