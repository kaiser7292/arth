import { memo } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac, acAlpha } from "@/utils/accent";
import { formatAmount } from "@/utils/format";
import { formatDate } from "@/utils/date";
import { STATUS_COLORS } from "@/constants/semantic-colors";
import type { LoansSummary } from "@/services/loan-accounts";

interface LoanSummaryCardProps {
  summary: LoansSummary;
}

function LoanSummaryCardImpl({ summary }: LoanSummaryCardProps) {
  const router = useRouter();
  const { accent, colorScheme, colors } = useColorScheme();

  return (
    <View>
      <Pressable
        onPress={() => router.push("/goals/loans" as never)}
        accessibilityLabel="View loan details"
        accessibilityRole="button"
      >
        <Card className="mx-4 mt-2">
          {/* Header row */}
          <View className="flex-row items-center mb-3">
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: acAlpha(accent, 600, 0.08) }}
            >
              <Ionicons
                name="cash-outline"
                size={20}
                color={ac(accent, colorScheme, 700, 300)}
              />
            </View>
            <Text className="text-sm font-semibold text-foreground flex-1">
              Loans
            </Text>
            <Text className="text-xs text-muted-foreground mr-2">
              {summary.activeCount} active
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.textSecondary}
            />
          </View>

          {/* Total Outstanding */}
          <View className="flex-row justify-between mb-1">
            <Text className="text-xs text-muted-foreground">
              Total Outstanding
            </Text>
            <Text
              className="text-sm font-bold"
              style={{ color: STATUS_COLORS.error }}
            >
              {formatAmount(summary.totalOutstandingINR)}
            </Text>
          </View>

          {/* Total Monthly EMI */}
          {summary.totalMonthlyEMI > 0 && (
            <View className="flex-row justify-between mb-1">
              <Text className="text-xs text-muted-foreground">
                Monthly EMI
              </Text>
              <Text className="text-sm font-semibold text-foreground">
                {formatAmount(summary.totalMonthlyEMI)}
              </Text>
            </View>
          )}

          {/* Next EMI Due */}
          {summary.nextDue && (
            <View className="flex-row justify-between pt-1 mt-1 border-t border-border">
              <Text className="text-xs text-muted-foreground">
                Next EMI · {summary.nextDue.bankName}
              </Text>
              <Text className="text-xs font-medium text-muted-foreground">
                {formatDate(summary.nextDue.dueDate)} · {formatAmount(summary.nextDue.amount)}
              </Text>
            </View>
          )}
        </Card>
      </Pressable>
    </View>
  );
}

export const LoanSummaryCard = memo(LoanSummaryCardImpl);
