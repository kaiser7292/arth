import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { ForecastActionBar } from "@/components/expense/ForecastActionBar";
import { Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import type { Expense } from "@/services/expense";
import { cleanDueLabel, dueCardSuffix, dueWhen } from "@/services/sms/due-description";
import { todayIso } from "@/utils/date";
import { formatAmount } from "@/utils/expense-validation";

/** Icon column width (w-7 + mr-2.5) — the actions line up with the name, not the icon. */
const TEXT_INDENT = 38;

interface DueRowProps {
  due: Pick<
    Expense,
    "id" | "amount" | "description" | "merchant_name" | "due_date" | "raw_source_text" | "forecast_type"
  >;
  /** The linked account's identifier, for the card's last 4 digits. */
  accountIdentifier?: string | null;
  onOpen: (id: string) => void;
  onMarkAsPaid: (id: string) => void;
  onRealiseNow: (id: string) => void;
  onDelete: (id: string) => void;
  onRepaymentPaid?: (id: string) => void;
  onPaidExternally?: (id: string) => void;
}

/** One row of Home's Upcoming Dues card. Callers draw the divider above it. */
export function DueRow({ due, accountIdentifier, onOpen, ...actions }: DueRowProps) {
  const theme = useTheme();
  const when = due.due_date ? dueWhen(due.due_date, todayIso()) : null;
  const isOverdue = when?.overdue ?? false;
  const label = cleanDueLabel(due.description || due.merchant_name);
  const suffix = dueCardSuffix(accountIdentifier, due.raw_source_text);
  const title = suffix ? `${label} ${suffix}` : label;
  const tone = isOverdue ? theme.danger : theme.warning;

  return (
    <View className="py-3">
      <Pressable
        onPress={() => onOpen(due.id)}
        accessibilityLabel={`${title}, ${formatAmount(due.amount)}`}
        accessibilityRole="button"
        className="flex-row items-center"
      >
        <View
          className="w-7 h-7 rounded-full items-center justify-center mr-2.5"
          style={{ backgroundColor: theme.alpha(isOverdue ? "danger" : "warning", 0.08) }}
        >
          <Ionicons name={isOverdue ? "alert-circle" : "time-outline"} size={14} color={tone} />
        </View>
        <View className="flex-1 mr-3">
          <Text className="text-sm font-medium text-foreground" numberOfLines={2}>
            {title}
          </Text>
          {when && (
            <Text className={`text-xs mt-0.5 ${isOverdue ? "text-danger" : "text-faint-foreground"}`}>
              {when.text}
            </Text>
          )}
        </View>
        <Text className="text-sm font-semibold shrink-0" style={{ color: tone }}>
          {formatAmount(due.amount)}
        </Text>
      </Pressable>
      <View className="mt-2.5" style={{ marginLeft: TEXT_INDENT }}>
        <ForecastActionBar forecastId={due.id} forecastType={due.forecast_type} compact {...actions} />
      </View>
    </View>
  );
}
