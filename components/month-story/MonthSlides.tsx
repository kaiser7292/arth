import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import Svg, { Circle, Path } from "react-native-svg";
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { Text } from "@/components/ui";
import { BODY, Chip, Count, Float, H1, H2, Headline, Pop, Slide, SLIDE_COLORS, SOFT, Sub, WHITE } from "@/components/year-review/StoryCards";
import { dayLabel, monthLong, type MonthStory } from "@/services/month-story";
import { formatShortAmount } from "@/utils/format";

/**
 * The month story's slides (app/insights/month-story.tsx), built on Year in Review's motion
 * pieces: same colours, same pop-in, numbers that count up. Every figure comes from
 * services/month-story.ts.
 */

const compact = (n: number) => formatShortAmount(Math.round(n));
const GOLD = "#FAC775";
const AnimatedPath = Animated.createAnimatedComponent(Path);

/** One big number with an icon floating above it. */
function Big({
  colors,
  eyebrow,
  icon,
  lead,
  value,
  format,
  children,
}: {
  colors: readonly [string, string];
  eyebrow: string;
  icon: keyof typeof Ionicons.glyphMap;
  lead: string;
  value: number;
  format: (n: number) => string;
  children?: React.ReactNode;
}) {
  return (
    <Slide colors={colors} eyebrow={eyebrow}>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Pop delay={100}>
          <Float>
            <View style={{ width: 84, height: 84, borderRadius: 28, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
              <Ionicons name={icon} size={42} color={WHITE} />
            </View>
          </Float>
        </Pop>
        <Pop delay={250}>
          <Text style={{ ...H2, color: SOFT }}>{lead}</Text>
        </Pop>
        <Pop delay={350}>
          <Count value={value} format={format} delay={350} style={{ ...H1, fontSize: 60, lineHeight: 68 }} />
        </Pop>
        {children}
      </View>
    </Slide>
  );
}

const title = (s: MonthStory) => `${monthLong(s.month)}${s.isCurrent ? " so far" : ""}`;

export function IntroMonthSlide({ s }: { s: MonthStory }) {
  return (
    <Slide colors={SLIDE_COLORS.intro} eyebrow={`${title(s)} · your month`} confetti>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Pop delay={150}>
          <Text style={{ ...H2, color: SOFT }}>{s.isCurrent ? "So far you've spent" : "You spent"}</Text>
        </Pop>
        <Pop delay={300} style={{ marginTop: 6 }}>
          <Count value={s.spent} format={compact} delay={300} style={{ ...H1, fontSize: 64, lineHeight: 72 }} />
        </Pop>
        <Chip icon="receipt-outline" label={`${s.payments} payment${s.payments === 1 ? "" : "s"}`} delay={900} />
        {s.quietDays > 0 && <Chip icon="leaf-outline" label={`${s.quietDays} day${s.quietDays === 1 ? "" : "s"} with nothing spent`} delay={1100} />}
        <Chip icon={s.persona.icon as keyof typeof Ionicons.glyphMap} label={s.persona.label} delay={1300} />
      </View>
      <Pop delay={1700}>
        <Text style={{ ...BODY, textAlign: "center" }}>{s.isCurrent ? `Day ${s.day} of ${s.daysInMonth}. Here's how it's going.` : "Let's look back."}</Text>
      </Pop>
    </Slide>
  );
}

export function PaceSlide({ s }: { s: MonthStory }) {
  const prev = monthLong(s.prevMonth);
  const diff = s.spent - s.prevSameDay;
  const under = diff < 0;
  const lead = Math.abs(diff) < 1 ? `Neck and neck with ${prev}` : `${compact(Math.abs(diff))} ${under ? "less" : "more"} than ${prev}`;
  return (
    <Slide colors={SLIDE_COLORS.months} eyebrow="The race against last month">
      <Headline>{lead}</Headline>
      <Sub>
        {s.isCurrent ? `By day ${s.day}, ${prev} was at ${compact(s.prevSameDay)}. You're at ${compact(s.spent)}.` : `${prev} came to ${compact(s.prevTotal)}. ${monthLong(s.month)} came to ${compact(s.spent)}.`}
      </Sub>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <PaceDraw s={s} />
        <View style={{ flexDirection: "row", gap: 18, marginTop: 14 }}>
          <Key color={under ? "#9FE1CB" : GOLD} label={monthLong(s.month)} />
          <Key color="rgba(255,255,255,0.55)" dashed label={prev} />
        </View>
      </View>
      {under && (
        <Pop delay={2300}>
          <Text style={{ ...BODY, textAlign: "center" }}>Nicely done.</Text>
        </Pop>
      )}
    </Slide>
  );
}

function Key({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <View style={{ width: 18, height: 0, borderTopWidth: 3, borderColor: color, borderStyle: dashed ? "dashed" : "solid" }} />
      <Text style={{ color: SOFT, fontSize: 13, marginLeft: 8 }}>{label}</Text>
    </View>
  );
}

/** Both months on one scale: last month dashed, this one drawing itself over it. */
function PaceDraw({ s }: { s: MonthStory }) {
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const H = 200;
  const p = useSharedValue(reduce ? 1 : 0);
  const color = s.spent < s.prevSameDay ? "#9FE1CB" : GOLD;
  const geo = useMemo(() => {
    if (w === 0) return null;
    const days = Math.max(s.daysInMonth, s.prevCumulative.length);
    const top = Math.max(s.cumulative[s.cumulative.length - 1] ?? 0, s.prevCumulative[s.prevCumulative.length - 1] ?? 0, 1);
    const pt = (v: number, i: number) => ({ x: 8 + (days <= 1 ? 0 : (i / (days - 1)) * (w - 16)), y: H - 8 - (v / top) * (H - 24) });
    const line = (vals: number[]) => vals.map((v, i) => pt(v, i));
    const now = line(s.cumulative);
    const before = line(s.prevCumulative);
    const d = (pts: { x: number; y: number }[]) => pts.map((q, i) => `${i ? "L" : "M"} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(" ");
    let len = 0;
    for (let i = 1; i < now.length; i++) len += Math.hypot(now[i].x - now[i - 1].x, now[i].y - now[i - 1].y);
    return { now: d(now), before: d(before), len, last: now[now.length - 1] ?? null };
  }, [w, s]);
  useEffect(() => {
    if (!reduce && geo && geo.len > 0) p.value = withDelay(500, withTiming(1, { duration: 1800, easing: Easing.out(Easing.cubic) }));
  }, [geo, reduce, p]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: (geo?.len ?? 0) * (1 - p.value) }));
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: H }}>
      {geo && (
        <Svg width={w} height={H}>
          <Path d={geo.before} stroke="rgba(255,255,255,0.55)" strokeWidth={2.5} strokeDasharray="6 6" fill="none" />
          {geo.len > 0 && <AnimatedPath d={geo.now} stroke={color} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${geo.len} ${geo.len}`} animatedProps={props} />}
          {geo.last && <Circle cx={geo.last.x} cy={geo.last.y} r={7} fill={WHITE} />}
        </Svg>
      )}
    </View>
  );
}

