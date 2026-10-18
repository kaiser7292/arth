import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StatusBar, Switch, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import { captureRef } from "react-native-view-shot";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Button, Text } from "@/components/ui";
import { ShareCard } from "@/components/year-review/ShareCard";
import {
  CategoriesSlide,
  Confetti,
  DebtSlide,
  EmptySlide,
  HisaabSlide,
  IntroSlide,
  InvestedSlide,
  MerchantsSlide,
  MonthsSlide,
  NetWorthSlide,
  Pop,
  SavingsSlide,
  SLIDE_COLORS,
  VsLastYearSlide,
} from "@/components/year-review/StoryCards";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { exportYearReviewPDF, sharePDF } from "@/services/reports/report-pdf-export";
import { buildShareLines, getReviewableFYs, getYearReview, type YearReview } from "@/services/reports/year-review";
import { getFYStartMonth } from "@/services/settings";
import { settingsStorage } from "@/services/storage";
import { getCurrentFY, getFYLabel } from "@/utils/fiscal-year";
import { formatAmount } from "@/utils/format";
import { logger } from "@/utils/logger";

/** How long each slide plays before moving on. */
const SLIDE_MS = 7000;
const MUSIC_KEY = "year_review_music";
const MUSIC = require("../../assets/audio/year-review-loop.wav");

/**
 * Year in Review, told as a story: full-screen slides that play one after another with progress
 * bars on top. Tap the right side for the next slide, the left for the one before, hold anywhere
 * to pause. The last slide is the share card and waits for you.
 *
 * Background music (an original loop made for Arth - scripts/make-year-review-music.py) plays
 * once you turn it on with the speaker button; the choice is remembered. It stops when you leave.
 */
