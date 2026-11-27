import { useCallback, useRef, useState } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import Svg, { Circle, Path } from "react-native-svg";
import { Card, Text } from "@/components/ui";
import { WipeIn } from "@/components/motion/Entrances";
import { useTheme } from "@/hooks/use-theme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { isAiJobOn } from "@/services/ai/ai-reading";
import { getNanoStatus } from "@/services/ai/nano";
import { savedHeadline, writeHeadline } from "@/services/ai/tasks/month-note";
import { loadMonthStory, monthLong, plainHeadline, prevYm, storyFacts, storyTiles, ymOf, type MonthStory } from "@/services/month-story";
import { isAmountsHidden } from "@/services/privacy-mode";
import { formatShortAmount } from "@/utils/format";
import { logger } from "@/utils/logger";

const CHART_H = 76;

/**
 * "Your month" at the top of Insights (services/month-story.ts): a badge for the month, one
 * headline, the spending pace against last month by the same day, and three small facts. Tapping
 * it plays this month's story; the link plays last month's. On phones with on-device AI the
 * headline is reworded once per change of facts, checked number by number
 * (services/ai/tasks/month-note.ts). Shows nothing before the first spend of two months.
 */
export function MonthStoryCard() {
  const theme = useTheme();
  const router = useRouter();
  const [story, setStory] = useState<MonthStory | null>(null);
  const [aiHeadline, setAiHeadline] = useState<string | null>(null);
  const loadSeq = useRef(0);
  /** The facts being written right now, if any: data refreshes mid-write don't start another. */
  const writingKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const month = ymOf(new Date());
    try {
      const s = await loadMonthStory(month);
      if (seq !== loadSeq.current) return;
      setStory(s);
      // Amounts hidden: the AI line carries numbers, so the plain (masked) one shows.
      if (s.payments === 0 || isAmountsHidden()) return setAiHeadline(null);
      const facts = storyFacts(s);
      const saved = await savedHeadline(month, facts);
      if (seq !== loadSeq.current) return;
      setAiHeadline(saved?.headline ?? null);
      // Asked once per set of facts: a headline that failed the check isn't asked for again.
      if (saved || !isAiJobOn("month_note")) return;
      if ((await getNanoStatus().catch(() => "unavailable")) !== "available") return;
      const key = facts.join("|");
      if (writingKey.current === key) return;
      writingKey.current = key;
      const written = await writeHeadline(month, facts)
        .catch((e) => {
          logger.warn("Month headline: AI didn't write it (plain one shown)", e);
          return null;
        })
        .finally(() => {
          if (writingKey.current === key) writingKey.current = null;
        });
      if (seq === loadSeq.current && written) setAiHeadline(written);
    } catch (e) {
      // A failed refresh keeps the card that was showing.
      logger.warn("Month story card: load failed", e);
    }
  }, []);

  useDataRefresh(load);

  if (!story || (story.payments === 0 && story.prevTotal === 0)) return null;
  const s = story;
  const tiles = storyTiles(s);
  const headline = aiHeadline ?? plainHeadline(s);
  const prevShort = monthLong(s.prevMonth).slice(0, 3);
  const open = (month: string) => router.push({ pathname: "/insights/month-story", params: { month } } as never);

  return (
    <Card className="mb-3">
      <Pressable onPress={() => open(s.month)} accessibilityRole="button" accessibilityLabel={`${s.persona.label}. ${headline}. Play ${monthLong(s.month)}'s story`}>
        <View className="flex-row items-center mb-2.5">
          <View className="flex-row items-center rounded-full px-2.5 py-1" style={{ backgroundColor: theme.alpha("primary", 0.12) }}>
            <Ionicons name={s.persona.icon as keyof typeof Ionicons.glyphMap} size={13} color={theme.primary} />
            <Text className="text-xs font-semibold ml-1.5" style={{ color: theme.primary }}>
              {s.persona.label}
            </Text>
          </View>
          <Text className="text-xs text-muted-foreground ml-auto">
            {monthLong(s.month).slice(0, 3)} · day {s.day} of {s.daysInMonth}
          </Text>
        </View>

        <Text className="text-foreground" style={{ fontSize: 20, lineHeight: 27, fontWeight: "700", letterSpacing: -0.3 }}>
          {headline}
        </Text>
        {aiHeadline && (
          <View className="flex-row items-center mt-1">
            <Ionicons name="sparkles-outline" size={11} color={theme.mutedForeground} />
            <Text className="text-label text-muted-foreground ml-1">Written on this phone</Text>
          </View>
        )}

        {s.prevTotal > 0 && <PaceChart s={s} />}
        <View className="flex-row items-center mt-1.5" style={{ gap: 14 }}>
          <Legend color={theme.primary} label={`${monthLong(s.month).slice(0, 3)} ${formatShortAmount(Math.round(s.spent))}`} />
          {s.prevTotal > 0 && <Legend color={theme.mutedForeground} dashed label={`${prevShort} by day ${Math.min(s.day, s.prevCumulative.length)} ${formatShortAmount(Math.round(s.prevSameDay))}`} />}
        </View>

        {tiles.length > 0 && (
          <View className="flex-row mt-3" style={{ gap: 8 }}>
            {tiles.map((t) => (
              <View key={t.label + t.value} className="flex-1 rounded-xl px-2.5 py-2" style={{ backgroundColor: theme.alpha("mutedForeground", 0.08) }}>
                <Text className="text-label text-muted-foreground" numberOfLines={1}>
                  {t.label}
                </Text>
                <Text className="text-base font-bold text-foreground" numberOfLines={1}>
                  {t.value}
                </Text>
                <Text className="text-label" numberOfLines={1} style={{ color: t.tone === "success" ? theme.success : t.tone === "warning" ? theme.warning : theme.mutedForeground }}>
                  {t.note}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Pressable>

      <View className="flex-row items-center mt-3">
        {s.budgetsOver > 0 ? (
          <Pressable onPress={() => router.push("/insights/budget-vs-actual" as never)} hitSlop={8} className="flex-row items-center" accessibilityRole="button">
            <Ionicons name="alert-circle-outline" size={14} color={theme.warning} />
            <Text className="text-xs font-semibold ml-1" style={{ color: theme.warning }}>
              {s.budgetsOver} budget{s.budgetsOver === 1 ? "" : "s"} over
            </Text>
          </Pressable>
        ) : (
          <View />
        )}
        {s.prevTotal > 0 && (
          <Pressable onPress={() => open(prevYm(s.month))} hitSlop={8} className="flex-row items-center ml-auto" accessibilityRole="button">
            <Text className="text-xs font-semibold" style={{ color: theme.primary }}>
              {`Play ${monthLong(s.prevMonth)}'s story`}
            </Text>
            <Ionicons name="play-circle-outline" size={15} color={theme.primary} style={{ marginLeft: 4 }} />
          </Pressable>
        )}
      </View>
    </Card>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <View className="flex-row items-center">
      <View style={{ width: 12, height: 0, borderTopWidth: 2, borderColor: color, borderStyle: dashed ? "dashed" : "solid" }} />
      <Text className="text-label text-muted-foreground ml-1.5">{label}</Text>
    </View>
  );
}

/** This month's spending added up day by day (solid), over last month's (dashed). */
function PaceChart({ s }: { s: MonthStory }) {
  const theme = useTheme();
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const days = Math.max(s.daysInMonth, s.prevCumulative.length);
  const top = Math.max(s.cumulative[s.cumulative.length - 1] ?? 0, s.prevCumulative[s.prevCumulative.length - 1] ?? 0, 1);
  const x = (i: number) => (days <= 1 ? 0 : (i / (days - 1)) * (w - 8) + 4);
  const y = (v: number) => CHART_H - 4 - (v / top) * (CHART_H - 10);
  const path = (pts: number[]) => pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const lastI = s.cumulative.length - 1;
  return (
    <View onLayout={onLayout} style={{ height: CHART_H, marginTop: 12 }}>
      {w > 0 && (
        <WipeIn>
          <Svg width={w} height={CHART_H}>
            <Path d={path(s.prevCumulative)} stroke={theme.mutedForeground} strokeWidth={1.5} strokeDasharray="4 4" fill="none" opacity={0.7} />
            {lastI >= 0 && <Path d={path(s.cumulative)} stroke={theme.primary} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />}
            {lastI >= 0 && <Circle cx={x(lastI)} cy={y(s.cumulative[lastI])} r={4} fill={theme.primary} />}
          </Svg>
        </WipeIn>
      )}
    </View>
  );
}
