import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StatusBar, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Button, Text } from "@/components/ui";
import { Pop, SLIDE_COLORS } from "@/components/year-review/StoryCards";
import { BigDaySlide, IntroMonthSlide, MonthWrapSlide, PaceSlide, PlaceSlide, WatchSlide, WinSlide } from "@/components/month-story/MonthSlides";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { savedHeadline } from "@/services/ai/tasks/month-note";
import { loadMonthStory, monthLong, plainHeadline, prevYm, storyFacts, ymOf, type MonthStory } from "@/services/month-story";
import { isAmountsHidden } from "@/services/privacy-mode";

/** How long each slide plays before moving on. */
const SLIDE_MS = 6000;

/** A month from the link, or last month. Never a month still to come. */
function startMonth(param: string | undefined): string {
  const now = ymOf(new Date());
  return param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param) && param <= now ? param : prevYm(now);
}

/**
 * A month told as a story: full-screen slides like Year in Review (app/insights/year-review.tsx),
 * from services/month-story.ts. Tap right for the next slide, left for the one before, hold to
 * pause. The last slide waits. Opened from the "Your month" card at the top of Insights.
 */
export default function MonthStoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ month?: string }>();
  const [month, setMonth] = useState(() => startMonth(params.month));
  const [story, setStory] = useState<MonthStory | null>(null);
  const [headline, setHeadline] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const loadSeq = useRef(0);
  const [page, setPage] = useState(0);
  /** Bumped on every arrival so a slide's motion replays, even on the same index. */
  const [visit, setVisit] = useState(0);
  const [paused, setPaused] = useState(false);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setFailed(false);
    try {
      const s = await loadMonthStory(month);
      if (seq !== loadSeq.current) return;
      // The AI headline only when amounts show (it carries numbers) and it was written for these facts.
      const ai = !isAmountsHidden() && s.payments > 0 ? (await savedHeadline(month, storyFacts(s)).catch(() => undefined))?.headline ?? null : null;
      if (seq !== loadSeq.current) return;
      setStory(s);
      setHeadline(ai ?? plainHeadline(s));
    } catch {
      if (seq === loadSeq.current) setFailed(true);
    }
  }, [month]);
  useDataRefresh(load);

  // Slides with nothing to say are left out.
  const slides = useMemo(() => {
    if (!story || story.payments === 0) return [];
    const s = story;
    const out: { key: string; node: React.ReactNode }[] = [{ key: "intro", node: <IntroMonthSlide s={s} /> }];
    if (s.prevTotal > 0) out.push({ key: "pace", node: <PaceSlide s={s} /> });
    if (s.topPlace) out.push({ key: "place", node: <PlaceSlide s={s} /> });
    if (s.biggestDay && s.payments > 1) out.push({ key: "day", node: <BigDaySlide s={s} /> });
    if (s.drop || s.quietDays > 0) out.push({ key: "win", node: <WinSlide s={s} /> });
    if (s.rise || s.budgetsOver > 0) out.push({ key: "watch", node: <WatchSlide s={s} /> });
    out.push({ key: "wrap", node: null });
    return out;
  }, [story]);
  const last = slides.length - 1;
  const onWrap = slides.length > 0 && page >= last;

  // ── Playback ──
  const progress = useSharedValue(0);
  const goTo = useCallback(
    (i: number) => {
      if (slides.length === 0) return;
      setPage(Math.max(0, Math.min(last, i)));
      setVisit((v) => v + 1);
      setPaused(false);
      Haptics.selectionAsync().catch(() => {});
    },
    [last, slides.length],
  );
  const advance = useCallback(() => goTo(page + 1), [goTo, page]);
  const run = useCallback(
    (from: number) => {
      if (onWrap) {
        progress.value = 1;
        return;
      }
      progress.value = from;
      progress.value = withTiming(1, { duration: (1 - from) * SLIDE_MS, easing: Easing.linear }, (done) => {
        if (done) runOnJS(advance)();
      });
    },
    [onWrap, progress, advance],
  );
  useEffect(() => {
    if (slides.length === 0) return;
    run(0);
    return () => cancelAnimation(progress);
    // A new arrival (visit) restarts the bar; pausing is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit, slides.length]);
  useEffect(() => {
    if (slides.length === 0) return;
    if (paused) cancelAnimation(progress);
    else if (progress.value < 1) run(progress.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  const pick = (m: string) => {
    if (m === month) return;
    setMonth(m);
    setStory(null);
    setPage(0);
    setVisit((v) => v + 1);
  };
  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const thisMonth = ymOf(new Date());
  const choices = [prevYm(thisMonth), thisMonth];

  const topBar = (
    <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0, paddingTop: insets.top + 8, paddingHorizontal: 12 }}>
      {slides.length > 0 && (
        <View style={{ flexDirection: "row", gap: 4 }} accessibilityLabel={`Slide ${page + 1} of ${slides.length}`}>
          {slides.map((s, i) => (
            <Bar key={s.key} state={i < page ? "done" : i > page ? "todo" : "now"} progress={progress} />
          ))}
        </View>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10, gap: 6 }} pointerEvents="box-none">
        {(choices.includes(month) ? choices : [month, ...choices]).map((m) => {
          const active = m === month;
          return (
            <Pressable
              key={m}
              onPress={() => pick(m)}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.16)" }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={{ color: active ? "#1B1640" : "#FFFFFF", fontSize: 12, fontWeight: "700" }}>{m === thisMonth ? `${monthLong(m)} so far` : monthLong(m)}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={close}
          hitSlop={8}
          style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", marginLeft: "auto", backgroundColor: "rgba(255,255,255,0.16)" }}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={19} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );

  if (failed || !story) {
    return (
      <LinearGradient colors={SLIDE_COLORS.intro} style={{ flex: 1 }}>
        <StatusBar barStyle="light-content" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
          {failed ? (
            <>
              <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "700", textAlign: "center" }}>Couldn't put your month together</Text>
              <View style={{ marginTop: 16, width: 160 }}>
                <Button title="Try again" onPress={() => void load()} />
              </View>
            </>
          ) : (
            <>
              <ActivityIndicator color="#FFFFFF" size="large" />
              <Text style={{ color: "rgba(255,255,255,0.8)", marginTop: 14, fontSize: 15 }}>Putting your month together…</Text>
            </>
          )}
        </View>
        {topBar}
      </LinearGradient>
    );
  }

  if (slides.length === 0) {
    return (
      <LinearGradient colors={SLIDE_COLORS.intro} style={{ flex: 1 }}>
        <StatusBar barStyle="light-content" />
        <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 28 }}>
          <Text style={{ color: "#FFFFFF", fontSize: 28, fontWeight: "800" }}>Nothing spent in {monthLong(month)}</Text>
          <Text style={{ color: "rgba(255,255,255,0.78)", fontSize: 15, marginTop: 8 }}>{month === thisMonth ? "A clean slate. Come back once the month gets going." : "No approved spending that month."}</Text>
        </View>
        {topBar}
      </LinearGradient>
    );
  }

  const current = slides[Math.min(page, last)];
  return (
    <View style={{ flex: 1, backgroundColor: "#0B0B14" }}>
      <StatusBar barStyle="light-content" />
      <View key={`${month}-${current.key}-${visit}`} style={{ flex: 1 }}>
        {current.key === "wrap" ? (
          <MonthWrapSlide s={story} headline={headline ?? plainHeadline(story)}>
            <Pop delay={900}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button title="Watch again" variant="outline" onPress={() => goTo(0)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Done" onPress={close} />
                </View>
              </View>
            </Pop>
          </MonthWrapSlide>
        ) : (
          current.node
        )}
      </View>

      {/* Left third goes back, the rest forward; hold to pause. On the last slide only a thin left
          edge is a zone, so its buttons stay tappable. */}
      <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + 64, bottom: onWrap ? 120 : 0, left: 0, right: 0, flexDirection: "row" }}>
        <Pressable
          style={{ width: onWrap ? 28 : "33%" }}
          onPress={() => goTo(page - 1)}
          onLongPress={() => setPaused(true)}
          onPressOut={() => setPaused(false)}
          delayLongPress={220}
          accessibilityRole="button"
          accessibilityLabel="Previous slide"
        />
        {!onWrap && (
          <Pressable
            style={{ flex: 1 }}
            onPress={() => goTo(page + 1)}
            onLongPress={() => setPaused(true)}
            onPressOut={() => setPaused(false)}
            delayLongPress={220}
            accessibilityRole="button"
            accessibilityLabel="Next slide"
          />
        )}
      </View>

      {paused && (
        <View pointerEvents="none" style={{ position: "absolute", bottom: insets.bottom + 24, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 }}>
          <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "700" }}>Paused</Text>
        </View>
      )}
      {topBar}
    </View>
  );
}

function Bar({ state, progress }: { state: "done" | "now" | "todo"; progress: { value: number } }) {
  const a = useAnimatedStyle(() => ({ width: `${(state === "done" ? 1 : state === "todo" ? 0 : progress.value) * 100}%` }));
  return (
    <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)", overflow: "hidden" }}>
      <Animated.View style={[{ height: "100%", backgroundColor: "#FFFFFF" }, a]} />
    </View>
  );
}
