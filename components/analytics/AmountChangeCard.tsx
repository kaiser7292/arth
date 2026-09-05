import { View, Pressable } from "react-native";
import { Text } from "@/components/ui";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useColorScheme } from "@/hooks/use-color-scheme";

import { formatAmount } from "@/utils/format";
import { useTheme } from "@/hooks/use-theme";

interface AmountChangeCardProps {
  merchant: string;
  newAmount: number;
  usualAmount: number;
  onPriceIncreased: () => void;
  onOneTimeCharge: () => void;
  onDifferentPlan: () => void;
  onNotSure: () => void;
}

export function AmountChangeCard({
  merchant,
  newAmount,
  usualAmount,
  onPriceIncreased,
  onOneTimeCharge,
  onDifferentPlan,
  onNotSure,
}: AmountChangeCardProps) {
  
  const theme = useTheme();

  return (
    <View
      className="rounded-2xl p-4 mb-3 border"
      style={{ borderColor: theme.alpha("primary", 0.25), backgroundColor: theme.alpha("primary", 0.19) }}
      accessibilityLabel={`Amount change: ${merchant} charged ${formatAmount(newAmount)} this month, usually ${formatAmount(usualAmount)}`}
    >
      <View className="flex-row items-start mb-2">
        <Ionicons name="swap-horizontal" size={16} color={theme.primary} style={{ marginRight: 8, marginTop: 1 }} />
        <View className="flex-1">
          <Text className="text-sm font-medium text-foreground capitalize">
            {merchant} charged {formatAmount(newAmount)} this month
          </Text>
          <Text className="text-xs text-muted-foreground mt-0.5">
            (usually {formatAmount(usualAmount)})
          </Text>
        </View>
      </View>

      <View className="flex-row flex-wrap gap-2 ml-6 mt-2">
        <ActionPill label="Price increased" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPriceIncreased(); }} />
        <ActionPill label="One-time charge" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onOneTimeCharge(); }} />
        <ActionPill label="Different plan" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onDifferentPlan(); }} />
        <ActionPill label="Not sure" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onNotSure(); }} />
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

