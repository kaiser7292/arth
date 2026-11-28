import { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer, StatusPill, Text } from "@/components/ui";
import { Toggle } from "@/components/ui/Toggle";
import { GroupLabel, LinkRow } from "@/components/ui/LinkRow";
import { LearnMoreChip } from "@/components/ui/LearnMoreChip";
import { historyLine, useFixUndo } from "@/components/ai/useFixUndo";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { isAiSetupPending } from "@/services/ai-share";
import { aiReadingBuilt, isAiReadingSwitchOn, setAiReadingSwitch } from "@/services/ai/ai-reading";
import { getNanoStatus, type NanoStatus } from "@/services/ai/nano";
import { countQueued, stopAiQueue } from "@/services/ai/reading-queue";
import { countAiItems, loadCatchUpAiItems } from "@/services/catch-up-ai";

const STATUS: Record<NanoStatus, { label: string; tone: "success" | "warning" | "mutedForeground" }> = {
  available: { label: "Ready", tone: "success" },
  downloadable: { label: "Needs a download", tone: "warning" },
  downloading: { label: "Downloading", tone: "warning" },
  unavailable: { label: "Not on this phone", tone: "mutedForeground" },
};

/**
 * Settings → AI (docs/AI_HUB_PROPOSAL.md §7): the two kinds of AI, each under the name it has
 * everywhere in the app. On this phone is Gemini Nano: private and automatic, on some phones
 * only. With your AI assistant is ChatGPT, Gemini or Claude: you share a file and paste the reply
 * back. Settings only: what waits for a decision is in Catch Up, and this screen points there.
 */
