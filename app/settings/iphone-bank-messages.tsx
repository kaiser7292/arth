import { useCallback, useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { Button, Card, ScreenContainer, Text, useToast } from "@/components/ui";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { importHandedMessages, waitingMessageCount } from "@/services/message-inbox";
import { runSmsScan } from "@/services/sms/sms-orchestrator";

/** The Shortcuts automation, step by step (wording follows iOS 17-18's Shortcuts app). */
const STEPS: { title: string; body: string }[] = [
  { title: "Open Shortcuts", body: "Go to the Automation tab and tap + (New Automation), then choose Message." },
  {
    title: "Pick your bank's messages",
    body: 'Under "Message Contains", type a word that appears in your bank\'s transaction messages, like debited. Leave Sender empty: banks send from many IDs.',
  },
  { title: "Let it run by itself", body: 'Choose "Run Immediately" (or "Run Automatically") and turn off "Notify When Run". Tap Next.' },
  {
    title: "Hand it to Arth",
    body: 'Tap "New Blank Automation", add the action "Add bank message to Arth" (search for Arth), set Message to Shortcut Input, and tap Done.',
  },
  {
    title: "Money coming in too",
    body: "Make a second automation the same way with credited, so refunds and salary come in as well.",
  },
];

/**
 * iPhone: setting up the Shortcuts automation that hands each bank message to Arth (iPhone gives
 * apps no access to messages). The messages are read the next time Arth opens
 * (services/message-inbox.ts); this screen also imports waiting ones now, and takes a message
 * pasted by hand for anything the automation missed.
 */
export default function IphoneBankMessagesScreen() {
  const router = useRouter();
  const toast = useToast();
  const theme = useTheme();
  const [waiting, setWaiting] = useState(0);
  const [busy, setBusy] = useState(false);

  useDataRefresh(
    useCallback(async () => {
      setWaiting(await waitingMessageCount().catch(() => 0));
    }, []),
  );

  const report = (created: number, credits: number, scanned: number) => {
    const added = created + credits;
    toast(
      added > 0
        ? `${added} transaction${added === 1 ? "" : "s"} added to review`
        : scanned > 0
          ? "Read, but no new transactions in it"
          : "Nothing to add",
      added > 0 ? { actionLabel: "Review", onAction: () => router.push("/expense/review-queue") } : undefined,
    );
  };

  const importNow = async () => {
    setBusy(true);
    try {
      const outcome = await importHandedMessages();
      report(outcome?.created ?? 0, outcome?.credits ?? 0, outcome?.totalScanned ?? 0);
      setWaiting(await waitingMessageCount().catch(() => 0));
    } finally {
      setBusy(false);
    }
  };

  const pasteMessage = async () => {
    const text = (await Clipboard.getStringAsync()).trim();
    if (!text) {
      toast("Copy a bank message first (press and hold it in Messages, then Copy)");
      return;
    }
    setBusy(true);
    try {
      const outcome = await runSmsScan({
        manual: true,
        messages: [{ _id: `pasted-${Date.now()}`, address: "Pasted", body: text, date: Date.now(), type: 1 } as never],
      });
      report(outcome.created, outcome.credits, outcome.totalScanned);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text className="text-sm text-muted-foreground leading-5 mb-4">
          iPhone doesn&apos;t let apps read your messages. A Shortcuts automation can hand each bank message to Arth instead.
          Set it up once; after that it runs in the background, and Arth reads the messages on this phone the next time you
          open it. You review each one before it counts.
        </Text>

        <Card className="mb-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Set it up once</Text>
          {STEPS.map((s, i) => (
            <View key={s.title} className="flex-row py-2">
              <View
                className="w-6 h-6 rounded-full items-center justify-center mr-3 mt-0.5"
                style={{ backgroundColor: theme.alpha("primary", 0.12) }}
              >
                <Text className="text-xs font-semibold" style={{ color: theme.primary }}>{i + 1}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-foreground">{s.title}</Text>
                <Text className="text-xs text-muted-foreground mt-0.5 leading-4">{s.body}</Text>
              </View>
            </View>
          ))}
          <Button title="Open Shortcuts" variant="outline" onPress={() => void Linking.openURL("shortcuts://")} className="mt-2" />
        </Card>

        <Card className="mb-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Waiting messages</Text>
          <Text className="text-sm text-foreground">
            {waiting > 0 ? `${waiting} message${waiting === 1 ? "" : "s"} handed over, not read yet` : "None waiting. New ones are read when you open Arth."}
          </Text>
          {waiting > 0 && <Button title="Read them now" onPress={() => void importNow()} loading={busy} className="mt-3" />}
        </Card>

        <Card>
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Missed one?</Text>
          <Text className="text-xs text-muted-foreground mb-3 leading-4">
            Copy the bank message in Messages, then add it here. It&apos;s read the same way.
          </Text>
          <Button title="Add a copied message" variant="outline" onPress={() => void pasteMessage()} loading={busy} />
        </Card>
      </ScrollView>
    </ScreenContainer>
  );
}
