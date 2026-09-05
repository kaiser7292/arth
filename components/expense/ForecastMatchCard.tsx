import { StatusColors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { ForecastMatchPair } from "@/services/expense";
import { ac } from "@/utils/accent";
import { formatAmount, formatDateForDisplay } from "@/utils/expense-validation";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

interface ForecastMatchCardProps {
  pair: ForecastMatchPair;
  onRealize: (forecastId: string, realizedId: string) => void;
  onAlreadyCaptured: (forecastId: string, realizedId: string) => void;
  onBothDifferent: (forecastId: string, realizedId: string) => void;
}

export function ForecastMatchCard({
  pair,
  onRealize,
  onAlreadyCaptured,
  onBothDifferent,
}: ForecastMatchCardProps) {
  const { colors, accent, colorScheme } = useColorScheme();
  const { forecast, realized } = pair;

  return (
    <View className="mx-4 my-2 rounded-xl bg-card border border-border overflow-hidden">
      {/* Header */}
      <View className="flex-row items-center px-3 py-2 bg-[#F59E0B14]">
        <Ionicons name="git-compare-outline" size={14} color={StatusColors[colorScheme].warning} />
        <Text className="text-xs font-semibold ml-1.5 uppercase tracking-wide" style={{ color: StatusColors[colorScheme].warning }}>
          Possible Match
        </Text>
      </View>

      {/* Forecast card */}
      <View className="px-3 py-2.5 border-b border-border">
        <View className="flex-row items-center mb-1">
          <View className="px-1.5 py-0.5 rounded bg-[#F59E0B14] mr-2">
            <Text className="text-[10px] font-bold" style={{ color: StatusColors[colorScheme].warning }}>FORECAST</Text>
          </View>
          <Text className="text-xs text-faint-foreground">
            Due {formatDateForDisplay(forecast.due_date ?? forecast.date)}
          </Text>
        </View>
        <Text
          className="text-sm text-foreground"
          numberOfLines={1}
        >
          {forecast.description || forecast.merchant_name || "Forecast expense"}
        </Text>
        <Text className="text-base font-bold text-foreground mt-0.5">
          {formatAmount(forecast.amount)}
        </Text>
      </View>

      {/* Match indicator */}
      <View className="items-center py-1">
        <Ionicons name="swap-vertical" size={16} color={colors.textSecondary} />
      </View>

      {/* Realized card */}
      <View className="px-3 py-2.5 border-b border-border">
        <View className="flex-row items-center mb-1">
          <View className="px-1.5 py-0.5 rounded mr-2" style={{ backgroundColor: accent[500] + '14' }}>
            <Text className="text-[10px] font-bold" style={{ color: ac(accent, colorScheme, 600, 300) }}>ACTUAL</Text>
          </View>
          <Text className="text-xs text-faint-foreground">
            {formatDateForDisplay(realized.date)}
          </Text>
        </View>
        <Text
          className="text-sm text-foreground"
          numberOfLines={1}
        >
          {realized.description || realized.merchant_name || "Bank transaction"}
        </Text>
        <Text className="text-base font-bold text-foreground mt-0.5">
          {formatAmount(realized.amount)}
        </Text>
      </View>

      {/* Action buttons */}
      <View className="flex-row px-2 py-2.5">
        <Pressable
          onPress={() => onRealize(forecast.id, realized.id)}
          className="flex-1 flex-row items-center justify-center py-2 mx-1 rounded-lg bg-[#22C55E14]"
        >
          <Ionicons name="checkmark-circle" size={16} color={StatusColors[colorScheme].success} />
          <Text className="text-xs font-semibold ml-1" style={{ color: StatusColors[colorScheme].success }}>
            Realise
          </Text>
        </Pressable>

        <Pressable
          onPress={() => onAlreadyCaptured(forecast.id, realized.id)}
          className="flex-1 flex-row items-center justify-center py-2 mx-1 rounded-lg"
          style={{ backgroundColor: accent[500] + '14' }}
        >
          <Ionicons name="duplicate" size={16} color={colors.blue} />
          <Text className="text-xs font-semibold ml-1" style={{ color: ac(accent, colorScheme, 600, 300) }}>
            Already Captured
          </Text>
        </Pressable>

        <Pressable
          onPress={() => onBothDifferent(forecast.id, realized.id)}
          className="flex-1 flex-row items-center justify-center py-2 mx-1 rounded-lg"
          style={{ backgroundColor: colors.textSecondary + '14' }}
        >
          <Ionicons name="git-branch" size={16} color={colors.textSecondary} />
          <Text className="text-xs font-semibold ml-1" style={{ color: colors.textSecondary }}>
            Both Different
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
