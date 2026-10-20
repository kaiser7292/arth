import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { RunProgress, type FeedItem } from "@/components/ai/RunProgress";
import { FirstScanSummaryView } from "@/components/onboarding/FirstScanSummaryView";
import { Button, Card, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import {
  buildFirstScanSummary,
  DEFAULT_LOOKBACK,
  finishFirstScanInBackground,
  FIRST_SCAN_WAIT_MS,
  lookbackStartDate,
  startFirstScan,
  type FirstScanSummary,
  type LookbackMonths,
} from "@/services/first-scan";
import { runSmsScan, type ScanProgress } from "@/services/sms/sms-orchestrator";
import { formatCompact } from "@/utils/format";
import { logger } from "@/utils/logger";

const OPTIONS: { months: LookbackMonths; label: string; note?: string }[] = [
  { months: 1, label: "Last month" },
  { months: 3, label: "Last 3 months", note: "recommended" },
  { months: 6, label: "Last 6 months" },
];

type Phase = "choose" | "scanning" | "summary";

/**
 * Onboarding, right after SMS permission: how far back to read, then "Here's your money".
 * While it reads, the screen shows how far it's got - a percentage, running counts and the
 * transactions as they're found - since months of messages can take minutes. After 45 s a
 * "Continue in the background" button appears; the summary then shows on Home when it's done.
 */
export default function OnboardingFirstScan() {
  const router = useRouter();
  const theme = useTheme();
  const [months, setMonths] = useState<LookbackMonths>(DEFAULT_LOOKBACK);
  const [phase, setPhase] = useState<Phase>("choose");
  const [summary, setSummary] = useState<FirstScanSummary | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [canLeave, setCanLeave] = useState(false);
  const work = useRef<{ since: string; promise: Promise<void> } | null>(null);
  const left = useRef(false);

  useEffect(() => {
    if (phase !== "scanning") return;
    const t = setTimeout(() => setCanLeave(true), FIRST_SCAN_WAIT_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const next = () => router.replace("/(onboarding)/accounts-preview");

  const start = async () => {
    setPhase("scanning");
    const since = lookbackStartDate(months);
    let feedId = 0;
    const promise = startFirstScan(since, () =>
      runSmsScan({
        manual: true,
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
    work.current = { since, promise };
    await promise;
    if (left.current) return;
    try {
      setSummary(await buildFirstScanSummary(DEFAULT_USER_ID, since));
      setPhase("summary");
    } catch (e) {
      logger.warn("First scan summary failed:", e);
      next();
    }
  };

  const continueInBackground = () => {
    if (work.current) finishFirstScanInBackground(work.current.since, work.current.promise);
    left.current = true;
    next();
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
          { label: "Money out", value: `₹${formatCompact(Math.round(p?.moneyOut ?? 0))}` },
          { label: "Money in", value: `₹${formatCompact(Math.round(p?.moneyIn ?? 0))}` },
        ]}
        feed={feed}
        footer={
          canLeave ? (
            <View className="pb-6 pt-2">
              <Text className="text-xs text-muted-foreground text-center mb-2">
                Lots of history. You can keep watching, or carry on and see the summary on Home when it's done.
              </Text>
              <Button title="Continue in the background" variant="outline" onPress={continueInBackground} />
            </View>
          ) : null
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
            <FirstScanSummaryView summary={summary} />
          </Card>
        </ScrollView>
        <View className="px-6 pb-6 pt-2">
          <Button
            title={summary.toReview > 0 ? "Review now" : "Continue"}
            onPress={() => (summary.toReview > 0 ? router.push("/expense/catch-up") : next())}
            className="mb-3"
          />
          {summary.toReview > 0 && <Button title="Later" variant="ghost" onPress={next} />}
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
      </ScrollView>
      <View className="px-6 pb-6 pt-2">
        <Button title="Start reading" onPress={() => void start()} />
      </View>
    </ScreenContainer>
  );
}
