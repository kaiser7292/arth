import { useEffect, useMemo, useState, type ReactNode } from "react";
import { View, type ViewStyle, type StyleProp } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import Svg, { Circle, Path } from "react-native-svg";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Text } from "@/components/ui";
import { formatAmount, formatCompact } from "@/utils/format";
import { monthName, type YearReview } from "@/services/reports/year-review";

/**
 * Year in Review as a story: full-screen slides, each in its own colours, where everything moves
 * in - numbers count up, bars rise, lines draw, bubbles float. The player
 * (app/insights/year-review.tsx) shows one slide at a time and remounts it on arrival, so the
 * motion replays every time a slide comes round. With "Remove animations" on, every slide shows
 * its final state at once.
 *
 * Slide colours are fixed (not the theme): they're the art of the piece and look the same in light
 * and dark mode, with white text on deep colour.
 */

export const SLIDE_COLORS = {
  intro: ["#6B5FD6", "#26215C"],
  savings: ["#14896B", "#04342C"],
  networth: ["#4C8A17", "#173404"],
  categories: ["#B8406B", "#4B1528"],
  merchants: ["#E36A3C", "#712B13"],
  months: ["#2373C4", "#042C53"],
  debt: ["#B06A10", "#412402"],
  invested: ["#1A8A80", "#0C447C"],
  hisaab: ["#C2532A", "#4B1528"],
  vs: ["#4F45B0", "#4B1528"],
  wrap: ["#2E2770", "#0B0B14"],
} as const satisfies Record<string, readonly [string, string]>;

const WHITE = "#FFFFFF";
const SOFT = "rgba(255,255,255,0.78)";

// ── Motion pieces ──

/** Springs in from below: fades up, grows from 85%. */
export function Pop({ delay = 0, children, style }: { delay?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) p.value = withDelay(delay, withSpring(1, { damping: 13, stiffness: 150 }));
  }, [delay, reduce, p]);
  const a = useAnimatedStyle(() => ({
    opacity: Math.min(1, p.value),
    transform: [{ translateY: (1 - p.value) * 26 }, { scale: 0.85 + 0.15 * p.value }],
  }));
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

