import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import type { Expense } from "@/services/expense";

interface ExpenseForecastTimelineProps {
  expense: Expense;
}

const LONG_DATE: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

function longDate(value: string): string {
  return new Date(value).toLocaleDateString("en-IN", LONG_DATE);
}

/**
 * When a forecast was detected, when it is due, and when it was paid.
 *
 * Forecasts only - the caller renders nothing for any other nature, and this returns null as a
 * second guard so the rule travels with the component rather than living only at the call site.
 *
 * Split out of app/expense/[id].tsx. It takes the expense and nothing else: every value it shows
 * is derived from that one object.
 */
export function ExpenseForecastTimeline({ expense }: ExpenseForecastTimelineProps) {
  const { colors } = useColorScheme();
  const theme = useTheme();

  if (expense.nature !== "forecast") return null;

  const detected = longDate(expense.created_at);
  // due_date is a bare YYYY-MM-DD; anchor it to local midnight so it does not shift a day.
  const due = expense.due_date ? longDate(expense.due_date + "T00:00:00") : null;
  const isPaid = expense.status === "rejected" && expense.paid_from_account_id;
  const paidOn = isPaid ? longDate(expense.updated_at) : null;

  return (
    <View className="mx-4 mt-3 rounded-xl bg-card">
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Ionicons name="scan-outline" size={16} color={colors.textSecondary} />
        <Text className="text-xs text-muted-foreground ml-3 w-24">Detected</Text>
        <Text className="text-sm font-medium text-foreground flex-1 text-right">{detected}</Text>
      </View>

      {due && (
        <View
          className={`flex-row items-center px-4 py-3 ${paidOn ? "border-b border-border" : ""}`}
        >
          <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
          <Text className="text-xs text-muted-foreground ml-3 w-24">Due</Text>
          <Text className="text-sm font-medium text-foreground flex-1 text-right">{due}</Text>
        </View>
      )}

      {paidOn && (
        <View className="flex-row items-center px-4 py-3">
          <Ionicons name="checkmark-circle-outline" size={16} color={theme.success} />
          <Text className="text-xs text-muted-foreground ml-3 w-24">Paid on</Text>
          <Text
            className="text-sm font-medium flex-1 text-right"
            style={{ color: theme.success }}
          >
            {paidOn}
          </Text>
        </View>
      )}
    </View>
  );
}
