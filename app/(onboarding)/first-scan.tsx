import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { Pressable, ScrollView, Switch, View } from "react-native";

import { RunProgress, type FeedItem } from "@/components/ai/RunProgress";
import { FirstScanSummaryView } from "@/components/onboarding/FirstScanSummaryView";
import { Button, Card, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import {
  approveFirstScan,
  buildFirstScanSummary,
  DEFAULT_LOOKBACK,
  FIRST_SCAN_WAIT_MS,
  lookbackStartDate,
  startFirstScan,
  type FirstScanSummary,
  type LookbackMonths,
} from "@/services/first-scan";
import { aiReadingBuilt, isAiReadingSwitchOn, setAiReadingSwitch } from "@/services/ai/ai-reading";
import { downloadNano, getNanoStatus, type NanoStatus } from "@/services/ai/nano";
import { countQueued, getAiQueueState, runAiQueue, subscribeAiQueue } from "@/services/ai/reading-queue";
import { runSmsScan, type ScanProgress } from "@/services/sms/sms-orchestrator";
import { setStartDate } from "@/services/start-date";
import { todayIso } from "@/utils/date";
import { formatCompact } from "@/utils/format";
import { logger } from "@/utils/logger";

const OPTIONS: { months: LookbackMonths; label: string; note?: string }[] = [
  { months: 1, label: "Last month" },
  { months: 3, label: "Last 3 months", note: "recommended" },
  { months: 6, label: "Last 6 months" },
];

type Phase = "choose" | "scanning" | "ai" | "summary";

/** How long setup waits for Android to finish downloading the on-device model before moving on. */
const MODEL_WAIT_MS = 3 * 60 * 1000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Onboarding, right after SMS permission: how far back to read, then "Here's your money".
 * While it reads, the screen shows how far it's got - a percentage, running counts and the
 * transactions as they're found - since months of messages can take minutes. It runs to the end
 * before onboarding moves on: the accounts step lists what the scan found, so leaving early would
 * show half of them. The screen is kept awake meanwhile.
 *
 * On phones with Gemini Nano, a switch lets on-device AI read the messages no pattern knows. The
 * model's download (if Android hasn't got it yet) starts with the scan, so it's usually ready by
 * the end. After the history is approved, the AI reads what was left over; its finds are never
 * approved in bulk and wait in Catch Up. "Continue" lets it finish in the background.
 */
