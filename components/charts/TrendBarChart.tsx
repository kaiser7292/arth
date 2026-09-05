import { memo } from "react";
import { Text } from "@/components/ui";
import { View, Pressable } from "react-native";
import type { MonthlyTotal } from "@/services/expense";
import { formatAmount } from "@/utils/expense-validation";

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

interface TrendBarChartProps {
  data: MonthlyTotal[];
  color: string;
  budgetAmount?: number;
  /** Currently selected month (highlighted with full color) */
  selectedMonth?: string | null;
  /** Called when a bar is tapped */
  onBarPress?: (month: string, total: number) => void;
}

function TrendBarChartBase({ data, color, budgetAmount, selectedMonth, onBarPress }: TrendBarChartProps) {
  if (data.length === 0) return null;

  const maxValue = Math.max(
    ...data.map((d) => d.total),
    budgetAmount ?? 0,
  );

  if (maxValue === 0) {
    return (
      <View className="items-center py-4">
        <Text className="text-xs text-faint-foreground">No spending data yet</Text>
      </View>
    );
  }

  return (
    <View>
      {/* Bars */}
      <View className="flex-row items-end justify-between" style={{ height: 120 }}>
        {data.map((item) => {
          const barHeight = maxValue > 0 ? (item.total / maxValue) * 100 : 0;
          const [, m] = item.month.split("-").map(Number);
          const label = SHORT_MONTHS[m - 1];
          const isCurrentMonth =
            item.month ===
            `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
          const isSelected = selectedMonth != null ? item.month === selectedMonth : isCurrentMonth;

          return (
            <Pressable
              key={item.month}
              onPress={() => onBarPress?.(item.month, item.total)}
              style={({ pressed }) => ({ opacity: pressed && onBarPress ? 0.6 : 1, flex: 1, alignItems: "center", marginHorizontal: 4 })}
              disabled={!onBarPress}
            >
              {/* Amount label above bar */}
              {item.total > 0 && (
                <Text
                  className={`text-label mb-1 ${
                    isSelected
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground"
                  }`}
                  numberOfLines={1}
                >
                  {formatAmount(item.total).replace("₹", "")}
                </Text>
              )}
              {/* Bar */}
              <View
                className="w-full rounded-t-md"
                style={{
                  height: Math.max(barHeight, item.total > 0 ? 4 : 0),
                  backgroundColor: isSelected ? color : color + "40",
                  minWidth: 20,
                }}
              />
              {/* Month label */}
              <Text
                className={`text-label mt-1 ${
                  isSelected
                    ? "font-semibold text-foreground"
                    : "text-faint-foreground"
                }`}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Budget line indicator */}
      {budgetAmount !== undefined && budgetAmount > 0 && (
        <View className="flex-row items-center mt-2">
          <View
            className="h-[1px] flex-1"
            style={{ backgroundColor: "#9CA3AF" }}
          />
          <Text className="text-label text-faint-foreground ml-2">
            Budget: {formatAmount(budgetAmount)}
          </Text>
        </View>
      )}
    </View>
  );
}

export const TrendBarChart = memo(TrendBarChartBase);
