import { View } from "react-native";
import { Text } from "@/components/ui";
import { formatAmount } from "@/utils/format";
import { useTheme } from "@/hooks/use-theme";

export interface SpendBreakdownProps {
  count: number;
  /** What was paid - the whole bill when split. */
  gross: number;
  /** The part of split bills other people owe. */
  othersShare: number;
  /** Refunds - your share of them. */
  refunds: number;
  /** What counts as your spending: gross − othersShare − refunds. */
  net: number;
}

/**
 * How a spending total gets from what was paid to what counts: gross, others' share of split bills,
 * refunds, net counted. Shared by the Insights and Budget transaction lists and Monthly Summary so
 * they read the same. With nothing split or refunded there's nothing to explain, and it shows just
 * the transaction count.
 */
export function SpendBreakdown({ count, gross, othersShare, refunds, net }: SpendBreakdownProps) {
  const theme = useTheme();
  const countLabel = `${count} ${count === 1 ? "transaction" : "transactions"}`;
  // Under half a rupee is rounding, not an adjustment.
  if (othersShare < 0.5 && refunds < 0.5) {
    return <Text className="text-xs text-muted-foreground mt-0.5">{countLabel}</Text>;
  }
  return (
    <View className="mt-2 pt-2 border-t border-border">
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-xs text-muted-foreground">{countLabel} · gross</Text>
        <Text className="text-xs text-muted-foreground">{formatAmount(gross)}</Text>
      </View>
      {othersShare >= 0.5 && (
        <View className="flex-row items-center justify-between mb-1">
          <Text className="text-xs" style={{ color: theme.warning }}>
            🤝 Others' share (split)
          </Text>
          <Text className="text-xs font-medium" style={{ color: theme.warning }}>
            −{formatAmount(othersShare)}
          </Text>
        </View>
      )}
      {refunds >= 0.5 && (
        <View className="flex-row items-center justify-between mb-1">
          <Text className="text-xs" style={{ color: theme.success }}>
            ↩ Refunds
          </Text>
          <Text className="text-xs font-medium" style={{ color: theme.success }}>
            −{formatAmount(refunds)}
          </Text>
        </View>
      )}
      <View className="flex-row items-center justify-between pt-1.5 border-t border-border mt-0.5">
        <Text className="text-xs font-semibold text-foreground">Net counted</Text>
        <Text className="text-xs font-bold text-foreground">{formatAmount(net)}</Text>
      </View>
    </View>
  );
}
