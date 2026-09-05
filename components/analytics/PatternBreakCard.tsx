import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { formatAmount } from "@/utils/format";

interface PatternBreakCardProps {
  merchant: string;
  amount: number;
  expectedDay: number;
  daysLate: number;
  onCancelled: () => void;
  onLate: () => void;
  onDateChanged: () => void;
}

export function PatternBreakCard({
  merchant,
  amount,
  expectedDay,
  daysLate,
  onCancelled,
  onLate,
  onDateChanged,
}: PatternBreakCardProps) {
  const { colorScheme } = useColorScheme();
  const statusColors = StatusColors[colorScheme];

  return (
    <View
      className="rounded-2xl p-4 mb-3 border"
      style={{ borderColor: statusColors.warning + "40", backgroundColor: statusColors.warning + "08" }}
      accessibilityLabel={`Expected payment missing: ${merchant}, ${formatAmount(amount)}, usually by day ${expectedDay}, ${daysLate} days late`}
    >
      <View className="flex-row items-start mb-2">
        <Ionicons name="clipboard-outline" size={16} color={statusColors.warning} style={{ marginRight: 8, marginTop: 1 }} />
        <Text className="text-sm font-medium text-foreground">
          Expected but missing:
        </Text>
      </View>

      <View className="ml-6 mb-3">
        <Text className="text-sm font-semibold text-foreground capitalize">
          {formatAmount(amount)}  {merchant}
        </Text>
        <Text className="text-xs text-muted-foreground mt-0.5">
          Usually arrives by {ordinal(expectedDay)} ({daysLate} days late)
        </Text>
      </View>

      <View className="flex-row flex-wrap gap-2 ml-6">
        <ActionPill
          label="I cancelled it"
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onCancelled(); }}
        />
        <ActionPill
          label="It's late"
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onLate(); }}
        />
        <ActionPill
          label="Changed date"
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onDateChanged(); }}
        />
      </View>
    </View>
  );
}

function ActionPill({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="px-3 py-1.5 rounded-full border border-border"
      accessibilityLabel={label}
      accessibilityRole="button"
    >
      <Text className="text-xs font-medium text-muted-foreground">
        {label}
      </Text>
    </Pressable>
  );
}


function ordinal(day: number): string {
  const suffix = day === 1 || day === 21 || day === 31 ? "st"
    : day === 2 || day === 22 ? "nd"
    : day === 3 || day === 23 ? "rd"
    : "th";
  return `${day}${suffix}`;
}
