import { useMemo, useState } from "react";
import { View, Pressable, LayoutChangeEvent } from "react-native";
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop } from "react-native-svg";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, FilterChip, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount, formatCompact } from "@/utils/format";
import { changeBetween, type NetWorthPoint } from "@/services/net-worth-history";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHART_HEIGHT = 140;
const PAD_V = 10;
const PAD_H = 12;

type RangeKey = "fy" | "1y" | "3y" | "all";

const monthLabel = (m: string, withYear = true) => {
  const [y, mo] = m.split("-").map(Number);
  return withYear ? `${SHORT_MONTHS[mo - 1]} ${String(y).slice(2)}` : SHORT_MONTHS[mo - 1];
};

interface Props {
  points: NetWorthPoint[];
  /** First month of the current FY ("YYYY-MM"). */
  fyStartMonth: string;
  loading?: boolean;
}

/**
 * Net worth month by month, with how the change splits up (saved / market /
 * loans / other) for the chosen range. Data: services/net-worth-history.ts.
 */
export function NetWorthTrendCard({ points, fyStartMonth, loading }: Props) {
  const theme = useTheme();
  const [range, setRange] = useState<RangeKey>("fy");
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  // The range's baseline is the month-end BEFORE its first month, so "this FY"
  // compares against 31 Mar - the same as "since 1 Apr".
  const { visible, baseIndex } = useMemo(() => {
    if (points.length === 0) return { visible: [] as NetWorthPoint[], baseIndex: 0 };
    const last = points.length - 1;
    let from: number;
    if (range === "all") from = 0;
    else if (range === "fy") {
      const i = points.findIndex((p) => p.month >= fyStartMonth);
      from = i <= 0 ? 0 : i - 1;
    } else {
      from = Math.max(0, last - (range === "1y" ? 12 : 36));
    }
    return { visible: points.slice(from), baseIndex: from };
  }, [points, range, fyStartMonth]);

  if (loading && points.length === 0) {
    return (
      <Card className="mx-4 mb-2">
        <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Net worth over time</Text>
        <View style={{ height: CHART_HEIGHT }} className="items-center justify-center">
          <Text className="text-xs text-faint-foreground">Working it out…</Text>
        </View>
      </Card>
    );
  }
  if (points.length < 2) return null;

  const first = visible[0];
  const last = visible[visible.length - 1];
  const delta = last.netWorth - first.netWorth;
  const change = changeBetween(points, baseIndex, points.length - 1);
  const deltaColor = delta > 0 ? theme.success : delta < 0 ? theme.danger : theme.faintForeground;
  const sinceLabel =
    range === "fy" && first.month < fyStartMonth
      ? `since 1 ${monthLabel(fyStartMonth, false)}`
      : `since ${monthLabel(first.month)}`;

  const values = visible.map((p) => p.netWorth);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= Math.abs(min) * 0.1 || 1;
    max += Math.abs(max) * 0.1 || 1;
  }
  const getX = (i: number) =>
    visible.length === 1 ? width / 2 : PAD_H + (i / (visible.length - 1)) * (width - 2 * PAD_H);
  const getY = (v: number) => PAD_V + (1 - (v - min) / (max - min)) * (CHART_HEIGHT - 2 * PAD_V);

  const linePath = visible.map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(p.netWorth)}`).join(" ");
  const areaPath = `${linePath} L ${getX(visible.length - 1)} ${CHART_HEIGHT} L ${getX(0)} ${CHART_HEIGHT} Z`;
  const lineColor = delta >= 0 ? theme.success : theme.danger;
  const sel = selected != null && selected < visible.length ? visible[selected] : null;
  const anyEstimated = visible.some((p) => p.estimated);

  const rows: { label: string; value: number; show: boolean }[] = [
    { label: "Saved & invested", value: change.saved, show: true },
    { label: "Market gains", value: change.marketGains, show: change.marketGains !== 0 },
    {
      label: change.loansPaidDown >= 0 ? "Loans paid down" : "New loans",
      value: change.loansPaidDown,
      show: change.loansPaidDown !== 0,
    },
    { label: "Hisaab & other", value: change.other, show: Math.abs(change.other) >= 1 },
  ];

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <Card className="mx-4 mb-2">
      <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
        Net worth over time
      </Text>
      <View className="flex-row items-center">
        <Ionicons name={delta >= 0 ? "arrow-up" : "arrow-down"} size={14} color={deltaColor} />
        <Text className="text-base font-bold ml-1" style={{ color: deltaColor }}>
          {delta >= 0 ? "+" : ""}{formatCompact(delta)}
        </Text>
        <Text className="text-xs text-muted-foreground ml-1.5">{sinceLabel}</Text>
      </View>

      <View className="flex-row mt-3 mb-2">
        {(
          [
            ["fy", "This FY"],
            ["1y", "1Y"],
            ["3y", "3Y"],
            ["all", "All"],
          ] as [RangeKey, string][]
        ).map(([key, label]) => (
          <FilterChip
            key={key}
            label={label}
            active={range === key}
            spacing="sm"
            onPress={() => {
              setRange(key);
              setSelected(null);
            }}
          />
        ))}
      </View>

      <View onLayout={onLayout} style={{ height: CHART_HEIGHT }}>
        {width > 0 && (
          <Svg width={width} height={CHART_HEIGHT}>
            <Defs>
              <LinearGradient id="nwArea" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={lineColor} stopOpacity={0.18} />
                <Stop offset="1" stopColor={lineColor} stopOpacity={0.02} />
              </LinearGradient>
            </Defs>
            {min < 0 && max > 0 && (
              <Line x1={0} x2={width} y1={getY(0)} y2={getY(0)} stroke={theme.border} strokeDasharray="4,4" />
            )}
            <Path d={areaPath} fill="url(#nwArea)" />
            <Path d={linePath} stroke={lineColor} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            {sel && selected != null && (
              <Line
                x1={getX(selected)} x2={getX(selected)} y1={PAD_V / 2} y2={CHART_HEIGHT}
                stroke={theme.mutedForeground} strokeDasharray="3,3" opacity={0.6}
              />
            )}
            {visible.map((p, i) => {
              const isLast = i === visible.length - 1;
              const isSel = i === selected;
              if (!isLast && !isSel && visible.length > 14) return null;
              return (
                <Circle
                  key={p.month}
                  cx={getX(i)}
                  cy={getY(p.netWorth)}
                  r={isSel ? 5 : isLast ? 4 : 2.5}
                  fill={p.estimated ? theme.card : lineColor}
                  stroke={lineColor}
                  strokeWidth={p.estimated ? 1.5 : 1}
                />
              );
            })}
          </Svg>
        )}
        {width > 0 && (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row" }}>
            {visible.map((p, i) => (
              <Pressable
                key={p.month}
                onPress={() => setSelected((s) => (s === i ? null : i))}
                style={{ flex: 1, height: CHART_HEIGHT }}
                accessibilityRole="button"
                accessibilityLabel={`${monthLabel(p.month)}: ${formatAmount(p.netWorth)}`}
              />
            ))}
          </View>
        )}
      </View>
      <View className="flex-row justify-between mt-1">
        <Text className="text-label text-faint-foreground">{monthLabel(first.month)}</Text>
        <Text className="text-label text-faint-foreground">Today</Text>
      </View>

      {sel ? (
        <View className="mt-3 pt-3 border-t border-border">
          <View className="flex-row justify-between mb-1.5">
            <Text className="text-sm font-semibold text-foreground">
              {sel === last ? "Today" : `End of ${monthLabel(sel.month)}`}
              {sel.estimated ? " · estimated" : ""}
            </Text>
            <Text className="text-sm font-bold text-foreground">{formatAmount(sel.netWorth)}</Text>
          </View>
          {[
            ["Bank, FDs & pension", sel.savings],
            ["Market investments", sel.market],
            ["Card dues", -sel.cards],
            ["Loans", -sel.loans],
            ["Hisaab (net)", sel.hisaab],
          ]
            .filter(([, v]) => v !== 0)
            .map(([label, v]) => (
              <View key={label as string} className="flex-row justify-between py-0.5">
                <Text className="text-xs text-muted-foreground">{label as string}</Text>
                <Text className="text-xs text-foreground">{formatAmount(v as number)}</Text>
              </View>
            ))}
        </View>
      ) : (
        <View className="mt-3 pt-3 border-t border-border">
          {rows
            .filter((r) => r.show)
            .map((r) => (
              <View key={r.label} className="flex-row justify-between py-0.5">
                <Text className="text-xs text-muted-foreground">{r.label}</Text>
                <Text
                  className="text-xs font-semibold"
                  style={{ color: r.value > 0 ? theme.success : r.value < 0 ? theme.danger : theme.mutedForeground }}
                >
                  {r.value >= 0 ? "+" : ""}{formatCompact(r.value)}
                </Text>
              </View>
            ))}
          <Text className="text-label text-faint-foreground mt-1.5">
            Tap the chart to see any month.
            {anyEstimated ? " Hollow dots are estimates: an old investment snapshot or a balance worked back from an SMS." : ""}
          </Text>
        </View>
      )}
    </Card>
  );
}
