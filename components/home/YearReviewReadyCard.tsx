import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Button, Card, Text } from "@/components/ui";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { dismissHomeReviewCard, getHomeReviewCardFY } from "@/services/reports/year-review";
import { getFYStartMonth } from "@/services/settings";
import { getFYLabel } from "@/utils/fiscal-year";

/**
 * "Your FY 25-26 in review is ready" — for the first 30 days of a new financial
 * year, until dismissed. Self-loading; hidden otherwise.
 */
export function YearReviewReadyCard() {
  const router = useRouter();
  const theme = useTheme();
  const [fy, setFy] = useState<number | null>(null);

  useDataRefresh(
    useCallback(async () => {
      setFy(getHomeReviewCardFY());
    }, []),
  );

  if (fy == null) return null;
  const label = getFYLabel(fy, getFYStartMonth());

  return (
    <Card className="mx-4 mt-3">
      <View className="flex-row items-center mb-1">
        <Ionicons name="sparkles-outline" size={14} color={theme.primary} />
        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground ml-1.5">
          Year in review
        </Text>
      </View>
      <Text className="text-base font-semibold text-foreground">Your {label} in review is ready</Text>
      <Text className="text-xs text-muted-foreground mt-1">
        Spending, savings, net worth and your favourite merchants, told as a story with music.
      </Text>
      <View className="flex-row gap-3 mt-3">
        <View className="flex-1">
          <Button title="Dismiss" variant="outline" onPress={() => dismissHomeReviewCard(fy)} />
        </View>
        <View className="flex-1">
          <Button
            title="See my year"
            onPress={() => router.push({ pathname: "/insights/year-review", params: { fy: String(fy) } })}
          />
        </View>
      </View>
    </Card>
  );
}
