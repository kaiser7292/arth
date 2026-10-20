import { useCallback, useState } from "react";
import { ScrollView, Switch, View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";

import { Button, Card, FilterChip, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import { DEFAULT_AI_EXPORT_SECTIONS, resolveAiExportPeriod, type AiExportOptions } from "@/services/ai-export";
import { AI_REQUESTS, type AiRequestId } from "@/services/ai-reply-format";
import { buildSetupOptions, createAiFile, setAiSetupPending, shareAiFile } from "@/services/ai-share";

/** The single jobs, for when the user doesn't want the whole setup. */
const JOBS = AI_REQUESTS.filter((r) => r.id !== "everything" && r.id !== "setup");

const EVERYTHING = [
  "Categories, and a category for every merchant",
  "Budgets from what you really spend",
  "Templates for transaction messages Arth couldn't read",
  "Your income, savings target, investment buckets and goals",
];

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function AiAssistedSetupScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [job, setJob] = useState<AiRequestId>("tidy");
  const [unreadMessages, setUnreadMessages] = useState(false);
  const [working, setWorking] = useState<"everything" | "job" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const share = useCallback(async (which: "everything" | "job", build: () => Promise<AiExportOptions>) => {
    setWorking(which);
    setMessage(null);
    try {
      const options = await build();
      const { file, counts } = await createAiFile(DEFAULT_USER_ID, options);
      await shareAiFile(file, options);
      setAiSetupPending(true);
      setMessage(
        `Shared ${counts.transactions.toLocaleString("en-IN")} transactions${
          counts.unreadMessages > 0 ? ` and ${counts.unreadMessages} transaction messages` : ""
        } (${formatSize(file.sizeBytes)}). Send it in your assistant; if its message box is empty, long-press and paste - your request is already copied.${
          which === "everything" ? " It will ask you a few questions first." : ""
        }`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't prepare the file. Try again.");
    }
    setWorking(null);
  }, []);

  const shareEverything = () =>
    share("everything", async () => ({
      ...(await buildSetupOptions(DEFAULT_USER_ID)),
      // Any time after onboarding the last year is plenty, and keeps the file small.
      ...(await resolveAiExportPeriod("last_12_months", DEFAULT_USER_ID)),
      suggest: { request: "everything", includeUnreviewed: true, includeUnreadMessages: true },
    }));

  const shareJob = () =>
    share("job", async () => ({
      ...(await resolveAiExportPeriod("last_12_months", DEFAULT_USER_ID)),
      sections: DEFAULT_AI_EXPORT_SECTIONS,
      hidePeopleNames: true,
      hideMerchantNames: false,
      suggest: { request: job, includeUnreadMessages: unreadMessages },
    }));

  const sectionLabel = "text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-5 mb-2";

  return (
    <ScreenContainer padTop={false}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-4 pt-2">
          <Text className="text-xs text-muted-foreground leading-5">
            Let your AI assistant (Claude, ChatGPT, Gemini) set Arth up from your own data. It suggests, you approve.
            Nothing changes until you tap Apply.
          </Text>

          <Card className="mt-4">
            <View className="flex-row items-center gap-2 mb-2">
              <Ionicons name="sparkles-outline" size={18} color={theme.primary} />
              <Text className="text-base font-semibold text-foreground">Set up everything</Text>
            </View>
            {EVERYTHING.map((line) => (
              <View key={line} className="flex-row items-start gap-2 py-0.5">
                <Ionicons name="checkmark" size={14} color={theme.success} style={{ marginTop: 3 }} />
                <Text className="flex-1 text-sm text-foreground">{line}</Text>
              </View>
            ))}
            <Text className="text-xs text-muted-foreground leading-5 mt-2">
              The assistant asks you a few questions first, such as what you are saving for. Goals and targets come
              from your answers, not from the assistant.
            </Text>
            <Button
              title="Share with AI"
              onPress={shareEverything}
              loading={working === "everything"}
              disabled={working !== null}
              className="mt-3"
            />
          </Card>

          <Text className={sectionLabel}>Or do one thing</Text>
          <View className="flex-row flex-wrap gap-y-2">
            {JOBS.map((j) => (
              <FilterChip
                key={j.id}
                label={j.label}
                active={job === j.id}
                onPress={() => {
                  setJob(j.id);
                  if (j.id === "messages") setUnreadMessages(true);
                }}
              />
            ))}
          </View>
          <Card className="mt-3">
            <View className="flex-row items-center justify-between py-1">
              <View className="flex-1 mr-3">
                <Text className="text-sm text-foreground">Include unread transaction messages</Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  As received, so it can work out how to read them
                </Text>
              </View>
              <Switch
                value={unreadMessages}
                onValueChange={setUnreadMessages}
                trackColor={{ false: theme.border, true: theme.primary }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Include unread transaction messages"
              />
            </View>
          </Card>
          <Button
            title="Share with AI"
            variant="outline"
            onPress={shareJob}
            loading={working === "job"}
            disabled={working !== null}
            className="mt-3"
          />

          {message && <Text className="text-xs text-muted-foreground text-center mt-3 leading-5">{message}</Text>}

          <Text className={sectionLabel}>Got the reply?</Text>
          <Button title="Paste AI reply" onPress={() => router.push("/settings/ai-suggestions?paste=1")} />

          <View className="flex-row items-start gap-2 mt-5">
            <Ionicons name="lock-closed" size={14} color={theme.success} style={{ marginTop: 2 }} />
            <Text className="flex-1 text-xs text-muted-foreground leading-5">
              Shares your last 12 months of transactions, accounts (last 4 digits), budgets, loans and goals. Never
              your password vault, broker or login credentials, or full account numbers.
            </Text>
          </View>
          <View className="flex-row items-start gap-2 mt-2">
            <Ionicons name="warning-outline" size={14} color={theme.warning} style={{ marginTop: 2 }} />
            <Text className="flex-1 text-xs text-muted-foreground leading-5">
              {"What you share is sent to that AI company's servers. Arth can't control it after that."}
            </Text>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
