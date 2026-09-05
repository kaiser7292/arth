import { Card } from "@/components/ui";
import { STATUS_COLORS } from "@/constants/semantic-colors";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { FinancialAccount } from "@/services/financial-account";
import { ac, acAlpha } from "@/utils/accent";
import { formatAmount } from "@/utils/format";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";

interface PensionSummaryCardProps {
  accounts: FinancialAccount[];
  computedBalances: Record<string, number | null>;
  creditTotals: Record<string, number>;
  lastContributionDate: string | null;
  ytdContributions: number;
}

function PensionSummaryCardImpl({ accounts, computedBalances, creditTotals, lastContributionDate, ytdContributions }: PensionSummaryCardProps) {
  const router = useRouter();
  const { accent, colorScheme, colors } = useColorScheme();

  if (accounts.length === 0) return null;

  const getBalance = (a: FinancialAccount) => computedBalances[a.id] ?? 0;
  const totalBalance = accounts.reduce((sum, a) => sum + getBalance(a), 0);
  const totalCredits = accounts.reduce((sum, a) => sum + (creditTotals[a.id] ?? 0), 0);

  return (
    <View>
      {/* v15.2.1: Pressable wraps Card (not vice versa) so on Android the
          touch responder sits outside the elevation shadow layer, eliminating
          the "first tap does nothing, scroll, then second tap works" bug. */}
      <Pressable
        onPress={() => router.push("/reconciliation/pension-accounts" as never)}
        accessibilityLabel="View pension account details"
        accessibilityRole="button"
      >
        <Card className="mx-4 mt-2">
          {/* Header row: icon + title + account count + chevron */}
          <View className="flex-row items-center mb-3">
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: acAlpha(accent, 600, 0.08) }}
            >
              <Ionicons
                name="briefcase-outline"
                size={20}
                color={ac(accent, colorScheme, 700, 300)}
              />
            </View>
            <Text className="text-sm font-semibold text-foreground flex-1">
              Pension
            </Text>
            <Text className="text-xs text-muted-foreground mr-2">
              {accounts.length} account{accounts.length !== 1 ? "s" : ""}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.textSecondary}
            />
          </View>

          {/* Balance + Contributions */}
          <View className="flex-row justify-between mb-1">
            <Text className="text-xs text-muted-foreground">Total Balance</Text>
            <Text
              className="text-sm font-bold"
              style={{ color: totalBalance >= 0 ? STATUS_COLORS.success : STATUS_COLORS.error }}
            >
              {formatAmount(totalBalance)}
            </Text>
          </View>
          {lastContributionDate && (
            <View className="flex-row justify-between mb-1">
              <Text className="text-xs text-muted-foreground">Last contribution</Text>
              <Text className="text-sm font-semibold text-foreground">
                {new Date(lastContributionDate + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
              </Text>
            </View>
          )}
          <View className="flex-row justify-between">
            <Text className="text-xs text-muted-foreground">YTD Contributions</Text>
            <Text
              className="text-sm font-semibold"
              style={{ color: ytdContributions > 0 ? STATUS_COLORS.success : colors.text }}
            >
              {formatAmount(ytdContributions)}
            </Text>
          </View>
        </Card>
      </Pressable>
    </View>
  );
}

export const PensionSummaryCard = memo(PensionSummaryCardImpl);
