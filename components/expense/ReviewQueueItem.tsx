import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import { StatusColors } from "@/constants/theme";
import { SwipeableRow } from "@/components/ui";
import { formatAmount, formatDateForDisplay } from "@/utils/expense-validation";
import type { Expense } from "@/services/expense";

interface ReviewQueueItemProps {
  expense: Expense;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onTap: (id: string) => void;
  onSplit?: (id: string, amount: number) => void;
  onPaidForFamily?: (id: string, amount: number) => void;
}

const SOURCE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  sms_auto: "chatbubble-outline",
  email_auto: "mail-outline",
  manual: "create-outline",
};

export function ReviewQueueItem({
  expense,
  onApprove,
  onReject,
  onTap,
  onSplit,
  onPaidForFamily,
}: ReviewQueueItemProps) {
  const { colors, accent, colorScheme } = useColorScheme();
  const isForecast = expense.nature === "forecast";
  const isCredit = expense.nature === "credit";
  const sourceIcon = SOURCE_ICONS[expense.source] ?? "document-outline";
  const creditGreen = StatusColors[colorScheme].success;
  const creditGreenBg = StatusColors[colorScheme].successBg;

  const displayDate = isForecast && expense.due_date
    ? expense.due_date
    : expense.date;

  // Check if forecast is overdue
  const today = new Date().toISOString().split("T")[0];
  const isOverdue = isForecast && expense.due_date != null && expense.due_date < today;

  // Build subtitle: source badge + date
  const datePrefix = isForecast ? "Due " : "";

  return (
    <SwipeableRow
      onSwipeRight={() => onApprove(expense.id)}
      onSwipeLeft={() => onReject(expense.id)}
    >
      <Pressable
        onPress={() => onTap(expense.id)}
        className="flex-row items-center px-4 py-3.5 bg-white dark:bg-surface-dark-alt border-b border-border"
      >
        {/* Source/nature icon */}
        <View
          className="w-10 h-10 rounded-full items-center justify-center mr-3"
          style={{
            backgroundColor: isForecast
              ? StatusColors[colorScheme].warningBg
              : isCredit
                ? creditGreenBg
                : colors.blue + "14",
          }}
        >
          <Ionicons
            name={isForecast ? "time-outline" : isCredit ? "arrow-down-circle-outline" : sourceIcon}
            size={20}
            color={isForecast ? StatusColors[colorScheme].warning : isCredit ? creditGreen : colors.blue}
          />
        </View>

        {/* Left: Merchant + metadata */}
        <View className="flex-1 mr-3">
          <Text
            className="text-sm font-semibold text-foreground"
            numberOfLines={1}
          >
            {expense.description || expense.merchant_name || "Bank transaction"}
          </Text>
          <View className="flex-row items-center mt-0.5">
            {isCredit && (
              <View
                className="px-1.5 py-0.5 rounded mr-1.5"
                style={{ backgroundColor: creditGreenBg }}
              >
                <Text className="text-[10px] font-semibold" style={{ color: creditGreen }}>
                  CREDIT
                </Text>
              </View>
            )}
            {isForecast && (
              <View
                className="px-1.5 py-0.5 rounded mr-1.5"
                style={{
                  backgroundColor:
                    expense.forecast_type === "repayment"
                      ? colors.blue + "14"
                      : isOverdue
                        ? StatusColors[colorScheme].dangerBg
                        : StatusColors[colorScheme].warningBg,
                }}
              >
                <Text
                  className="text-[10px] font-semibold"
                  style={{
                    color:
                      expense.forecast_type === "repayment"
                        ? colors.blue
                        : isOverdue
                          ? StatusColors[colorScheme].danger
                          : StatusColors[colorScheme].warning,
                  }}
                >
                  {expense.forecast_type === "repayment"
                    ? "REPAYMENT"
                    : isOverdue
                      ? "OVERDUE"
                      : "DUE"}
                </Text>
              </View>
            )}
            <Text
              className="text-xs text-muted-foreground"
              numberOfLines={1}
            >
              {datePrefix}{formatDateForDisplay(displayDate)}
            </Text>
          </View>
        </View>

        {/* Quick action buttons (realized expenses only — not forecasts, not credits) */}
        {!isForecast && !isCredit && (
          <View className="flex-row items-center mr-2">
            {onPaidForFamily && (
              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  onPaidForFamily(expense.id, expense.amount);
                }}
                className="w-9 h-9 rounded-lg items-center justify-center mr-1"
                style={{ backgroundColor: StatusColors[colorScheme].warningBg }}
                hitSlop={4}
              >
                <Ionicons name="home-outline" size={16} color={StatusColors[colorScheme].warning} />
              </Pressable>
            )}
            {onSplit && (
              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  onSplit(expense.id, expense.amount);
                }}
                className="w-9 h-9 rounded-lg items-center justify-center"
                style={{ backgroundColor: ac(accent, colorScheme, 50, 900) }}
                hitSlop={4}
              >
                <Ionicons name="people-outline" size={16} color={colors.blue} />
              </Pressable>
            )}
          </View>
        )}

        {/* Right: Amount */}
        <View className="items-end shrink-0">
          <Text
            className="text-sm font-bold"
            style={isCredit ? { color: creditGreen } : undefined}
          >
            <Text className={isCredit ? "" : "text-foreground"}>
              {isCredit ? "+" : ""}{formatAmount(expense.amount)}
            </Text>
          </Text>
        </View>
      </Pressable>
    </SwipeableRow>
  );
}
