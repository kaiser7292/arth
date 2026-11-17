import { Chip, Text, moneyTone, type ChipTone } from "@/components/ui";
import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";
import { formatNumber } from "@/utils/format";
import { useTheme } from "@/hooks/use-theme";
import { tint } from "@/constants/brand";

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
  manual: "Added by you",
  sms_auto: "From SMS",
  email_auto: "From email",
};

function formatDisplayDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function formatTime12h(time: string): string | null {
  if (!time || time === "00:00:00") return null;
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/**
 * The top of a transaction: its icon, its name, the amount on the hero step and one line of when
 * and where from. At most ONE status chip, under it - the old hero stacked up to four uppercase
 * badges above the title.
 */
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
  const theme = useTheme();
  const title = description || merchantName || categoryName || "Expense";
  const subtitle = description && merchantName && merchantName !== description ? merchantName : null;

  // For split expenses, compare the refund against the full original charge, not just the user's share.
  // e.g. 128 total, 50-50 split → user's share = 64. Refund of 120 is partial (not full) because 120 < 128.
  const originalForRefund = splitOriginalAmount ?? amount;
  const isFullRefund = refundedAmount > 0 && refundedAmount + 0.01 >= originalForRefund;
  const isPartialRefund = refundedAmount > 0 && !isFullRefund;
  // Effective amount for split: remaining total × user's proportion.
  const myProportion = splitOriginalAmount != null && splitOriginalAmount > 0 ? amount / splitOriginalAmount : 1;
  const effectiveAmount = Math.max(0, Math.round((originalForRefund - refundedAmount) * myProportion * 100) / 100);

  const tone = moneyTone(theme, isTransfer ? "moved" : nature === "credit" ? "in" : "out");
  const iconColor = categoryColor ?? (isTransfer ? theme.data.transfer : nature === "credit" ? theme.success : theme.mutedForeground);
  const icon = (categoryIcon as keyof typeof Ionicons.glyphMap | null) ?? (isTransfer ? "swap-horizontal" : nature === "credit" ? "arrow-down" : "receipt-outline");

  const status1: { label: string; tone: ChipTone } | null =
    status === "pending_review"
      ? { label: "Needs review", tone: "warning" }
      : nature === "forecast"
        ? { label: "Forecast", tone: "warning" }
        : isFullRefund
          ? { label: "Refunded", tone: "success" }
          : isPartialRefund
            ? { label: "Partly refunded", tone: "warning" }
            : isTransfer
              ? { label: "Transfer", tone: "transfer" }
              : null;

  const time = nature !== "forecast" && transactionTime ? formatTime12h(transactionTime) : null;
  const meta = [
    nature === "forecast" && dueDate ? `Due ${formatDisplayDate(dueDate)}` : formatDisplayDate(date),
    time,
    SOURCE_LABELS[source] ?? source,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View className="px-4 pt-5 pb-4 items-center">
      <View className="w-14 h-14 rounded-card items-center justify-center mb-3" style={{ backgroundColor: tint(iconColor, 0.12) }}>
        <Ionicons name={icon} size={26} color={iconColor} />
      </View>

      <Text className="text-heading font-semibold text-foreground text-center" numberOfLines={2}>
        {title}
      </Text>
      {subtitle && (
        <Text className="text-meta text-muted-foreground mt-0.5 text-center" numberOfLines={1}>
          {subtitle}
        </Text>
      )}

      {/* Amount. Refunded: the original is struck through and what it cost after refunds is the big figure. */}
      {isFullRefund || isPartialRefund ? (
        <>
          <Text className="text-hero font-bold mt-2" style={{ color: tone.fg }} accessibilityLabel={`Net cost ₹${formatNumber(effectiveAmount)}`}>
            {"₹"}{formatNumber(effectiveAmount)}
          </Text>
          <Text className="text-meta text-muted-foreground mt-0.5">
            <Text className="line-through">{"₹"}{formatNumber(amount)}</Text>
            {"  ·  "}Refunded {"₹"}{formatNumber(refundedAmount)}
          </Text>
        </>
      ) : (
        <Text className="text-hero font-bold mt-2" style={{ color: tone.fg }}>
          {nature === "credit" ? "+" : ""}{"₹"}{formatNumber(amount)}
        </Text>
      )}

      <Text className="text-meta text-muted-foreground mt-1.5 text-center">{meta}</Text>

      {status1 && (
        <View className="mt-2.5">
          <Chip variant="status" tone={status1.tone} label={status1.label} />
        </View>
      )}
    </View>
  );
}