export default function YearReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ fy?: string }>();
  const startMonth = getFYStartMonth();
  const [fy, setFy] = useState<number>(() => {
    const p = Number(params.fy);
    return Number.isFinite(p) && p > 0 ? p : getCurrentFY(startMonth) - 1;
  });
  const [fys, setFys] = useState<number[]>([]);
  const [review, setReview] = useState<YearReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const loadSeq = useRef(0);
  const [page, setPage] = useState(0);
  /** Bumped on every arrival so a slide's motion replays even when it's the same index. */
  const [visit, setVisit] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hideAmounts, setHideAmounts] = useState(true);
  const [sharing, setSharing] = useState<"image" | "pdf" | null>(null);
  const shareRef = useRef<View>(null);

  // ── Data ──
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setFailed(false);
    try {
      const [list, r] = await Promise.all([getReviewableFYs(DEFAULT_USER_ID), getYearReview(DEFAULT_USER_ID, fy)]);
      if (seq !== loadSeq.current) return; // a newer year is already loading
      setFys(list.includes(fy) ? list : [fy, ...list].sort((a, b) => b - a));
      setReview(r);
    } catch {
      if (seq === loadSeq.current) setFailed(true);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [fy]);
  // Cached by data version inside getYearReview, so coming back with nothing changed is instant.
  useDataRefresh(load);

  // Slides with nothing to say are left out (no loans → no loans slide).
  const slides = useMemo(() => {
    if (!review || review.totals.txCount === 0) return [];
    const r = review;
    const out: { key: string; colors: readonly [string, string]; node: React.ReactNode }[] = [];
    const add = (key: keyof typeof SLIDE_COLORS, node: React.ReactNode) => out.push({ key, colors: SLIDE_COLORS[key], node });
    add("intro", <IntroSlide r={r} />);
    if (r.savings) add("savings", <SavingsSlide r={r} />);
    if (r.categories.length > 0) add("categories", <CategoriesSlide r={r} />);
    if (r.merchants.bySpend.length > 0 || r.merchants.byVisits.length > 0) add("merchants", <MerchantsSlide r={r} />);
    if (r.biggestMonth) add("months", <MonthsSlide r={r} />);
    if (r.netWorth) add("networth", <NetWorthSlide r={r} />);
    if (r.debt && r.debt.reduced !== 0) add("debt", <DebtSlide r={r} />);
    if (r.invested && r.invested.amount > 0) add("invested", <InvestedSlide r={r} />);
    if (r.hisaab && (r.hisaab.settledAmount > 0 || r.hisaab.netAtEnd !== 0)) add("hisaab", <HisaabSlide r={r} />);
    if (r.vsLastYear && r.vsLastYear.changes.length > 0) add("vs", <VsLastYearSlide r={r} />);
    add("wrap", null);
    return out;
  }, [review]);
  const last = slides.length - 1;
  const onShareSlide = page === last && slides.length > 0;

  const shareLines = useMemo(() => (review ? buildShareLines(review, hideAmounts, formatAmount) : []), [review, hideAmounts]);

  // ── Playback ──
  const progress = useSharedValue(0);
  const goTo = useCallback(
    (i: number) => {
      if (slides.length === 0) return;
      const next = Math.max(0, Math.min(last, i));
      setPage(next);
      setVisit((v) => v + 1);
      setPaused(false);
      Haptics.selectionAsync().catch(() => {});
    },
    [last, slides.length],
  );
  const advance = useCallback(() => goTo(page + 1), [goTo, page]);

  // Run the current slide's bar; at the end, move on (the share slide waits).
  const run = useCallback(
    (from: number) => {
      if (onShareSlide) {
        progress.value = 1;
        return;
      }
      progress.value = from;
      progress.value = withTiming(1, { duration: (1 - from) * SLIDE_MS, easing: Easing.linear }, (done) => {
        if (done) runOnJS(advance)();
      });
    },
    [onShareSlide, progress, advance],
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

  const pickFy = (next: number) => {
    if (next === fy) return;
    setFy(next);
    setPage(0);
    setVisit((v) => v + 1);
  };

  // ── Music ──
  const [musicOn, setMusicOn] = useState(() => settingsStorage.getBoolean(MUSIC_KEY) ?? false);
  const [focused, setFocused] = useState(true);
  const player = useAudioPlayer(MUSIC);
  useEffect(() => {
    player.loop = true;
    player.volume = 0.6;
    setAudioModeAsync({ playsInSilentMode: false, shouldPlayInBackground: false, interruptionMode: "mixWithOthers" }).catch(() => {});
  }, [player]);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    try {
      if (musicOn && focused && slides.length > 0) player.play();
      else player.pause();
    } catch {
      // The player may already be released while leaving the screen.
    }
  }, [musicOn, focused, slides.length, player]);
  const toggleMusic = () => {
    const next = !musicOn;
    setMusicOn(next);
    settingsStorage.set(MUSIC_KEY, next);
  };

  // ── Sharing ──
  const shareImage = async () => {
    if (!shareRef.current) return;
    setSharing("image");
    try {
      const uri = await captureRef(shareRef, { format: "png", quality: 1, result: "tmpfile" });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Share your year" });
      }
    } catch (e) {
      logger.warn("Year review image share failed:", e);
      Alert.alert("Couldn't share", "Something went wrong making the image. Try the PDF instead.");
    } finally {
      setSharing(null);
    }
  };
  const sharePdf = async () => {
    if (!review) return;
    setSharing("pdf");
    try {
      const uri = await exportYearReviewPDF(review, hideAmounts);
      await sharePDF(uri);
    } catch (e) {
      logger.warn("Year review PDF share failed:", e);
      Alert.alert("Couldn't share", "Something went wrong making the PDF.");
    } finally {
      setSharing(null);
    }
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  // ── Top bar: progress, year, music, close ──
  const topBar = (
    <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0, paddingTop: insets.top + 8, paddingHorizontal: 12 }}>
      {slides.length > 0 && (
        <View style={{ flexDirection: "row", gap: 4 }} accessibilityLabel={`Slide ${page + 1} of ${slides.length}`}>
          {slides.map((s, i) => (
            <ProgressBar key={s.key} state={i < page ? "done" : i > page ? "todo" : "now"} progress={progress} />
          ))}
        </View>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10 }} pointerEvents="box-none">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 6 }}>
          {(fys.length > 1 ? fys : [fy]).map((y) => {
            const active = y === fy;
            return (
              <Pressable
                key={y}
                onPress={() => pickFy(y)}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.16)" }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={{ color: active ? "#1B1640" : "#FFFFFF", fontSize: 12, fontWeight: "700" }}>
                  {y === getCurrentFY(startMonth) ? `${getFYLabel(y, startMonth)} so far` : getFYLabel(y, startMonth)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <RoundButton icon={musicOn ? "volume-high" : "volume-mute"} label={musicOn ? "Turn music off" : "Turn music on"} onPress={toggleMusic} glow={!musicOn && page === 0} />
        <RoundButton icon="close" label="Close" onPress={close} />
      </View>
    </View>
  );

  // ── Screens ──
  if (failed && !review) {
    return (
      <Backdrop colors={SLIDE_COLORS.intro}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
          <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "700", textAlign: "center" }}>Couldn't put your year together</Text>
          <View style={{ marginTop: 16, width: 160 }}>
            <Button title="Try again" onPress={() => void load()} />
          </View>
        </View>
        {topBar}
      </Backdrop>
    );
  }

  if (!review || (loading && slides.length === 0)) {
    return (
      <Backdrop colors={SLIDE_COLORS.intro}>
        <Confetti count={14} />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color="#FFFFFF" size="large" />
          <Text style={{ color: "rgba(255,255,255,0.8)", marginTop: 14, fontSize: 15 }}>Putting your year together…</Text>
        </View>
        {topBar}
      </Backdrop>
    );
  }

  if (slides.length === 0) {
    return (
      <View style={{ flex: 1 }}>
        <StatusBar barStyle="light-content" />
        <EmptySlide fyLabel={getFYLabel(fy, startMonth)} />
        {topBar}
      </View>
    );
  }

  const current = slides[Math.min(page, last)];
  return (
    <View style={{ flex: 1, backgroundColor: current.colors[1] }}>
      <StatusBar barStyle="light-content" />
      <View key={`${current.key}-${visit}`} style={{ flex: 1, opacity: loading ? 0.6 : 1 }}>
        {current.key === "wrap" ? (
          <WrapSlide fyLabel={review.fyLabel} isComplete={review.isComplete}>
            <ShareCard ref={shareRef} fyLabel={review.fyLabel} lines={shareLines} isComplete={review.isComplete} />
            <Pop delay={500}>
              <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 14, padding: 14, marginTop: 14 }}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "700" }}>Hide amounts</Text>
                  <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2 }}>Shows percentages, counts and names instead of rupees.</Text>
                </View>
                <Switch value={hideAmounts} onValueChange={setHideAmounts} accessibilityLabel="Hide amounts" />
              </View>
            </Pop>
            <Pop delay={700}>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                <View style={{ flex: 1 }}>
                  <Button title="Share image" onPress={shareImage} loading={sharing === "image"} disabled={sharing != null} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Share PDF" variant="outline" onPress={sharePdf} loading={sharing === "pdf"} disabled={sharing != null} />
                </View>
              </View>
              <Pressable onPress={() => goTo(0)} style={{ alignSelf: "center", marginTop: 16, padding: 8 }} accessibilityRole="button">
                <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 14, fontWeight: "600" }}>Watch again</Text>
              </Pressable>
            </Pop>
          </WrapSlide>
        ) : (
          current.node
        )}
      </View>

      {/* Tap zones: left third goes back, the rest goes forward; hold anywhere to pause. On the
          share slide only the left edge is a zone, so its buttons stay tappable. */}
      <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + 64, bottom: 0, left: 0, right: 0, flexDirection: "row" }}>
        <Pressable
          style={{ width: onShareSlide ? 28 : "33%" }}
          onPress={() => goTo(page - 1)}
          onLongPress={() => setPaused(true)}
          onPressOut={() => setPaused(false)}
          delayLongPress={220}
          accessibilityRole="button"
          accessibilityLabel="Previous slide"
        />
        {!onShareSlide && (
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

function Backdrop({ colors, children }: { colors: readonly [string, string]; children: React.ReactNode }) {
  return (
    <LinearGradient colors={colors} style={{ flex: 1 }}>
      <StatusBar barStyle="light-content" />
      {children}
    </LinearGradient>
  );
}

/** The last slide: "That's a wrap", the share card and the share buttons. */
function WrapSlide({ fyLabel, isComplete, children }: { fyLabel: string; isComplete: boolean; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient colors={SLIDE_COLORS.wrap} style={{ flex: 1 }}>
      <Confetti />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 84, paddingBottom: insets.bottom + 28 }}>
        <Pop>
          <Text style={{ color: "rgba(255,255,255,0.78)", fontSize: 12, fontWeight: "700", letterSpacing: 1.6, textTransform: "uppercase" }}>
            {isComplete ? "That's a wrap" : "So far, so good"}
          </Text>
        </Pop>
        <Pop delay={150} style={{ marginTop: 8, marginBottom: 18 }}>
          <Text style={{ color: "#FFFFFF", fontSize: 30, fontWeight: "800", letterSpacing: -0.5 }}>{fyLabel}, in one card</Text>
        </Pop>
        <Pop delay={300}>{children}</Pop>
      </ScrollView>
    </LinearGradient>
  );
}

function ProgressBar({ state, progress }: { state: "done" | "now" | "todo"; progress: { value: number } }) {
  const a = useAnimatedStyle(() => ({ width: `${(state === "done" ? 1 : state === "todo" ? 0 : progress.value) * 100}%` }));
  return (
    <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)", overflow: "hidden" }}>
      <Animated.View style={[{ height: "100%", backgroundColor: "#FFFFFF" }, a]} />
    </View>
  );
}

function RoundButton({ icon, label, onPress, glow }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; glow?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", marginLeft: 8, backgroundColor: glow ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.16)" }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={19} color="#FFFFFF" />
    </Pressable>
  );
}
