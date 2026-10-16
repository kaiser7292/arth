import { useMemo, useRef, useState } from "react";
import { View, LayoutChangeEvent } from "react-native";
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop } from "react-native-svg";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { Card, Money, Text } from "@/components/ui";
import { SegmentedControl } from "@/components/motion";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount, formatCompact } from "@/utils/format";
import { changeBetween, type NetWorthPoint } from "@/services/net-worth-history";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHART_HEIGHT = 150;
const PAD_TOP = 20; // room for the date that rides on the drag line
const PAD_BOTTOM = 8;
const PAD_H = 12;

type RangeKey = "fy" | "1y" | "3y" | "all";
const RANGES: { value: RangeKey; label: string }[] = [
  { value: "fy", label: "This FY" },
  { value: "1y", label: "1Y" },
  { value: "3y", label: "3Y" },
  { value: "all", label: "All" },
];

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
 * Net worth month by month. Drag along the chart to read any month - the value, the change since
 * the range began, how that change splits up (saved / market / loans / other) and what the net
 * worth was made of all follow the finger, like the Investments chart. Let go and it's back to
 * today. Data: services/net-worth-history.ts.
 */
export function NetWorthTrendCard({ points, fyStartMonth, loading }: Props) {
  const theme = useTheme();
  const [range, setRange] = useState<RangeKey>("fy");
  const [width, setWidth] = useState(0);
  /** Index into `visible` under the finger while dragging; null otherwise. */
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubRef = useRef<number | null>(null);

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

  const n = visible.length;
  const x = (i: number) => (n <= 1 ? width / 2 : PAD_H + (i / (n - 1)) * (width - 2 * PAD_H));
  const indexAt = (px: number) => {
    if (n <= 1 || width <= 0) return 0;
    const i = Math.round(((px - PAD_H) / (width - 2 * PAD_H)) * (n - 1));
    return Math.max(0, Math.min(n - 1, i));
  };

  const scrubTo = (px: number) => {
    const i = indexAt(px);
    if (i === scrubRef.current) return;
    scrubRef.current = i;
    setScrub(i);
    Haptics.selectionAsync().catch(() => {});
  };
  const endScrub = () => {
    if (scrubRef.current == null) return;
    scrubRef.current = null;
    setScrub(null);
  };
  // Sideways drag reads the chart; a vertical move fails it so the page scrolls. A tap reads that
  // month until the finger lifts, the same as a very short drag.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onStart((e) => scrubTo(e.x))
    .onUpdate((e) => scrubTo(e.x))
    .onFinalize(endScrub);
  const press = Gesture.LongPress()
    .runOnJS(true)
    .minDuration(120)
    .onStart((e) => scrubTo(e.x))
    .onFinalize(endScrub);
  const gesture = Gesture.Race(pan, press);

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

  const scrubbing = scrub != null && scrub < n;
  const at = scrubbing ? scrub! : n - 1;
  const first = visible[0];
  const point = visible[at];
  const isToday = at === n - 1;
  const delta = point.netWorth - first.netWorth;
  const deltaPct = first.netWorth > 0 ? (delta / first.netWorth) * 100 : null;
  const change = changeBetween(points, baseIndex, baseIndex + at);
  const deltaColor = delta > 0 ? theme.success : delta < 0 ? theme.danger : theme.mutedForeground;
  const sinceLabel =
    range === "fy" && first.month < fyStartMonth ? `since 1 ${monthLabel(fyStartMonth, false)}` : `since ${monthLabel(first.month)}`;
  const pointLabel = isToday ? "Today" : `End of ${monthLabel(point.month)}`;

  // Y scale over what's visible, with a little headroom; a flat line sits mid-chart.
  const values = visible.map((p) => p.netWorth);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= Math.abs(min) * 0.1 || 1;
    max += Math.abs(max) * 0.1 || 1;
  }
  const y = (v: number) => PAD_TOP + (1 - (v - min) / (max - min)) * (CHART_HEIGHT - PAD_TOP - PAD_BOTTOM);
  const linePath = visible.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.netWorth)}`).join(" ");
  const areaPath = `${linePath} L ${x(n - 1)} ${CHART_HEIGHT} L ${x(0)} ${CHART_HEIGHT} Z`;
  const overall = visible[n - 1].netWorth - first.netWorth;
  const lineColor = overall >= 0 ? theme.success : theme.danger;
  const anyEstimated = visible.some((p) => p.estimated);

  const changeRows: { label: string; value: number; show: boolean }[] = [
    { label: "Saved & invested", value: change.saved, show: true },
    { label: "Market gains", value: change.marketGains, show: change.marketGains !== 0 },
    {
      label: change.loansPaidDown >= 0 ? "Loans paid down" : "New loans",
      value: change.loansPaidDown,
      show: change.loansPaidDown !== 0,
    },
    { label: "Hisaab & other", value: change.other, show: Math.abs(change.other) >= 1 },
  ];
  const madeOf: [string, number][] = (
    [
      ["Bank, FDs & pension", point.savings],
      ["Market investments", point.market],
      ["Card dues", -point.cards],
      ["Loans", -point.loans],
      ["Hisaab (net)", point.hisaab],
    ] as [string, number][]
  ).filter(([, v]) => v !== 0);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <Card className="mx-4 mb-2">
      <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
        Net worth over time
      </Text>
      <Money value={point.netWorth} className="text-2xl font-bold text-foreground" />
      <Text className="text-xs mt-0.5" style={{ color: deltaColor }}>
        {delta >= 0 ? "+" : "−"}{formatAmount(Math.abs(delta))}
        {deltaPct != null ? ` (${delta >= 0 ? "+" : "−"}${Math.abs(deltaPct).toFixed(1)}%)` : ""}
        <Text className="text-xs text-muted-foreground">
          {" "}{scrubbing && !isToday ? `by end of ${monthLabel(point.month)}` : sinceLabel}
          {point.estimated ? " · estimated" : ""}
        </Text>
      </Text>

      <SegmentedControl
        className="mt-3"
        accessibilityLabel="Period"
        options={RANGES}
        value={range}
        onChange={(v) => {
          setRange(v);
          endScrub();
        }}
      />

      <GestureDetector gesture={gesture}>
        <View
          className="mt-3"
          onLayout={onLayout}
          style={{ height: CHART_HEIGHT }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`Net worth chart. ${pointLabel}: ${formatAmount(point.netWorth)}. Drag across for other months.`}
        >
          {width > 0 && (
            <Svg width={width} height={CHART_HEIGHT}>
              <Defs>
                <LinearGradient id="nwArea" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={lineColor} stopOpacity={0.2} />
                  <Stop offset="1" stopColor={lineColor} stopOpacity={0.02} />
                </LinearGradient>
              </Defs>
              {min < 0 && max > 0 && (
                <Line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke={theme.border} strokeDasharray="4,4" />
              )}
              <Path d={areaPath} fill="url(#nwArea)" />
              <Path d={linePath} stroke={lineColor} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              {/* Estimated months as hollow dots (only when there's room to show dots at all). */}
              {n <= 14 &&
                visible.map((p, i) =>
                  i === at && scrubbing ? null : (
                    <Circle
                      key={p.month}
                      cx={x(i)}
                      cy={y(p.netWorth)}
                      r={i === n - 1 ? 3.5 : 2.5}
                      fill={p.estimated ? theme.card : lineColor}
                      stroke={lineColor}
                      strokeWidth={p.estimated ? 1.5 : 1}
                    />
                  ),
                )}
              {scrubbing && (
                <>
                  <Line x1={x(at)} x2={x(at)} y1={16} y2={CHART_HEIGHT - PAD_BOTTOM} stroke={theme.foreground} strokeWidth={1} />
                  <Circle
                    cx={x(at)}
                    cy={y(point.netWorth)}
                    r={5}
                    fill={point.estimated ? theme.card : theme.primary}
                    stroke={point.estimated ? theme.primary : theme.card}
                    strokeWidth={2}
                  />
                </>
              )}
            </Svg>
          )}
          {/* While dragging: the month, riding on top of the line. */}
          {scrubbing && width > 0 && (
            <View
              pointerEvents="none"
              style={{ position: "absolute", top: 0, left: Math.max(0, Math.min(x(at) - 32, width - 64)), width: 64, alignItems: "center" }}
            >
              <Text className="text-label font-semibold text-foreground">{isToday ? "Today" : monthLabel(point.month)}</Text>
            </View>
          )}
        </View>
      </GestureDetector>
      <View className="flex-row justify-between mt-1">
        <Text className="text-label text-faint-foreground">{monthLabel(first.month)}</Text>
        <Text className="text-label text-faint-foreground">Today</Text>
      </View>

      {/* Both breakdowns follow the finger: how the change since the range began splits up,
          and what the net worth was made of at that point. */}
      <View className="mt-3 pt-3 border-t border-border">
        <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          {scrubbing && !isToday ? `Change to ${monthLabel(point.month)}` : "Change"}
        </Text>
        {changeRows
          .filter((r) => r.show)
          .map((r) => (
            <View key={r.label} className="flex-row justify-between py-0.5">
              <Text className="text-xs text-muted-foreground">{r.label}</Text>
              <Text
                className="text-xs font-semibold"
                style={{ color: r.value > 0 ? theme.success : r.value < 0 ? theme.danger : theme.mutedForeground }}
              >
                {r.value >= 0 ? "+" : "−"}{formatCompact(Math.abs(r.value))}
              </Text>
            </View>
          ))}

        <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mt-3 mb-1">
          {pointLabel}
        </Text>
        {madeOf.map(([label, v]) => (
          <View key={label} className="flex-row justify-between py-0.5">
            <Text className="text-xs text-muted-foreground">{label}</Text>
            <Text className="text-xs text-foreground">{formatAmount(v)}</Text>
          </View>
        ))}
        <Text className="text-label text-faint-foreground mt-1.5">
          Drag along the chart to see any month.
          {anyEstimated ? " Hollow dots are estimates: an old investment snapshot or a balance worked back from an SMS." : ""}
        </Text>
      </View>
    </Card>
  );
}
