import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, EmptyState, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { TrendLineChart, type TrendSeries } from "@/components/charts/TrendLineChart";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getProjection, PROJECTION_MONTHS, type Projection } from "@/services/projections";
import { formatMonthLabel } from "@/utils/date";
import { formatAmount } from "@/utils/format";

const signed = (n: number) => `${n < 0 ? "−" : "+"}${formatAmount(Math.abs(n))}`;

/**
 * Projections: the next 12 months of bank + wallet money. The line comes from your last three
 * months; the simulator's scenarios are what-ifs you switch on to see them move it.
 */
export default function ProjectionsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [on, setOn] = useState<Set<string>>(new Set());
  const [data, setData] = useState<Projection | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getProjection(DEFAULT_USER_ID, on));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [on]);
  useDataRefresh(load);

  const toggle = (id: string) =>
    setOn((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const series = useMemo<TrendSeries[]>(() => {
    if (!data) return [];
    const base: TrendSeries = { label: "As things go", color: theme.primary, data: data.months.map((m) => ({ month: m.month, total: m.baseline })) };
    if (on.size === 0) return [base];
    return [base, { label: "With what-ifs", color: theme.warning, data: data.months.map((m) => ({ month: m.month, total: m.withWhatIfs })) }];
  }, [data, on, theme]);

  if (failed) return <EmptyState icon="alert-circle-outline" title="Couldn't work this out" subtitle="Go back and try again." />;
  if (!data) return <LoadingState message="Looking ahead..." icon="trending-up-outline" />;

  const end = data.months[data.months.length - 1];
  const showWhatIfs = on.size > 0;
  const endValue = showWhatIfs ? end.withWhatIfs : end.baseline;
  const lowest = data.months.reduce((lo, m) => ((showWhatIfs ? m.withWhatIfs : m.baseline) < (showWhatIfs ? lo.withWhatIfs : lo.baseline) ? m : lo), data.months[0]);
  const lowestValue = showWhatIfs ? lowest.withWhatIfs : lowest.baseline;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        <Card className="mb-3">
          <Text className="text-xs text-muted-foreground">In your bank and wallets by {formatMonthLabel(end.month)}</Text>
          <Text className="text-title font-bold mt-1" style={{ color: endValue < 0 ? theme.danger : theme.foreground }}>
            {formatAmount(endValue)}
          </Text>
          <Text className="text-xs text-muted-foreground mt-1">
            {formatAmount(data.startBalance)} today · {signed(data.monthlyLeft)} a month
            {data.basedOn.length > 0 ? `, as in ${data.basedOn.map((m) => formatMonthLabel(m)).join(", ")}` : ""}
          </Text>
          {showWhatIfs && end.withWhatIfs !== end.baseline && (
            <Text className="text-xs mt-1" style={{ color: theme.warning }}>
              {signed(end.withWhatIfs - end.baseline)} from the what-ifs you've switched on
            </Text>
          )}
          {lowestValue < 0 && (
            <Text className="text-xs mt-2" style={{ color: theme.danger }}>
              Goes below zero in {formatMonthLabel(lowest.month)} ({formatAmount(lowestValue)}).
            </Text>
          )}
        </Card>

        <Card className="mb-3">
          <TrendLineChart series={series} showLegend={showWhatIfs} />
          {data.basedOn.length === 0 && (
            <Text className="text-xs text-muted-foreground mt-2">
              No complete month to learn from yet, so the line stays flat. It fills in after your first full month.
            </Text>
          )}
        </Card>

        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 mt-2">What-ifs</Text>
        {data.scenarios.length === 0 ? (
          <Text className="text-sm text-muted-foreground mb-3">
            Plan a big buy, a bonus or a trip and see what it does to the line.
          </Text>
        ) : (
          data.scenarios.map((s) => {
            const active = on.has(s.scenario.id);
            return (
              <Card key={s.scenario.id} className="mb-2 py-3">
                <View className="flex-row items-center">
                  <Pressable
                    onPress={() => toggle(s.scenario.id)}
                    className="flex-row items-center flex-1"
                    accessibilityRole="switch"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={`${s.scenario.name}, ${active ? "on" : "off"}`}
                  >
                    <Ionicons name={active ? "checkbox" : "square-outline"} size={20} color={active ? theme.primary : theme.mutedForeground} />
                    <View className="flex-1 ml-2.5">
                      <Text className="text-sm font-medium text-foreground" numberOfLines={1}>{s.scenario.name}</Text>
                      <Text className="text-xs text-muted-foreground mt-0.5">
                        {s.count === 0
                          ? `Nothing planned in the next ${PROJECTION_MONTHS} months`
                          : `${s.count} planned · ${s.plannedIn > 0 ? `+${formatAmount(s.plannedIn)} ` : ""}${s.plannedOut > 0 ? `−${formatAmount(s.plannedOut)}` : ""}`}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() => router.push(`/simulator/${s.scenario.id}`)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${s.scenario.name}`}
                    className="pl-3"
                  >
                    <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
                  </Pressable>
                </View>
              </Card>
            );
          })
        )}
        <Button title="Plan a what-if" variant="outline" onPress={() => router.push("/simulator")} className="mt-2" />
        <Button title="This month in detail" variant="ghost" onPress={() => router.push("/insights/forecast")} className="mt-1" />
      </ScrollView>
    </ScreenContainer>
  );
}
