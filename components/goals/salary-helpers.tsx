import { useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac } from "@/utils/accent";
import { STATE_LIST } from "@/services/tax-engine";
import { formatAmount } from "@/utils/expense-validation";

// ─── Toggle Component ─────────────────────────────────────

export function Toggle({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const { accent } = useColorScheme();
  return (
    <View className="mb-3">
      <Text className="text-xs font-semibold text-muted-foreground mb-1.5">
        {label}
      </Text>
      <View className="flex-row rounded-lg border border-border overflow-hidden">
        {options.map((opt) => (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            className={`flex-1 py-2.5 items-center ${
              value === opt.value
                ? ""
                : "bg-white dark:bg-surface-dark-alt"
            }`}
            style={value === opt.value ? { backgroundColor: accent[500] } : undefined}
          >
            <Text
              className={`text-sm font-medium ${
                value === opt.value
                  ? "text-white"
                  : "text-muted-foreground"
              }`}
            >
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ─── State Picker ─────────────────────────────────────────

export function StatePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const { accent, colorScheme, colors } = useColorScheme();
  const [expanded, setExpanded] = useState(false);

  return (
    <View className="mb-3">
      <Text className="text-xs font-semibold text-muted-foreground mb-1.5">
        State (for Professional Tax)
      </Text>
      <Pressable
        onPress={() => setExpanded(!expanded)}
        className="flex-row items-center justify-between rounded-lg border border-border bg-white dark:bg-surface-dark-alt px-3 py-3"
      >
        <Text className="text-base text-foreground">
          {value ?? "Select state"}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.textSecondary}
        />
      </Pressable>
      {expanded && (
        <View className="mt-1 rounded-lg border border-border bg-white dark:bg-surface-dark-alt max-h-48">
          <ScrollView nestedScrollEnabled>
            {STATE_LIST.map((state) => (
              <Pressable
                key={state}
                onPress={() => {
                  onChange(state);
                  setExpanded(false);
                }}
                className={`px-3 py-2.5 border-b border-border ${
                  value === state ? "bg-[rgba(37,99,235,0.08)]" : ""
                }`}
              >
                <Text
                  className={`text-sm ${
                    value === state
                      ? "font-medium"
                      : "text-foreground"
                  }`}
                  style={value === state ? { color: ac(accent, colorScheme, 500, 200) } : undefined}
                >
                  {state}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// ─── Row Helpers ──────────────────────────────────────

export function BreakdownRow({
  label,
  annual,
  monthly,
  highlight,
}: {
  label: string;
  annual: number;
  monthly?: number;
  highlight?: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <Text
        className={`text-sm flex-1 ${
          highlight
            ? "font-bold text-foreground"
            : "text-muted-foreground"
        }`}
      >
        {label}
      </Text>
      <Text
        className={`text-sm text-right w-28 ${
          highlight
            ? "font-bold text-foreground"
            : "font-medium text-foreground"
        }`}
      >
        {formatAmount(annual)}
      </Text>
      {monthly !== undefined && (
        <Text className="text-xs text-faint-foreground text-right w-24">
          {formatAmount(monthly)}/mo
        </Text>
      )}
    </View>
  );
}

export { MetricRow as TaxRow } from "@/components/ui";
