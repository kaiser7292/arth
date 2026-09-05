import { memo } from "react";
import { View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { formatAmount } from "@/utils/format";
import { STATUS_COLORS } from "@/constants/semantic-colors";
import type { FinancialAccount } from "@/services/financial-account";
import { useTheme } from "@/hooks/use-theme";

interface CreditCardDashboardProps {
  accounts: FinancialAccount[];
  expenseTotals: Record<string, number>;
  computedBalances: Record<string, number | null>;
}

function getUtilColor(pct: number): string {
  if (pct > 75) return STATUS_COLORS.error;
  if (pct > 50) return STATUS_COLORS.warning;
  return STATUS_COLORS.success;
}

function CreditCardDashboardImpl({ accounts, expenseTotals, computedBalances }: CreditCardDashboardProps) {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();

  if (accounts.length === 0) return null;

  // Deduplicate credit limits by bank — shared limits counted once per bank.
  // For shared-pool siblings (e.g. Axis 2445 + 8920), the user typically
  // seeds credit_limit on only one card and the bank pool is the MAX across
  // siblings (they share the pool — not additive).
  const limitByBank = new Map<string, number>();
  for (const a of accounts) {
    if (a.credit_limit && a.credit_limit > 0) {
      const current = limitByBank.get(a.bank_name) ?? 0;
      limitByBank.set(a.bank_name, Math.max(current, a.credit_limit));
    }
  }
  const totalLimit = Array.from(limitByBank.values()).reduce((sum, v) => sum + v, 0);

  // Utilized model: per-card ledger closing IS the utilized amount. Pool
  // utilized = sum of sibling closings (no capping — ledger is authoritative).
  //
  // v15.2.1 fix: previously we'd `continue` when a card's own credit_limit
  // was 0/null. That silently dropped every expense on the unseeded sibling
  // of a shared-pool CC (e.g. Axis 2445 add-on under 8920) from the bank's
  // utilized total — so new spends on 2445 appeared to not affect the
  // balance. Now: if the BANK has any seeded limit, every sibling's closing
  // counts toward that bank's utilized. Cards whose bank has zero seeded
  // limit anywhere are still skipped (no denominator to reason against).
  const utilizedByBank = new Map<string, number>();
  for (const a of accounts) {
    const bankHasLimit = (limitByBank.get(a.bank_name) ?? 0) > 0;
    if (!bankHasLimit) continue;
    const closing = computedBalances[a.id];
    let cardUtilized: number;
    if (closing != null) {
      cardUtilized = closing;
    } else if (a.last_known_balance != null && a.credit_limit != null && a.credit_limit > 0) {
      // Fallback only for cards that DO have their own seeded limit; for
      // unseeded siblings we have no meaningful fallback and closing=0
      // keeps them inert until the ledger catches up.
      cardUtilized = Math.max(0, a.credit_limit - a.last_known_balance);
    } else {
      cardUtilized = 0;
    }
    const current = utilizedByBank.get(a.bank_name) ?? 0;
    utilizedByBank.set(a.bank_name, current + cardUtilized);
  }

  const totalUtilized = Array.from(utilizedByBank.values()).reduce((sum, v) => sum + v, 0);
  const totalAvailable = totalLimit - totalUtilized;
  const overallUtil = totalLimit > 0 ? (totalUtilized / totalLimit) * 100 : null;
  const overallUtilColor = overallUtil != null ? getUtilColor(overallUtil) : STATUS_COLORS.muted;

  return (
    <View>
      {/* v15.2.1: Pressable outside Card. See BankBalanceSummary for rationale. */}
      <Pressable
        onPress={() => router.push("/reconciliation/credit-cards" as never)}
        accessibilityLabel="View credit card details"
        accessibilityRole="button"
      >
        <Card className="mx-4 mt-2">
          {/* Header row: icon + title + card count + chevron */}
          <View className="flex-row items-center mb-3">
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: theme.alpha("primary", 0.08) }}
            >
              <Ionicons
                name="card-outline"
                size={20}
                color={theme.primary}
              />
            </View>
            <Text className="text-sm font-semibold text-foreground flex-1">
              Credit Cards
            </Text>
            <Text className="text-xs text-muted-foreground mr-2">
              {accounts.length} card{accounts.length !== 1 ? "s" : ""}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.textSecondary}
            />
          </View>

          {/* Three-line breakdown: Limit, Utilized, Remaining */}
          <View className="flex-row justify-between mb-1">
            <Text className="text-xs text-muted-foreground">Credit Limit</Text>
            <Text className="text-sm font-semibold text-foreground">
              {formatAmount(totalLimit)}
            </Text>
          </View>
          <View className="flex-row justify-between mb-1">
            <Text className="text-xs text-muted-foreground">Utilized</Text>
            <Text className="text-sm font-semibold" style={{ color: totalUtilized > 0 ? STATUS_COLORS.error : colors.text }}>
              {formatAmount(totalUtilized)}
            </Text>
          </View>
          <View className="flex-row justify-between mb-2">
            <Text className="text-xs text-muted-foreground">Remaining</Text>
            <Text className="text-sm font-bold" style={{ color: STATUS_COLORS.success }}>
              {formatAmount(totalAvailable)}
            </Text>
          </View>

          {/* Utilization bar */}
          {overallUtil != null && (
            <View>
              <View className="h-1.5 rounded-full bg-border">
                <View
                  className="h-1.5 rounded-full"
                  style={{
                    width: `${Math.min(overallUtil, 100)}%`,
                    backgroundColor: overallUtilColor,
                  }}
                />
              </View>
              <Text className="text-label mt-0.5" style={{ color: overallUtilColor }}>
                {Math.round(overallUtil)}% used
              </Text>
            </View>
          )}
        </Card>
      </Pressable>
    </View>
  );
}

export const CreditCardDashboard = memo(CreditCardDashboardImpl);
