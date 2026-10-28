import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, PeriodNavigator, ScreenContainer, Text, useToast } from "@/components/ui";
import { Avatar, ago } from "@/components/household/HouseholdBits";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount } from "@/utils/format";
import { getStatement, type Statement, type StatementRow } from "@/services/household/statement";
import { ensureMemberLinks, linkMember, linkMemberToNewPerson, type LinkSuggestion } from "@/services/household/shares";
import { syncHousehold, requestSync } from "@/services/household/sync";

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function dayLabel(date: string): string {
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (date === iso(today)) return "Today";
  if (date === iso(y)) return "Yesterday";
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const SPLIT_LABEL: Record<string, string> = { equal: "split equally", payer_all: "shared, paid in full", custom: "custom split" };

/**
 * Together: the household's shared money in one statement (Together rework). Who paid what, what
 * it means between you, your balance with each person and whether both phones agree, and settling
 * up. Personal spending only appears here as monthly totals, if its owner shares those.
 */
export default function TogetherScreen() {
  const router = useRouter();
  const theme = useTheme();
  const toast = useToast();
  const [month, setMonth] = useState(thisMonth());
  const [s, setS] = useState<Statement | null | undefined>(undefined);
  const [suggestions, setSuggestions] = useState<LinkSuggestion[]>([]);
  const [who, setWho] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const st = await getStatement(month);
    setS(st);
    if (st) setSuggestions(await ensureMemberLinks(st.household).catch(() => []));
  }, [month]);
  useDataRefresh(load);

  const rows = useMemo(() => (s?.rows ?? []).filter((r) => !who || r.member.id === who), [s, who]);
  const groups = useMemo(() => {
    const out: { date: string; rows: StatementRow[] }[] = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.date === r.date) last.rows.push(r);
      else out.push({ date: r.date, rows: [r] });
    }
    return out;
  }, [rows]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await syncHousehold();
      if (r.error) toast(r.error === "offline" ? "You're offline. It'll sync when you're back." : `Couldn't sync (${r.error})`, { tone: "danger" });
    } finally {
      setSyncing(false);
    }
  };

  if (s === undefined) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </ScreenContainer>
    );
  }

  if (s === null) {
    return (
      <ScreenContainer padTop={false}>
        <View className="p-4">
          <Card>
            <Text className="text-base font-semibold text-foreground">See your household&apos;s money together</Text>
            <Text className="text-sm text-muted-foreground mt-2 leading-5">
              Start a household or join one, and shared spending, who paid and who owes whom appear here.
            </Text>
            <Button title="Set up a household" className="mt-4" onPress={() => router.push("/settings/household")} />
          </Card>
        </View>
      </ScreenContainer>
    );
  }

  const h = s.household;
  const total = s.together;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={syncing} onRefresh={syncNow} />}>
        <PeriodNavigator mode="month" value={month} onChange={setMonth} />
        <View className="px-4">
          {suggestions.map((sg) => (
            <Card key={sg.member.id} className="mb-3">
              <Text className="text-sm font-semibold text-foreground">Is &quot;{sg.person.name}&quot; in your Hisaab the same {sg.member.name}?</Text>
              <Text className="text-xs text-muted-foreground mt-1 leading-4">
                Shared bills between you two will go into that Hisaab, on both phones.
              </Text>
              <View className="flex-row gap-2 mt-3">
                <Button
                  title="Keep separate"
                  variant="outline"
                  className="flex-1"
                  onPress={async () => {
                    await linkMemberToNewPerson(h, sg.member);
                    requestSync(500);
                    await load();
                  }}
                />
                <Button
                  title="Same person"
                  className="flex-1"
                  onPress={async () => {
                    await linkMember(h.id, sg.member.id, sg.person.id);
                    requestSync(500);
                    await load();
                  }}
                />
              </View>
            </Card>
          ))}

          <Card className="mb-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-muted-foreground">{h.name} · spent together</Text>
              <Pressable onPress={() => router.push("/settings/household")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Household settings">
                <Ionicons name="settings-outline" size={18} color={theme.mutedForeground} />
              </Pressable>
            </View>
            <Text className="text-2xl font-bold text-foreground mt-1">{formatAmount(total)}</Text>
            {total > 0 && (
              <View className="flex-row h-2 rounded-full overflow-hidden mt-2" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                {s.byMember.map((b) => (
                  <View key={b.member.id} style={{ flex: b.paid, backgroundColor: b.member.colour ?? theme.primary }} />
                ))}
              </View>
            )}
            <View className="flex-row flex-wrap mt-2">
              {s.byMember.map((b) => (
                <Text key={b.member.id} className="text-xs text-muted-foreground mr-3">
                  <Text style={{ color: b.member.colour ?? theme.primary }}>● </Text>
                  {b.member.id === h.my_member_id ? "You" : b.member.name} paid {formatAmount(b.paid)}
                </Text>
              ))}
            </View>
            {s.balances.map((b) => {
              const agree = b.theirs == null || Math.abs(b.theirs - b.amount) < 1;
              return (
                <View key={b.memberId} className="mt-3 pt-3 border-t border-border">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-sm font-semibold text-foreground flex-1 mr-2">
                      {b.amount < -0.5
                        ? `You owe ${b.name} ${formatAmount(-b.amount)}`
                        : b.amount > 0.5
                          ? `${b.name} owes you ${formatAmount(b.amount)}`
                          : `All square with ${b.name}`}
                    </Text>
                    {Math.abs(b.amount) > 0.5 && (
                      <Pressable
                        onPress={() => router.push({ pathname: "/together/settle", params: { memberId: b.memberId } })}
                        className="px-3 py-1 rounded-full"
                        style={{ backgroundColor: theme.alpha("primary", 0.12) }}
                        accessibilityRole="button"
                      >
                        <Text className="text-xs font-semibold" style={{ color: theme.primary }}>Settle up</Text>
                      </Pressable>
                    )}
                  </View>
                  <Text className="text-xs mt-1" style={{ color: agree ? theme.success : theme.warning }}>
                    {b.theirs == null
                      ? "Waiting for their phone to sync"
                      : agree
                        ? "Both phones agree"
                        : `${b.name}'s phone says ${b.theirs < 0 ? `you owe ${formatAmount(-b.theirs)}` : `they owe ${formatAmount(b.theirs)}`}`}
                  </Text>
                  <Pressable
                    onPress={() => router.push({ pathname: "/hisaab/ledger", params: { personId: b.personId, personName: b.name } })}
                    hitSlop={6}
                  >
                    <Text className="text-xs mt-1" style={{ color: theme.primary }}>Open Hisaab with {b.name}</Text>
                  </Pressable>
                </View>
              );
            })}
          </Card>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2" contentContainerStyle={{ gap: 6 }}>
            {[{ id: null as string | null, name: "Everyone" }, ...s.members.map((m) => ({ id: m.id, name: m.id === h.my_member_id ? "You" : m.name }))].map((c) => {
              const on = who === c.id;
              return (
                <Pressable
                  key={c.id ?? "all"}
                  onPress={() => setWho(c.id)}
                  className="px-3 py-1.5 rounded-full border"
                  style={{ borderColor: on ? "transparent" : theme.alpha("foreground", 0.15), backgroundColor: on ? theme.alpha("primary", 0.12) : "transparent" }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text className="text-xs" style={{ color: on ? theme.primary : theme.mutedForeground }}>{c.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {groups.length === 0 ? (
            <Card>
              <Text className="text-sm text-muted-foreground">
                No shared spending in this month yet. Spending in household categories is shared as you approve it; any other
                transaction can be shared from its screen.
              </Text>
            </Card>
          ) : (
            groups.map((g) => (
              <View key={g.date} className="mb-2">
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-2 mb-1">{dayLabel(g.date)}</Text>
                <Card>
                  {g.rows.map((r, idx) => (
                    <Pressable
                      key={r.id}
                      disabled={!r.expenseId}
                      onPress={() => r.expenseId && router.push(`/expense/${r.expenseId}`)}
                      className={`flex-row items-center py-2.5 ${idx < g.rows.length - 1 ? "border-b border-border" : ""}`}
                    >
                      <Avatar member={r.member} size={28} />
                      <View className="flex-1 ml-3 mr-2">
                        <Text className="text-sm text-foreground" numberOfLines={1}>{r.merchant || r.category || "Shared"}</Text>
                        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                          {r.relation.kind === "settle"
                            ? "Settle-up"
                            : [r.category, r.relation.kind === "personal" ? "personal" : SPLIT_LABEL[r.split ?? "equal"]].filter(Boolean).join(" · ")}
                        </Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-sm text-foreground">{formatAmount(r.paid)}</Text>
                        {r.relation.kind === "you_owe" && (
                          <Text className="text-xs" style={{ color: theme.danger }}>you owe {formatAmount(r.relation.amount)}</Text>
                        )}
                        {r.relation.kind === "owes_you" && (
                          <Text className="text-xs" style={{ color: theme.primary }}>
                            {r.relation.with} owes {formatAmount(r.relation.amount)}
                          </Text>
                        )}
                      </View>
                    </Pressable>
                  ))}
                </Card>
              </View>
            ))
          )}

          {s.totalsOnly.length > 0 && !who && (
            <Card className="mt-2">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Personal spending · totals only</Text>
              {s.totalsOnly
                .sort((a, b) => b.amount - a.amount)
                .slice(0, 12)
                .map((t) => (
                  <View key={`${t.member.id}-${t.category}`} className="flex-row items-center py-1.5">
                    <Avatar member={t.member} size={20} />
                    <Text className="text-sm text-foreground flex-1 ml-2">{t.category}</Text>
                    <Text className="text-sm text-muted-foreground">{formatAmount(t.amount)}</Text>
                  </View>
                ))}
            </Card>
          )}

          <Text className="text-xs text-muted-foreground text-center mt-4">
            {h.last_sync_error
              ? h.last_sync_error === "offline"
                ? "Offline · it'll sync when you're back"
                : "Couldn't sync · pull down to try again"
              : `Synced ${ago(h.last_sync_at)}`}
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
