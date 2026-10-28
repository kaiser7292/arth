import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import * as Clipboard from "expo-clipboard";
import { QrScanner } from "@/components/household/QrScanner";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, Input, ScreenContainer, Text, useToast } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import {
  cancelPendingJoin,
  checkJoin,
  getPendingJoin,
  parseInviteLink,
  requestToJoin,
  type InviteLink,
} from "@/services/household/household";
import { formatError } from "@/utils/error-message";

const POLL_MS = 3000;

type Step =
  | { kind: "scan" }
  | { kind: "confirm"; link: InviteLink }
  | { kind: "waiting"; code: string; householdName: string; inviterName: string };

/**
 * Join a household: scan the QR on the inviting phone (or open the invite link), say how you'll
 * appear, compare the check code, and wait for approval. Then on to choosing what to share.
 */
export default function JoinScreen() {
  const router = useRouter();
  const toast = useToast();
  const theme = useTheme();
  const url = Linking.useURL();
  const [step, setStep] = useState<Step | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const scanned = useRef(false);

  // Where to start: a link that opened Arth, a join already waiting, or the scanner.
  useEffect(() => {
    (async () => {
      const fromLink = url ? parseInviteLink(url) : null;
      if (fromLink) {
        setStep({ kind: "confirm", link: fromLink });
        return;
      }
      const pending = await getPendingJoin();
      setStep(pending ? { kind: "waiting", ...pending } : { kind: "scan" });
    })();
  }, [url]);

  const onScanned = useCallback(
    (data: string) => {
      if (scanned.current) return;
      const link = parseInviteLink(data);
      if (!link) {
        toast("That isn't an Arth household invite");
        return;
      }
      scanned.current = true;
      setStep({ kind: "confirm", link });
    },
    [toast],
  );

  const pasteLink = async () => {
    const text = await Clipboard.getStringAsync();
    const link = text ? parseInviteLink(text.trim()) : null;
    if (link) setStep({ kind: "confirm", link });
    else toast("Copy the invite link first, then tap Paste");
  };

  const join = async (link: InviteLink) => {
    if (!name.trim()) {
      toast("Enter your name, as the others will see it", { tone: "danger" });
      return;
    }
    setBusy(true);
    try {
      const code = await requestToJoin(link, name);
      setStep({ kind: "waiting", code, householdName: link.householdName, inviterName: link.inviterName });
    } catch (e) {
      toast(formatError("Join", e), { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  // Waiting: check for approval every few seconds while this screen is open.
  useEffect(() => {
    if (step?.kind !== "waiting") return;
    let stopped = false;
    const tick = async () => {
      try {
        const s = await checkJoin();
        if (stopped) return;
        if (s.status === "joined") {
          toast(`You joined ${s.householdName ?? "the household"}`);
          router.replace("/settings/household/share");
        } else if (s.status === "declined") {
          toast("The invite was declined or has expired", { tone: "danger" });
          setStep({ kind: "scan" });
        }
      } catch {
        /* offline: keep waiting */
      }
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [step, router, toast]);

  if (!step) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {step.kind === "scan" && (
          <>
            <Text className="text-sm text-muted-foreground mb-3 leading-5">
              On the other phone: Settings → Household → Invite someone. Then scan the code it shows.
            </Text>
            <QrScanner onScanned={onScanned} />
            <Button title="Paste an invite link" variant="outline" className="mt-4" onPress={() => void pasteLink()} />
          </>
        )}

        {step.kind === "confirm" && (
          <>
            <Card className="mb-4">
              <View className="items-center py-2">
                <Ionicons name="people-outline" size={32} color={theme.primary} />
                <Text className="text-lg font-semibold text-foreground mt-2 text-center">
                  Join {step.link.inviterName ? `${step.link.inviterName}'s household` : "the household"} &quot;{step.link.householdName}&quot;?
                </Text>
                <Text className="text-xs text-muted-foreground mt-1 text-center">
                  Nothing is shared yet. You&apos;ll choose what to share next.
                </Text>
              </View>
            </Card>
            <Input label="Your name" value={name} onChangeText={setName} placeholder="Aastha" maxLength={40} autoFocus />
            <Text className="text-xs text-muted-foreground mt-1">How the others in the household will see you.</Text>
            <View className="flex-row gap-2 mt-6">
              <Button title="Not now" variant="outline" className="flex-1" onPress={() => router.back()} />
              <Button title="Join" className="flex-1" loading={busy} onPress={() => void join(step.link)} />
            </View>
          </>
        )}

        {step.kind === "waiting" && (
          <Card>
            <View className="items-center py-2">
              <Text className="text-xs text-muted-foreground">Check code</Text>
              <Text className="text-3xl font-bold text-foreground mt-1" style={{ letterSpacing: 2 }}>
                {step.code}
              </Text>
              <Text className="text-sm text-foreground mt-3 text-center">
                Waiting for {step.inviterName || "them"} to approve
              </Text>
              <Text className="text-xs text-muted-foreground mt-1 text-center leading-4">
                Their phone shows a code too. They should approve only if it matches this one.
              </Text>
              <ActivityIndicator className="mt-4" />
            </View>
            <Button
              title="Cancel"
              variant="ghost"
              className="mt-3"
              onPress={async () => {
                await cancelPendingJoin();
                router.back();
              }}
            />
          </Card>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
