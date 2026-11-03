import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Sheet, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { INSIGHT_PERIODS, insightPeriodLabel, type InsightPeriod } from "@/utils/insight-periods";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const monthLabel = (yyyyMM: string) => `${MONTH_SHORT[parseInt(yyyyMM.split("-")[1], 10) - 1]} ${yyyyMM.split("-")[0]}`;

/** Period chips, and with Custom a from and to month. Shared by Budget vs actual and Money in and out. */
export function PeriodBar({
  period,
  fyStartMonth,
  customStart,
  customEnd,
  onPeriod,
  onCustomStart,
  onCustomEnd,
}: {
  period: InsightPeriod;
  fyStartMonth: number;
  customStart: string;
  customEnd: string;
  onPeriod: (p: InsightPeriod) => void;
  onCustomStart: (month: string) => void;
  onCustomEnd: (month: string) => void;
}) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [picking, setPicking] = useState<"start" | "end" | null>(null);

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}
      >
        {INSIGHT_PERIODS.map((p) => {
          const selected = period === p;
          return (
            <Pressable
              key={p}
              onPress={() => onPeriod(p)}
              className="px-4 py-2 rounded-full border"
              style={{
                backgroundColor: selected ? theme.primary : "transparent",
                borderColor: selected ? theme.primary : colors.border,
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
            >
              <Text className="text-sm font-semibold" style={{ color: selected ? "#fff" : colors.textSecondary }}>
                {insightPeriodLabel(p, fyStartMonth)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {period === "custom" && (
        <View className="flex-row items-center px-4 pb-2 gap-2">
          <Text className="text-xs text-muted-foreground">From</Text>
          <Pressable
            onPress={() => setPicking("start")}
            className="flex-row items-center px-3 py-1.5 rounded-lg border"
            style={{ borderColor: colors.border }}
            accessibilityRole="button"
            accessibilityLabel={`From ${monthLabel(customStart)}`}
          >
            <Text className="text-sm font-medium text-foreground mr-1">{monthLabel(customStart)}</Text>
            <Ionicons name="chevron-down" size={13} color={colors.textSecondary} />
          </Pressable>
          <Text className="text-xs text-muted-foreground">to</Text>
          <Pressable
            onPress={() => setPicking("end")}
            className="flex-row items-center px-3 py-1.5 rounded-lg border"
            style={{ borderColor: colors.border }}
            accessibilityRole="button"
            accessibilityLabel={`To ${monthLabel(customEnd)}`}
          >
            <Text className="text-sm font-medium text-foreground mr-1">{monthLabel(customEnd)}</Text>
            <Ionicons name="chevron-down" size={13} color={colors.textSecondary} />
          </Pressable>
        </View>
      )}

      <Sheet visible={picking !== null} onClose={() => setPicking(null)}>
        <MiniMonthPicker
          key={picking ?? "closed"}
          value={picking === "start" ? customStart : customEnd}
          maxMonth={picking === "start" ? customEnd : undefined}
          minMonth={picking === "end" ? customStart : undefined}
          label={picking === "start" ? "Start Month" : "End Month"}
          onSelect={(v) => {
            if (picking === "start") onCustomStart(v);
            else onCustomEnd(v);
            setPicking(null);
          }}
          onCancel={() => setPicking(null)}
        />
      </Sheet>
    </>
  );
}

function MiniMonthPicker({
  value,
  minMonth,
  maxMonth,
  label,
  onSelect,
  onCancel,
}: {
  value: string;
  minMonth?: string;
  maxMonth?: string;
  label: string;
  onSelect: (v: string) => void;
  onCancel: () => void;
}) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [y, m] = value.split("-").map(Number);
  const [pickerYear, setPickerYear] = useState(y);
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const minYear = minMonth ? parseInt(minMonth.split("-")[0], 10) : undefined;
  const maxYear = maxMonth ? parseInt(maxMonth.split("-")[0], 10) : undefined;

  return (
    <View className="px-4 pt-5 pb-4">
      <Text className="text-base font-bold text-foreground mb-4">{label}</Text>

      <View className="flex-row items-center justify-between mb-4">
        <Pressable
          onPress={() => setPickerYear((v) => v - 1)}
          disabled={minYear !== undefined && pickerYear <= minYear}
          className="p-2"
          style={minYear !== undefined && pickerYear <= minYear ? { opacity: 0.25 } : undefined}
          accessibilityRole="button"
          accessibilityLabel="Previous year"
        >
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </Pressable>
        <Text className="text-lg font-bold text-foreground">{pickerYear}</Text>
        <Pressable
          onPress={() => setPickerYear((v) => v + 1)}
          disabled={maxYear !== undefined && pickerYear >= maxYear}
          className="p-2"
          style={maxYear !== undefined && pickerYear >= maxYear ? { opacity: 0.25 } : undefined}
          accessibilityRole="button"
          accessibilityLabel="Next year"
        >
          <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      <View className="flex-row flex-wrap mb-4">
        {MONTH_SHORT.map((name, idx) => {
          const monthNum = idx + 1;
          const monthVal = `${pickerYear}-${String(monthNum).padStart(2, "0")}`;
          const isSelected = pickerYear === y && monthNum === m;
          const isCurrent = monthVal === currentMonth;
          const isDisabled = (minMonth && monthVal < minMonth) || (maxMonth && monthVal > maxMonth);
          return (
            <Pressable
              key={name}
              onPress={() => !isDisabled && onSelect(monthVal)}
              disabled={!!isDisabled}
              className="w-1/3 items-center py-2.5"
              style={isDisabled ? { opacity: 0.25 } : undefined}
              accessibilityRole="button"
              accessibilityLabel={`${name} ${pickerYear}`}
            >
              <View
                className={`w-16 py-2 rounded-xl items-center ${isSelected ? "" : isCurrent ? "border" : ""}`}
                style={isSelected ? { backgroundColor: theme.primary } : isCurrent ? { borderColor: theme.primary } : undefined}
              >
                <Text
                  className="text-sm font-semibold"
                  style={{ color: isSelected ? "#fff" : isCurrent ? theme.primary : colors.text }}
                >
                  {name}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Pressable onPress={onCancel} className="py-3 rounded-xl bg-background items-center" accessibilityRole="button">
        <Text className="text-sm font-semibold text-muted-foreground">Cancel</Text>
      </Pressable>
    </View>
  );
}
