import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { Card, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getSpendingRows } from "@/services/analytics/spending-rows";
import { dayLabel } from "@/services/month-story";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { formatAmount, formatShortAmount } from "@/utils/format";
import { logger } from "@/utils/logger";

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Longer than this, the calendar shows one cell per month instead of per day. */
const DAY_GRID_MAX_DAYS = 62;

/** Spending per day of a month, from the Budget tab's spending rows (index 0 is day 1). Pure. */
export function perDayFrom(rows: { date: string; amount: number }[], days: number): number[] {
  const out = new Array<number>(days).fill(0);
  for (const r of rows) {
    const d = Number(r.date.slice(8, 10));
    if (d >= 1 && d <= days) out[d - 1] += r.amount;
  }
  return out;
}

/** 0 (nothing) to 4 (one of the biggest), by where a value sits among the ones with spending. Pure. */
export function shadeOf(v: number, all: number[]): number {
  if (v <= 0) return 0;
  const spent = all.filter((x) => x > 0).sort((a, b) => a - b);
  const rank = spent.findIndex((x) => x >= v);
  return Math.min(4, 1 + Math.floor((rank / Math.max(1, spent.length)) * 4));
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Every day from start to end, padded to whole Monday–Sunday weeks (null outside the range). Pure. */
export function weeksOf(start: string, end: string): (string | null)[][] {
  const a = parse(start);
  const b = parse(end);
  const first = new Date(a.getFullYear(), a.getMonth(), a.getDate() - ((a.getDay() + 6) % 7));
  const weeks: (string | null)[][] = [];
  for (let d = first; d <= b; ) {
    const week: (string | null)[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(d >= a && d <= b ? iso(d) : null);
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** One cell's look: shade from the spending, ring for the picked or highlighted one. */
function useCellStyle(light: boolean) {
  const theme = useTheme();
  const muted = light ? "rgba(255,255,255,0.7)" : theme.mutedForeground;
  const fill = (shade: number) =>
    light ? `rgba(255,255,255,${[0.1, 0.25, 0.45, 0.7, 0.95][shade]})` : shade === 0 ? theme.alpha("foreground", 0.06) : theme.alpha("primary", [0, 0.25, 0.45, 0.7, 1][shade]);
  const text = (shade: number) => (light ? (shade >= 4 ? "#26215C" : "#FFFFFF") : shade >= 3 ? theme.primaryForeground : muted);
  const ring = light ? "#FAC775" : theme.foreground;
  return { muted, fill, text, ring };
}

/**
 * A month as a grid of days, Monday first, darker the more was spent. Days after `upToDay` are
 * outlined: still to come. `highlight` rings one day; `onPressDay` makes the days tappable.
 * `light` draws for the month story's dark slides.
 */
export function DayGrid({
  month,
  perDay,
  upToDay,
  highlight,
  light = false,
  onPressDay,
}: {
  month: string;
  perDay: number[];
  upToDay: number;
  highlight?: number;
  light?: boolean;
  onPressDay?: (day: number) => void;
}) {
  const { endDate } = getMonthDateRange(month);
  const weeks = weeksOf(`${month}-01`, endDate);
  const counted = perDay.slice(0, upToDay);
  return (
    <Grid
      weeks={weeks}
      valueOf={(d) => perDay[Number(d.slice(8, 10)) - 1] ?? 0}
      all={counted}
      isFuture={(d) => Number(d.slice(8, 10)) > upToDay}
      ringed={(d) => Number(d.slice(8, 10)) === highlight}
      light={light}
      onPress={onPressDay ? (d) => onPressDay(Number(d.slice(8, 10))) : undefined}
    />
  );
}

function Grid({
  weeks,
  valueOf,
  all,
  isFuture,
  ringed,
  light,
  onPress,
  monthOnFirst = false,
}: {
  monthOnFirst?: boolean;
  weeks: (string | null)[][];
  valueOf: (day: string) => number;
  all: number[];
  isFuture: (day: string) => boolean;
  ringed: (day: string) => boolean;
  light: boolean;
  onPress?: (day: string) => void;
}) {
  const c = useCellStyle(light);
  return (
    <View>
      <View className="flex-row mb-1">
        {DAY_LETTERS.map((d, i) => (
          <Text key={i} className="text-label flex-1 text-center" style={{ color: c.muted }}>
            {d}
          </Text>
        ))}
      </View>
      {/* One row per week, seven equal cells: a wrapped list can lose its last column to rounding. */}
      {weeks.map((week, wi) => (
        <View key={wi} className="flex-row">
          {week.map((day, i) => {
            if (!day) return <View key={i} style={{ flex: 1, aspectRatio: 1 }} />;
            const future = isFuture(day);
            const shade = future ? 0 : shadeOf(valueOf(day), all);
            const isRinged = ringed(day);
            const n = Number(day.slice(8, 10));
            // "1 Dec" marks where a month starts, only when the grid runs across months.
            const label = monthOnFirst && n === 1 ? `${n} ${MONTHS[Number(day.slice(5, 7)) - 1]}` : String(n);
            const cell = (
              <View
                className="flex-1 rounded-control items-center justify-center"
                style={{
                  backgroundColor: future ? "transparent" : c.fill(shade),
                  borderWidth: future || isRinged ? 1.5 : 0,
                  borderStyle: future ? "dashed" : "solid",
                  borderColor: isRinged ? c.ring : c.muted,
                }}
              >
                <Text className="text-label font-semibold" style={{ color: c.text(shade) }} numberOfLines={1}>
                  {label}
                </Text>
              </View>
            );
            return (
              <View key={i} style={{ flex: 1, aspectRatio: 1, padding: 2 }}>
                {onPress && !future ? (
                  <Pressable
                    onPress={() => onPress(day)}
                    style={{ flex: 1 }}
                    accessibilityRole="button"
                    accessibilityLabel={`${dayLabel(day)}, ${formatAmount(valueOf(day))}`}
                  >
                    {cell}
                  </Pressable>
                ) : (
                  cell
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

interface Row {
  id: string;
  date: string;
  amount: number;
  merchant_name: string | null;
  raw_merchant_name: string | null;
}

/**
 * Compare's calendar for any period (docs/INSIGHTS_STREAMLINE_PROPOSAL.md §2.3): a day grid up to
 * two months, one cell per month beyond that. Tap a day or month for what was spent, the biggest
 * payment and a link to its transactions.
 */
export function SpendCalendar({ start, end }: { start: string; end: string }) {
  const theme = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const seq = useRef(0);
  const today = iso(new Date());
  const days = Math.round((parse(end).getTime() - parse(start).getTime()) / 86400000) + 1;
  const byMonth = days > DAY_GRID_MAX_DAYS;

  // A new range starts clean: no day picked from the old one, no old rows drawn in the new layout.
  useEffect(() => {
    setPicked(null);
    setRows(null);
  }, [start, end]);

  const load = useCallback(async () => {
    const s = ++seq.current;
    try {
      const r = (await getSpendingRows(DEFAULT_USER_ID, start.slice(0, 10), end.slice(0, 10))) as Row[];
      if (s === seq.current) setRows(r);
    } catch (e) {
      logger.warn("Spending calendar: load failed", e);
    }
  }, [start, end]);
  useDataRefresh(load);

  // Spending per day (or month), and the rows behind each, for the tap.
  const { groups, totals } = useMemo(() => {
    const m = new Map<string, Row[]>();
    const t = new Map<string, number>();
    for (const r of rows ?? []) {
      const key = byMonth ? r.date.slice(0, 7) : r.date.slice(0, 10);
      const list = m.get(key);
      if (list) list.push(r);
      else m.set(key, [r]);
      t.set(key, (t.get(key) ?? 0) + r.amount);
    }
    return { groups: m, totals: t };
  }, [rows, byMonth]);
  const total = (key: string) => totals.get(key) ?? 0;

  if (!rows) return null;

  const keys = byMonth ? monthsBetween(start, end) : [...groups.keys()];
  const all = keys.map(total);
  const quiet = byMonth ? 0 : weeksOf(start, end).flat().filter((d) => d && d <= today && total(d) <= 0).length;
  const top = keys.reduce<string | null>((best, k) => (best == null || total(k) > total(best) ? k : best), null);

  const pickedRows = picked ? [...(groups.get(picked) ?? [])].sort((a, b) => b.amount - a.amount) : [];
  const pickedLabel = picked ? (byMonth ? `${MONTHS[Number(picked.slice(5, 7)) - 1]} ${picked.slice(0, 4)}` : dayLabel(picked)) : "";

  return (
    <Card className="mx-4 mt-3">
      <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-2">{byMonth ? "Month by month" : "Day by day"}</Text>
      {byMonth ? (
        <View className="flex-row flex-wrap">
          {keys.map((k) => {
            const shade = shadeOf(total(k), all);
            const on = picked === k;
            return (
              <View key={k} style={{ width: "25%", padding: 2 }}>
                <Pressable
                  onPress={() => setPicked(on ? null : k)}
                  className="rounded-control items-center justify-center py-3"
                  style={{
                    backgroundColor: shade === 0 ? theme.alpha("foreground", 0.06) : theme.alpha("primary", [0, 0.25, 0.45, 0.7, 1][shade]),
                    borderWidth: on ? 1.5 : 0,
                    borderColor: theme.foreground,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${MONTHS[Number(k.slice(5, 7)) - 1]}, ${formatAmount(total(k))}`}
                >
                  <Text className="text-label font-semibold" style={{ color: shade >= 3 ? theme.primaryForeground : theme.mutedForeground }}>
                    {MONTHS[Number(k.slice(5, 7)) - 1]}
                  </Text>
                  <Text className="text-label" style={{ color: shade >= 3 ? theme.primaryForeground : theme.mutedForeground }}>
                    {formatShortAmount(Math.round(total(k)))}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : (
        <Grid
          weeks={weeksOf(start, end)}
          valueOf={total}
          all={all}
          isFuture={(d) => d > today}
          ringed={(d) => d === picked}
          light={false}
          monthOnFirst={start.slice(0, 7) !== end.slice(0, 7)}
          onPress={(d) => setPicked(picked === d ? null : d)}
        />
      )}

      {picked ? (
        <View className="mt-3 rounded-control px-3 py-2.5" style={{ backgroundColor: theme.alpha("foreground", 0.05), gap: 2 }}>
          <Text className="text-meta font-semibold text-foreground">
            {pickedLabel} · {formatAmount(total(picked))}
          </Text>
          <Text className="text-meta text-muted-foreground">
            {pickedRows.length === 0
              ? "Nothing spent"
              : `${pickedRows.length} payment${pickedRows.length === 1 ? "" : "s"}${
                  pickedRows[0] ? ` · biggest ${formatAmount(pickedRows[0].amount)}${(pickedRows[0].merchant_name ?? pickedRows[0].raw_merchant_name) ? ` at ${pickedRows[0].merchant_name ?? pickedRows[0].raw_merchant_name}` : ""}` : ""
                }`}
          </Text>
          {pickedRows.length > 0 && (
            <Pressable
              onPress={() => router.push({ pathname: "/insights/filtered", params: { expenseIds: pickedRows.map((r) => r.id).join(","), title: pickedLabel } })}
              hitSlop={6}
              accessibilityRole="button"
            >
              <Text className="text-meta font-semibold mt-1" style={{ color: theme.primary }}>See these transactions</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <Text className="text-label text-muted-foreground mt-2">
          {quiet > 0 ? `${quiet} day${quiet === 1 ? "" : "s"} with nothing spent · ` : ""}
          {top && total(top) > 0 ? `biggest: ${byMonth ? MONTHS[Number(top.slice(5, 7)) - 1] : dayLabel(top)}, ${formatShortAmount(Math.round(total(top)))} · tap one for more` : "tap one for more"}
        </Text>
      )}
    </Card>
  );
}

/** "2026-04" … "2027-03" for every month the range touches. Pure. */
function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const endKey = end.slice(0, 7);
  for (;;) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    out.push(k);
    if (k >= endKey || out.length > 120) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
