import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, LoadingState, ScreenContainer, SelectSheet, Text } from "@/components/ui";
import { SegmentedControl } from "@/components/motion";
import { YoYCumulativeChart } from "@/components/goals/YoYCumulativeChart";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getReviewableFYs } from "@/services/reports/year-review";
import { getYoY, type YoYComparison, type YoYMode } from "@/services/reports/yoy";
import { getFYStartMonth } from "@/services/settings";
import { getCurrentFY, getFYLabel } from "@/utils/fiscal-year";
import { formatAmount, formatCompact } from "@/utils/format";

/**
 * Two financial years side by side, from real data (a yearly plan only adds "plan" figures).
 * A year in progress is compared with the same months of the other year by default.
 * Recomputes only after a write (data version) - see services/reports/yoy.ts.
 */
export default function YoYComparisonScreen() {
  const router = useRouter();
  const theme = useTheme();
  const startMonth = getFYStartMonth();
  const currentFY = getCurrentFY(startMonth);

  const [fys, setFys] = useState<number[]>([currentFY, currentFY - 1]);
  const [fy, setFy] = useState(currentFY);
  const [baseFy, setBaseFy] = useState(currentFY - 1);
  const [mode, setMode] = useState<YoYMode>("same-period");
  const [data, setData] = useState<YoYComparison | null>(null);
  const [failed, setFailed] = useState(false);
  const [basePicker, setBasePicker] = useState(false);
  const [fyPicker, setFyPicker] = useState(false);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const [list, result] = await Promise.all([getReviewableFYs(DEFAULT_USER_ID), getYoY(DEFAULT_USER_ID, fy, baseFy, mode)]);
      if (seq !== loadSeq.current) return; // a newer choice is already loading
      setFys(list.length >= 2 ? list : [currentFY, currentFY - 1]);
      setData(result);
      setFailed(false);
    } catch {
      if (seq === loadSeq.current) setFailed(true);
    }
  }, [fy, baseFy, mode, currentFY]);

  // Cached by data version inside getYoY, so a focus with nothing written is instant.
  useDataRefresh(load);
  useEffect(() => {
    void load();
  }, [load]);

  const inProgress = fy === currentFY;
  const fyLabel = (y: number) => getFYLabel(y, startMonth);

  const tiles = useMemo(() => {
    if (!data) return [];
    const c = data.current;
    const b = data.base;
    const amt = (curr: number, prev: number, lowerIsBetter = false) => {
      const diff = curr - prev;
      const pct = prev > 0 ? Math.round((diff / prev) * 100) : null;
      const good = lowerIsBetter ? diff <= 0 : diff >= 0;
      return {
        change: Math.abs(diff) < 1 ? "Same as" : `${diff > 0 ? "▲" : "▼"} ${pct != null ? `${Math.abs(pct)}%` : formatCompact(Math.abs(diff))}`,
        good: Math.abs(diff) < 1 ? null : good,
        from: `from ${formatCompact(prev)}`,
      };
    };
    const savedPts = c.savedPct != null && b.savedPct != null ? Math.round(c.savedPct - b.savedPct) : null;
    return [
      { label: "Money in", value: formatCompact(c.moneyIn), ...amt(c.moneyIn, b.moneyIn), plan: null as string | null },
      {
        label: "Spent",
        value: formatCompact(c.spent),
        ...amt(c.spent, b.spent, true),
        plan: c.planSpent != null ? `plan ${formatCompact(c.planSpent)}` : null,
      },
      {
        label: "Saved",
        value: c.savedPct != null ? `${Math.round(c.savedPct)}%` : "—",
        change: savedPts == null || savedPts === 0 ? "Same as" : `${savedPts > 0 ? "▲" : "▼"} ${Math.abs(savedPts)} pts`,
        good: savedPts == null || savedPts === 0 ? null : savedPts > 0,
        from: b.savedPct != null ? `from ${Math.round(b.savedPct)}%` : "",
        plan: null,
      },
      {
        label: "Invested",
        value: formatCompact(c.invested),
        ...amt(c.invested, b.invested),
        plan: c.planInvested != null ? `plan ${formatCompact(c.planInvested)}` : null,
      },
      { label: "Loans repaid", value: formatCompact(c.loansRepaid), ...amt(c.loansRepaid, b.loansRepaid), plan: null },
      {
        label: "Net worth",
        value: c.netWorthChange != null ? `${c.netWorthChange >= 0 ? "+" : "−"}${formatCompact(Math.abs(c.netWorthChange))}` : "—",
        ...(c.netWorthChange != null && b.netWorthChange != null
          ? amt(c.netWorthChange, b.netWorthChange)
          : { change: "", good: null, from: "" }),
        from: b.netWorthChange != null ? `vs ${b.netWorthChange >= 0 ? "+" : "−"}${formatCompact(Math.abs(b.netWorthChange))}` : "no history",
        plan: null,
      },
    ];
  }, [data]);

  if (!data && !failed) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState icon="git-compare-outline" message="Lining up the two years…" />
      </ScreenContainer>
    );
  }
  if (!data) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="alert-circle-outline" size={32} color={theme.danger} />
          <Text className="text-base font-semibold text-foreground mt-3 text-center">Couldn't compare the years</Text>
          <View className="mt-4 w-40">
            <Button title="Try again" onPress={() => void load()} />
          </View>
        </View>
      </ScreenContainer>
    );
  }

  const baseOptions = fys.filter((y) => y !== fy).map((y) => ({ value: String(y), label: fyLabel(y) }));
  const fyOptions = fys.map((y) => ({ value: String(y), label: y === currentFY ? `${fyLabel(y)} so far` : fyLabel(y) }));
  const nothing = data.current.spent === 0 && data.base.spent === 0 && data.current.moneyIn === 0 && data.base.moneyIn === 0;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Which two years */}
        <View className="flex-row items-center flex-wrap px-4 pt-3" style={{ gap: 8 }}>
          <YearPill label={inProgress ? `${fyLabel(fy)} so far` : fyLabel(fy)} onPress={() => setFyPicker(true)} />
          <Text className="text-xs text-muted-foreground">vs</Text>
          <YearPill label={data.partial ? `${fyLabel(baseFy)}, same months` : fyLabel(baseFy)} onPress={() => setBasePicker(true)} />
        </View>
        {inProgress && (
          <View className="px-4 mt-3">
            <SegmentedControl
              accessibilityLabel="Compare"
              options={[
                { value: "same-period", label: "Same months" },
                { value: "full", label: "Full years" },
              ]}
              value={mode}
              onChange={(v) => setMode(v as YoYMode)}
            />
          </View>
        )}

        {nothing ? (
          <Card className="mx-4 mt-3">
            <Text className="text-sm text-muted-foreground">
              No spending or money in recorded for these years yet. Pick other years, or come back once there's some history.
            </Text>
          </Card>
        ) : (
          <>
            <Card className="mx-4 mt-3">
              <Text className="text-base font-semibold text-foreground leading-6">{data.summary}</Text>
            </Card>

            <View className="flex-row flex-wrap px-4 mt-2" style={{ gap: 8 }}>
              {tiles.map((t) => (
                <View key={t.label} className="bg-card rounded-xl border border-border px-3 py-2.5" style={{ width: "48.5%" }}>
                  <Text className="text-xs text-muted-foreground">{t.label}</Text>
                  <Text className="text-lg font-bold text-foreground mt-0.5">{t.value}</Text>
                  <Text className="text-label text-muted-foreground mt-0.5" numberOfLines={1}>
                    {t.change ? (
                      <Text
                        className="text-label font-semibold"
                        style={{ color: t.good == null ? theme.mutedForeground : t.good ? theme.success : theme.danger }}
                      >
                        {t.change}
                      </Text>
                    ) : null}
                    {t.change ? " " : ""}
                    {t.plan ?? t.from}
                  </Text>
                </View>
              ))}
            </View>

            <Card className="mx-4 mt-3">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Spending through the year
              </Text>
              <YoYCumulativeChart
                monthLabels={data.monthLabels}
                current={data.current.cumulative}
                base={data.base.cumulative}
                currentLabel={data.current.label}
                baseLabel={data.base.label}
              />
            </Card>

            {data.movers.length > 0 && (
              <Card className="mx-4 mt-3">
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Biggest movers</Text>
                {data.movers.map((m, i) => {
                  const up = m.curr > m.prev;
                  const diff = Math.abs(m.curr - m.prev);
                  return (
                    <Pressable
                      key={`${m.categoryId ?? "none"}-${i}`}
                      onPress={
                        m.expenseIds.length > 0
                          ? () =>
                              router.push({
                                pathname: "/insights/filtered",
                                params: { expenseIds: m.expenseIds.join(","), title: `${m.name} · ${data.current.label}` },
                              })
                          : undefined
                      }
                      className="flex-row items-center py-2.5"
                      style={i > 0 ? { borderTopWidth: 1, borderTopColor: theme.border } : undefined}
                      accessibilityRole={m.expenseIds.length > 0 ? "button" : undefined}
                    >
                      <View className="flex-1">
                        <Text className="text-sm text-foreground" numberOfLines={1}>{m.name}</Text>
                        <Text className="text-label text-muted-foreground">
                          {formatAmount(m.prev)} → {formatAmount(m.curr)}
                        </Text>
                      </View>
                      <Text className="text-sm font-semibold" style={{ color: up ? theme.danger : theme.success }}>
                        {up ? "▲" : "▼"} {m.changePct != null ? `${Math.abs(Math.round(m.changePct))}%` : "new"}
                        <Text className="text-xs text-muted-foreground"> {up ? "+" : "−"}{formatCompact(diff)}</Text>
                      </Text>
                      {m.expenseIds.length > 0 && <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} style={{ marginLeft: 4 }} />}
                    </Pressable>
                  );
                })}
              </Card>
            )}

            <Text className="text-label text-faint-foreground px-4 mt-3">
              From your transactions: spending follows your budget's rules (no transfers, loan payments or investments).
              {data.current.planSpent != null || data.current.planInvested != null ? " Plan figures come from your yearly plan, scaled to these months." : ""}
            </Text>
          </>
        )}
      </ScrollView>

      <SelectSheet
        visible={fyPicker}
        title="Compare"
        options={fyOptions}
        value={String(fy)}
        onChange={(v) => {
          const next = Number(v);
          setFy(next);
          if (next === baseFy) setBaseFy(next - 1);
        }}
        onClose={() => setFyPicker(false)}
      />
      <SelectSheet
        visible={basePicker}
        title="Against"
        options={baseOptions}
        value={String(baseFy)}
        onChange={(v) => setBaseFy(Number(v))}
        onClose={() => setBasePicker(false)}
      />
    </ScreenContainer>
  );
}

function YearPill({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center rounded-lg border px-3 py-1.5 bg-card"
      style={{ borderColor: theme.border }}
      accessibilityRole="button"
      accessibilityLabel={`${label}, change year`}
    >
      <Text className="text-xs font-medium text-foreground">{label}</Text>
      <Ionicons name="chevron-down" size={12} color={theme.mutedForeground} style={{ marginLeft: 4 }} />
    </Pressable>
  );
}
