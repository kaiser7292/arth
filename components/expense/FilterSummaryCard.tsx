import { useState, useMemo } from "react";
import { STATUS_COLORS } from "@/constants/semantic-colors";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import { formatAmount } from "@/utils/expense-validation";
import type { FilteredSummary } from "@/services/expense";

interface FilterSummaryCardProps {
  summary: FilteredSummary;
  resolveGroupLabel: (key: string | null) => string;
  groupLabelHeader: string;
  onChangeGroupBy?: (groupBy: "category" | "account" | "payment_mode" | "merchant") => void;
  allowGroupByChange?: boolean;
  /** Total for the previous same-length period. When provided, renders a trend % delta. */
  previousTotal?: number | null;
  /** 'realized' = expenses (default), 'credit' = incoming money. Changes row labels and trend color semantics (more credit = better). */
  natureKind?: "realized" | "credit";
  /** Which groupBy options to offer. Defaults to all four. Credits mode typically omits 'category' since credits rarely carry a category. */
  availableGroupBys?: ReadonlyArray<"category" | "account" | "payment_mode" | "merchant">;
}

const MAX_VISIBLE_GROUPS = 5;

export function FilterSummaryCard({
  summary,
  resolveGroupLabel,
  groupLabelHeader,
  onChangeGroupBy,
  allowGroupByChange = false,
  previousTotal,
  natureKind = "realized",
  availableGroupBys = ["category", "account", "payment_mode", "merchant"] as const,
}: FilterSummaryCardProps) {
  const { accent, colorScheme } = useColorScheme();
  const [collapsed, setCollapsed] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const visibleGroups = useMemo(
    () => (showAll ? summary.groups : summary.groups.slice(0, MAX_VISIBLE_GROUPS)),
    [summary.groups, showAll],
  );

  const isCredit = natureKind === "credit";
  const itemLabel = isCredit
    ? summary.count === 1 ? "credit" : "credits"
    : summary.count === 1 ? "expense" : "expenses";

  return (
    <View className="px-4 pt-2 pb-1">
      <Card elevated={false}>
        <Pressable
          onPress={() => setCollapsed((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={collapsed ? "Expand summary" : "Collapse summary"}
        >
          <View className="flex-row items-start justify-between">
            <View className="flex-1">
              <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                Filtered Total
              </Text>
              <Text
                className="text-2xl font-bold mt-1"
                style={{ color: ac(accent, colorScheme, 600, 300) }}
              >
                {formatAmount(summary.total)}
              </Text>
              <Text className="text-xs text-muted-foreground mt-0.5">
                {summary.count} {itemLabel}
              </Text>
              {previousTotal != null && previousTotal > 0 && (() => {
                const delta = ((summary.total - previousTotal) / previousTotal) * 100;
                const absDelta = Math.abs(delta);
                if (absDelta < 0.5) return null;
                const isUp = delta > 0;
                // Expenses: higher = worse (red), lower = better (green).
                // Credits: higher = better (green), lower = worse (red).
                const isGood = isCredit ? isUp : !isUp;
                const color = isGood ? STATUS_COLORS.success : STATUS_COLORS.error;
                return (
                  <Text className="text-xs font-medium mt-1" style={{ color }}>
                    {isUp ? "↑" : "↓"} {absDelta.toFixed(0)}% vs previous period
                  </Text>
                );
              })()}
            </View>
            <Ionicons
              name={collapsed ? "chevron-down" : "chevron-up"}
              size={18}
              color={ac(accent, colorScheme, 500, 300)}
            />
          </View>
        </Pressable>

        {!collapsed && summary.groups.length > 0 && (
          <View className="mt-3 pt-3 border-t border-border">
            {allowGroupByChange && onChangeGroupBy && availableGroupBys.length > 1 && (
              <View className="flex-row mb-3">
                {availableGroupBys.map((gb) => {
                  const isActive = summary.groupBy === gb;
                  const label = gb === "category" ? "Category" : gb === "account" ? "Account" : gb === "merchant" ? "Merchant" : "Payment";
                  return (
                    <Pressable
                      key={gb}
                      onPress={() => onChangeGroupBy(gb)}
                      className={`px-3 py-1 rounded-full mr-2 ${
                        isActive ? "border" : "bg-card"
                      }`}
                      style={
                        isActive
                          ? { backgroundColor: ac(accent, colorScheme, 100, 700), borderColor: accent[500] }
                          : undefined
                      }
                    >
                      <Text
                        className={`text-xs ${
                          isActive ? "font-medium" : "text-muted-foreground"
                        }`}
                        style={isActive ? { color: ac(accent, colorScheme, 500, 200) } : undefined}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <Text className="text-label font-semibold tracking-wider uppercase text-muted-foreground mb-2">
              By {groupLabelHeader}
            </Text>

            {visibleGroups.map((group) => {
              const pct = summary.total > 0 ? (group.total / summary.total) * 100 : 0;
              return (
                <View key={group.key ?? "__null__"} className="mb-2">
                  <View className="flex-row items-center justify-between mb-1">
                    <Text
                      className="text-sm text-foreground flex-1 pr-2"
                      numberOfLines={1}
                    >
                      {resolveGroupLabel(group.key)}
                    </Text>
                    <Text className="text-sm font-semibold text-foreground">
                      {formatAmount(group.total)}
                    </Text>
                  </View>
                  <View className="flex-row items-center">
                    <View className="flex-1 h-1.5 rounded-full bg-card overflow-hidden">
                      <View
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: accent[500],
                        }}
                      />
                    </View>
                    <Text className="text-label text-muted-foreground ml-2 w-10 text-right">
                      {pct.toFixed(0)}%
                    </Text>
                  </View>
                </View>
              );
            })}

            {summary.groups.length > MAX_VISIBLE_GROUPS && (
              <Pressable onPress={() => setShowAll((v) => !v)} className="mt-1">
                <Text className="text-xs font-medium" style={{ color: accent[500] }}>
                  {showAll ? "Show less" : `Show all ${summary.groups.length}`}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </Card>
    </View>
  );
}