export default function OnboardingFirstScan() {
  const router = useRouter();
  const theme = useTheme();
  const [months, setMonths] = useState<LookbackMonths>(DEFAULT_LOOKBACK);
  /** After the scan: count what it found in reports, or start fresh from today. */
  const [history, setHistory] = useState<"use" | "fresh">("use");
  const [applying, setApplying] = useState(false);
  const [phase, setPhase] = useState<Phase>("choose");
  const [summary, setSummary] = useState<FirstScanSummary | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  /** Taking a while: say so, so it doesn't look stuck. */
  const [isLong, setIsLong] = useState(false);
  /** Gemini Nano on this phone; null while checking, or when the build has no on-device AI. */
  const [aiStatus, setAiStatus] = useState<NanoStatus | null>(null);
  const [aiOn, setAiOn] = useState(isAiReadingSwitchOn);
  /** Waiting for Android to finish the model download. */
  const [aiWaiting, setAiWaiting] = useState(false);
  const aiRun = useSyncExternalStore(subscribeAiQueue, getAiQueueState);
  const moveOn = useRef<(() => void) | null>(null);
  const aiOffered = aiStatus != null && aiStatus !== "unavailable";

  useEffect(() => {
    if (!aiReadingBuilt()) return;
    let live = true;
    getNanoStatus()
      .then((st) => {
        if (live) setAiStatus(st);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // The AI pass's finds, for the live list.
  const lastAiId = useRef(0);
  useEffect(() => {
    const it = aiRun.latest;
    if (phase !== "ai" || !it || it.id === lastAiId.current) return;
    lastAiId.current = it.id;
    const text = `${it.merchant || (it.credit ? "Money in" : "Payment")} · ₹${Math.round(it.amount).toLocaleString("en-IN")}`;
    setFeed((f) => [{ id: 100000 + it.id, text, ok: true }, ...f].slice(0, 8));
  }, [aiRun.latest, phase]);

  useEffect(() => {
    if (phase !== "scanning" && phase !== "ai") return;
    // A locked screen can pause the scan; keep it on until the scan is done.
    activateKeepAwakeAsync("first-scan").catch(() => {});
    const t = setTimeout(() => setIsLong(true), FIRST_SCAN_WAIT_MS);
    return () => {
      clearTimeout(t);
      deactivateKeepAwake("first-scan");
    };
  }, [phase]);

  const next = () => router.replace("/(onboarding)/accounts-preview");

  // Starting fresh hides what the scan found from reports (not deleted: Settings → Start date brings
  // it back) and leaves nothing old to review. Today's balances, asked a couple of steps on, are
  // where every account starts.
  const goOn = async () => {
    if (history === "fresh") {
      setApplying(true);
      await setStartDate(DEFAULT_USER_ID, todayIso()).catch((e) => logger.warn("Start date failed:", e));
      setApplying(false);
      next();
      return;
    }
    if (summary && summary.toReview > 0) router.push("/expense/catch-up");
    else next();
  };

  /**
   * After the history is approved: on-device AI reads what no pattern knew. Waits for the model
   * if Android is still downloading it. Resolves when it's done, or when the person moves on (the
   * reading then carries on by itself).
   */
  const readWithAi = async () => {
    if ((await countQueued().catch(() => 0)) === 0) return;
    setFeed([]);
    setPhase("ai");
    const skipped = new Promise<void>((resolve) => {
      moveOn.current = resolve;
    });
    let gaveUpWaiting = false;
    const waitForModel = async () => {
      const until = Date.now() + MODEL_WAIT_MS;
      for (;;) {
        const st = await getNanoStatus().catch((): NanoStatus => "unavailable");
        if (st === "available") return true;
        if (st === "unavailable" || Date.now() > until || gaveUpWaiting) return false;
        setAiWaiting(true);
        await sleep(3000);
      }
    };
    const work = (async () => {
      const ready = await waitForModel();
      setAiWaiting(false);
      if (ready) await runAiQueue({ label: "During setup" });
    })();
    await Promise.race([work, skipped]);
    gaveUpWaiting = true;
    moveOn.current = null;
  };

  const start = async () => {
    // The switch decides whether this scan's unread messages are queued for the AI.
    if (aiOffered) {
      setAiReadingSwitch(aiOn);
      if (aiOn && aiStatus === "downloadable") {
        // Fetched while the scan runs, so it's usually ready by the end.
        void downloadNano().catch((e) => logger.warn("First scan: model download failed", e));
      }
    }
    setPhase("scanning");
    const since = lookbackStartDate(months);
    let feedId = 0;
    const promise = startFirstScan(since, () =>
      runSmsScan({
        manual: true,
        aiQueue: false,
        onProgress: (p) => {
          setProgress(p);
          if (p.latest) {
            const it = p.latest;
            const text = `${it.merchant || (it.credit ? "Money in" : "Payment")}${it.amount ? ` · ₹${Math.round(it.amount).toLocaleString("en-IN")}` : ""}`;
            setFeed((f) => [{ id: ++feedId, text, ok: true }, ...f].slice(0, 8));
          }
        },
      }),
    );
    await promise;
    // Months of history shouldn't arrive as one review pile: approve it all, keeping possible
    // duplicates open.
    try {
      await approveFirstScan(DEFAULT_USER_ID);
    } catch (e) {
      logger.warn("First scan: approving everything failed; items stay in review", e);
    }
    if (aiOffered && aiOn) {
      try {
        await readWithAi();
      } catch (e) {
        logger.warn("First scan: on-device AI pass failed (non-fatal)", e);
      }
    }
    try {
      setSummary(await buildFirstScanSummary(DEFAULT_USER_ID, since));
      setPhase("summary");
    } catch (e) {
      logger.warn("First scan summary failed:", e);
      next();
    }
  };

  if (phase === "scanning") {
    const p = progress;
    const doing =
      !p || p.stage === "inbox"
        ? "Opening your messages"
        : p.stage === "reading"
          ? `Reading ${p.messagesRead.toLocaleString("en-IN")} messages`
          : p.stage === "adding"
            ? "Adding your transactions"
            : "Almost done";
    return (
      <RunProgress
        standalone
        title="Reading your transaction messages · everything stays on this phone"
        done={p?.transactionsAdded ?? 0}
        total={0}
        fraction={p?.fraction ?? 0.02}
        doing={doing}
        counters={[
          { label: "Messages read", value: p?.messagesRead ?? 0 },
          { label: "Transactions found", value: p?.transactionsAdded ?? 0 },
          { label: "Money out", value: p?.moneyOut ?? 0, format: (n) => `₹${formatCompact(Math.round(n))}` },
          { label: "Money in", value: p?.moneyIn ?? 0, format: (n) => `₹${formatCompact(Math.round(n))}` },
        ]}
        feed={feed}
        footer={
          isLong ? (
            <View className="pb-6 pt-2">
              <Text className="text-xs text-muted-foreground text-center">
                Lots of history, so this can take a few minutes. Keep Arth open; your accounts show up once it's done.
              </Text>
            </View>
          ) : null
        }
      />
    );
  }

  if (phase === "ai") {
    const r = aiRun;
    const doing = aiWaiting
      ? "Getting on-device AI ready (Android is downloading it)"
      : r.paused
        ? "Paused while Arth is in the background"
        : r.total > 0
          ? `Reading message ${Math.min(r.done + 1, r.total)} of ${r.total}`
          : "Starting on-device AI";
    return (
      <RunProgress
        standalone
        title="Reading the messages Arth didn't know · on-device AI, on this phone"
        done={r.done}
        total={r.total}
        fraction={r.total > 0 ? Math.max(0.03, r.done / r.total) : 0.02}
        doing={doing}
        counters={[
          { label: "Messages read", value: r.done },
          { label: "Transactions found", value: r.added },
          { label: "Money out", value: r.moneyOut, format: (n) => `₹${formatCompact(Math.round(n))}` },
          { label: "Money in", value: r.moneyIn, format: (n) => `₹${formatCompact(Math.round(n))}` },
        ]}
        feed={feed}
        footer={
          <View className="px-6 pb-6 pt-2">
            <Text className="text-xs text-muted-foreground text-center mb-3 leading-5">
              {"What the AI finds waits in Catch Up for you to check. It only counts in your reports once you approve it."}
            </Text>
            <Button title="Continue, finish in the background" variant="outline" onPress={() => moveOn.current?.()} />
          </View>
        }
      />
    );
  }

  if (phase === "summary" && summary) {
    return (
      <ScreenContainer safe padTop>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }}>
          <Text className="text-2xl font-bold text-foreground mb-2">Here’s your money</Text>
          <Text className="text-sm text-muted-foreground mb-5">From your transaction messages since {summary.since}.</Text>
          <Card>
            <FirstScanSummaryView summary={summary} reviewLabel="Possible duplicates to check" splitAi />
          </Card>
          <Text className="text-base font-semibold text-foreground mt-6 mb-1">Count these months in your reports?</Text>
          <Text className="text-sm text-muted-foreground mb-3 leading-5">
            Either way, you'll confirm each account's balance today, and everything from now on adds up from there.
          </Text>
          {(
            [
              { id: "use", label: "Yes, use them", note: "Trends and averages start with real history" },
              { id: "fresh", label: "No, start fresh from today", note: "Nothing old to review; reports begin today" },
            ] as const
          ).map((o) => {
            const selected = history === o.id;
            return (
              <Pressable
                key={o.id}
                onPress={() => setHistory(o.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                className="flex-row items-center rounded-xl border px-4 py-3 mb-2.5 bg-card"
                style={{ borderColor: selected ? theme.primary : theme.border }}
              >
                <View className="flex-1 mr-3">
                  <Text className="text-base text-foreground">{o.label}</Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">{o.note}</Text>
                </View>
                <Ionicons
                  name={selected ? "radio-button-on" : "radio-button-off"}
                  size={20}
                  color={selected ? theme.primary : theme.mutedForeground}
                />
              </Pressable>
            );
          })}
        </ScrollView>
        <View className="px-6 pb-6 pt-2">
          <Button
            title={
              history === "use" && summary.toReview > 0
                ? summary.readByAi > 0
                  ? "Check what's waiting"
                  : "Check possible duplicates"
                : "Continue"
            }
            onPress={() => void goOn()}
            loading={applying}
            className="mb-3"
          />
          {history === "use" && summary.toReview > 0 && <Button title="Later" variant="ghost" onPress={next} />}
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer safe padTop>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }}>
        <Text className="text-2xl font-bold text-foreground mb-2">How far back should Arth read?</Text>
        <Text className="text-sm text-muted-foreground mb-6 leading-5">
          More history means better insights, and more items to review today.
        </Text>
        {OPTIONS.map((o) => {
          const selected = o.months === months;
          return (
            <Pressable
              key={o.months}
              onPress={() => setMonths(o.months)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              className="flex-row items-center justify-between rounded-xl border px-4 py-3.5 mb-2.5 bg-card"
              style={{ borderColor: selected ? theme.primary : theme.border }}
            >
              <Text className="text-base text-foreground">
                {o.label}
                {o.note ? <Text className="text-sm text-muted-foreground"> · {o.note}</Text> : null}
              </Text>
              <Ionicons
                name={selected ? "radio-button-on" : "radio-button-off"}
                size={20}
                color={selected ? theme.primary : theme.mutedForeground}
              />
            </Pressable>
          );
        })}
        {aiOffered && (
          <View className="flex-row items-center rounded-xl border px-4 py-3.5 mt-3 bg-card" style={{ borderColor: theme.border }}>
            <Ionicons name="sparkles-outline" size={20} color={theme.primary} />
            <View className="flex-1 mx-3">
              <Text className="text-base text-foreground">Read the rest with on-device AI</Text>
              <Text className="text-xs text-muted-foreground mt-0.5 leading-4">
                {aiStatus === "available"
                  ? "Gemini Nano reads messages Arth doesn't know, on this phone. You check what it finds."
                  : "Gemini Nano reads messages Arth doesn't know, on this phone. Android downloads it while Arth reads."}
              </Text>
            </View>
            <Switch value={aiOn} onValueChange={setAiOn} accessibilityLabel="Read the rest with on-device AI" />
          </View>
        )}
      </ScrollView>
      <View className="px-6 pb-6 pt-2">
        <Button title="Start reading" onPress={() => void start()} />
      </View>
    </ScreenContainer>
  );
}
