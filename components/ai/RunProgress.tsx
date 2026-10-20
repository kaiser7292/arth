import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import Animated, { Easing, FadeOut, Keyframe, LinearTransition, ReduceMotion, useReducedMotion } from "react-native-reanimated";
import { ProgressBar, ScreenContainer, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";

export interface FeedItem {
  id: number;
  text: string;
  ok: boolean;
}

/** One row of the live list at most this often, however fast the work runs. */
const ROW_EVERY_MS = 300;
/** Rows waiting beyond this are skipped so the list stays current. */
const MAX_WAITING = 3;
const ROW_HEIGHT = 40;
const VISIBLE_ROWS = 7;
const ANIMATE = Platform.OS !== "web";

// A short fade while sliding down 8px - no zoom, no bounce. (The checkmark "pop" this list used to
// borrow overshoots past full size, which cut wide rows off at the screen edge.)
const rowIn = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: -8 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: Easing.out(Easing.cubic) },
})
  .duration(200)
  .reduceMotion(ReduceMotion.System);
const rowOut = FadeOut.duration(150).reduceMotion(ReduceMotion.System);
const rowsMove = LinearTransition.duration(220).easing(Easing.out(Easing.cubic)).reduceMotion(ReduceMotion.System);

/**
 * A number that glides to each new value instead of jumping: it covers part of the remaining gap
 * every frame, so bursts of work read as a smooth count. Shows the value at once with reduce
 * motion on.
 */
function useGlide(target: number): number {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    if (reduce) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    const t = setInterval(() => {
      const gap = target - shownRef.current;
      const next = Math.abs(gap) < 0.5 ? target : shownRef.current + gap * 0.2;
      shownRef.current = next;
      setShown(next);
      if (next === target) clearInterval(t);
    }, 40);
    return () => clearInterval(t);
  }, [target, reduce]);
  return shown;
}

function Counter({ label, value, format }: { label: string; value: number; format?: (n: number) => string }) {
  const shown = useGlide(value);
  return (
    <View style={{ width: "50%", padding: 4 }}>
      <View className="rounded-xl bg-card px-3 py-2.5">
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>{label}</Text>
        <Text className="text-xl font-bold text-foreground mt-0.5" numberOfLines={1}>
          {format ? format(shown) : Math.round(shown).toLocaleString("en-IN")}
        </Text>
      </View>
    </View>
  );
}

/**
 * Releases the feed's new items one at a time, at a steady pace, so a burst of work doesn't land
 * five rows at once. When more than a few are waiting, the older ones are skipped.
 */
function usePacedFeed(feed: FeedItem[]): FeedItem[] {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState<FeedItem[]>([]);
  const seen = useRef(new Set<number>());
  const waiting = useRef<FeedItem[]>([]);

  useEffect(() => {
    // `feed` is newest first; queue what's new, oldest first.
    const fresh = feed.filter((f) => !seen.current.has(f.id)).reverse();
    for (const f of fresh) seen.current.add(f.id);
    waiting.current.push(...fresh);
    if (waiting.current.length > MAX_WAITING) waiting.current = waiting.current.slice(-2);
    if (reduce) {
      // No motion wanted: show the latest straight away.
      setShown((prev) => [...waiting.current.reverse(), ...prev].slice(0, VISIBLE_ROWS));
      waiting.current = [];
    }
  }, [feed, reduce]);

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => {
      const next = waiting.current.shift();
      if (next) setShown((prev) => [next, ...prev].slice(0, VISIBLE_ROWS));
    }, ROW_EVERY_MS);
    return () => clearInterval(t);
  }, [reduce]);

  return shown;
}

/**
 * A long wait made watchable: a big percentage and bar, what's happening now, running counters,
 * and a live list of the last few things handled. Showing the work, not just a spinner, is what
 * makes a wait feel worth it (the "labour illusion", Buell & Norton 2011), and past ~10 seconds
 * people need a percentage (Nielsen). Used by AI Assisted Setup while reading and applying a reply,
 * and by onboarding's first read of transaction messages.
 *
 * Motion is kept calm and even however bursty the work is: rows arrive one at a time (at most one
 * every 0.3 s), fade in sliding down a little, and the numbers glide rather than jump.
 */
export function RunProgress({
  title,
  done,
  total,
  doing,
  counters,
  feed,
  fraction,
  standalone,
  footer,
}: {
  title: string;
  done: number;
  /** 0 when the total isn't known yet: the count line is left out. */
  total: number;
  doing: string;
  counters: { label: string; value: number; format?: (n: number) => string }[];
  /** Newest first. */
  feed: FeedItem[];
  /** Overall progress when it isn't simply done / total (a scan with stages). */
  fraction?: number;
  /** A screen of its own with no header above it (onboarding): pads for the status bar. */
  standalone?: boolean;
  footer?: ReactNode;
}) {
  const theme = useTheme();
  const raw = fraction ?? (total > 0 ? done / total : 0);
  // The bar and percentage never go backwards.
  const peak = useRef(0);
  peak.current = Math.max(peak.current, Math.max(0, Math.min(1, raw)));
  const glided = useGlide(peak.current * 100);
  const pct = Math.round(glided);
  const shownDone = useGlide(done);
  const rows = usePacedFeed(feed);

  return (
    <ScreenContainer padTop={!!standalone} safe={standalone ? true : undefined}>
      <View className={`px-5 flex-1 ${standalone ? "pt-8" : "pt-4"}`}>
        <Text className="text-sm font-semibold text-muted-foreground">{title}</Text>
        <View className="flex-row items-baseline mt-2" accessibilityLabel={`${Math.round(peak.current * 100)} percent`}>
          <Text style={{ fontSize: 48, fontWeight: "800", color: theme.foreground, letterSpacing: -1 }}>{pct}%</Text>
          {total > 0 && (
            <Text className="text-sm text-muted-foreground ml-3">
              {Math.round(shownDone).toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
            </Text>
          )}
        </View>
        <ProgressBar value={glided / 100} height={10} className="mt-2" />
        <Text className="text-sm text-muted-foreground mt-2" numberOfLines={1}>
          {doing}…
        </Text>

        <View className="flex-row flex-wrap mt-5" style={{ marginHorizontal: -4 }}>
          {counters.map((c) => (
            <Counter key={c.label} label={c.label} value={c.value} format={c.format} />
          ))}
        </View>

        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-6 mb-2">Just now</Text>
        <View style={{ height: ROW_HEIGHT * VISIBLE_ROWS, overflow: "hidden" }}>
          {rows.map((f) => (
            <Animated.View
              key={f.id}
              entering={ANIMATE ? rowIn : undefined}
              exiting={ANIMATE ? rowOut : undefined}
              layout={ANIMATE ? rowsMove : undefined}
              style={{ height: ROW_HEIGHT }}
              className="flex-row items-center border-b border-border"
            >
              <Ionicons
                name={f.ok ? "checkmark-circle" : "remove-circle-outline"}
                size={16}
                color={f.ok ? theme.success : theme.mutedForeground}
              />
              <Text className="text-sm ml-2 flex-1" style={{ color: f.ok ? theme.foreground : theme.mutedForeground }} numberOfLines={1}>
                {f.text}
              </Text>
            </Animated.View>
          ))}
        </View>
        <View style={{ flex: 1 }} />
        {footer}
      </View>
    </ScreenContainer>
  );
}
