import { useState } from "react";
import { View, Text, Pressable, Modal, ScrollView, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { Button } from "@/components/ui/Button";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import { dismissRecurring } from "@/services/recurring-detector";
import type { RecurringTransaction, RecurringFrequency } from "@/services/recurring-detector";
import { formatAmount } from "@/utils/format";

interface PatternEditSheetProps {
  visible: boolean;
  pattern: RecurringTransaction;
  onClose: () => void;
}

const FREQUENCIES: { value: RecurringFrequency; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

export function PatternEditSheet({ visible, pattern, onClose }: PatternEditSheetProps) {
  const { colorScheme, colors, accent } = useColorScheme();
  const statusColors = StatusColors[colorScheme];
  const insets = useSafeAreaInsets();

  const [amount, setAmount] = useState(String(Math.round(pattern.amount)));
  const [frequency, setFrequency] = useState<RecurringFrequency>(pattern.frequency as RecurringFrequency);
  const [expectedDay, setExpectedDay] = useState(String(new Date(pattern.last_seen_date).getDate()));

  const handleSave = async () => {
    const db = getDatabase();
    const newAmount = parseFloat(amount) || pattern.amount;
    const newDay = parseInt(expectedDay, 10) || 1;

    await db.runAsync(
      `UPDATE recurring_transactions
       SET amount = ?, frequency = ?, is_confirmed = 1, updated_at = datetime('now')
       WHERE id = ?;`,
      newAmount,
      frequency,
      pattern.id,
    );
    await bumpDataVersion();
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
  };

  const handleDelete = async () => {
    await dismissRecurring(pattern.id);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
      >
      <View
        className="bg-card rounded-t-3xl px-5 pt-4"
        style={{ maxHeight: "92%", paddingBottom: Math.max(insets.bottom, 8) }}
      >
        {/* Handle */}
        <View className="w-10 h-1 rounded-full bg-border self-center mb-4" />

        <Text className="text-lg font-bold text-foreground mb-4">
          Edit Pattern
        </Text>

        {/* Current Pattern Summary */}
        <View className="bg-background rounded-xl p-3 mb-5">
          <Text className="text-sm font-medium text-foreground capitalize">
            {pattern.merchant_normalized}
          </Text>
          <Text className="text-xs text-muted-foreground mt-0.5">
            {formatAmount(pattern.amount)} · {capitalizeFirst(pattern.frequency)} · ~Day {new Date(pattern.last_seen_date).getDate()}
          </Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Amount */}
          <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Amount
          </Text>
          <View className="flex-row items-center bg-background rounded-xl px-3 py-2.5 mb-4">
            <Text className="text-sm text-muted-foreground mr-1">{"\u20B9"}</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              className="flex-1 text-sm text-foreground"
              accessibilityLabel="Amount"
            />
          </View>

          {/* Frequency */}
          <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Frequency
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
                style={frequency === f.value ? { backgroundColor: accent[500] + "20" } : undefined}
                accessibilityLabel={f.label}
                accessibilityState={{ selected: frequency === f.value }}
              >
                <Text
                  className="text-xs font-medium"
                  style={{ color: frequency === f.value ? accent[600] : colors.textSecondary }}
                >
                  {f.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Expected Day */}
          <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Expected Day
          </Text>
          <View className="flex-row items-center bg-background rounded-xl px-3 py-2.5 mb-5">
            <Text className="text-sm text-muted-foreground mr-1">Day</Text>
            <TextInput
              value={expectedDay}
              onChangeText={setExpectedDay}
              keyboardType="numeric"
              className="w-12 text-sm text-foreground"
              accessibilityLabel="Expected day of month"
            />
            <Text className="text-sm text-muted-foreground ml-1">
              of each {frequency === "weekly" ? "week" : frequency === "yearly" ? "year" : "month"}
            </Text>
          </View>
        </ScrollView>

        {/* Actions */}
        <View className="border-t border-border pt-4 mt-2">
          <View className="flex-row justify-between">
            <Pressable onPress={handleDelete} className="py-2">
              <Text className="text-sm font-medium" style={{ color: statusColors.danger }}>
                Delete Pattern
              </Text>
            </Pressable>
            <Button title="Save Changes" onPress={handleSave} />
          </View>
          <Text className="text-xs mt-3" style={{ color: statusColors.warning }}>
            Changing this will update your forecast immediately.
          </Text>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}


function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
