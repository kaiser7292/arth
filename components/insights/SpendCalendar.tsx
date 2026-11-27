import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { Card, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getSpendingRows } from "@/services/analytics/spending-rows";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { formatShortAmount } from "@/utils/format";
import { logger } from "@/utils/logger";

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** Spending per day of a month, from the Budget tab's spending rows (index 0 is day 1). Pure. */
export function perDayFrom(rows: { date: string; amount: number }[], days: number): number[] {
  const out = new Array<number>(days).fill(0);
  for (const r of rows) {
    const d = Number(r.date.slice(8, 10));
    if (d >= 1 && d <= days) out[d - 1] += r.amount;
  }
  return out;
}

/** 0 (nothing) to 4 (one of the biggest days), by where a day sits among the days with spending. Pure. */
export function shadeOf(v: number, all: number[]): number {
  if (v <= 0) return 0;
  const spent = all.filter((x) => x > 0).sort((a, b) => a - b);
  const rank = spent.findIndex((x) => x >= v);
  return Math.min(4, 1 + Math.floor((rank / Math.max(1, spent.length)) * 4));
}

/**
 * The month as a grid of days, darker the more was spent (Monday first). Days after `upToDay`
 * are outlined: still to come. `highlight` rings one day (the month story's biggest day).
 * `light` draws for the month story's dark slides.
 */
export function DayGrid({ month, perDay, upToDay, highlight, light }: { month: string; perDay: number[]; upToDay: number; highlight?: number; light?: boolean }) {
  const theme = useTheme();
  const [y, m] = month.split("-").map(Number);
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [...new Array<null>(offset).fill(null), ...perDay.map((_, i) => i + 1)];
  const base = light ? "255,255,255" : null;
  const fill = (shade: number) =>
    light ? `rgba(${base},${[0.1, 0.25, 0.45, 0.7, 0.95][shade]})` : shade === 0 ? theme.alpha("foreground", 0.06) : theme.alpha("primary", [0, 0.25, 0.45, 0.7, 1][shade]);
  const muted = light ? "rgba(255,255,255,0.7)" : theme.mutedForeground;
  return (
    <View accessibilityLabel={`Spending by day, ${month}`}>
      <View className="flex-row mb-1">
        {DAY_LETTERS.map((d, i) => (
          <Text key={i} className="text-label flex-1 text-center" style={{ color: muted }}>
            {d}
          </Text>
        ))}
      </View>
      <View className="flex-row flex-wrap">
        {cells.map((day, i) => {
          if (day == null) return <View key={`e${i}`} style={{ width: `${100 / 7}%`, aspectRatio: 1 }} />;
          const future = day > upToDay;
          const shade = future ? 0 : shadeOf(perDay[day - 1], perDay.slice(0, upToDay));
          const dark = !light && shade >= 3;
          return (
            <View key={day} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}>
              <View
                className="flex-1 rounded-control items-center justify-center"
                style={{
                  backgroundColor: future ? "transparent" : fill(shade),
                  borderWidth: future || day === highlight ? 1.5 : 0,
                  borderStyle: future ? "dashed" : "solid",
                  borderColor: day === highlight ? (light ? "#FAC775" : theme.foreground) : muted,
                }}
              >
                <Text className="text-label font-semibold" style={{ color: light ? (shade >= 4 ? "#26215C" : "#FFFFFF") : dark ? theme.primaryForeground : muted }}>
                  {day}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Compare's calendar: this month's days, from its spending rows. Shows nothing until loaded. */
export function SpendCalendar({ month, upTo }: { month: string; upTo: string }) {
  const [perDay, setPerDay] = useState<number[] | null>(null);
  const seq = useRef(0);
  const days = Number(getMonthDateRange(month).endDate.slice(8, 10));
  const upToDay = upTo.slice(0, 7) === month ? Number(upTo.slice(8, 10)) : days;
  const load = useCallback(async () => {
    const s = ++seq.current;
    try {
      const rows = await getSpendingRows(DEFAULT_USER_ID, `${month}-01`, getMonthDateRange(month).endDate);
      if (s === seq.current) setPerDay(perDayFrom(rows, days));
    } catch (e) {
      logger.warn("Spending calendar: load failed", e);
    }
  }, [month, days]);
  useDataRefresh(load);
  if (!perDay) return null;
  const counted = perDay.slice(0, upToDay);
  const quiet = counted.filter((v) => v <= 0).length;
  const top = counted.reduce((best, v, i) => (v > counted[best] ? i : best), 0);
  return (
    <Card className="mx-4 mt-3">
      <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-2">Day by day</Text>
      <DayGrid month={month} perDay={perDay} upToDay={upToDay} />
      <Text className="text-label text-muted-foreground mt-2">
        {quiet > 0 ? `${quiet} day${quiet === 1 ? "" : "s"} with nothing spent · ` : ""}
        {counted[top] > 0 ? `biggest: day ${top + 1}, ${formatShortAmount(Math.round(counted[top]))}` : "darker means more spent"}
      </Text>
    </Card>
  );
}