export default function AiScreen() {
  const router = useRouter();
  const theme = useTheme();
  const built = aiReadingBuilt();
  const [status, setStatus] = useState<NanoStatus | null>(built ? null : "unavailable");
  const [reading, setReading] = useState(isAiReadingSwitchOn);
  const [queued, setQueued] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [replyWaiting, setReplyWaiting] = useState(isAiSetupPending);
  const { history, undoable, undoing, undo } = useFixUndo();

  useDataRefresh(
    useCallback(async () => {
      setReplyWaiting(isAiSetupPending());
      const [s, q, items] = await Promise.all([
        built ? getNanoStatus().catch((): NanoStatus => "unavailable") : Promise.resolve<NanoStatus>("unavailable"),
        built ? countQueued().catch(() => null) : Promise.resolve(null),
        loadCatchUpAiItems(),
      ]);
      setStatus(s);
      setQueued(q);
      setWaiting(countAiItems(items));
    }, [built]),
  );

  const toggleReading = (v: boolean) => {
    setReading(v);
    setAiReadingSwitch(v);
    // Off means off: don't carry on adding to Catch Up.
    if (!v) stopAiQueue();
  };

  const onPhone = status != null && status !== "unavailable";
  const meta = status ? STATUS[status] : null;
  const go = (path: string) => () => router.push(path as never);

  return (
    <ScreenContainer padTop={false}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 20 }}>
        {waiting > 0 && (
          <View className="rounded-card bg-card border border-border overflow-hidden">
            <LinkRow
              divider={false}
              icon="albums-outline"
              color={theme.primary}
              title={`${waiting} from AI waiting for you`}
              sub="In Catch Up, with your transactions"
              onPress={go("/expense/catch-up")}
            />
          </View>
        )}

        <View>
          <GroupLabel>On this phone</GroupLabel>
          <View className="rounded-card bg-card border border-border overflow-hidden">
            {status === "unavailable" ? (
              <LinkRow
                divider={false}
                icon="phone-portrait-outline"
                title="Gemini Nano"
                sub="This phone doesn't have Gemini Nano, so Arth reads messages as before."
                right={meta ? <StatusPill label={meta.label} color={theme[meta.tone]} /> : undefined}
              />
            ) : (
              <>
                <LinkRow
                  divider={false}
                  icon="phone-portrait-outline"
                  color={theme.primary}
                  title="Gemini Nano"
                  sub="Private and automatic. Nothing leaves the phone."
                  right={meta ? <StatusPill label={meta.label} color={theme[meta.tone]} /> : undefined}
                  onPress={go("/settings/on-device-ai")}
                />
                <LinkRow
                  icon="chatbubbles-outline"
                  color={theme.primary}
                  title="Read messages Arth doesn't know"
                  sub={
                    !reading
                      ? "Off"
                      : queued == null
                        ? "What it finds waits in Catch Up"
                        : queued === 0
                          ? "Nothing waiting"
                          : `${queued.toLocaleString("en-IN")} waiting`
                  }
                  right={<Toggle value={reading} onValueChange={toggleReading} accessibilityLabel="Read messages Arth doesn't know with on-device AI" />}
                />
                {onPhone && reading && (
                  <LinkRow
                    icon="options-outline"
                    color={theme.primary}
                    title="What else it does"
                    sub="Categories, same-place names, formats, voice and more"
                    onPress={go("/settings/on-device-ai")}
                  />
                )}
              </>
            )}
          </View>
        </View>

        <View>
          <GroupLabel>With your AI assistant</GroupLabel>
          <View className="rounded-card bg-card border border-border overflow-hidden">
            {replyWaiting && (
              <LinkRow
                divider={false}
                icon="clipboard-outline"
                color={theme.primary}
                title="Paste your assistant's reply"
                sub="You shared a file. Copy the reply there, then tap here."
                onPress={go("/settings/ai-request?paste=1")}
              />
            )}
            <LinkRow
              divider={replyWaiting}
              icon="color-wand-outline"
              color={theme.data.series[3]}
              title="Ask your AI assistant"
              sub="Set up, tidy, budget, or fix your whole history. With Undo."
              onPress={go("/settings/ai-request")}
            />
            <LinkRow
              icon="chatbox-ellipses-outline"
              color={theme.data.series[3]}
              title="Ask about my money"
              sub="A file to chat about. Nothing comes back."
              onPress={go("/insights/export-for-ai")}
            />
          </View>
          <Text className="text-meta text-muted-foreground mt-2 px-1 leading-5">
            ChatGPT, Gemini, Claude or any chat app. What you share goes to that company&apos;s servers. Arth never sends anything by itself.
          </Text>
        </View>

        <View>
          <GroupLabel
            right={
              history.length > 0 ? (
                <Pressable onPress={go("/settings/ai-history")} hitSlop={10} accessibilityRole="button" className="mb-2.5">
                  <Text className="text-meta font-semibold" style={{ color: theme.primary }}>
                    See all
                  </Text>
                </Pressable>
              ) : undefined
            }
          >
            What AI changed
          </GroupLabel>
          <View className="rounded-card bg-card border border-border overflow-hidden">
            {history.length === 0 ? (
              <LinkRow divider={false} icon="time-outline" title="Nothing yet" sub="Fixes from your assistant show here, with Undo." />
            ) : (
              history.slice(0, 3).map((e, i) => {
                const canUndo = undoable?.id === e.id;
                return (
                  <LinkRow
                    key={e.id}
                    divider={i > 0}
                    icon={e.kind === "match" ? "swap-horizontal-outline" : "sparkles-outline"}
                    color={e.undoneAt ? undefined : theme.primary}
                    title={e.title}
                    sub={historyLine(e, canUndo)}
                    right={
                      canUndo ? (
                        <Pressable onPress={() => void undo()} hitSlop={8} disabled={undoing} accessibilityRole="button" accessibilityLabel={`Undo ${e.title}`}>
                          <Text className="text-body font-semibold" style={{ color: theme.primary }}>
                            {undoing ? "Undoing…" : "Undo"}
                          </Text>
                        </Pressable>
                      ) : undefined
                    }
                    onPress={go("/settings/ai-history")}
                  />
                );
              })
            )}
          </View>
        </View>
        <View className="items-start">
          <LearnMoreChip contextKey="ai" label="How AI works in Arth" />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
