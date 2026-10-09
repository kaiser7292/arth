import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";

import { FirstScanSummaryView } from "@/components/onboarding/FirstScanSummaryView";
import { Button, Card, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import {
  buildFirstScanSummary,
  DEFAULT_LOOKBACK,
  lookbackStartDate,
  runFirstScan,
  type FirstScanSummary,
  type LookbackMonths,
} from "@/services/first-scan";
import { runSmsScan } from "@/services/sms/sms-orchestrator";
import { logger } from "@/utils/logger";

const OPTIONS: { months: LookbackMonths; label: string; note?: string }[] = [
  { months: 1, label: "Last month" },
  { months: 3, label: "Last 3 months", note: "recommended" },
  { months: 6, label: "Last 6 months" },
];

type Phase = "choose" | "scanning" | "summary" | "background";

/**
 * Onboarding, right after SMS permission: how far back to read, then "Here's your money".
 * Scans in the foreground for up to 45 s; past that the scan carries on and the summary shows
 * on Home when it's done.
 */
export default function OnboardingFirstScan() {
  const router = useRouter();
  const theme = useTheme();
  const [months, setMonths] = useState<LookbackMonths>(DEFAULT_LOOKBACK);
  const [phase, setPhase] = useState<Phase>("choose");
  const [summary, setSummary] = useState<FirstScanSummary | null>(null);

  const next = () => router.replace("/(onboarding)/accounts-preview");

  const start = async () => {
    setPhase("scanning");
    const since = lookbackStartDate(months);
    try {
      const outcome = await runFirstScan(since, () => runSmsScan({ manual: true }));
      if (outcome === "background") {
        setPhase("background");
        return;
      }
      setSummary(await buildFirstScanSummary(DEFAULT_USER_ID, since));
      setPhase("summary");
    } catch (e) {
      logger.warn("First scan summary failed:", e);
      next();
    }
  };

  if (phase === "scanning" || phase === "background") {
    return (
      <ScreenContainer safe padTop>
        <View className="flex-1 items-center justify-center px-8">
          {phase === "scanning" ? (
            <ActivityIndicator size="large" color={theme.primary} />
          ) : (
            <Ionicons name="hourglass-outline" size={36} color={theme.primary} />
          )}
          <Text className="text-lg font-semibold text-foreground mt-5 text-center">
            {phase === "scanning" ? "Reading your bank messages…" : "Still reading"}
          </Text>
          <Text className="text-sm text-muted-foreground mt-2 text-center leading-5">
            {phase === "scanning"
              ? "Everything stays on this phone."
              : "You have a lot of history. Arth will keep going and show your summary on Home when it's done."}
          </Text>
        </View>
        {phase === "background" && (
          <View className="px-6 pb-6">
            <Button title="Continue" onPress={next} />
          </View>
        )}
      </ScreenContainer>
    );
  }

  if (phase === "summary" && summary) {
    return (
      <ScreenContainer safe padTop>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }}>
          <Text className="text-2xl font-bold text-foreground mb-2">Here’s your money</Text>
          <Text className="text-sm text-muted-foreground mb-5">From your bank messages since {summary.since}.</Text>
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
