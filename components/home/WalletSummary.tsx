import { memo, useState, useCallback } from "react";
import { View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";

import { formatAmount } from "@/utils/format";

import type { FinancialAccount } from "@/services/financial-account";
import { getComputedBalanceComponents, computeUnseededBalance } from "@/services/account-balance";
import { getCurrentMonth } from "@/services/budget";
import { useTheme } from "@/hooks/use-theme";

interface WalletSummaryProps {
  accounts: FinancialAccount[];
}

interface Totals {
  opening: number;
  expenses: number;
  credits: number;
  transfersOut: number;
  transfersIn: number;
  closing: number;
}

function WalletSummaryImpl({ accounts }: WalletSummaryProps) {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [totals, setTotals] = useState<Totals>({ opening: 0, expenses: 0, credits: 0, transfersOut: 0, transfersIn: 0, closing: 0 });

  const load = useCallback(async () => {
    if (accounts.length === 0) return;
    try {
      const ids = accounts.map((a) => a.id);
      const month = getCurrentMonth();
      const components = await getComputedBalanceComponents(ids);
      let opening = 0, expenses = 0, credits = 0, transfersOut = 0, transfersIn = 0, closing = 0;
      for (const id of ids) {
        const c = components[id];
        if (c) {
          opening += c.opening;
          expenses += c.expenses;
          credits += c.credits;
          transfersOut += c.transfersOut;
          transfersIn += c.transfersIn;
          closing += c.closing;
        } else {
          const unseeded = await computeUnseededBalance(id, month);
          opening += unseeded.opening;
          expenses += unseeded.expenses;
          credits += unseeded.credits;
          closing += unseeded.closing;
        }
      }
      setTotals({ opening, expenses, credits, transfersOut, transfersIn, closing });
    } catch {
      // DB not ready
    }
  }, [accounts]);

  useDataRefresh(load);

  if (accounts.length === 0) return null;

  const { opening, expenses, credits, transfersOut, transfersIn, closing } = totals;

  return (
    <View>
      <Pressable
        onPress={() => router.push("/reconciliation/wallets" as never)}
        accessibilityLabel="View wallet account details"
        accessibilityRole="button"
      >
        <Card className="mx-4 mt-2">
          {/* Header */}
          <View className="flex-row items-center mb-3">
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: theme.alpha("primary", 0.08) }}
            >
              <Ionicons name="phone-portrait-outline" size={20} color={theme.primary} />
            </View>
            <Text className="text-sm font-semibold text-foreground flex-1">
              Digital Wallets
            </Text>
            <Text className="text-xs text-muted-foreground mr-2">
              {accounts.length} wallet{accounts.length !== 1 ? "s" : ""}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </View>

          {/* Opening */}
          <View className="flex-row justify-between mb-1">
            <Text className="text-xs text-muted-foreground">Opening Balance</Text>
            <Text className="text-sm font-semibold text-foreground">
              {formatAmount(opening)}
            </Text>
          </View>

          {/* Expenses */}
          {expenses > 0 && (
            <View className="flex-row justify-between mb-1">
              <Text className="text-xs text-muted-foreground">Expenses</Text>
              <Text className="text-sm font-semibold" style={{ color: theme.danger }}>
                −{formatAmount(expenses)}
              </Text>
            </View>
          )}

          {/* Top-ups / Credits */}
          {credits > 0 && (
            <View className="flex-row justify-between mb-1">
              <Text className="text-xs text-muted-foreground">Top-ups / Refunds</Text>
              <Text className="text-sm font-semibold" style={{ color: theme.success }}>
                +{formatAmount(credits)}
              </Text>
            </View>
          )}

          {/* Transfers Out */}
          {transfersOut > 0 && (
            <View className="flex-row justify-between mb-1">
              <Text className="text-xs text-muted-foreground">Transfers Out</Text>
              <Text className="text-sm font-semibold" style={{ color: theme.danger }}>
                −{formatAmount(transfersOut)}
              </Text>
            </View>
          )}

          {/* Transfers In */}
          {transfersIn > 0 && (
            <View className="flex-row justify-between mb-1">
              <Text className="text-xs text-muted-foreground">Transfers In</Text>
              <Text className="text-sm font-semibold" style={{ color: theme.success }}>
                +{formatAmount(transfersIn)}
              </Text>
            </View>
          )}

          {/* Closing */}
          <View className="flex-row justify-between pt-2 mt-1 border-t border-border">
            <Text className="text-xs font-semibold text-muted-foreground">
              Closing Balance
            </Text>
            <Text className="text-sm font-bold" style={{ color: closing >= 0 ? theme.success : theme.danger }}>
              {formatAmount(closing)}
            </Text>
          </View>
        </Card>
      </Pressable>
    </View>
  );
}

export const WalletSummary = memo(WalletSummaryImpl);
