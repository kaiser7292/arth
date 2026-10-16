import { useMemo, useState } from "react";
import { View } from "react-native";
import { Card, Money, ProgressBar, Text } from "@/components/ui";
import { AnimatedNumber, SegmentedControl } from "@/components/motion";
import { StackedAreaChart, type StackedLayer } from "@/components/charts/StackedAreaChart";
import { DATA_HEX } from "@/constants/brand";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount, formatCompact } from "@/utils/format";
import { changeBetween, type NetWorthPoint } from "@/services/net-worth-history";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type RangeKey = "fy" | "1y" | "3y" | "all";
const RANGES: { value: RangeKey; label: string }[] = [
  { value: "fy", label: "This FY" },
  { value: "1y", label: "1Y" },
  { value: "3y", label: "3Y" },
  { value: "all", label: "All" },
];

/**
 * What you own, bottom band first - the Balance Sheet's asset sections, drawn like the
 * Investments chart. What you owe (Credit, Debt, Payables) is listed under it.
 */
const OWN = [
  { key: "liquidCash", label: "Liquid Cash", hint: "Bank, wallets and FDs", color: DATA_HEX.series[0] },
  { key: "investments", label: "Investments", hint: "Demat, mutual funds and pension", color: DATA_HEX.series[2] },
  { key: "receivables", label: "Receivables", hint: "Money people owe you", color: DATA_HEX.series[3] },
] as const;
type OwnKey = (typeof OWN)[number]["key"];

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
 * Net worth month by month, built like the Investments chart: what you own as stacked bands, and
 * the rows underneath - what you own and what you owe - follow the finger while you drag. Then, in
 * plain words, how the net worth changed since the range began. Data: services/net-worth-history.ts.
 */
