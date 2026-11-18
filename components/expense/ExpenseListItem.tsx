import { transactionTitle } from "@/utils/transaction-title";
import { Chip, Text, moneyTone, type ChipTone } from "@/components/ui";
import type { Category } from "@/services/category";
import { creditLook } from "@/services/expense-types";
import type { Expense } from "@/services/expense";
import { classifyRefund, type RefundState } from "@/services/expense";
import type { FinancialAccount } from "@/services/financial-account";
import type { PaymentMode } from "@/services/payment-mode";
import { tint } from "@/constants/brand";

import { formatAmount, formatDateForDisplay } from "@/utils/expense-validation";
import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { MONEY_EVENT_META } from "./money-event-meta";

interface ExpenseListItemProps {
  expense: Expense;
  category?: Category | null;
  paymentMode?: PaymentMode | null;
  account?: FinancialAccount | null;
  /** Sum of approved refund credits linked to this expense. Defaults to 0. */
  refundedAmount?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Optional element rendered after the amount column (e.g. recycle-bin restore / delete). */
  rightElement?: React.ReactNode;
  /** Short annotation explaining a split or hisaab adjustment (drill-down screens only). */
  splitNote?: string | null;
  /** The list is grouped by day, so the heading already says the date: don't repeat it. */
  hideDate?: boolean;
  /** Untagged rows get a dashed "Add category" chip that calls this, to pick one in place. */
  onAddCategory?: (expense: Expense) => void;
  /** Ticked in bulk select. */
  selected?: boolean;
  /** Replaces the date under the amount, e.g. "Deleted 3 days ago". */
  dateOverride?: string;
}

export interface RowStatus {
  label: string;
  tone: ChipTone;
}

/**
 * The ONE status a row shows, by priority: needs review › forecast › refunded › money event › split.
 * More than one badge on a row was the clutter the old design had.
 */
export function rowStatus(expense: Expense, refundState: RefundState): RowStatus | null {
  if (expense.status === "pending_review") {
    const ev = expense.money_event ? MONEY_EVENT_META[expense.money_event] : null;
    return { label: ev ? `Review · ${ev.short}` : "Needs review", tone: "warning" };
  }
  if (expense.nature === "forecast") return { label: "Forecast", tone: "warning" };
  if (refundState === "full") return { label: "Refunded", tone: "success" };
  if (refundState === "partial") return { label: "Partly refunded", tone: "warning" };
  if (expense.money_event) {
    const ev = MONEY_EVENT_META[expense.money_event];
    return { label: ev.short, tone: expense.money_event === "self_transfer" ? "transfer" : ev.tone };
  }
  if (expense.purchase_group_id) return { label: "Split payment", tone: "primary" };
  return null;
}