export function PlaceSlide({ s }: { s: MonthStory }) {
  const p = s.topPlace!;
  const every = p.count > 1 ? s.day / p.count : null;
  return (
    <Slide colors={SLIDE_COLORS.merchants} eyebrow="Your most loyal place">
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Pop delay={100}>
          <Float period={2400}>
            <Ionicons name="trophy" size={46} color={GOLD} style={{ marginBottom: 18 }} />
          </Float>
        </Pop>
        <Pop delay={250}>
          <Text style={{ ...H1, fontSize: 44 }} numberOfLines={2}>
            {p.name}
          </Text>
        </Pop>
        <Pop delay={450} style={{ marginTop: 4 }}>
          <Count value={p.count} format={(n) => `${Math.round(n)} visits`} delay={450} style={{ ...H2, color: GOLD }} />
        </Pop>
        <Sub delay={900}>
          {compact(p.amount)} in all{every != null && every <= 10 ? `. About one every ${every < 1.5 ? "day" : `${Math.round(every)} days`}` : ""}.
        </Sub>
      </View>
    </Slide>
  );
}

export function BigDaySlide({ s }: { s: MonthStory }) {
  const d = s.biggestDay!;
  const pay = s.biggestPayment && s.biggestPayment.date === d.date && s.biggestPayment.name ? s.biggestPayment : null;
  return (
    <Big colors={SLIDE_COLORS.debt} eyebrow="Your biggest day" icon="calendar-outline" lead={dayLabel(d.date)} value={d.amount} format={compact}>
      <Sub delay={900}>
        {d.count} payment{d.count === 1 ? "" : "s"} that day{pay ? `, ${compact(pay.amount)} of it at ${pay.name}` : ""}.
      </Sub>
    </Big>
  );
}

