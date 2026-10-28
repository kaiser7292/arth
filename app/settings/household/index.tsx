import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, ScreenContainer, Text, useToast } from "@/components/ui";
import { Avatar, ago } from "@/components/household/HouseholdBits";
import { useAlert } from "@/hooks/use-alert";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount } from "@/utils/format";
import { formatError } from "@/utils/error-message";
import {
  approveJoin,
  closeHousehold,
  declineJoin,
  forgetHousehold,
  getJoinRequests,
  getPendingJoin,
  leaveHousehold,
  removeMember,
  type JoinRequest,
} from "@/services/household/household";
import { getEvents, getHousehold, getItems, getMembers } from "@/services/household/store";
import { syncHousehold } from "@/services/household/sync";
import type { Household, HouseholdEvent, HouseholdItem, HouseholdMember } from "@/services/household/types";

const ENDED: Record<string, { title: string; body: string }> = {
  removed: { title: "You were removed", body: "You're no longer in this household. What others shared has been removed from this phone; your own data is untouched." },
  closed: { title: "The household was closed", body: "It no longer exists. What others shared has been removed from this phone; your own data is untouched." },
  moved: { title: "Now on your other phone", body: "This household is being used on another phone (you restored a backup there). This phone has stopped syncing it." },
  no_keys: { title: "This phone can't open the household", body: "Its keys aren't on this phone (a scheduled backup doesn't carry them). Leave it here, then ask to be invited again." },
  left: { title: "You left", body: "What others shared has been removed from this phone." },
};

function eventLine(e: HouseholdEvent, who: string): string {
  const p = e.payload_json ? (JSON.parse(e.payload_json) as { count?: number; name?: string; amount?: number }) : {};
  switch (e.type) {
    case "created":
      return `${who} started ${p.name ?? "the household"}`;
    case "joined":
      return `${who} joined`;
    case "left":
      return `${who} left`;
    case "removed":
      return `${who} was removed`;
    case "renamed":
      return `${who} renamed it ${p.name ?? ""}`;
    case "budget_proposed":
      return `${who} proposed a household budget`;
    case "goal_started":
      return `${who} started a goal${p.name ? `: ${p.name}` : ""}`;
    case "settled":
      return `${who} settled up ${p.amount ? formatAmount(p.amount) : ""}`.trim();
    case "rekeyed":
      return "The household key was changed";
    default:
      return who;
  }
}

/**
 * Settings → Household (Together, Phase 1): start or join a household, who's in it, what each person
 * shares, and recent activity. Design: docs/HOUSEHOLD_PHASE1_DESIGN.md §2.
 */
