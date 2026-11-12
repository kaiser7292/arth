import { memo } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { formatAmount } from "@/utils/format";
import { useTheme } from "@/hooks/use-theme";
import { AnimatedNumber, PressableScale } from "@/components/motion";
import { HomeTile } from "./HomeTile";

export interface InstrumentBreakdown {
  label: string;
  value: number;
}

interface InvestmentsSummaryCardProps {
  totalValue: number;
  accountCount: number;
  breakdown: InstrumentBreakdown[];
  /** Draw as a compact Home tile at this place in the stagger. */
  tileIndex?: number;
}

/**
 * Replaces the separate Demat + Pension home cards (Item 10 Phase 3,
 * docs/INVESTMENT_ACCOUNTS_PROPOSAL.md section 5) with one Investments card,
 * in the same header + per-line-item + divided-total shape as the other
 * hero cards (BankBalanceSummary, DematSummaryCard before it): one row per
 * instrument with its full amount, then a bold Total Value row. Includes FD
 * accounts too, which never had a home card of their own before this.
 */
function InvestmentsSummaryCardImpl({ totalValue, accountCount, breakdown, tileIndex }: InvestmentsSummaryCardProps) {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();

  if (accountCount === 0) return null;

  if (tileIndex != null) {
    const top = [...breakdown].sort((a, b) => b.value - a.value)[0];
    return (
      <HomeTile
        index={tileIndex}
        icon="trending-up-outline"
        label={`Investments · ${accountCount}`}
        value={totalValue}
        sub={top && breakdown.length > 1 ? `Most in ${top.label}` : top?.label}
        onPress={() => router.push("/investments")}
      />
    );
  }

  return (
    <View>
      <PressableScale
        onPress={() => router.push("/investments")}
        accessibilityLabel="View investment accounts"
        accessibilityRole="button"
      >
        <Card className="mx-4 mt-2">
          <View className="flex-row items-center mb-3">
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: theme.alpha("primary", 0.08) }}
            >
              <Ionicons name="trending-up-outline" size={20} color={theme.primary} />
            </View>
            <Text className="text-sm font-semibold text-foreground flex-1">Investments</Text>
            <Text className="text-xs text-muted-foreground mr-2">
              {accountCount} account{accountCount !== 1 ? "s" : ""}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </View>

          {breakdown.map((b) => (
            <View key={b.label} className="flex-row justify-between mb-1">
              <Text className="text-xs text-muted-foreground">{b.label}</Text>
              <Text className="text-sm font-semibold text-foreground">{formatAmount(b.value)}</Text>
            </View>
          ))}

          <View className="flex-row justify-between pt-2 mt-1 border-t border-border">
            <Text className="text-xs font-semibold text-muted-foreground">Total Value</Text>
            <AnimatedNumber value={totalValue} className="text-sm font-bold text-foreground" />
          </View>
        </Card>
      </PressableScale>
    </View>
  );
}

export const InvestmentsSummaryCard = memo(InvestmentsSummaryCardImpl);