export function WinSlide({ s }: { s: MonthStory }) {
  const prev = monthLong(s.prevMonth);
  if (s.drop) {
    return (
      <Big colors={SLIDE_COLORS.savings} eyebrow="Your win" icon="trending-down-outline" lead={`${s.drop.name} fell`} value={Math.abs(s.drop.pct)} format={(n) => `${Math.round(n)}%`}>
        <Sub delay={900}>
          {compact(s.drop.now)} against {compact(s.drop.before)} by the same day in {prev}. That's {compact(s.drop.before - s.drop.now)} still with you.
        </Sub>
      </Big>
    );
  }
  return (
    <Big colors={SLIDE_COLORS.savings} eyebrow="Your win" icon="leaf-outline" lead="Days with nothing spent" value={s.quietDays} format={(n) => String(Math.round(n))}>
      <Sub delay={900}>Out of {s.day}. Every quiet day counts.</Sub>
    </Big>
  );
}

export function WatchSlide({ s }: { s: MonthStory }) {
  const prev = monthLong(s.prevMonth);
  const r = s.rise;
  return (
    <Slide colors={SLIDE_COLORS.categories} eyebrow="Keep an eye on">
      <View style={{ flex: 1, justifyContent: "center" }}>
        {r && (
          <>
            <Pop delay={150}>
              <Text style={{ ...H2, color: SOFT }}>{r.name} went up</Text>
            </Pop>
            <Pop delay={300}>
              <Count value={r.pct} format={(n) => `+${Math.round(n)}%`} delay={300} style={{ ...H1, fontSize: 64, lineHeight: 72 }} />
            </Pop>
            <Sub delay={800}>
              {compact(r.now)} against {compact(r.before)} by the same day in {prev}.
            </Sub>
          </>
        )}
        {s.budgetsOver > 0 && <Chip icon="alert-circle-outline" label={`${s.budgetsOver} budget${s.budgetsOver === 1 ? "" : "s"} over`} delay={r ? 1100 : 300} />}
      </View>
    </Slide>
  );
}

/** The last slide: the month's badge and headline. Buttons come from the player. */
export function MonthWrapSlide({ s, headline, children }: { s: MonthStory; headline: string; children?: React.ReactNode }) {
  return (
    <Slide colors={SLIDE_COLORS.wrap} eyebrow={s.isCurrent ? "So far, so good" : "That's a wrap"} confetti>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Pop delay={150}>
          <Float>
            <View style={{ width: 96, height: 96, borderRadius: 32, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center", marginBottom: 22 }}>
              <Ionicons name={s.persona.icon as keyof typeof Ionicons.glyphMap} size={48} color={GOLD} />
            </View>
          </Float>
        </Pop>
        <Pop delay={300}>
          <Text style={{ ...H1, fontSize: 40, lineHeight: 46 }}>{s.persona.label}</Text>
        </Pop>
        <Pop delay={550} style={{ marginTop: 14 }}>
          <Text style={{ color: WHITE, fontSize: 19, lineHeight: 27, fontWeight: "600" }}>{headline}</Text>
        </Pop>
      </View>
      {children}
    </Slide>
  );
}
