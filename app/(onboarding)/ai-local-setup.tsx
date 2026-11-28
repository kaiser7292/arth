import { useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import { RunProgress, type FeedItem } from "@/components/ai/RunProgress";
import { Button, Card, ScreenContainer, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { runLocalSetup, setLocalReply, type LocalSetupProgress } from "@/services/ai/local-setup";
import { continueAfterAi } from "@/services/onboarding-flow";
import { logger } from "@/utils/logger";

type Phase = "intro" | "working" | "nothing";

/**
 * Onboarding, "Set up on this phone" (services/ai/local-setup.ts): on-device AI files your biggest
 * uncategorised merchants into your categories. Nothing is shared. Its suggestions open on the AI
 * suggestions review screen, where you tick what to keep; then setup carries on with income and
 * budgets (the budget step offers figures from what you really spent).
 */
export default function OnboardingAiLocalSetup() {
  const router = useRouter();
  const theme = useTheme();
  const [phase, setPhase] = useState<Phase>("intro");
  const [progress, setProgress] = useState<LocalSetupProgress | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const stop = useRef(false);

  // Income and budgets come next either way; this route sets neither.
  const carryOn = () => continueAfterAi(router, {});

  const start = async () => {
    stop.current = false;
    setPhase("working");
    setFeed([]);
    let feedId = 0;
    activateKeepAwakeAsync("ai-local-setup").catch(() => {});
    try {
      const result = await runLocalSetup(
        (p) => {
          setProgress(p);
          const it = p.latest;
          if (it) setFeed((f) => [{ id: ++feedId, text: `${it.merchant} → ${it.category}`, ok: true }, ...f].slice(0, 8));
        },
        () => stop.current,
      );
      if (result.reply) {
        setLocalReply(result.reply);
        router.push({ pathname: "/settings/ai-request", params: { local: "1", onboarding: "1" } });
        setPhase("intro");
      } else {
        setNote(
          result.asked === 0
            ? "Every merchant already has a category. Nothing to file."
            : result.failedBatches > 0
              ? "On-device AI didn't answer this time. You can carry on and set categories as you go."
              : "On-device AI wasn't sure about any of your merchants. You can set them as you go in Catch Up.",
        );
        setPhase("nothing");
      }
    } catch (e) {
      logger.warn("Local setup failed", e);
      setNote("On-device AI couldn't run just now. You can carry on and set categories as you go.");
      setPhase("nothing");
    } finally {
      deactivateKeepAwake("ai-local-setup");
    }
  };

  if (phase === "working") {
    const p = progress;
    return (
      <RunProgress
        standalone
        title="Filing your merchants · on-device AI, on this phone"
        done={p?.done ?? 0}
        total={p?.total ?? 0}
        fraction={p && p.total > 0 ? Math.max(0.03, p.done / p.total) : 0.02}
        doing={p && p.total > 0 ? `Merchant ${Math.min(p.done + 1, p.total)} of ${p.total}` : "Finding your merchants"}
        counters={[
          { label: "Merchants looked at", value: p?.done ?? 0 },
          { label: "Filed", value: p?.filed ?? 0 },
        ]}
        feed={feed}
        footer={
          <View className="px-6 pb-6 pt-2">
            <Button
              title="Stop and review what's filed"
              variant="outline"
              onPress={() => {
                stop.current = true;
              }}
            />
          </View>
        }
      />
    );
  }

  return (
    <ScreenContainer safe padTop>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 24 }}>
        <Text className="text-2xl font-bold text-foreground mb-2">Set up on this phone</Text>
        <Text className="text-sm text-muted-foreground mb-6 leading-5">
          Gemini Nano, the AI built into your phone, puts your biggest merchants into your categories. Nothing is shared or
          sent anywhere, and nothing changes until you approve it.
        </Text>
        <Card className="mb-3">
          {[
            ["pricetags-outline", "A category for your top merchants", "Up to 40, biggest spend first. You tick the ones to keep."],
            ["calculator-outline", "Budgets from what you spend", "The budget step offers figures from your real months."],
            ["cash-outline", "Your income", "You add it on the next step."],
          ].map(([icon, title, body], i) => (
            <View key={title} className={`flex-row items-start${i > 0 ? " mt-3" : ""}`}>
              <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={18} color={theme.primary} />
              <View className="flex-1 ml-3">
                <Text className="text-base font-semibold text-foreground">{title}</Text>
                <Text className="text-sm text-muted-foreground mt-0.5 leading-5">{body}</Text>
              </View>
            </View>
          ))}
        </Card>
        {note && <Text className="text-sm text-muted-foreground mt-2 leading-5">{note}</Text>}
      </ScrollView>
      <View className="px-6 pb-6 pt-2">
        {phase === "nothing" ? (
          <Button title="Continue" onPress={carryOn} />
        ) : (
          <>
            <Button title="File my merchants" onPress={() => void start()} className="mb-3" />
            <Button title="Skip this" variant="ghost" onPress={carryOn} />
          </>
        )}
      </View>
    </ScreenContainer>
  );
}