export function NetWorthTrendCard({ points, fyStartMonth, loading }: Props) {
  const theme = useTheme();
  const [range, setRange] = useState<RangeKey>("fy");
  /** Index into `visible` under the finger while dragging; null otherwise. */
  const [scrub, setScrub] = useState<number | null>(null);

  // The range starts from the month-end BEFORE its first month, so "this FY" compares against
  // 31 Mar - the same as "since 1 Apr".
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

  const layers = useMemo<StackedLayer[]>(
    () =>
      OWN.map((o) => ({
        key: o.key,
        label: o.label,
        color: o.color,
        values: visible.map((p) => Math.max(0, p[o.key as OwnKey])),
      })).filter((l) => l.values.some((v) => v > 0)),
    [visible],
  );

  if (loading && points.length === 0) {
    return (
      <Card className="mx-4 mb-2">
        <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Net worth over time</Text>
        <View style={{ height: 150 }} className="items-center justify-center">
          <Text className="text-xs text-faint-foreground">Working it out…</Text>
        </View>
      </Card>
    );
  }
  if (points.length < 2) return null;

  const n = visible.length;
  const scrubbing = scrub != null && scrub < n;
  const at = scrubbing ? scrub! : n - 1;
  const first = visible[0];
  const point = visible[at];
  const isToday = at === n - 1;
  const delta = point.netWorth - first.netWorth;
  const deltaPct = first.netWorth > 0 ? (delta / first.netWorth) * 100 : null;
  const sinceLabel =
    range === "fy" && first.month < fyStartMonth ? `since 1 ${monthLabel(fyStartMonth, false)}` : `since ${monthLabel(first.month)}`;
  const change = changeBetween(points, baseIndex, baseIndex + at);

  const own = OWN.map((o) => ({ ...o, value: Math.max(0, point[o.key as OwnKey]) })).filter((o) => o.value > 0);
  const owned = own.reduce((sum, o) => sum + o.value, 0);
  const owe = [
    { label: "Credit", hint: "Card dues", value: point.cards },
    { label: "Debt", hint: "Loans", value: point.loans },
    { label: "Payables", hint: "Money you owe people", value: point.payables },
  ].filter((o) => o.value > 0);
  const pct = (v: number) => (owned > 0 ? Math.round((v / owned) * 100) : 0);

  const howRows: { label: string; hint: string; value: number }[] = [
    {
      label: "You saved",
      hint: "Money that came in, minus what you spent, kept in your accounts, FDs and investments",
      value: change.saved,
    },
    {
      label: "Markets",
      hint: "Your investments' value going up or down, not counting money you put in",
      value: change.marketGains,
    },
    {
      label: change.loansPaidDown >= 0 ? "Loans paid off" : "New loans",
      hint: change.loansPaidDown >= 0 ? "How much your loan balances went down" : "How much your loan balances went up",
      value: change.loansPaidDown,
    },
    { label: "Everything else", hint: "Money people owe you or you owe them, and other changes", value: change.other },
  ].filter((r, i) => i === 0 || Math.abs(r.value) >= 1);

  return (
    <Card className="mx-4 mb-2">
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        {isToday && !scrubbing ? "Net worth" : `Net worth · end of ${monthLabel(point.month)}`}
      </Text>
      {/* Counts up when the screen opens; while dragging it follows the finger exactly. */}
      {scrubbing ? (
        <Money value={point.netWorth} className="text-2xl font-bold text-foreground" />
      ) : (
        <AnimatedNumber value={point.netWorth} className="text-2xl font-bold text-foreground" />
      )}
      {Math.abs(delta) >= 1 || scrubbing ? (
        <Text className="text-xs mt-0.5" style={{ color: delta >= 0 ? theme.success : theme.danger }}>
          {delta >= 0 ? "+" : "−"}{formatAmount(Math.abs(delta))}
          {deltaPct != null ? ` (${delta >= 0 ? "+" : "−"}${Math.abs(deltaPct).toFixed(1)}%)` : ""}
          <Text className="text-xs text-muted-foreground"> {sinceLabel}{point.estimated ? " · estimated" : ""}</Text>
        </Text>
      ) : null}

      {/* How far back to look. */}
      <SegmentedControl
        className="mt-3"
        accessibilityLabel="Period"
        options={RANGES}
        value={range}
        onChange={(v) => {
          setRange(v);
          setScrub(null);
        }}
      />

      <View className="mt-3">
        <StackedAreaChart key={range} months={visible.map((p) => p.month)} dateLabels="month" layers={layers} onScrub={setScrub} />
      </View>

      {/* What it's made of - follows the finger, like the rows under the Investments chart. */}
      <View className="mt-2">
        {owe.length > 0 && <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">What you own</Text>}
        {[...own].reverse().map((o) => (
          <BreakdownRow key={o.key} color={o.color} label={o.label} hint={o.hint} amount={o.value} percent={pct(o.value)} />
        ))}
        {owe.length > 0 && <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mt-2 mb-0.5">What you owe</Text>}
        {owe.map((o) => (
          <BreakdownRow key={o.label} color={theme.danger} label={o.label} hint={o.hint} amount={-o.value} percent={pct(o.value)} owed />
        ))}
      </View>

      {/* How it changed, in plain words. The rows add up to the change shown at the top. */}
      <View className="mt-3 pt-3 border-t border-border">
        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          How it changed {sinceLabel}{scrubbing && !isToday ? ` to ${monthLabel(point.month)}` : ""}
        </Text>
        {howRows.map((r) => (
          <View key={r.label} className="flex-row items-start py-1.5">
            <View className="flex-1 mr-3">
              <Text className="text-sm text-foreground">{r.label}</Text>
              <Text className="text-label text-muted-foreground">{r.hint}</Text>
            </View>
            <Text className="text-sm font-semibold" style={{ color: r.value > 0 ? theme.success : r.value < 0 ? theme.danger : theme.mutedForeground }}>
              {r.value >= 0 ? "+" : "−"}{formatCompact(Math.abs(r.value))}
            </Text>
          </View>
        ))}
        <View className="flex-row items-center pt-1.5 mt-0.5 border-t border-border">
          <Text className="text-sm font-semibold text-foreground flex-1">Change in net worth</Text>
          <Text className="text-sm font-bold" style={{ color: delta >= 0 ? theme.success : theme.danger }}>
            {delta >= 0 ? "+" : "−"}{formatCompact(Math.abs(delta))}
          </Text>
        </View>
        {visible.some((p) => p.estimated) && (
          <Text className="text-label text-faint-foreground mt-2">
            Some months are estimates: an investment snapshot carried forward, or a balance worked back from a message.
          </Text>
        )}
      </View>
    </Card>
  );
}

function BreakdownRow({
  color,
  label,
  hint,
  amount,
  percent,
  owed,
}: {
  color: string;
  label: string;
  hint: string;
  amount: number;
  percent: number;
  owed?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ minHeight: 40, flexDirection: "row", alignItems: "center", paddingVertical: 6 }} accessible accessibilityLabel={`${label}, ${formatAmount(amount)}`}>
      <View className="w-2.5 h-2.5 rounded-sm mr-2.5" style={{ backgroundColor: color, opacity: owed ? 0.7 : 1 }} />
      <View className="flex-1">
        <Text className="text-sm text-foreground" numberOfLines={1}>
          {label}
          <Text className="text-label text-muted-foreground">  {hint}</Text>
        </Text>
        <ProgressBar value={Math.min(1, percent / 100)} color={color} height={3} className="mt-1" animated={false} />
      </View>
      <Text className="text-xs w-24 text-right" style={{ color: owed ? theme.danger : theme.mutedForeground }}>
        {owed ? "−" : ""}{formatAmount(Math.abs(amount))}
      </Text>
      <Text className="text-sm font-semibold text-foreground w-11 text-right">{percent}%</Text>
    </View>
  );
}
