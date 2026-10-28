import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Share, View } from "react-native";
import { useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, ScreenContainer, Text, useToast } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { approveJoin, createInvite, declineJoin, getJoinRequests, type Invite, type JoinRequest } from "@/services/household/household";
import { getActiveHousehold } from "@/services/household/store";
import { formatError } from "@/utils/error-message";

const POLL_MS = 4000;

/**
 * Invite someone: a QR code to scan in person, or a link to send. Waits here for their request and
 * shows the check code to compare before approving.
 */
export default function InviteScreen() {
  const router = useRouter();
  const toast = useToast();
  const theme = useTheme();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [householdName, setHouseholdName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const made = useRef(false);

  useEffect(() => {
    if (made.current) return;
    made.current = true;
    (async () => {
      try {
        setHouseholdName((await getActiveHousehold())?.name ?? "");
        setInvite(await createInvite());
      } catch (e) {
        setError(formatError("Invite", e));
      }
    })();
  }, []);

  const poll = useCallback(async () => {
    try {
      setRequests(await getJoinRequests());
    } catch {
      /* offline: try again next tick */
    }
  }, []);

  useEffect(() => {
    if (!invite) return;
    const t = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(t);
  }, [invite, poll]);

  const share = async () => {
    if (!invite) return;
    await Share.share({
      message: `Join "${householdName}" on Arth, so we can see our household spending together: ${invite.link}\n\nOpen it on your phone (Arth needs to be installed). The link works once and for 24 hours.`,
    });
  };

  const approve = async (r: JoinRequest) => {
    setBusy(r.inviteId);
    try {
      await approveJoin(r);
      toast(`${r.name} joined`);
      router.back();
    } catch (e) {
      toast(formatError("Approve", e), { tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {requests.map((r) => (
          <Card key={r.inviteId} className="mb-3">
            <Text className="text-base font-semibold text-foreground">{r.name} wants to join</Text>
            <Text className="text-xs text-muted-foreground mt-0.5">{r.device}</Text>
            <View className="items-center my-4">
              <Text className="text-xs text-muted-foreground">Check code</Text>
              <Text className="text-3xl font-bold text-foreground" style={{ letterSpacing: 2 }}>
                {r.code}
              </Text>
              <Text className="text-xs text-muted-foreground mt-2 text-center leading-4">
                {r.name}&apos;s phone shows a code too. Approve only if they match; if you&apos;re apart, read it out on a call.
              </Text>
            </View>
            <View className="flex-row gap-2">
              <Button
                title="Decline"
                variant="outline"
                className="flex-1"
                onPress={async () => {
                  await declineJoin(r.inviteId);
                  setRequests((rs) => rs.filter((x) => x.inviteId !== r.inviteId));
                }}
              />
              <Button title="Approve" className="flex-1" loading={busy === r.inviteId} onPress={() => void approve(r)} />
            </View>
          </Card>
        ))}

        <Card>
          {error ? (
            <Text className="text-sm text-danger">{error}</Text>
          ) : !invite ? (
            <View className="items-center py-10">
              <ActivityIndicator />
            </View>
          ) : (
            <View className="items-center">
              <View style={{ padding: 12, backgroundColor: "#FFFFFF", borderRadius: 12 }}>
                <QRCode value={invite.link} size={200} />
              </View>
              <Text className="text-base font-semibold text-foreground mt-4 text-center">Scan this on their phone</Text>
              <Text className="text-xs text-muted-foreground mt-1 text-center">
                In their Arth: Settings → Household → Join a household
              </Text>
              <Button title="Send an invite link instead" variant="outline" className="mt-4 self-stretch" onPress={() => void share()} />
              <View className="flex-row items-center mt-4">
                <ActivityIndicator size="small" color={theme.mutedForeground} />
                <Text className="text-xs text-muted-foreground ml-2">Waiting for them to join · works once, for 24 hours</Text>
              </View>
            </View>
          )}
        </Card>

        <View className="flex-row items-start mt-4 px-1">
          <Ionicons name="lock-closed-outline" size={14} color={theme.mutedForeground} style={{ marginTop: 1 }} />
          <Text className="text-xs text-muted-foreground ml-2 flex-1 leading-4">
            Nothing is shared just by joining. Each person picks what to share, with a preview first.
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
