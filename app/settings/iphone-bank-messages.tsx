import { useCallback, useState } from "react";
import { Linking, ScrollView, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ShortcutSetupSteps } from "@/components/sms/ShortcutSetupSteps";
import { Button, Card, ScreenContainer, Text, useToast } from "@/components/ui";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import {
  getMessageStats,
  importHandedMessages,
  isArrivalNotifyOn,
  newestWaitingAt,
  setArrivalNotify,
  waitingMessageCount,
} from "@/services/message-inbox";

/** "2 min ago", "3 h ago", "yesterday", "5 days ago". */
function ago(ms: number, now: number = Date.now()): string {
  const min = Math.max(0, Math.round((now - ms) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/**
 * iPhone: setting up the Shortcuts automation that hands each bank message to Arth (iPhone gives
 * apps no access to messages), whether it's working, and the notification each message brings.
 */
export default function IphoneBankMessagesScreen() {
  const router = useRouter();
  const toast = useToast();
  const theme = useTheme();
  const [waiting, setWaiting] = useState(0);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [monthCount, setMonthCount] = useState(0);
  const [notify, setNotify] = useState(isArrivalNotifyOn());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const stats = getMessageStats();
    const [w, newest] = await Promise.all([waitingMessageCount().catch(() => 0), newestWaitingAt().catch(() => null)]);
    setWaiting(w);
    setLastAt(Math.max(stats.lastMessageAt ?? 0, newest ?? 0) || null);
    setMonthCount(stats.monthCount + w);
  }, []);

  useDataRefresh(refresh);

  const importNow = async () => {
    setBusy(true);
    try {
      const outcome = await importHandedMessages();
      await refresh();
      if (outcome) router.push("/expense/just-arrived");
      else toast("Nothing to add");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Is it working? */}
        <Card className="mb-3">
          <View className="flex-row items-center">
            <Ionicons
              name={lastAt ? "checkmark-circle" : "time-outline"}
              size={22}
              color={lastAt ? theme.success : theme.warning}
            />
            <View className="flex-1 ml-3">
              <Text className="text-sm font-semibold text-foreground">{lastAt ? "Working" : "Nothing received yet"}</Text>
              <Text className="text-xs text-muted-foreground mt-0.5">
                {lastAt
                  ? `Last message ${ago(lastAt)} · ${monthCount} this month`
                  : 'Set it up below. If you have, check step 3: "Run Immediately".'}
              </Text>
            </View>
          </View>
          {waiting > 0 && (
            <Button
              title={`Read ${waiting} waiting message${waiting === 1 ? "" : "s"} now`}
              onPress={() => void importNow()}
              loading={busy}
              className="mt-3"
            />
          )}
          <Button
            title="Paste bank message"
            variant={waiting > 0 ? "outline" : "primary"}
            onPress={() => router.push("/expense/paste-message")}
            className="mt-3"
          />
          <Text className="text-xs text-muted-foreground mt-2 leading-4">
            Missed one? Copy it in Messages and paste it here. In Shortcuts, &quot;Review bank message in Arth&quot; does the
            same.
          </Text>
        </Card>

        <Card className="mb-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Set it up once</Text>
          <Text className="text-xs text-muted-foreground mb-2 leading-4">
            iPhone doesn&apos;t let apps read your messages, and only you can create an automation, so this takes two
            minutes in the Shortcuts app.
          </Text>
          <ShortcutSetupSteps />
          <Button title="Open Shortcuts" variant="outline" onPress={() => void Linking.openURL("shortcuts://")} className="mt-2" />
        </Card>

        <Card>
          <View className="flex-row items-center">
            <View className="flex-1 mr-3">
              <Text className="text-sm font-medium text-foreground">Notify me</Text>
              <Text className="text-xs text-muted-foreground mt-0.5 leading-4">
                A notification for each message the Shortcut hands over, like &quot;₹185 debited · ••8689&quot;. Tap it to review.
              </Text>
            </View>
            <Switch
              value={notify}
              onValueChange={(on) => {
                setNotify(on);
                setArrivalNotify(on);
              }}
              accessibilityLabel="Notify me about bank messages"
            />
          </View>
        </Card>
      </ScrollView>
    </ScreenContainer>
  );
}