export default function HouseholdScreen() {
  const router = useRouter();
  const toast = useToast();
  const alert = useAlert();
  const theme = useTheme();
  const [loaded, setLoaded] = useState(false);
  const [h, setH] = useState<Household | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [everMembers, setEverMembers] = useState<HouseholdMember[]>([]);
  const [events, setEvents] = useState<HouseholdEvent[]>([]);
  const [items, setItems] = useState<HouseholdItem[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [pendingJoin, setPendingJoin] = useState<{ code: string; householdName: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const hh = await getHousehold();
    setH(hh);
    if (hh && hh.status === "active") {
      // Everyone who was ever in it, so activity from someone who left still shows their name.
      const [all, e, it] = await Promise.all([getMembers(hh.id, true), getEvents(hh.id, 30), getItems(hh.id)]);
      setEverMembers(all);
      setMembers(all.filter((m) => !m.removed_at));
      setEvents(e);
      setItems(it);
      if (hh.role === "creator") getJoinRequests().then(setRequests).catch(() => undefined);
    } else {
      setPendingJoin(await getPendingJoin());
    }
    setLoaded(true);
  }, []);
  useDataRefresh(load);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await syncHousehold();
      if (r.error) toast(r.error === "offline" ? "You're offline. It'll sync when you're back." : `Couldn't sync (${r.error})`, { tone: "danger" });
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const run = async (key: string, fn: () => Promise<void>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) toast(done);
      await load();
    } catch (e) {
      toast(formatError("Household", e), { tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  if (!loaded) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </ScreenContainer>
    );
  }

  // ── Not in a household ──
  if (!h) {
    return (
      <ScreenContainer padTop={false}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View className="items-center mt-4 mb-6 px-4">
            <View className="w-16 h-16 rounded-full items-center justify-center" style={{ backgroundColor: theme.alpha("primary", 0.12) }}>
              <Ionicons name="people-outline" size={30} color={theme.primary} />
            </View>
            <Text className="text-xl font-bold text-foreground mt-4 text-center">Money, together</Text>
            <Text className="text-sm text-muted-foreground mt-2 text-center leading-5">
              Share household spending with your partner or family (up to 5 people). Each of you keeps your own Arth and
              chooses what to share. It&apos;s locked so only your household&apos;s phones can read it.
            </Text>
          </View>
          {pendingJoin && (
            <Card className="mb-3">
              <Text className="text-sm font-semibold text-foreground">Waiting to join {pendingJoin.householdName}</Text>
              <Text className="text-xs text-muted-foreground mt-1">Check code {pendingJoin.code}</Text>
              <Button title="Open" variant="outline" className="mt-3" onPress={() => router.push("/settings/household/join")} />
            </Card>
          )}
          <Button title="Start a household" onPress={() => router.push("/settings/household/start")} className="mb-3" />
          <Button title="Join a household" variant="outline" onPress={() => router.push("/settings/household/join")} />
          <Card className="mt-6">
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">How it stays private</Text>
            {[
              ["eye-off-outline", "Nothing is shared until you choose, with a preview first."],
              ["lock-closed-outline", "Changes travel end-to-end encrypted. Arth's relay can't read them."],
              ["exit-outline", "Leave any time. What you shared disappears from the others' phones."],
            ].map(([icon, line]) => (
              <View key={line} className="flex-row items-start py-1.5">
                <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={16} color={theme.mutedForeground} style={{ marginTop: 1 }} />
                <Text className="text-xs text-muted-foreground ml-2 flex-1 leading-4">{line}</Text>
              </View>
            ))}
          </Card>
        </ScrollView>
      </ScreenContainer>
    );
  }

  // ── Ended (removed, closed, moved, keys missing) ──
  if (h.status !== "active") {
    const msg = ENDED[h.status] ?? ENDED.left;
    return (
      <ScreenContainer padTop={false}>
        <View className="p-4">
          <Card>
            <Text className="text-base font-semibold text-foreground">{msg.title}</Text>
            <Text className="text-sm text-muted-foreground mt-2 leading-5">{msg.body}</Text>
            <Button title="OK" className="mt-4" onPress={() => run("forget", forgetHousehold)} loading={busy === "forget"} />
          </Card>
        </View>
      </ScreenContainer>
    );
  }

  // ── In a household ──
  const isCreator = h.role === "creator";
  const nameOf = (id: string | null) => (id === h.my_member_id ? "You" : (everMembers.find((m) => m.id === id)?.name ?? "Someone"));
  // Moments only: who joined, left, settled up. Spending lives in Together; sync is never news.
  const moments = events.filter((e) => e.type !== "shared" && e.type !== "rekeyed");

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={syncNow} />}
      >
        <Button title="Open Together" onPress={() => router.push("/together")} className="mb-3" />

        <Card className="mb-3">
          <View className="flex-row items-center">
            <View className="flex-row mr-3">
              {members.slice(0, 5).map((m, i) => (
                <View key={m.id} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                  <Avatar member={m} />
                </View>
              ))}
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-foreground">{h.name}</Text>
              <Text className="text-xs text-muted-foreground mt-0.5">
                {h.last_sync_error
                  ? h.last_sync_error === "offline"
                    ? "Offline · will sync when you're back"
                    : `Couldn't sync · ${h.last_sync_error}`
                  : `Synced ${ago(h.last_sync_at)}`}
              </Text>
            </View>
            <Pressable onPress={syncNow} hitSlop={10} accessibilityRole="button" accessibilityLabel="Sync now">
              {syncing ? <ActivityIndicator /> : <Ionicons name="refresh" size={20} color={theme.primary} />}
            </Pressable>
          </View>
        </Card>

        {requests.map((r) => (
          <Card key={r.inviteId} className="mb-3">
            <Text className="text-sm font-semibold text-foreground">{r.name} wants to join</Text>
            <Text className="text-xs text-muted-foreground mt-1">{r.device}</Text>
            <View className="items-center my-3">
              <Text className="text-xs text-muted-foreground">Check code</Text>
              <Text className="text-2xl font-bold text-foreground tracking-wider">{r.code}</Text>
              <Text className="text-xs text-muted-foreground mt-1 text-center">It should match the code on {r.name}&apos;s phone.</Text>
            </View>
            <View className="flex-row gap-2">
              <Button title="Decline" variant="outline" className="flex-1" onPress={() => run(`d${r.inviteId}`, () => declineJoin(r.inviteId), "Declined")} />
              <Button title="Approve" className="flex-1" loading={busy === `a${r.inviteId}`} onPress={() => run(`a${r.inviteId}`, () => approveJoin(r), `${r.name} joined`)} />
            </View>
          </Card>
        ))}

        <Card className="mb-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">People</Text>
          {members.map((m) => (
            <View key={m.id} className="flex-row items-center py-2 border-b border-border">
              <Avatar member={m} size={28} />
              <View className="flex-1 ml-3">
                <Text className="text-sm text-foreground">
                  {m.id === h.my_member_id ? `${m.name} (you)` : m.name}
                  {m.role === "creator" ? " · started it" : ""}
                </Text>
                {m.joined_at ? <Text className="text-xs text-muted-foreground">Joined {ago(m.joined_at)}</Text> : null}
              </View>
              {isCreator && m.id !== h.my_member_id && (
                <Pressable
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${m.name}`}
                  onPress={() =>
                    alert(`Remove ${m.name}?`, `What ${m.name} shared disappears from this household, and the household's key changes so their phone can't read anything new. What they already have stays on their phone.`, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Remove", style: "destructive", onPress: () => run(`r${m.id}`, () => removeMember(m.id), `${m.name} removed`) },
                    ])
                  }
                >
                  <Ionicons name="person-remove-outline" size={18} color={theme.mutedForeground} />
                </Pressable>
              )}
            </View>
          ))}
          {isCreator && members.length < 5 && (
            <Button title="Invite someone" variant="outline" className="mt-3" onPress={() => router.push("/settings/household/invite")} />
          )}
        </Card>

        <Card className="mb-3">
          <Pressable className="flex-row items-center py-2 border-b border-border" onPress={() => router.push("/settings/household/share")} accessibilityRole="button">
            <Ionicons name="eye-outline" size={20} color={theme.mutedForeground} />
            <View className="flex-1 ml-3">
              <Text className="text-sm text-foreground">What you share</Text>
              <Text className="text-xs text-muted-foreground">
                {[
                  h.share_all_transactions ? "every transaction" : null,
                  !h.share_all_transactions && h.share_household_categories ? "household categories" : null,
                  !h.share_all_transactions && h.share_other_totals ? "totals of the rest" : null,
                  h.share_savings_rate ? "savings rate" : null,
                  h.share_balances ? "balances" : null,
                ]
                  .filter(Boolean)
                  .join(", ") || "Nothing yet"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
          </Pressable>
          <Pressable className="flex-row items-center py-2" onPress={() => router.push("/settings/household/categories")} accessibilityRole="button">
            <Ionicons name="grid-outline" size={20} color={theme.mutedForeground} />
            <View className="flex-1 ml-3">
              <Text className="text-sm text-foreground">Household categories</Text>
              <Text className="text-xs text-muted-foreground">Which of your categories count as household spending</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
          </Pressable>
        </Card>

        {moments.length > 0 && (
          <Card className="mb-3">
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Activity</Text>
            {moments.slice(0, 15).map((e) => (
              <View key={e.id} className="flex-row items-center justify-between py-1.5">
                <Text className="text-sm text-foreground flex-1 mr-2">{eventLine(e, nameOf(e.member_id))}</Text>
                <Text className="text-xs text-muted-foreground">{ago(e.at)}</Text>
              </View>
            ))}
          </Card>
        )}

        <Button
          title={isCreator ? "Close household" : "Leave household"}
          variant="ghost"
          loading={busy === "leave"}
          onPress={() =>
            alert(
              isCreator ? `Close ${h.name}?` : `Leave ${h.name}?`,
              isCreator
                ? "It closes for everyone and is deleted from Arth's relay. Each person keeps their own data."
                : "What you shared disappears from the others' phones, and what they shared disappears from yours. Your own data stays.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: isCreator ? "Close" : "Leave",
                  style: "destructive",
                  onPress: () => run("leave", isCreator ? closeHousehold : leaveHousehold, isCreator ? "Household closed" : "You left"),
                },
              ],
            )
          }
        />
      </ScrollView>
    </ScreenContainer>
  );
}
