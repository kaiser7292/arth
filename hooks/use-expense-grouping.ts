import { useEffect, useMemo, useState } from "react";
import { useGroupBy } from "@/hooks/use-group-by";
import { getPeopleForExpenses } from "@/services/expense-people";
import type { Expense } from "@/services/expense-types";
import { expenseGroupLabels, groupExpenses, type ExpenseGroupBy, type ExpenseGroupNames, type ExpenseListKind } from "@/utils/expense-grouping";

/** Group by for a list of transactions: the choice, its options, and the rows with their headings. */
export function useExpenseGrouping({
  screen,
  kind,
  available,
  fallback,
  expenses,
  names,
  amountOf,
}: {
  screen: string;
  kind: ExpenseListKind;
  available: readonly ExpenseGroupBy[];
  fallback: ExpenseGroupBy;
  expenses: readonly Expense[];
  names: Omit<ExpenseGroupNames, "people">;
  amountOf?: (e: Expense) => number;
}) {
  const [groupBy, setGroupBy] = useGroupBy(screen, available, fallback);
  const [people, setPeople] = useState<Map<string, string>>(new Map());

  // Only looked up when it's asked for; if it fails everything reads as "Not shared".
  useEffect(() => {
    if (groupBy !== "person") return;
    let live = true;
    getPeopleForExpenses(expenses.map((e) => e.id))
      .then((map) => {
        if (live) setPeople(map);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [groupBy, expenses]);

  const { categoryMap, accountMap, paymentModeMap } = names;
  const rows = useMemo(
    () => groupExpenses(expenses, groupBy, { categoryMap, accountMap, paymentModeMap, people }, amountOf),
    [expenses, groupBy, categoryMap, accountMap, paymentModeMap, people, amountOf],
  );
  const options = useMemo(() => {
    const labels = expenseGroupLabels(kind);
    return available.map((value) => ({ value, label: labels[value] }));
  }, [available, kind]);

  return { groupBy, setGroupBy, rows, options };
}
