import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { formatAmount } from "@/utils/format";

interface YoYComparisonRowProps {
  label: string;
  currentAmount: number;
  previousAmount: number;
  deltaAmount: number;
  deltaPct: number | null;
  count: number;
  /** Largest bar in the whole table — sets the 100% width reference. */
  maxBarValue: number;
  onPress?: () => void;
}

/**
 * Row optimized for year-over-year category comparison. Shows two
 * side-by-side horizontal bars (current vs previous) scaled against the
 * largest bar in the dataset so small-category rows don't look identical
 * to the big ones. Delta is highlighted in red (grew) or green (shrank).
 *
 * "New this year" badge replaces the percentage when there's no
 * prior-year data for the category (avoids dividing by zero).
 */
export function YoYComparisonRow({
  label,
  currentAmount,
  previousAmount,
  deltaAmount,
  deltaPct,
  count,
  maxBarValue,
  onPress,
}: YoYComparisonRowProps) {
  const { colorScheme } = useColorScheme();
  const statusColors = StatusColors[colorScheme];

  const isNew = deltaPct === null;
  const grew = deltaAmount >= 0;
  const deltaColor = grew ? statusColors.danger : statusColors.success;

  const currentWidth = maxBarValue > 0 ? (currentAmount / maxBarValue) * 100 : 0;
  const previousWidth = maxBarValue > 0 ? (previousAmount / maxBarValue) * 100 : 0;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      className="py-3 border-b border-border"
      accessibilityLabel={
        isNew
          ? `${label}: new this year ${formatAmount(currentAmount)}, ${count} transactions`
          : `${label}: ${formatAmount(currentAmount)} this year versus ${formatAmount(previousAmount)} last year, ${grew ? "up" : "down"} ${Math.abs(deltaPct ?? 0)}%, ${count} transactions`
      }
      accessibilityRole={onPress ? "button" : undefined}
    >
      {/* Header row: label + delta badge */}
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center flex-1 mr-2">
          <Text
            className="text-sm font-semibold text-foreground"
            numberOfLines={1}
          >
            {label}
          </Text>
          {isNew && (
            <View
              className="ml-2 rounded-full px-2 py-0.5"
              style={{ backgroundColor: statusColors.warning + "22" }}
            >
              <Text className="text-[10px] font-semibold" style={{ color: statusColors.warning }}>
                NEW THIS YEAR
              </Text>
            </View>
          )}
        </View>
        {!isNew && (
          <View className="flex-row items-center">
            <Ionicons
              name={grew ? "arrow-up" : "arrow-down"}
              size={12}
              color={deltaColor}
              style={{ marginRight: 2 }}
            />
            <Text className="text-xs font-bold" style={{ color: deltaColor }}>
              {grew ? "+" : ""}
              {deltaPct}%
            </Text>
          </View>
        )}
        {onPress && (
          <Ionicons
            name="chevron-forward"
            size={14}
            color={statusColors.muted}
            style={{ marginLeft: 6 }}
          />
        )}
      </View>

      {/* Twin bars */}
      <View className="gap-1.5">
        {/* This year */}
        <View className="flex-row items-center">
          <Text className="text-[10px] font-medium text-faint-foreground w-16">
            This yr
          </Text>
          <View className="flex-1 h-4 rounded-md bg-card overflow-hidden mr-2">
            <View
              className="h-full rounded-md"
              style={{
                width: `${Math.max(currentWidth, 1)}%`,
                backgroundColor: grew ? statusColors.danger : statusColors.success,
              }}
            />
          </View>
          <Text className="text-xs font-bold text-foreground w-20 text-right">
            {formatAmount(currentAmount)}
          </Text>
        </View>

        {/* Last year */}
        <View className="flex-row items-center">
          <Text className="text-[10px] font-medium text-faint-foreground w-16">
            Last yr
          </Text>
          <View className="flex-1 h-4 rounded-md bg-card overflow-hidden mr-2">
            <View
              className="h-full rounded-md"
              style={{
                width: `${Math.max(previousWidth, 1)}%`,
                backgroundColor: statusColors.muted + "99",
              }}
            />
          </View>
          <Text className="text-xs text-muted-foreground w-20 text-right">
            {isNew ? "-" : formatAmount(previousAmount)}
          </Text>
        </View>
      </View>

      {/* Footer: delta ₹ + transaction count */}
      <View className="flex-row items-center justify-between mt-1.5 ml-16">
        <Text className="text-[11px] text-faint-foreground">
          {count} {count === 1 ? "transaction" : "transactions"} this year
        </Text>
        {!isNew && (
          <Text className="text-[11px] font-semibold" style={{ color: deltaColor }}>
            {grew ? "+" : "−"}
            {formatAmount(Math.abs(deltaAmount))} vs last yr
          </Text>
        )}
      </View>
    </Pressable>
  );
}