/** Bobs gently up and down for as long as it's on screen. */
function Float({ children, period = 3200, offset = 0, style }: { children: ReactNode; period?: number; offset?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    y.value = withDelay(
      offset,
      withRepeat(withSequence(withTiming(-7, { duration: period / 2, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: period / 2, easing: Easing.inOut(Easing.sin) })), -1),
    );
  }, [reduce, period, offset, y]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

/** A number that counts up from zero, formatted on every frame. */
function Count({ value, format, delay = 0, style }: { value: number; format: (n: number) => string; delay?: number; style?: object }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  useEffect(() => {
    if (reduce) {
      setShown(value);
      return;
    }
    let frame = 0;
    const duration = 1400;
    const start = setTimeout(() => {
      const t0 = Date.now();
      const tick = () => {
        const t = Math.min(1, (Date.now() - t0) / duration);
        setShown(value * (1 - Math.pow(1 - t, 3)));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, delay);
    // Frames pause in the background; the real value always lands.
    const settle = setTimeout(() => setShown(value), delay + duration + 200);
    return () => {
      clearTimeout(start);
      clearTimeout(settle);
      cancelAnimationFrame(frame);
    };
  }, [value, delay, reduce]);
  return (
    <Text style={style} accessibilityLabel={format(value)}>
      {format(shown)}
    </Text>
  );
}

/** A bar that grows up from the baseline. */
function RiseBar({ height, delay, color, width = "72%" }: { height: number; delay: number; color: string; width?: ViewStyle["width"] }) {
  const reduce = useReducedMotion();
  const h = useSharedValue(reduce ? height : 0);
  useEffect(() => {
    if (!reduce) h.value = withDelay(delay, withSpring(height, { damping: 14, stiffness: 120 }));
  }, [height, delay, reduce, h]);
  const a = useAnimatedStyle(() => ({ height: Math.max(0, h.value) }));
  return <Animated.View style={[{ width, backgroundColor: color, borderTopLeftRadius: 8, borderTopRightRadius: 8 }, a]} />;
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** A line chart that draws itself left to right. */
function DrawLine({ values, color, height = 130 }: { values: number[]; color: string; height?: number }) {
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const p = useSharedValue(reduce ? 1 : 0);
  const { d, len, last } = useMemo(() => {
    if (values.length < 2 || w === 0) return { d: "", len: 0, last: null as { x: number; y: number } | null };
    const min = Math.min(...values);
    const span = Math.max(...values) - min || 1;
    const pts = values.map((v, i) => ({ x: 8 + (i / (values.length - 1)) * (w - 16), y: height - 10 - ((v - min) / span) * (height - 24) }));
    let l = 0;
    for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return { d: pts.map((q, i) => `${i ? "L" : "M"} ${q.x} ${q.y}`).join(" "), len: l, last: pts[pts.length - 1] };
  }, [values, w, height]);
  useEffect(() => {
    if (!reduce && len > 0) p.value = withDelay(400, withTiming(1, { duration: 1800, easing: Easing.out(Easing.cubic) }));
  }, [len, reduce, p]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: len * (1 - p.value) }));
  const dot = useAnimatedProps(() => ({ r: p.value > 0.97 ? 6 : 0 }));
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height }}>
      {w > 0 && d ? (
        <Svg width={w} height={height}>
          <AnimatedPath d={d} stroke={color} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${len} ${len}`} animatedProps={props} />
          {last && <AnimatedCircle cx={last.x} cy={last.y} fill={WHITE} animatedProps={dot} />}
        </Svg>
      ) : null}
    </View>
  );
}

/** A ring that fills to `pct`. */
function Ring({ pct, size = 200, color, children }: { pct: number; size?: number; color: string; children?: ReactNode }) {
  const reduce = useReducedMotion();
  const target = Math.max(0, Math.min(1, pct / 100));
  const p = useSharedValue(reduce ? target : 0);
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  useEffect(() => {
    if (!reduce) p.value = withDelay(300, withTiming(target, { duration: 1600, easing: Easing.out(Easing.cubic) }));
  }, [target, reduce, p]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - p.value) }));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.18)" strokeWidth={16} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={16}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          animatedProps={props}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

const CONFETTI = ["#FAC775", "#9FE1CB", "#F4C0D1", "#B5D4F4", "#FFFFFF", "#F0997B"];

/** Bits of confetti drifting down behind the content. */
export function Confetti({ count = 22 }: { count?: number }) {
  const reduce = useReducedMotion();
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: `${(i * 37) % 100}%` as const,
        color: CONFETTI[i % CONFETTI.length],
        delay: (i * 260) % 3000,
        duration: 4200 + ((i * 530) % 2600),
        size: 6 + (i % 3) * 3,
        round: i % 2 === 0,
      })),
    [count],
  );
  if (reduce) return null;
  return (
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden" }}>
      {pieces.map((p, i) => (
        <Piece key={i} {...p} />
      ))}
    </View>
  );
}

function Piece({ left, color, delay, duration, size, round }: { left: `${number}%`; color: string; delay: number; duration: number; size: number; round: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1));
  }, [delay, duration, t]);
  const a = useAnimatedStyle(() => ({
    opacity: t.value > 0 ? 0.85 : 0,
    transform: [{ translateY: -30 + t.value * 900 }, { translateX: Math.sin(t.value * 12) * 14 }, { rotate: `${t.value * 720}deg` }],
  }));
  return <Animated.View style={[{ position: "absolute", top: 0, left, width: size, height: round ? size : size * 1.8, borderRadius: round ? size : 2, backgroundColor: color }, a]} />;
}

// ── Slide frame ──

export function Slide({ colors, eyebrow, children, confetti }: { colors: readonly [string, string]; eyebrow: string; children: ReactNode; confetti?: boolean }) {
  // Room on top for the player's progress bars and buttons.
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }} style={{ flex: 1 }}>
      {confetti && <Confetti />}
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: insets.top + 80, paddingBottom: insets.bottom + 28 }}>
        <Pop>
          <Text style={{ color: SOFT, fontSize: 12, fontWeight: "700", letterSpacing: 1.6, textTransform: "uppercase" }}>{eyebrow}</Text>
        </Pop>
        {children}
      </View>
    </LinearGradient>
  );
}

const H1 = { color: WHITE, fontSize: 46, fontWeight: "800" as const, lineHeight: 52, letterSpacing: -1 };
const H2 = { color: WHITE, fontSize: 28, fontWeight: "800" as const, lineHeight: 34, letterSpacing: -0.5 };
const BODY = { color: SOFT, fontSize: 15, lineHeight: 22 };

function Headline({ children, delay = 150 }: { children: ReactNode; delay?: number }) {
  return (
    <Pop delay={delay} style={{ marginTop: 10 }}>
      <Text style={H2}>{children}</Text>
    </Pop>
  );
}

function Sub({ children, delay = 350 }: { children: ReactNode; delay?: number }) {
  return (
    <Pop delay={delay} style={{ marginTop: 8 }}>
      <Text style={BODY}>{children}</Text>
    </Pop>
  );
}

/** A frosted pill for a small fact. */
function Chip({ icon, label, delay }: { icon: keyof typeof Ionicons.glyphMap; label: string; delay: number }) {
  return (
    <Pop delay={delay}>
      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, marginTop: 10, alignSelf: "flex-start" }}>
        <Ionicons name={icon} size={16} color={WHITE} />
        <Text style={{ color: WHITE, fontSize: 14, fontWeight: "600", marginLeft: 8 }}>{label}</Text>
      </View>
    </Pop>
  );
}

const compact = (n: number) => formatCompact(Math.round(n));
const whole = (n: number) => Math.round(n).toLocaleString("en-IN");
const days = (r: YearReview) => Math.max(1, Math.round((Date.parse(r.endDate) - Date.parse(r.startDate)) / 86400000) + 1);

// ── Slides ──

export function IntroSlide({ r }: { r: YearReview }) {
  const smsPct = r.totals.txCount > 0 ? Math.round((r.totals.smsCount / r.totals.txCount) * 100) : 0;
  return (
    <Slide colors={SLIDE_COLORS.intro} eyebrow={`${r.fyLabel} · ${r.isComplete ? "your year" : "your year so far"}`} confetti>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Pop delay={150}>
          <Text style={{ ...H2, color: SOFT }}>This year you spent</Text>
        </Pop>
        <Pop delay={300} style={{ marginTop: 6 }}>
          <Count value={r.totals.spent} format={compact} delay={300} style={{ ...H1, fontSize: 64, lineHeight: 72 }} />
        </Pop>
        <Chip icon="receipt-outline" label={`${whole(r.totals.txCount)} transactions`} delay={900} />
        {r.totals.moneyIn > 0 && <Chip icon="arrow-down-circle-outline" label={`${compact(r.totals.moneyIn)} came in`} delay={1100} />}
        {smsPct > 0 && <Chip icon="sparkles-outline" label={`${smsPct}% picked up by Arth on its own`} delay={1300} />}
      </View>
      <Pop delay={1700}>
        <Text style={{ ...BODY, textAlign: "center" }}>
          {monthName(r.startDate.slice(0, 7))} to {monthName(r.endDate.slice(0, 7))}. Let's look back.
        </Text>
      </Pop>
    </Slide>
  );
}

export function SavingsSlide({ r }: { r: YearReview }) {
  const s = r.savings!;
  const rate = Math.max(0, s.ratePct);
  const beat = s.targetPct != null ? Math.round(s.ratePct - s.targetPct) : null;
  const change = s.prevRatePct != null ? Math.round(s.ratePct - s.prevRatePct) : null;
  return (
    <Slide colors={SLIDE_COLORS.savings} eyebrow="Savings">
      <Headline>{rate >= 30 ? "You're a saver" : rate > 0 ? "Something put aside" : "A spending year"}</Headline>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Ring pct={rate} size={230} color="#9FE1CB">
          <Count value={rate} format={(n) => `${Math.round(n)}%`} delay={300} style={{ ...H1, fontSize: 56 }} />
          <Text style={{ ...BODY, fontSize: 13 }}>saved</Text>
        </Ring>
      </View>
      <Sub delay={900}>
        {formatAmount(s.saved)} kept {s.source === "plan" ? "out of your income, going by your yearly plan" : "out of everything that came in"}.
      </Sub>
      {beat != null && <Chip icon={beat >= 0 ? "trophy-outline" : "flag-outline"} label={beat >= 0 ? `Beat your ${Math.round(s.targetPct!)}% target by ${beat} pts` : `${-beat} pts short of your ${Math.round(s.targetPct!)}% target`} delay={1200} />}
      {change != null && <Chip icon={change >= 0 ? "trending-up-outline" : "trending-down-outline"} label={`${change >= 0 ? "+" : ""}${change} pts on last year`} delay={1400} />}
    </Slide>
  );
}

export function NetWorthSlide({ r }: { r: YearReview }) {
  const nw = r.netWorth!;
  const up = nw.change >= 0;
  return (
    <Slide colors={SLIDE_COLORS.networth} eyebrow="Net worth">
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Pop delay={150}>
          <Text style={{ ...H2, color: SOFT }}>{up ? "You grew by" : "It slipped by"}</Text>
        </Pop>
        <Pop delay={250}>
          <Count value={Math.abs(nw.change)} format={(n) => `${up ? "+" : "−"}${compact(n)}`} delay={250} style={{ ...H1, fontSize: 60, lineHeight: 68 }} />
        </Pop>
        <Sub delay={500}>
          From {formatAmount(nw.start)} to {formatAmount(nw.end)}.
        </Sub>
        <View style={{ marginTop: 28 }}>
          <DrawLine values={nw.points.map((p) => p.netWorth)} color={up ? "#C0DD97" : "#F7C1C1"} height={150} />
        </View>
      </View>
    </Slide>
  );
}

const BUBBLE_TINTS = [
  { bg: "#FFE3EC", fg: "#72243E" },
  { bg: "#F4C0D1", fg: "#72243E" },
  { bg: "#FBEAF0", fg: "#4B1528" },
  { bg: "#ED93B1", fg: "#4B1528" },
  { bg: "#FCD9C9", fg: "#712B13" },
];
/** Where each bubble sits, as fractions of the area (centre x, centre y). Biggest first. */
const BUBBLE_SPOTS = [
  [0.3, 0.3],
  [0.74, 0.24],
  [0.68, 0.66],
  [0.26, 0.74],
  [0.5, 0.5],
];

export function CategoriesSlide({ r }: { r: YearReview }) {
  const top = r.categories.slice(0, 5);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const lead = top[0];
  return (
    <Slide colors={SLIDE_COLORS.categories} eyebrow="Where it went">
      <Headline>{lead ? `${lead.name} led the way` : "Where it went"}</Headline>
      {lead && <Sub>{Math.round(lead.pct)}% of everything you spent went here.</Sub>}
      <View style={{ flex: 1, marginTop: 12 }} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {box &&
          top.map((c, i) => {
            const base = Math.min(box.w, box.h);
            const size = Math.max(70, Math.min(base * 0.52, base * 0.62 * Math.sqrt(c.pct / Math.max(1, top[0].pct))));
            const [fx, fy] = BUBBLE_SPOTS[i];
            const left = Math.max(0, Math.min(box.w - size, fx * box.w - size / 2));
            const topPx = Math.max(0, Math.min(box.h - size, fy * box.h - size / 2));
            const tint = BUBBLE_TINTS[i];
            return (
              <Pop key={c.name} delay={400 + i * 160} style={{ position: "absolute", left, top: topPx }}>
                <Float period={2800 + i * 500} offset={i * 300}>
                  <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint.bg, alignItems: "center", justifyContent: "center", padding: 8 }}>
                    <Text style={{ color: tint.fg, fontSize: size > 120 ? 16 : 12, fontWeight: "800", textAlign: "center" }} numberOfLines={2}>
                      {c.name}
                    </Text>
                    <Text style={{ color: tint.fg, fontSize: size > 120 ? 14 : 11, fontWeight: "600", opacity: 0.8 }}>{Math.round(c.pct)}%</Text>
                  </View>
                </Float>
              </Pop>
            );
          })}
      </View>
    </Slide>
  );
}

export function MerchantsSlide({ r }: { r: YearReview }) {
  const list = (r.merchants.byVisits.length > 0 ? r.merchants.byVisits : r.merchants.bySpend).slice(0, 5);
  const [first, second, third] = list;
  const every = first && first.count > 1 ? days(r) / first.count : null;
  // Podium order: 2nd, 1st, 3rd - the winner in the middle, tallest.
  const podium = [
    second && { m: second, place: 2, h: 120, delay: 350 },
    first && { m: first, place: 1, h: 170, delay: 0 },
    third && { m: third, place: 3, h: 90, delay: 700 },
  ].filter(Boolean) as { m: (typeof list)[number]; place: number; h: number; delay: number }[];
  return (
    <Slide colors={SLIDE_COLORS.merchants} eyebrow="Your favourite merchants">
      <Headline>{first ? `${first.name} was your go-to` : "Your favourite merchants"}</Headline>
      {first && (
        <Sub>
          {first.count} {first.count === 1 ? "visit" : "visits"}
          {every != null ? `, about one every ${every < 1.5 ? "day" : `${Math.round(every)} days`}` : ""}. {formatAmount(first.amount)} in all.
        </Sub>
      )}
      <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 10 }}>
        {podium.map(({ m, place, h, delay }) => (
          <View key={m.name} style={{ flex: 1, alignItems: "center", maxWidth: 120 }}>
            {place === 1 && (
              <Pop delay={900}>
                <Float period={2400}>
                  <Ionicons name="trophy" size={30} color="#FAC775" />
                </Float>
              </Pop>
            )}
            <Pop delay={delay + 500}>
              <Text style={{ color: WHITE, fontSize: 14, fontWeight: "800", textAlign: "center" }} numberOfLines={2}>
                {m.name}
              </Text>
            </Pop>
            <Pop delay={delay + 600} style={{ marginBottom: 8 }}>
              <Text style={{ color: SOFT, fontSize: 12, textAlign: "center" }}>
                {m.count} {m.count === 1 ? "visit" : "visits"}
              </Text>
            </Pop>
            <RiseBar height={h} delay={delay} width="100%" color={place === 1 ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)"} />
            <View style={{ position: "absolute", bottom: h - 44, alignItems: "center" }} pointerEvents="none">
              <Pop delay={delay + 400}>
                <Text style={{ color: "#712B13", fontSize: 30, fontWeight: "900" }}>{place}</Text>
              </Pop>
            </View>
          </View>
        ))}
      </View>
      {list.slice(3).map((m, i) => (
        <Pop key={m.name} delay={1200 + i * 150}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginTop: 8 }}>
            <Text style={{ color: WHITE, fontSize: 14, fontWeight: "600" }} numberOfLines={1}>
              {i + 4}. {m.name}
            </Text>
            <Text style={{ color: SOFT, fontSize: 13 }}>
              {m.count} {m.count === 1 ? "visit" : "visits"}
            </Text>
          </View>
        </Pop>
      ))}
    </Slide>
  );
}

export function MonthsSlide({ r }: { r: YearReview }) {
  const big = r.biggestMonth!;
  const max = Math.max(1, ...r.months.map((m) => m.total));
  const [h, setH] = useState(0);
  return (
    <Slide colors={SLIDE_COLORS.months} eyebrow="Month by month">
      <Headline>{monthName(big.month)} went big</Headline>
      <Sub>
        {formatAmount(big.total)} that month.
        {r.quietestMonth ? ` ${monthName(r.quietestMonth.month)} was the calmest at ${formatAmount(r.quietestMonth.total)}.` : ""}
      </Sub>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", marginTop: 20 }} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
        {h > 0 &&
          r.months.map((m, i) => {
            const isBig = m.month === big.month;
            return (
              <View key={m.month} style={{ flex: 1, alignItems: "center" }}>
                {isBig && (
                  <Pop delay={300 + i * 70 + 500}>
                    <Text style={{ color: "#FAC775", fontSize: 11, fontWeight: "800", marginBottom: 4 }}>{compact(m.total)}</Text>
                  </Pop>
                )}
                <RiseBar height={Math.max(4, (m.total / max) * (h - 44))} delay={300 + i * 70} color={isBig ? "#FAC775" : "rgba(255,255,255,0.6)"} />
                <Text style={{ color: SOFT, fontSize: 11, marginTop: 6 }}>{monthName(m.month).slice(0, 1)}</Text>
              </View>
            );
          })}
      </View>
    </Slide>
  );
}

/** One big number with an icon floating above it - loans, investing, hisaab. */
function BigNumberSlide({
  colors,
  eyebrow,
  icon,
  lead,
  value,
  sign = "",
  children,
}: {
  colors: readonly [string, string];
  eyebrow: string;
  icon: keyof typeof Ionicons.glyphMap;
  lead: string;
  value: number;
  sign?: string;
  children?: ReactNode;
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
          <Count value={value} format={(n) => `${sign}${compact(n)}`} delay={350} style={{ ...H1, fontSize: 60, lineHeight: 68 }} />
        </Pop>
        {children}
      </View>
    </Slide>
  );
}

export function DebtSlide({ r }: { r: YearReview }) {
  const d = r.debt!;
  const down = d.reduced >= 0;
  return (
    <BigNumberSlide colors={SLIDE_COLORS.debt} eyebrow="Loans" icon={down ? "flame-outline" : "cash-outline"} lead={down ? "Debt paid off" : "Borrowed this year"} value={Math.abs(d.reduced)}>
      <Sub delay={700}>
        Loans went from {formatAmount(d.start)} to {formatAmount(d.end)}.
      </Sub>
    </BigNumberSlide>
  );
}

export function InvestedSlide({ r }: { r: YearReview }) {
  const inv = r.invested!;
  return (
    <BigNumberSlide colors={SLIDE_COLORS.invested} eyebrow="Investing" icon="leaf-outline" lead="Put to work" value={inv.amount}>
      <Sub delay={700}>Money you moved into investments, FDs and pension.</Sub>
      {inv.fdsOpened > 0 && <Chip icon="lock-closed-outline" label={`${inv.fdsOpened} fixed deposit${inv.fdsOpened === 1 ? "" : "s"} opened`} delay={1000} />}
    </BigNumberSlide>
  );
}

export function HisaabSlide({ r }: { r: YearReview }) {
  const h = r.hisaab!;
  return (
    <BigNumberSlide colors={SLIDE_COLORS.hisaab} eyebrow="Hisaab" icon="people-outline" lead={h.peopleSettled > 0 ? `Settled with ${h.peopleSettled} ${h.peopleSettled === 1 ? "person" : "people"}` : "Settled up"} value={h.settledAmount}>
      <Sub delay={700}>
        {h.netAtEnd > 0 ? `People owed you ${formatAmount(h.netAtEnd)} at year end.` : h.netAtEnd < 0 ? `You owed ${formatAmount(-h.netAtEnd)} at year end.` : "All square at year end."}
      </Sub>
    </BigNumberSlide>
  );
}

export function VsLastYearSlide({ r }: { r: YearReview }) {
  const v = r.vsLastYear!;
  const pct = v.spentChangePct;
  return (
    <Slide colors={SLIDE_COLORS.vs} eyebrow={r.isComplete ? "Vs last year" : "Vs the same point last year"}>
      <Headline>{pct == null ? "Compared with last year" : `Spending ${pct >= 0 ? "up" : "down"} ${Math.abs(Math.round(pct))}%`}</Headline>
      <Sub>{formatAmount(v.spentPrev)} last year. What moved the most:</Sub>
      <View style={{ flex: 1, justifyContent: "center" }}>
        {v.changes.slice(0, 5).map((c, i) => {
          const better = c.curr <= c.prev;
          return (
            <Pop key={c.name} delay={500 + i * 180}>
              <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10 }}>
                <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: better ? "#9FE1CB" : "#F7C1C1" }}>
                  <Ionicons name={better ? "arrow-down" : "arrow-up"} size={16} color={better ? "#04342C" : "#501313"} />
                </View>
                <Text style={{ color: WHITE, fontSize: 15, fontWeight: "600", flex: 1, marginLeft: 12 }} numberOfLines={1}>
                  {c.name}
                </Text>
                <Text style={{ color: WHITE, fontSize: 15, fontWeight: "800" }}>
                  {c.changePct == null ? `new · ${compact(c.curr)}` : `${c.changePct > 0 ? "+" : ""}${Math.round(c.changePct)}%`}
                </Text>
              </View>
            </Pop>
          );
        })}
      </View>
    </Slide>
  );
}

/** Shown when there's nothing for the year yet. */
export function EmptySlide({ fyLabel }: { fyLabel: string }) {
  return (
    <Slide colors={SLIDE_COLORS.intro} eyebrow="Year in review">
      <Headline>Nothing for {fyLabel} yet</Headline>
      <Sub>Once there's spending recorded for this year, your story shows up here.</Sub>
    </Slide>
  );
}
