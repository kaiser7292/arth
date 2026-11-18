import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { Card, Money, ProgressBar, Text } from "@/components/ui";
import { Statement } from "@/components/ui/LinkRow";
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
  { key: "liquidCash", label: "Cash", color: DATA_HEX.series[0] },
  { key: "investments", label: "Investments", color: DATA_HEX.series[2] },
  { key: "receivables", label: "Owed to you", color: DATA_HEX.series[3] },
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
  /** The (i) by "Change since": one short line on what each reason means. */
  const [explain, setExplain] = useState(false);
  // Whole rupees on this card: paise make every figure wrap (owner, Nov 2026).
  const rs = (n: number) => formatAmount(Math.round(n));

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
        <Text className="text-label font-semibold text-muted-foreground uppercase tracking-wider">Net worth over time</Text>
        <View style={{ height: 150 }} className="items-center justify-center">
          <Text className="text-label text-faint-foreground">Working it out…</Text>
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
    { label: "Card dues", value: point.cards },
    { label: "Loans", value: point.loans },
    { label: "You owe people", value: point.payables },
  ].filter((o) => o.value > 0);
  const pct = (v: number) => (owned > 0 ? Math.round((v / owned) * 100) : 0);

  const howRows: { label: string; hint: string; value: number }[] = [
    {
      label: "Saved",
      hint: "What came in minus what you spent",
      value: change.saved,
    },
    {
      label: "Markets",
      hint: "Investments going up or down, not counting what you put in",
      value: change.marketGains,
    },
    {
      label: change.loansPaidDown >= 0 ? "Loans paid" : "New loans",
      hint: change.loansPaidDown >= 0 ? "How much less you owe on loans" : "How much more you owe on loans",
      value: change.loansPaidDown,
    },
    { label: "Other", hint: "Hisaab with people, and everything else", value: change.other },
  ].filter((r, i) => i === 0 || Math.abs(r.value) >= 1);
  // Rounding in the monthly steps can leave a rupee or two: "Other" takes it, so the
  // statement below adds up to the net worth shown at the top.
  const gap = point.netWorth - first.netWorth - howRows.reduce((sum, r) => sum + r.value, 0);
  if (Math.abs(gap) >= 1) {
    const other = howRows.find((r) => r.label === "Other");
    if (other) other.value += gap;
    else howRows.push({ label: "Other", hint: "Hisaab with people, and everything else", value: gap });
  }

  return (
    <Card className="mx-4 mb-2">
      <Text className="text-meta text-muted-foreground">
        {isToday && !scrubbing ? "Net worth today" : `Net worth · end of ${monthLabel(point.month)}`}
      </Text>
      {/* Counts up when the screen opens; while dragging it follows the finger exactly. */}
      {scrubbing ? (
        <Money value={Math.round(point.netWorth)} className="text-hero font-bold text-foreground" />
      ) : (
        <AnimatedNumber value={Math.round(point.netWorth)} className="text-hero font-bold text-foreground" />
      )}
      {Math.abs(delta) >= 1 || scrubbing ? (
        <Text className="text-label mt-0.5" style={{ color: delta >= 0 ? theme.success : theme.danger }}>
          {delta >= 0 ? "+" : "−"}{rs(Math.abs(delta))}
          {deltaPct != null ? ` (${delta >= 0 ? "+" : "−"}${Math.abs(deltaPct).toFixed(1)}%)` : ""}
          <Text className="text-label text-muted-foreground"> {sinceLabel}{point.estimated ? " · estimated" : ""}</Text>
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
          <BreakdownRow key={o.key} color={o.color} label={o.label} amount={o.value} percent={pct(o.value)} />
        ))}
        {owe.length > 0 && <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mt-2 mb-0.5">What you owe</Text>}
        {owe.map((o) => (
          <BreakdownRow key={o.label} color={theme.danger} label={o.label} amount={-o.value} percent={pct(o.value)} owed />
        ))}
      </View>

      {/* How it changed, as a statement that adds up: where it started, each reason, where it is now. */}
      <View className="mt-3 pt-3 border-t border-border">
        <View className="flex-row items-center mb-1" style={{ gap: 6 }}>
          <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground flex-1" numberOfLines={1}>
            Change {sinceLabel}{scrubbing && !isToday ? ` to ${monthLabel(point.month)}` : ""}
          </Text>
          <Pressable
            onPress={() => setExplain((v) => !v)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityState={{ expanded: explain }}
            accessibilityLabel="What these mean"
          >
            <Ionicons name={explain ? "information-circle" : "information-circle-outline"} size={18} color={explain ? theme.primary : theme.mutedForeground} />
          </Pressable>
        </View>
        {explain && (
          <View className="mb-1 px-3 py-2.5 rounded-control" style={{ gap: 4, backgroundColor: theme.alpha("primary", 0.06) }}>
            {howRows.map((r) => (
              <Text key={r.label} className="text-label text-muted-foreground">
                <Text className="text-label font-semibold text-foreground">{r.label}</Text>  {r.hint}
              </Text>
            ))}
          </View>
        )}
        <Statement
          lines={[
            {
              label:
                range === "fy" && first.month < fyStartMonth
                  ? `On 1 ${monthLabel(fyStartMonth, false)}`
                  : `End of ${monthLabel(first.month)}`,
              amount: rs(first.netWorth),
            },
            ...howRows.map((r) => ({
              label: r.label,
              sign: (r.value >= 0 ? "+" : "−") as "+" | "−",
              amount: rs(Math.abs(r.value)),
            })),
          ]}
          total={{
            label: isToday ? "Today" : `End of ${monthLabel(point.month)}`,
            amount: rs(point.netWorth),
          }}
        />
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
  amount,
  percent,
  owed,
}: {
  color: string;
  label: string;
  amount: number;
  percent: number;
  owed?: boolean;
}) {
  const value = `${owed ? "−" : ""}${formatAmount(Math.round(Math.abs(amount)))}`;
  // Two lines so nothing is cut: name and amount, then the bar with its share.
  return (
    <View style={{ paddingVertical: 7 }} accessible accessibilityLabel={`${label}, ${value}, ${percent}%`}>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <View className="w-2.5 h-2.5 rounded-control" style={{ backgroundColor: color, opacity: owed ? 0.7 : 1 }} />
        <Text className="text-meta text-foreground flex-1" numberOfLines={1}>
          {label}
        </Text>
        <Text className="text-meta font-semibold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
          {value}
        </Text>
      </View>
      <View className="flex-row items-center mt-1.5" style={{ gap: 8, paddingLeft: 18 }}>
        <View className="flex-1">
          <ProgressBar value={Math.min(1, percent / 100)} color={color} height={3} animated={false} />
        </View>
        <Text className="text-label text-muted-foreground w-9 text-right">{percent}%</Text>
      </View>
    </View>
  );
}
