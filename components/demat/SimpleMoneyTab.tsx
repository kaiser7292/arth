import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { Card, Text } from "@/components/ui";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { fyOf, getDetectedMoney, type DetectedMoney } from "@/services/broker-history/history";
import { formatAmount } from "@/utils/format";
import { todayIso } from "@/utils/local-date";

const QUARTERS: { q: 1 | 2 | 3 | 4; label: string }[] = [
  { q: 1, label: "Apr - Jun" },
  { q: 2, label: "Jul - Sep" },
  { q: 3, label: "Oct - Dec" },
  { q: 4, label: "Jan - Mar" },
];

/** History with broker records off: money in and out from the transfers Arth detected, and nothing else. */
export function SimpleMoneyTab({ accountId }: { accountId: string }) {
  const theme = useTheme();
  const currentFy = fyOf(todayIso());
  const [fy, setFy] = useState(currentFy);
  const [money, setMoney] = useState<DetectedMoney | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setMoney(await getDetectedMoney(accountId, fy));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [accountId, fy]);
  useDataRefresh(load);

  if (failed) return <LoadFailedBanner onRetry={load} />;
  if (!money) return null;

  return (
    <View className="mx-4 mb-3">
      <View className="flex-row items-center justify-center mb-3">
        <Pressable onPress={() => setFy(fy - 1)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Previous year">
          <Ionicons name="chevron-back" size={18} color={theme.mutedForeground} />
        </Pressable>
        <Text className="text-sm font-semibold text-foreground mx-4">
          FY {fy}-{String(fy + 1).slice(2)}
        </Text>
        <Pressable onPress={() => setFy(fy + 1)} disabled={fy >= currentFy} hitSlop={12} accessibilityRole="button" accessibilityLabel="Next year">
          <Ionicons name="chevron-forward" size={18} color={fy >= currentFy ? theme.faintForeground : theme.mutedForeground} />
        </Pressable>
      </View>

      <Card className="mb-3">
        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Money in and out</Text>
        {money.count === 0 ? (
          <Text className="text-sm text-muted-foreground py-1">No transfers detected for this year.</Text>
        ) : (
          <>
            <View className="flex-row justify-between py-1">
              <Text className="text-sm text-muted-foreground">Added</Text>
              <Text className="text-sm font-semibold" style={{ color: money.added > 0 ? theme.success : theme.foreground }}>{formatAmount(money.added)}</Text>
            </View>
            <View className="flex-row justify-between py-1">
              <Text className="text-sm text-muted-foreground">Withdrawn</Text>
              <Text className="text-sm font-semibold" style={{ color: money.withdrawn > 0 ? theme.danger : theme.foreground }}>{formatAmount(money.withdrawn)}</Text>
            </View>
            {QUARTERS.filter(({ q }) => money.byQuarter[q].added > 0 || money.byQuarter[q].withdrawn > 0).map(({ q, label }) => (
              <View key={q} className="flex-row justify-between pt-1 mt-1 border-t border-border">
                <Text className="text-xs text-muted-foreground">{label}</Text>
                <Text className="text-xs text-muted-foreground">
                  {formatAmount(money.byQuarter[q].added)} in, {formatAmount(money.byQuarter[q].withdrawn)} out
                </Text>
              </View>
            ))}
          </>
        )}
        <Text className="text-xs text-muted-foreground mt-2">From the transfers Arth detected for this account.</Text>
      </Card>

      <Text className="text-xs text-faint-foreground text-center">
        For gains and broker reports, turn on Broker records in Settings &gt; Customise Arth.
      </Text>
    </View>
  );
}
