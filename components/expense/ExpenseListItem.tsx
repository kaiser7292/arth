import { StatusColors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { Category } from "@/services/category";
import type { Expense } from "@/services/expense";
import { classifyRefund } from "@/services/expense";
import type { FinancialAccount } from "@/services/financial-account";
import type { PaymentMode } from "@/services/payment-mode";
import { ac } from "@/utils/accent";
import { formatAmount, formatDateForDisplay } from "@/utils/expense-validation";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, Text, View } from "react-native";

interface ExpenseListItemProps {
  expense: Expense;
  category?: Category | null;
  paymentMode?: PaymentMode | null;
  account?: FinancialAccount | null;
  /** Sum of approved refund credits linked to this expense. Defaults to 0. */
  refundedAmount?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Optional element rendered after the amount/date column (e.g. action buttons) */
  rightElement?: React.ReactNode;
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
}: ExpenseListItemProps) {
  const { colorScheme, accent, colors } = useColorScheme();
  const isPending = expense.status === "pending_review";
  const refundState = classifyRefund(expense.amount, refundedAmount);
  const isFullRefund = refundState === "full";
  const isPartialRefund = refundState === "partial";

  const subtitleParts: string[] = [];
  if (expense.merchant_name && expense.description && expense.description !== expense.merchant_name) {
    subtitleParts.push(expense.merchant_name);
  }
  if (paymentMode) subtitleParts.push(paymentMode.name);
  if (account) {
    const acctLabel =
      account.account_label ||
      `****${account.account_identifier.slice(-4)}`;
    subtitleParts.push(acctLabel);
  }

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className="flex-row items-center px-4 py-3.5 border-b border-border-light dark:border-border-dark"
    >
      {/* Category icon */}
      <View
        className="w-10 h-10 rounded-full items-center justify-center mr-3"
        style={{
          backgroundColor: category ? category.color + "14" : colors.textSecondary + "14",
        }}
      >
        <Ionicons
          name={
            category
              ? (category.icon as keyof typeof Ionicons.glyphMap)
              : "receipt-outline"
          }
          size={20}
          color={category ? category.color : colors.textSecondary}
        />
      </View>

      {/* Left: Merchant + metadata */}
      <View className="flex-1 mr-3">
        <View className="flex-row items-center">
          <Text
            className="text-sm font-semibold text-text-primary dark:text-text-dark-primary shrink"
            numberOfLines={1}
          >
            {expense.description || expense.merchant_name || "No description"}
          </Text>
          {isPending && (
            <View
              className="ml-1.5 px-1.5 py-0.5 rounded"
              style={{ backgroundColor: StatusColors[colorScheme].warning + "1A" }}
            >
              <Text
                className="text-[9px] font-bold uppercase"
                style={{ color: StatusColors[colorScheme].warning }}
              >
                Pending
              </Text>
            </View>
          )}
          {expense.purchase_group_id && (
            <View
              className="ml-1.5 px-1.5 py-0.5 rounded"
              style={{ backgroundColor: accent[500] + "1A" }}
            >
              <Text
                className="text-[9px] font-bold uppercase"
                style={{ color: ac(accent, colorScheme, 600, 300) }}
              >
                Split
              </Text>
            </View>
          )}
          {(isFullRefund || isPartialRefund) && (
            <View
              className="ml-1.5 px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: isFullRefund
                  ? StatusColors[colorScheme].success + "1A"
                  : StatusColors[colorScheme].warning + "1A",
              }}
            >
              <Text
                className="text-[9px] font-bold uppercase"
                style={{
                  color: isFullRefund
                    ? StatusColors[colorScheme].success
                    : StatusColors[colorScheme].warning,
                }}
              >
                {isFullRefund ? "Refunded" : "Partial Refund"}
              </Text>
            </View>
          )}
        </View>
        {subtitleParts.length > 0 && (
          <Text
            className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5"
            numberOfLines={1}
          >
            {subtitleParts.join(" · ")}
          </Text>
        )}
      </View>

      {/* Right: Amount + date. Fully-refunded expenses strike through the
          amount and render a muted "₹0 net" line. Partials show effective
          amount as primary with the original crossed-out underneath. */}
      <View className="items-end shrink-0">
        {isFullRefund ? (
          <>
            <Text
              className="text-sm font-bold text-text-tertiary dark:text-text-dark-tertiary line-through"
            >
              {formatAmount(expense.amount)}
            </Text>
            <Text className="text-[11px] text-text-secondary dark:text-text-dark-secondary mt-0.5">
              {formatDateForDisplay(expense.date)}
            </Text>
          </>
        ) : isPartialRefund ? (
          <>
            <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary">
              {formatAmount(Math.max(0, expense.amount - refundedAmount))}
            </Text>
            <Text className="text-[10px] text-text-tertiary dark:text-text-dark-tertiary line-through">
              {formatAmount(expense.amount)}
            </Text>
            <Text className="text-[11px] text-text-secondary dark:text-text-dark-secondary mt-0.5">
              {formatDateForDisplay(expense.date)}
            </Text>
          </>
        ) : (
          <>
            <Text
              className="text-sm font-bold text-text-primary dark:text-text-dark-primary"
              style={expense.nature === "credit" ? { color: "#10B981" } : undefined}
            >
              {expense.nature === "credit" ? "+" : ""}{formatAmount(expense.amount)}
            </Text>
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
              {expense.nature === "forecast" && expense.due_date
                ? `Due ${formatDateForDisplay(expense.due_date)}`
                : formatDateForDisplay(expense.date)}
            </Text>
          </>
        )}
      </View>

      {/* Discretionary spend indicator */}
      {expense.is_right_spend === 0 && (
        <View className="ml-1.5">
          <Ionicons name="pricetag-outline" size={14} color={StatusColors[colorScheme].warning} />
        </View>
      )}

      {/* Optional action buttons (e.g. recycle bin restore/delete) */}
      {rightElement}
    </Pressable>
  );
}

export const ExpenseListItem = React.memo(ExpenseListItemInner);
