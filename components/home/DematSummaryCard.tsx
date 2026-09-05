import { memo } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac, acAlpha } from "@/utils/accent";
import { formatAmount } from "@/utils/format";
import { STATUS_COLORS } from "@/constants/semantic-colors";

interface DematSummaryCardProps {
  totalPortfolio: number;
  totalFund: number;
  accountCount: number;
}

function DematSummaryCardImpl({
  totalPortfolio,
  totalFund,
  accountCount,
}: DematSummaryCardProps) {
  const router = useRouter();
  const { accent, colorScheme, colors } = useColorScheme();

  if (accountCount === 0) return null;

  const total = totalPortfolio + totalFund;

  return (
    <View>
      {/* v15.2.1: Pressable outside Card. See BankBalanceSummary for rationale. */}
      <Pressable
        onPress={() => router.push("/reconciliation/demat-portfolio" as never)}
        accessibilityLabel="View demat account details"
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
                name="trending-up-outline"
                size={20}
                color={ac(accent, colorScheme, 700, 300)}
              />
            </View>
            <Text className="text-sm font-semibold text-foreground flex-1">
              Demat Accounts
            </Text>
            <Text className="text-xs text-muted-foreground mr-2">
              {accountCount} account{accountCount !== 1 ? "s" : ""}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.textSecondary}
            />
          </View>

          {/* Portfolio Value */}
          <View className="flex-row justify-between mb-1">
            <Text className="text-xs text-muted-foreground">
              Portfolio Value
            </Text>
            <Text
              className="text-sm font-bold"
              style={{ color: totalPortfolio > 0 ? STATUS_COLORS.success : colors.text }}
            >
              {formatAmount(totalPortfolio)}
            </Text>
          </View>

          {/* Fund Balance */}
          {totalFund > 0 && (
            <View className="flex-row justify-between mb-1">
              <Text className="text-xs text-muted-foreground">
                Idle Cash / Fund
              </Text>
              <Text className="text-sm font-semibold text-foreground">
                {formatAmount(totalFund)}
              </Text>
            </View>
          )}

          {/* Total */}
          {totalFund > 0 && (
            <View className="flex-row justify-between pt-1 mt-1 border-t border-border">
              <Text className="text-xs font-medium text-muted-foreground">
                Total
              </Text>
              <Text className="text-sm font-bold text-foreground">
                {formatAmount(total)}
              </Text>
            </View>
          )}
        </Card>
      </Pressable>
    </View>
  );
}

export const DematSummaryCard = memo(DematSummaryCardImpl);
