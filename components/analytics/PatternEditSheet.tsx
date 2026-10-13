import { useState } from "react";
import { Sheet, Text } from "@/components/ui";
import { View, Pressable, ScrollView, TextInput } from "react-native";
import * as Haptics from "expo-haptics";

import { Button } from "@/components/ui/Button";
import { useColorScheme } from "@/hooks/use-color-scheme";

import type { ExpenseClassificationRow } from "@/services/analytics/classifier";
import { EVERY, amountText } from "@/utils/analytics/pattern-display";
import { THRESHOLDS } from "@/utils/analytics/thresholds";
import type { Classification } from "@/utils/analytics/types";
import { useTheme } from "@/hooks/use-theme";

export interface PatternEdit {
  classification: Classification;
  amountLow: number;
  amountHigh: number;
  frequency: string;
  expectedDay: number;
}

interface PatternEditSheetProps {
  visible: boolean;
  pattern: ExpenseClassificationRow;
  onSave: (edit: PatternEdit) => void | Promise<void>;
  /** "It varies" — stop counting it as a bill. */
  onNotBill: () => void | Promise<void>;
  onClose: () => void;
}

const FREQUENCIES: { value: string; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

/** Pure: what the form's text boxes amount to, or why they can't be saved. */
export function readPatternEdit(
  lowText: string,
  highText: string,
  frequency: string,
  dayText: string,
): { edit: PatternEdit } | { error: string } {
  const low = parseFloat(lowText);
  const high = highText.trim() === "" ? low : parseFloat(highText);
  const day = parseInt(dayText, 10);
  if (!(low > 0) || !(high > 0)) return { error: "Enter the amount." };
  if (high < low) return { error: "The highest amount is below the lowest." };
  if (!(day >= 1 && day <= 31)) return { error: "The day must be between 1 and 31." };
  const mid = (low + high) / 2;
  const classification: Classification =
    (high - mid) / mid <= THRESHOLDS.CLASSIFICATION_AMOUNT_TOLERANCE ? "fixed" : "semi_fixed";
  return { edit: { classification, amountLow: low, amountHigh: high, frequency, expectedDay: day } };
}

export function PatternEditSheet({ visible, pattern, onSave, onNotBill, onClose }: PatternEditSheetProps) {
  const { colors } = useColorScheme();
  const theme = useTheme();

  const [low, setLow] = useState(String(Math.round(pattern.amount_range_low)));
  const [high, setHigh] = useState(String(Math.round(pattern.amount_range_high)));
  const [frequency, setFrequency] = useState(pattern.frequency ?? "monthly");
  const [expectedDay, setExpectedDay] = useState(String(pattern.expected_day_of_month ?? 1));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const result = readPatternEdit(low, high, frequency, expectedDay);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSaving(true);
    try {
      await onSave(result.edit);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleNotBill = async () => {
    setSaving(true);
    try {
      await onNotBill();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="px-5">

        <Text className="text-lg font-bold text-foreground mb-4">
          Edit regular payment
        </Text>

        {/* Current Pattern Summary */}
        <View className="bg-background rounded-xl p-3 mb-5">
          <Text className="text-sm font-medium text-foreground capitalize">
            {pattern.merchant_normalized}
          </Text>
          <Text className="text-xs text-muted-foreground mt-0.5">
            {amountText(pattern)} · {EVERY[pattern.frequency ?? "monthly"] ?? pattern.frequency}
          </Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Amount */}
          <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Amount (lowest to highest)
          </Text>
          <View className="flex-row items-center mb-1" style={{ gap: 8 }}>
            <View className="flex-1 flex-row items-center bg-background rounded-xl px-3 py-2.5">
              <Text className="text-sm text-muted-foreground mr-1">{"₹"}</Text>
              <TextInput
                value={low}
                onChangeText={(t) => { setLow(t); setError(null); }}
                keyboardType="numeric"
                className="flex-1 text-sm text-foreground"
                accessibilityLabel="Lowest amount"
              />
            </View>
            <Text className="text-sm text-muted-foreground">to</Text>
            <View className="flex-1 flex-row items-center bg-background rounded-xl px-3 py-2.5">
              <Text className="text-sm text-muted-foreground mr-1">{"₹"}</Text>
              <TextInput
                value={high}
                onChangeText={(t) => { setHigh(t); setError(null); }}
                keyboardType="numeric"
                className="flex-1 text-sm text-foreground"
                accessibilityLabel="Highest amount"
              />
            </View>
          </View>
          <Text className="text-xs text-muted-foreground mb-4">
            The same in both for a bill that never changes. The projection expects the middle.
          </Text>

          {/* Frequency */}
          <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            How often
          </Text>
          <View className="flex-row flex-wrap gap-2 mb-4">
            {FREQUENCIES.map((f) => (
              <Pressable
                key={f.value}
                onPress={() => setFrequency(f.value)}
                className={`px-3.5 py-2 rounded-full border ${
                  frequency === f.value
                    ? "border-transparent"
                    : "border-border"
                }`}
                style={frequency === f.value ? { backgroundColor: theme.alpha("primary", 0.13) } : undefined}
                accessibilityLabel={f.label}
                accessibilityState={{ selected: frequency === f.value }}
              >
                <Text
                  className="text-xs font-medium"
                  style={{ color: frequency === f.value ? theme.primary : colors.textSecondary }}
                >
                  {f.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Expected Day */}
          <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Usual day of the month
          </Text>
          <View className="flex-row items-center bg-background rounded-xl px-3 py-2.5 mb-1">
            <Text className="text-sm text-muted-foreground mr-1">Day</Text>
            <TextInput
              value={expectedDay}
              onChangeText={(t) => { setExpectedDay(t); setError(null); }}
              keyboardType="numeric"
              maxLength={2}
              className="w-12 text-sm text-foreground"
              accessibilityLabel="Usual day of the month"
            />
          </View>
          <Text className="text-xs text-muted-foreground mb-4">Use 31 for the end of the month.</Text>

          {error && (
            <Text className="text-xs mb-3" style={{ color: theme.danger }}>{error}</Text>
          )}
        </ScrollView>

        {/* Actions */}
        <View className="border-t border-border pt-4 mt-2">
          <View className="flex-row justify-between items-center">
            <Pressable onPress={handleNotBill} disabled={saving} className="py-2">
              <Text className="text-sm font-medium" style={{ color: theme.danger }}>
                Not a bill
              </Text>
            </Pressable>
            <Button title="Save Changes" onPress={handleSave} disabled={saving} />
          </View>
          <Text className="text-xs text-muted-foreground mt-3">
            {pattern.is_active === 1
              ? "Saving counts this as a bill in your month-end projection straight away."
              : "This one is paused. It counts in the projection again once you next pay it."}
          </Text>
        </View>
      </View>
    </Sheet>
  );
}