function ExpenseListItemInner({
  expense,
  category,
  paymentMode,
  account,
  refundedAmount = 0,
  onPress,
  onLongPress,
  rightElement,
  splitNote,
  hideDate = false,
  onAddCategory,
  selected = false,
  dateOverride,
}: ExpenseListItemProps) {
  const theme = useTheme();
  const isCredit = expense.nature === "credit";
  const look = isCredit ? creditLook(expense.credit_kind) : category;
  // For split expenses, the refund is against the full original charge, not just the user's share.
  const originalForRefund = expense.split_original_amount ?? expense.amount;
  const refundState = classifyRefund(originalForRefund, refundedAmount);
  const isFullRefund = refundState === "full";
  const isPartialRefund = refundState === "partial";
  // Effective display amount for partial refund: remaining total × user's proportion.
  const myProportion = expense.split_original_amount != null && expense.split_original_amount > 0
    ? expense.amount / expense.split_original_amount
    : 1;
  const effectiveDisplayAmount = Math.max(0, Math.round((originalForRefund - refundedAmount) * myProportion * 100) / 100);

  const status = rowStatus(expense, refundState);
  const tone = moneyTone(theme, expense.money_event === "self_transfer" ? "moved" : isCredit ? "in" : "out");

  // Line 2: category chip · paid by · account.
  const meta: string[] = [];
  if (expense.merchant_name && expense.description && expense.description !== expense.merchant_name) {
    meta.push(expense.merchant_name);
  }
  if (paymentMode) meta.push(paymentMode.name);
  if (account) meta.push(account.account_label || `••${account.account_identifier.slice(-4)}`);

  const showAddCategory = !look && !isCredit && expense.nature !== "forecast" && !!onAddCategory;
  const iconColor = look ? look.color : theme.mutedForeground;

  const dateText = dateOverride
    ?? (expense.nature === "forecast" && expense.due_date
      ? `Due ${formatDateForDisplay(expense.due_date)}`
      : hideDate
        ? null
        : formatDateForDisplay(expense.date));

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className="flex-row items-start px-4 py-3 border-b border-border"
      style={selected ? { backgroundColor: theme.alpha("primary", 0.08) } : undefined}
      accessibilityState={selected ? { selected: true } : undefined}
    >
      {/* Category icon, or the credit's type. A tick while selected. */}
      <View
        className="w-10 h-10 rounded-control items-center justify-center mr-3"
        style={{ backgroundColor: selected ? theme.primary : tint(iconColor, 0.12) }}
      >
        <Ionicons
          name={selected ? "checkmark" : look ? (look.icon as keyof typeof Ionicons.glyphMap) : "receipt-outline"}
          size={20}
          color={selected ? theme.primaryForeground : iconColor}
        />
      </View>

      <View className="flex-1" style={{ minWidth: 0 }}>
        {/* Line 1: name and amount */}
        <View className="flex-row items-center">
          <Text className="flex-1 text-body font-semibold text-foreground mr-3" numberOfLines={1}>
            {transactionTitle(expense, look?.name)}
          </Text>
          <View className="items-end shrink-0">
            {isFullRefund ? (
              <Text className="text-body font-bold text-faint-foreground line-through">{formatAmount(expense.amount)}</Text>
            ) : isPartialRefund ? (
              <>
                <Text className="text-body font-bold" style={{ color: tone.fg }}>{formatAmount(effectiveDisplayAmount)}</Text>
                <Text className="text-label text-faint-foreground line-through">{formatAmount(expense.amount)}</Text>
              </>
            ) : (
              <Text className="text-body font-bold" style={{ color: tone.fg }}>
                {isCredit ? "+" : ""}{formatAmount(expense.amount)}
              </Text>
            )}
          </View>
        </View>

        {/* Line 2: category chip · paid by · account and at most one status, then the date on the right */}
        <View className="flex-row items-center mt-1" style={{ gap: 8 }}>
        <View className="flex-1 flex-row items-center" style={{ gap: 6, minWidth: 0 }}>
          {look ? (
            <Chip variant="category" label={look.name} color={look.color} />
          ) : showAddCategory ? (
            <Chip variant="add" label="Add category" onPress={() => onAddCategory?.(expense)} accessibilityLabel={`Add a category to ${transactionTitle(expense)}`} />
          ) : null}
          {meta.length > 0 && (
            <Text className="text-meta text-muted-foreground shrink" numberOfLines={1}>
              {meta.join(" · ")}
            </Text>
          )}
          {status && <Chip variant="status" tone={status.tone} label={status.label} />}
          {expense.is_right_spend === 0 && (
            <Ionicons name="pricetag-outline" size={13} color={theme.accent} accessibilityLabel="Discretionary" />
          )}
        </View>
          {dateText ? (
            <Text className="text-label text-muted-foreground shrink-0" numberOfLines={1}>
              {dateText}
            </Text>
          ) : null}
        </View>

        {splitNote ? (
          <Text className="text-meta text-muted-foreground mt-1" numberOfLines={1}>
            {splitNote}
          </Text>
        ) : null}
      </View>

      {/* Optional action buttons (e.g. recycle bin restore/delete) */}
      {rightElement}
    </Pressable>
  );
}

export const ExpenseListItem = React.memo(ExpenseListItemInner);
