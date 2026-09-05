import { StatusColors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

interface ExpenseHeroCardProps {
  merchantName: string | null;
  description: string | null;
  amount: number;
  categoryName: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
  date: string;
  dueDate?: string | null;
  transactionTime?: string | null;
  source: "manual" | "sms_auto" | "email_auto";
  nature: "realized" | "forecast" | "credit" | "ledger_adjustment";
  status?: "approved" | "pending_review" | "rejected";
  /** Sum of approved linked refund credits. 0 = not refunded. */
  refundedAmount?: number;
  /** For hisaab-split expenses: the full original charge before splitting.
   *  Used so refund classification compares against the full purchase, not just the user's share. */
  splitOriginalAmount?: number | null;
  /** Whether this expense is marked as a transfer */
  isTransfer?: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  sms_auto: "SMS",
  email_auto: "Email",
};

function formatDisplayDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime12h(time: string): string | null {
  if (!time || time === "00:00:00") return null;
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

import { formatNumber } from "@/utils/format";

export default function ExpenseHeroCard({
  merchantName,
  description,
  amount,
  categoryName,
  categoryColor,
  categoryIcon,
  date,
  dueDate,
  transactionTime,
  source,
  nature,
  status,
  refundedAmount = 0,
  splitOriginalAmount,
  isTransfer = false,
}: ExpenseHeroCardProps) {
  const { accent, colorScheme } = useColorScheme();
  const title = description || merchantName || "Expense";
  const subtitle = description && merchantName ? merchantName : null;

  // For split expenses, compare the refund against the full original charge, not just the user's share.
  // e.g. 128 total, 50-50 split → user's share = 64. Refund of 120 is partial (not full) because 120 < 128.
  const originalForRefund = splitOriginalAmount ?? amount;
  const isFullRefund = refundedAmount > 0 && refundedAmount + 0.01 >= originalForRefund;
  const isPartialRefund = refundedAmount > 0 && !isFullRefund;
  // Effective amount for split: remaining total × user's proportion.
  // For non-split: remaining = amount − refundedAmount.
  const myProportion = splitOriginalAmount != null && splitOriginalAmount > 0 ? amount / splitOriginalAmount : 1;
  const effectiveAmount = Math.max(0, Math.round((originalForRefund - refundedAmount) * myProportion * 100) / 100);

  return (
    <View className="px-4 pt-5 pb-4 items-center">
      {/* Source + Nature badges */}
      <View className="flex-row items-center mb-3">
        <View className="px-2.5 py-1 rounded-full mr-2" style={{ backgroundColor: ac(accent, colorScheme, 50, 700) }}>
          <Text className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: ac(accent, colorScheme, 500, 200) }}>
            {SOURCE_LABELS[source] ?? source}
          </Text>
        </View>
        {nature === "forecast" && (
          <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: StatusColors[colorScheme].warningBg }}>
            <Text className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: StatusColors[colorScheme].warning }}>
              Forecast
            </Text>
          </View>
        )}
        {status === "pending_review" && (
          <View className="px-2.5 py-1 rounded-full bg-[#F59E0B14]">
            <Text className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: StatusColors[colorScheme].warning }}>
              Pending Review
            </Text>
          </View>
        )}
        {isFullRefund && (
          <View className="px-2.5 py-1 rounded-full ml-2" style={{ backgroundColor: StatusColors[colorScheme].success + "1A" }}>
            <Text className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: StatusColors[colorScheme].success }}>
              Refunded
            </Text>
          </View>
        )}
        {isPartialRefund && (
          <View className="px-2.5 py-1 rounded-full ml-2" style={{ backgroundColor: StatusColors[colorScheme].warning + "1A" }}>
            <Text className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: StatusColors[colorScheme].warning }}>
              Partial Refund
            </Text>
          </View>
        )}
        {isTransfer && (
          <View className="px-2.5 py-1 rounded-full ml-2" style={{ backgroundColor: "#6366F11A" }}>
            <Text className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#6366F1" }}>
              Transfer
            </Text>
          </View>
        )}
      </View>

      {/* Merchant / Title */}
      <Text
        className="text-xl font-bold text-foreground text-center"
        numberOfLines={2}
      >
        {title}
      </Text>

      {/* Subtitle (description when merchant exists) */}
      {subtitle && (
        <Text
          className="text-sm text-muted-foreground mt-1 text-center"
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      )}

      {/* Amount \u2014 when refunded, the original amount is struck through and
          the effective net cost is shown underneath in muted colour. */}
      <View className="flex-row items-center mt-3">
        <Ionicons
          name={nature === "credit" ? "arrow-up" : "arrow-down"}
          size={18}
          color={nature === "credit" ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger}
        />
        <Text
          className="text-3xl font-bold text-foreground ml-1"
          style={isFullRefund || isPartialRefund ? { textDecorationLine: "line-through", opacity: 0.5 } : undefined}
        >
          {"\u20B9"}{formatNumber(amount)}
        </Text>
      </View>

      {(isFullRefund || isPartialRefund) && (
        <View className="mt-2 items-center">
          <Text className="text-xs text-muted-foreground">
            {isFullRefund ? "Fully refunded \u00B7 effective cost" : "Net cost after refund"}
          </Text>
          <Text className="text-xl font-bold text-foreground mt-0.5">
            {"\u20B9"}{formatNumber(effectiveAmount)}
          </Text>
          <Text className="text-[11px] text-muted-foreground mt-0.5">
            Refunded {"\u20B9"}{formatNumber(refundedAmount)}
          </Text>
        </View>
      )}

      {/* Category badge */}
      {categoryName && (
        <View
          className="flex-row items-center px-3 py-1.5 rounded-full mt-3"
          style={{ backgroundColor: (categoryColor ?? "#6B7280") + "14" }}
        >
          {categoryIcon && (
            <Ionicons
              name={categoryIcon as keyof typeof Ionicons.glyphMap}
              size={14}
              color={categoryColor ?? "#6B7280"}
            />
          )}
          <Text
            className="text-xs font-semibold ml-1.5"
            style={{ color: categoryColor ?? "#6B7280" }}
          >
            {categoryName}
          </Text>
        </View>
      )}

      {/* Date + Time */}
      <Text className="text-sm text-muted-foreground mt-2">
        {nature === "forecast" && dueDate
          ? `Due ${formatDisplayDate(dueDate)}`
          : formatDisplayDate(date)}
        {nature !== "forecast" && transactionTime && formatTime12h(transactionTime)
          ? ` at ${formatTime12h(transactionTime)}`
          : ""}
      </Text>
    </View>
  );
}
