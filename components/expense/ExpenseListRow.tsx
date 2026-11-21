import { categoryPath } from "@/utils/category-tree";
import React, { useCallback } from "react";
import { ExpenseListItem } from "./ExpenseListItem";
import type { Expense } from "@/services/expense";
import type { Category } from "@/services/category";
import type { PaymentMode } from "@/services/payment-mode";
import type { FinancialAccount } from "@/services/financial-account";

interface ExpenseListRowProps {
  item: Expense;
  categoryMap: Map<string, Category>;
  paymentModeMap: Map<string, PaymentMode>;
  accountMap: Map<string, FinancialAccount>;
  /** Expense id → sum of linked refund credits. Missing entries default to 0. */
  refundedMap?: Map<string, number>;
  onPress: (id: string) => void;
  onLongPress: (expense: Expense) => void;
  rightElement?: React.ReactNode;
  /** Per-expense annotation for split/hisaab adjustments (drill-down screens). */
  splitNote?: string | null;
  /** Grouped by day: the heading already says the date. */
  hideDate?: boolean;
  /** Ticked in bulk select. */
  selected?: boolean;
  /** Untagged rows: pick a category in place. */
  onAddCategory?: (expense: Expense) => void;
}

function ExpenseListRowInner({
  item,
  categoryMap,
  paymentModeMap,
  accountMap,
  refundedMap,
  onPress,
  onLongPress,
  rightElement,
  splitNote,
  hideDate,
  selected,
  onAddCategory,
}: ExpenseListRowProps) {
  const category = item.category_id ? categoryMap.get(item.category_id) ?? null : null;
  // "Food › Groceries" for a sub-category (095).
  const categoryLabel = category ? categoryPath(category, categoryMap) : undefined;
  const paymentMode = item.payment_mode_id ? paymentModeMap.get(item.payment_mode_id) ?? null : null;
  const account = item.account_id ? accountMap.get(item.account_id) ?? null : null;
  const refundedAmount = refundedMap?.get(item.id) ?? 0;

  const handlePress = useCallback(() => onPress(item.id), [onPress, item.id]);
  const handleLongPress = useCallback(() => onLongPress(item), [onLongPress, item]);

  return (
    <ExpenseListItem
      expense={item}
      category={category}
      categoryLabel={categoryLabel}
      paymentMode={paymentMode}
      account={account}
      refundedAmount={refundedAmount}
      onPress={handlePress}
      onLongPress={handleLongPress}
      rightElement={rightElement}
      splitNote={splitNote}
      hideDate={hideDate}
      selected={selected}
      onAddCategory={onAddCategory}
    />
  );
}

export const ExpenseListRow = React.memo(ExpenseListRowInner);
