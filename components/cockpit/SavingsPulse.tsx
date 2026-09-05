import { View } from "react-native";
import { Text } from "@/components/ui";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { formatAmount } from "@/utils/expense-validation";
import type { SavingsPulseData } from "@/utils/financial-cockpit";
import { useTheme } from "@/hooks/use-theme";

interface SavingsPulseProps {
  data: SavingsPulseData;
}

export function SavingsPulse({ data }: SavingsPulseProps) {
  
  const theme = useTheme();
  const rateColor = data.actualRatePct >= 20
    ? theme.success
    : data.actualRatePct >= 10
      ? theme.warning
      : theme.danger;

  return (
    <View className="flex-row items-center">
      {/* Large rate */}
      <View className="mr-4 items-center">
        <Text
          className="text-2xl font-bold"
          style={{ color: rateColor }}
        >
          {data.actualRatePct.toFixed(1)}%
        </Text>
        <Text className="text-xs text-muted-foreground">
          savings rate
        </Text>
      </View>

      {/* Details */}
      <View className="flex-1">
        <View className="flex-row items-center mb-1">
          <Ionicons
            name="cash-outline"
            size={12}
            color={theme.faintForeground}
            style={{ marginRight: 4 }}
          />
          <Text className="text-xs text-muted-foreground">
            Saved: {formatAmount(Math.round(data.totalSaved))}
          </Text>
        </View>

        <View className="flex-row items-center mb-1">
          <Ionicons
            name="stats-chart-outline"
            size={12}
            color={theme.faintForeground}
            style={{ marginRight: 4 }}
          />
          <Text className="text-xs text-muted-foreground">
            Avg: {formatAmount(Math.round(data.avgMonthlySavings))}/mo
          </Text>
        </View>

        {/* Projected year-end */}
        <View className="flex-row items-center">
          <Ionicons
            name="trending-up-outline"
            size={12}
            color={theme.faintForeground}
            style={{ marginRight: 4 }}
          />
          <Text className="text-xs text-muted-foreground">
            Year-end: {data.projectedYearEndRate.toFixed(1)}%
          </Text>
        </View>
      </View>

      <Ionicons
        name="chevron-forward"
        size={16}
        color={theme.faintForeground}
      />
    </View>
  );
}
