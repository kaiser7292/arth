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
}: ExpenseListRowProps) {
  const category = item.category_id ? categoryMap.get(item.category_id) ?? null : null;
  const paymentMode = item.payment_mode_id ? paymentModeMap.get(item.payment_mode_id) ?? null : null;
  const account = item.account_id ? accountMap.get(item.account_id) ?? null : null;
  const refundedAmount = refundedMap?.get(item.id) ?? 0;

  const handlePress = useCallback(() => onPress(item.id), [onPress, item.id]);
  const handleLongPress = useCallback(() => onLongPress(item), [onLongPress, item]);

  return (
    <ExpenseListItem
      expense={item}
      category={category}
      paymentMode={paymentMode}
      account={account}
      refundedAmount={refundedAmount}
      onPress={handlePress}
      onLongPress={handleLongPress}
      rightElement={rightElement}
    />
  );
}

export const ExpenseListRow = React.memo(ExpenseListRowInner);
