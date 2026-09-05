import { View, Pressable } from "react-native";
import { Text } from "@/components/ui";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { ProgressBar } from "@/components/ui/ProgressBar";
import { formatAmount } from "@/utils/format";
import { useTheme } from "@/hooks/use-theme";

interface DrillGroupRowProps {
  label: string;
  amount: number;
  count: number;
  percentage: number;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
}

export function DrillGroupRow({
  label,
  amount,
  count,
  percentage,
  icon = "storefront-outline",
  onPress,
}: DrillGroupRowProps) {
  
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      className="py-3 border-b border-border"
      accessibilityLabel={`${label}: ${formatAmount(amount)}, ${count} transactions, ${percentage}%`}
      accessibilityRole="button"
    >
      <View className="flex-row items-center justify-between mb-1.5">
        <View className="flex-row items-center flex-1 mr-3">
          <Ionicons name={icon} size={16} color={theme.faintForeground} style={{ marginRight: 8 }} />
          <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
            {label}
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          <Text className="text-sm font-bold text-foreground">
            {formatAmount(amount)} ({percentage}%)
          </Text>
          {onPress && <Ionicons name="chevron-forward" size={14} color={theme.faintForeground} />}
        </View>
      </View>

      <View className="flex-row items-center gap-2 ml-6">
        <View className="flex-1">
          <ProgressBar value={percentage / 100} height={4} />
        </View>
        <Text className="text-xs text-muted-foreground w-20 text-right">
          {count} {count === 1 ? "transaction" : "transactions"}
        </Text>
      </View>
    </Pressable>
  );
}

