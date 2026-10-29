import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, PeriodNavigator, ScreenContainer, Text, useToast } from "@/components/ui";
import { Avatar, ago } from "@/components/household/HouseholdBits";
import { PaidBillsCard } from "@/components/household/PaidBillsCard";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount } from "@/utils/format";
import { getStatement, type Statement } from "@/services/household/statement";
import { ensureMemberLinks, linkMember, linkMemberToNewPerson, type LinkSuggestion } from "@/services/household/shares";
import { syncHousehold, requestSync } from "@/services/household/sync";
import { getBudgetState, getGoals, type BudgetState, type Goal } from "@/services/household/plans";
import { getTheirCategories } from "@/services/household/their-categories";

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * Together: the household's shared money in one statement (Together rework). Who paid what, what
 * it means between you, your balance with each person and whether both phones agree, and settling
 * up. Personal spending appears only if its owner shares every transaction.
 */
export default function TogetherScreen() {
  const router = useRouter();
  const theme = useTheme();
  const toast = useToast();
  const [month, setMonth] = useState(thisMonth());
  const [s, setS] = useState<Statement | null | undefined>(undefined);
  const [suggestions, setSuggestions] = useState<LinkSuggestion[]>([]);
  const [budget, setBudget] = useState<BudgetState | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [theirCount, setTheirCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const st = await getStatement(month);
    setS(st);
    if (st) {
      setSuggestions(await ensureMemberLinks(st.household).catch(() => []));
      setBudget(await getBudgetState(st.household, month).catch(() => null));
      setGoals(await getGoals(st.household).catch(() => []));
      setTheirCount((await getTheirCategories(st.household).catch(() => [])).filter((t) => t.needsChoice).length);
    }
  }, [month]);
  useDataRefresh(load);

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
      <PeriodNavigator mode="month" value={month} onChange={setMonth} />
      <ScrollView
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={syncNow} />}
      >
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

          <PaidBillsCard household={h} reloadKey={s} />

          {/* Household budget: agreed together; spent counts every shared bill, whoever paid. */}
          <Card className="mb-3">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Household budget</Text>
              {budget?.active && !budget.pending && (
                <Pressable onPress={() => router.push("/together/budget")} hitSlop={8}>
                  <Text className="text-xs" style={{ color: theme.primary }}>Change</Text>
                </Pressable>
              )}
            </View>
            {budget?.pending && budget.pending.by.id !== h.my_member_id && (
              <Pressable
                onPress={() => router.push({ pathname: "/together/budget", params: { review: budget.pending!.id } })}
                className="flex-row items-center justify-between py-2"
              >
                <Text className="text-sm text-foreground flex-1 mr-2">
                  {budget.pending.by.name} proposed a budget of {formatAmount(Object.values(budget.pending.amounts).reduce((a, v) => a + v, 0))} a month
                </Text>
                <Text className="text-xs font-semibold" style={{ color: theme.primary }}>Review</Text>
              </Pressable>
            )}
            {budget?.pending && budget.pending.by.id === h.my_member_id && (
              <Text className="text-sm text-muted-foreground py-1">
                Waiting for {budget.pending.waitingFor.map((m) => m.name).join(", ")} to accept your budget.
              </Text>
            )}
            {budget?.active ? (
              <>
                {budget.lines.map((l) => {
                  const ratio = l.budget > 0 ? l.spent / l.budget : 1;
                  return (
                    <View key={l.category} className="py-1.5">
                      <View className="flex-row justify-between">
                        <Text className="text-sm text-foreground">{l.category}</Text>
                        <Text className="text-xs" style={{ color: ratio > 1 ? theme.danger : ratio > 0.85 ? theme.warning : theme.mutedForeground }}>
                          {formatAmount(l.spent)} of {formatAmount(l.budget)}
                        </Text>
                      </View>
                      <View className="h-1.5 rounded-full overflow-hidden mt-1" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                        <View style={{ width: `${Math.min(100, ratio * 100)}%`, height: "100%", backgroundColor: ratio > 1 ? theme.danger : ratio > 0.85 ? theme.warning : theme.primary }} />
                      </View>
                    </View>
                  );
                })}
                <Text className="text-xs text-muted-foreground mt-1">
                  {formatAmount(budget.total.spent)} of {formatAmount(budget.total.budget)} together this month
                </Text>
              </>
            ) : (
              !budget?.pending && (
                <Pressable onPress={() => router.push("/together/budget")} className="py-1">
                  <Text className="text-sm" style={{ color: theme.primary }}>Agree a budget together</Text>
                </Pressable>
              )
            )}
          </Card>

          {/* Shared goals: each person saves their own part. */}
          <Card className="mb-3">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Goals together</Text>
              <Pressable onPress={() => router.push("/together/goal")} hitSlop={8}>
                <Text className="text-xs" style={{ color: theme.primary }}>New goal</Text>
              </Pressable>
            </View>
            {goals.length === 0 ? (
              <Text className="text-sm text-muted-foreground py-1">A trip, a house, a wedding: start one and each of you adds your part.</Text>
            ) : (
              goals.map((g) => (
                <Pressable key={g.id} onPress={() => router.push({ pathname: "/together/goal", params: { id: g.id } })} className="py-2">
                  <View className="flex-row justify-between">
                    <Text className="text-sm text-foreground">{g.name}</Text>
                    <Text className="text-xs text-muted-foreground">
                      {formatAmount(g.total)} of {formatAmount(g.target)}
                    </Text>
                  </View>
                  <View className="flex-row h-1.5 rounded-full overflow-hidden mt-1" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                    {g.parts.map((p) => (
                      <View key={p.member.id} style={{ width: `${g.target > 0 ? Math.min(100, (p.amount / g.target) * 100) : 0}%`, backgroundColor: p.member.colour ?? theme.primary }} />
                    ))}
                  </View>
                  {g.perMonthNeeded ? (
                    <Text className="text-xs text-muted-foreground mt-1">{formatAmount(g.perMonthNeeded)} a month together to make it by {g.by}</Text>
                  ) : null}
                </Pressable>
              ))
            )}
          </Card>

          {theirCount > 0 && (
            <Pressable onPress={() => router.push("/settings/household/categories")}>
              <Card className="mb-3">
                <View className="flex-row items-center">
                  <Ionicons name="pricetags-outline" size={18} color={theme.warning} />
                  <Text className="text-sm text-foreground flex-1 ml-2">
                    {theirCount} categor{theirCount === 1 ? "y" : "ies"} from your household you don&apos;t have. Map or create them.
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
                </View>
              </Card>
            </Pressable>
          )}

          {/* Totals, like the accounts screens: tap one for its transactions. */}
          <Card className="mb-3">
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Shared spending</Text>
            {s.byMember.map((b) => {
              const count = s.rows.filter((r) => r.member.id === b.member.id && r.relation.kind !== "settle" && r.relation.kind !== "personal").length;
              return (
                <Pressable
                  key={b.member.id}
                  onPress={() => router.push({ pathname: "/together/transactions", params: { month, member: b.member.id } })}
                  className="flex-row items-center py-2.5 border-b border-border"
                  accessibilityRole="button"
                >
                  <Avatar member={b.member} size={28} />
                  <View className="flex-1 ml-3">
                    <Text className="text-sm text-foreground">{b.member.id === h.my_member_id ? "You" : b.member.name}</Text>
                    <Text className="text-xs text-muted-foreground">{count} shared bill{count === 1 ? "" : "s"} paid</Text>
                  </View>
                  <Text className="text-sm font-semibold text-foreground mr-1">{formatAmount(b.paid)}</Text>
                  <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => router.push({ pathname: "/together/transactions", params: { month } })}
              className="flex-row items-center pt-2.5"
              accessibilityRole="button"
            >
              <Text className="text-sm flex-1" style={{ color: theme.primary }}>All transactions</Text>
              <Ionicons name="chevron-forward" size={14} color={theme.primary} />
            </Pressable>
          </Card>

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
