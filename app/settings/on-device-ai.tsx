import { useCallback, useState, useSyncExternalStore } from "react";
import { ScrollView, Switch, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Button, Card, ScreenContainer, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { isAiReadingSwitchOn, setAiReadingSwitch } from "@/services/ai/ai-reading";
import { downloadNano, getNanoStatus, type NanoStatus } from "@/services/ai/nano";
import {
  countOlderUnread,
  countQueued,
  getAiQueueState,
  queueOlderUnread,
  runAiQueue,
  stopAiQueue,
  subscribeAiQueue,
} from "@/services/ai/reading-queue";
import { logger } from "@/utils/logger";

/** How far back "Read older messages too" looks. */
const OLDER_DAYS = 90;

const STATUS: Record<NanoStatus, { label: string; note: string; tone: "success" | "warning" | "mutedForeground" }> = {
  available: { label: "Ready", note: "Gemini Nano is on this phone.", tone: "success" },
  downloadable: {
    label: "Needs a download",
    note: "Android fetches Google's on-device model once. It's shared with other apps that use it.",
    tone: "warning",
  },
  downloading: { label: "Downloading", note: "Android is fetching the model. Keep Arth open or come back later.", tone: "warning" },
  unavailable: { label: "Not on this phone", note: "This phone doesn't have Gemini Nano, so Arth reads messages as before.", tone: "mutedForeground" },
};

/**
 * Settings → On-device AI: Gemini Nano reads the bank messages no pattern or template knows, on
 * this phone, and what it finds waits in Catch Up marked "Read by AI". Shown only on phones that
 * have the model or can download it (app/(tabs)/settings.tsx).
 */
export default function OnDeviceAiScreen() {
  const theme = useTheme();
  const router = useRouter();
  const run = useSyncExternalStore(subscribeAiQueue, getAiQueueState);
  const [on, setOn] = useState(isAiReadingSwitchOn);
  const [status, setStatus] = useState<NanoStatus | null>(null);
  const [queued, setQueued] = useState<number | null>(null);
  const [older, setOlder] = useState(0);
  const [downloaded, setDownloaded] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const since = Date.now() - OLDER_DAYS * 86400000;
    const [s, q, o] = await Promise.all([
      getNanoStatus().catch((): NanoStatus => "unavailable"),
      countQueued().catch(() => null),
      countOlderUnread(since).catch(() => 0),
    ]);
    setStatus(s);
    setQueued(q);
    setOlder(o);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Counts change as a run goes.
  const finished = !run.running;
  useFocusEffect(
    useCallback(() => {
      if (finished) void load();
    }, [finished, load]),
  );

  const toggle = (v: boolean) => {
    setOn(v);
    setAiReadingSwitch(v);
    // Off means off: don't carry on adding to Catch Up.
    if (!v) stopAiQueue();
  };

  const download = async () => {
    setMessage(null);
    setStatus("downloading");
    setDownloaded(0);
    try {
      await downloadNano((bytes) => setDownloaded(bytes));
      setMessage("Downloaded. Arth reads waiting messages next time it's open, or tap Read now.");
    } catch (e) {
      logger.warn("On-device AI: download failed", e);
      setMessage("The download didn't finish. Check your connection and try again.");
    }
    setDownloaded(null);
    await load();
  };

  const readNow = async () => {
    setMessage(null);
    const r = await runAiQueue({ label: "From Settings" });
    if (r.unavailable && r.unavailable !== "available") setMessage(STATUS[r.unavailable].note);
    else if (r.gaveUp) setMessage("On-device AI stopped answering. The rest wait for next time.");
    else if (r.done > 0) setMessage(`Read ${r.done}. ${r.added > 0 ? `${r.added} added to Catch Up for you to check.` : "Nothing new to add."}`);
  };

  const readOlder = async () => {
    try {
      await queueOlderUnread(Date.now() - OLDER_DAYS * 86400000);
      await load();
      await readNow();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't queue them. Try again.");
    }
  };

  const meta = status ? STATUS[status] : null;
  const ready = status === "available";

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Card className="mb-4">
          <View className="flex-row items-center">
            <Ionicons name="sparkles-outline" size={20} color={theme.primary} />
            <Text className="text-base font-semibold text-foreground ml-2 flex-1">Gemini Nano</Text>
            {meta && (
              <Text className="text-xs font-semibold" style={{ color: theme[meta.tone] }}>
                {meta.label}
              </Text>
            )}
          </View>
          <Text className="text-sm text-muted-foreground mt-2 leading-5">
            {meta ? meta.note : "Checking this phone…"}
            {downloaded != null && downloaded > 0 ? ` ${(downloaded / (1024 * 1024)).toFixed(0)} MB so far.` : ""}
          </Text>
          {status === "downloadable" && <Button title="Download the model" onPress={() => void download()} className="mt-3" />}
        </Card>

        <Card className="mb-4">
          <View className="flex-row items-center">
            <View className="flex-1 mr-3">
              <Text className="text-base font-semibold text-foreground">Read messages Arth doesn't know</Text>
              <Text className="text-sm text-muted-foreground mt-1 leading-5">
                When no pattern or template reads a bank message, the AI reads it. What it finds waits in Catch Up, marked
                &quot;Read by AI&quot;, for you to approve.
              </Text>
            </View>
            <Switch value={on} onValueChange={toggle} accessibilityLabel="Read messages Arth doesn't know with on-device AI" />
          </View>
        </Card>

        {on && (
          <>
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">Waiting for the AI</Text>
            <Card className="mb-4">
              {run.running ? (
                <>
                  <Text className="text-sm text-foreground">
                    {run.paused ? "Paused until Arth is open again" : `Reading ${run.done} of ${run.total}`}
                    {run.added > 0 ? ` · ${run.added} added` : ""}
                  </Text>
                  <Button title="Stop" variant="outline" onPress={stopAiQueue} className="mt-3" />
                </>
              ) : (
                <>
                  <Text className="text-sm text-foreground">
                    {queued == null
                      ? "Couldn't count them."
                      : queued === 0
                        ? "Nothing waiting."
                        : `${queued.toLocaleString("en-IN")} message${queued === 1 ? "" : "s"} waiting. Arth reads them a few at a time while it's open.`}
                  </Text>
                  {ready && (queued ?? 0) > 0 && <Button title="Read now" onPress={() => void readNow()} className="mt-3" />}
                  {ready && older > 0 && (
                    <Button
                      title={`Read ${older.toLocaleString("en-IN")} older unread message${older === 1 ? "" : "s"} too`}
                      variant="outline"
                      onPress={() => void readOlder()}
                      className="mt-3"
                    />
                  )}
                </>
              )}
              {message && <Text className="text-xs text-muted-foreground mt-3 leading-5">{message}</Text>}
              {!run.running && run.added > 0 && (
                <Button title="Check them in Catch Up" variant="ghost" onPress={() => router.push("/expense/catch-up")} className="mt-1" />
              )}
            </Card>
          </>
        )}

        <Text className="text-xs text-muted-foreground px-1 leading-5">
          Runs entirely on this phone through Android&apos;s AICore. No message, amount or account leaves the phone. Each run is
          kept in Settings → Transaction messages → Scan history.
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}
