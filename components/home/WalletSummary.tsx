import { memo } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac, acAlpha } from "@/utils/accent";
import { formatAmount } from "@/utils/format";
import { STATUS_COLORS } from "@/constants/semantic-colors";
import type { FinancialAccount } from "@/services/financial-account";

interface WalletSummaryProps {
  accounts: FinancialAccount[];
  computedBalances: Record<string, number | null>;
  expenseTotals: Record<string, number>;
}

function WalletSummaryImpl({ accounts, computedBalances, expenseTotals }: WalletSummaryProps) {
  const router = useRouter();
  const { accent, colorScheme, colors } = useColorScheme();

  if (accounts.length === 0) return null;

  const getBalance = (a: FinancialAccount) => computedBalances[a.id] ?? a.last_known_balance ?? 0;
  const totalBalance = accounts.reduce((sum, a) => sum + getBalance(a), 0);
  const totalSpent = accounts.reduce((sum, a) => sum + (expenseTotals[a.id] ?? 0), 0);

  return (
    <View>
      {/* v15.2.1: Pressable outside Card. See BankBalanceSummary for rationale. */}
      <Pressable
        onPress={() => router.push("/reconciliation/wallets" as never)}
        accessibilityLabel="View wallet account details"
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
                name="phone-portrait-outline"
                size={20}
                color={ac(accent, colorScheme, 700, 300)}
              />
            </View>
            <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary flex-1">
              Digital Wallets
            </Text>
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mr-2">
              {accounts.length} wallet{accounts.length !== 1 ? "s" : ""}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.textSecondary}
            />
          </View>

          {/* Balance + Spent */}
          <View className="flex-row justify-between mb-1">
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Total Balance</Text>
            <Text
              className="text-sm font-bold"
              style={{ color: totalBalance >= 0 ? STATUS_COLORS.success : STATUS_COLORS.error }}
            >
              {formatAmount(totalBalance)}
            </Text>
          </View>
          {totalSpent > 0 && (
            <View className="flex-row justify-between">
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Spent this month</Text>
              <Text
                className="text-sm font-semibold"
                style={{ color: STATUS_COLORS.error }}
              >
                {formatAmount(totalSpent)}
              </Text>
            </View>
          )}
        </Card>
      </Pressable>
    </View>
  );
}

export const WalletSummary = memo(WalletSummaryImpl);
