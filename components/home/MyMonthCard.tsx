import { useCallback, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { PressableScale } from "@/components/motion";
import { Card, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getCurrentMonth } from "@/services/budget";
import { getMyMonth, type MyMonth } from "@/services/my-month";
import { formatAmount } from "@/utils/expense-validation";

/** This month at a glance on Home; tap for My month. Self-loading, and hidden if it can't load. */
export function MyMonthCard() {
  const router = useRouter();
  const theme = useTheme();
  const [data, setData] = useState<MyMonth | null>(null);

  useDataRefresh(
    useCallback(async () => {
      setData(await getMyMonth(DEFAULT_USER_ID, getCurrentMonth()).catch(() => null));
    }, []),
  );

  if (!data) return null;

  const cells = [
    { label: "Money in", value: data.moneyIn, color: theme.foreground },
    { label: "Spent", value: data.spent, color: theme.foreground },
    { label: "Saved", value: data.savedTotal, color: theme.foreground },
    { label: data.leftOver < 0 ? "Over by" : "Left", value: Math.abs(data.leftOver), color: data.leftOver < 0 ? theme.danger : theme.success },
  ];

  return (
    <PressableScale onPress={() => router.push("/summary/my-month")} accessibilityRole="button" accessibilityLabel="Open My month">
      <Card className="mx-4 mt-3">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-label font-semibold uppercase tracking-wider text-faint-foreground">My month</Text>
          <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
        </View>
        <View className="flex-row flex-wrap">
          {cells.map((c) => (
            <View key={c.label} className="w-1/2 py-1">
              <Text className="text-xs text-muted-foreground">{c.label}</Text>
              <Text className="text-sm font-bold" style={{ color: c.color }} numberOfLines={1} adjustsFontSizeToFit>
                {formatAmount(c.value)}
              </Text>
            </View>
          ))}
        </View>
      </Card>
    </PressableScale>
  );
}
