import { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SalaryChecks } from "@/components/goals/SalaryChecks";
import { Card, LoadingState, PeriodNavigator, ProgressBar, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getCurrentMonth } from "@/services/budget";
import { getMonthAccounts, getMyMonth, type MonthAccount, type MyMonth } from "@/services/my-month";
import type { MyMonthSection } from "@/services/my-month-rows";
import { formatAmount } from "@/utils/expense-validation";

const TOP_CATEGORIES = 5;

function Heading({ children }: { children: string }) {
  return <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{children}</Text>;
}

function Row({ label, amount, sign = "", onPress }: { label: string; amount: number; sign?: string; onPress?: () => void }) {
  const tint = useTheme().mutedForeground;
  return (
    <Pressable disabled={!onPress} onPress={onPress} className="flex-row items-center justify-between py-1.5" accessibilityRole={onPress ? "button" : undefined}>
      <Text className="text-sm text-foreground flex-1 mr-3">{label}</Text>
      <Text className="text-sm font-semibold text-foreground">{sign}{formatAmount(amount)}</Text>
      {onPress && <Ionicons name="chevron-forward" size={13} color={tint} style={{ marginLeft: 4 }} />}
    </Pressable>
  );
}

function SubRow({ label, amount, onPress }: { label: string; amount: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-row justify-between py-1" accessibilityRole="button">
      <Text className="text-xs text-muted-foreground flex-1 mr-3" numberOfLines={1}>{label}</Text>
      <Text className="text-xs text-muted-foreground">{formatAmount(amount)}</Text>
    </Pressable>
  );
}

/** "This is my salary, how I spent it": what came in, where it went (invested, spent by you, spent for others), and what's left. */
export default function MyMonthScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ month?: string }>();
  const [month, setMonth] = useState(params.month ?? getCurrentMonth());
  const [data, setData] = useState<MyMonth | null>(null);
  const [accounts, setAccounts] = useState<MonthAccount[]>([]);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useDataRefresh(
    useCallback(async () => {
      try {
        setData(await getMyMonth(DEFAULT_USER_ID, month));
        setFailed(false);
      } catch {
        setFailed(true);
      }
      // Separate from the sums above, so a balance problem can't blank the page.
      setAccounts(await getMonthAccounts(DEFAULT_USER_ID, month).catch(() => []));
    }, [month]),
  );

  const drill = (section: MyMonthSection, title: string, categoryId?: string) => () =>
    router.push({ pathname: "/summary/my-month-rows", params: { month, section, title, ...(categoryId ? { categoryId } : {}) } });

  const categories = data ? (showAll ? data.categories : data.categories.slice(0, TOP_CATEGORIES)) : [];
  // Before pay day, being behind is just the calendar: no red, and it says so below.
  const beforePayDay = !!data?.salaryDue && data.leftOver < 0;
  const leftColor = beforePayDay ? theme.foreground : data && data.leftOver < 0 ? theme.danger : theme.success;
  const dueLabel = data?.salaryDue
    ? new Date(`${data.salaryDue.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
    : "";

  // Money you can use today: bank and wallets, not investments or cards.
  const cash = accounts.reduce((s, a) => s + a.balance, 0);
  const cashGroup = (type: MonthAccount["type"]) => accounts.filter((a) => a.type === type);
  const cashGroups = [
    { key: "savings", label: "Savings accounts", icon: "business-outline" as const, color: theme.primary, route: "/reconciliation/bank-accounts" as const, list: cashGroup("savings") },
    { key: "wallet", label: "Wallets", icon: "wallet-outline" as const, color: theme.warning, route: "/reconciliation/wallets" as const, list: cashGroup("wallet") },
  ]
    .filter((g) => g.list.length > 0)
    .map((g) => ({ ...g, count: g.list.length, total: g.list.reduce((s, a) => s + a.balance, 0) }));

  const cameIn = data ? data.moneyIn + data.people.repaid : 0;
  const flow = data
    ? [
        { key: "invested", label: "Invested", amount: data.savedTotal, color: theme.warning, section: "saved" as const },
        { key: "spent", label: "Spent by you", amount: data.spent, color: theme.primary, section: "spent" as const },
        { key: "others", label: "Spent for others", amount: data.people.billsShare, color: theme.alpha("primary", 0.45), section: "bills" as const },
        { key: "adjusted", label: "Balance adjustments", amount: data.adjustedOut, color: theme.mutedForeground, section: "spent" as const },
      ]
    : [];
  // The bar is out of money in; if more went out than came in, out of that instead.
  const barWhole = Math.max(cameIn, flow.reduce((s, f) => s + f.amount, 0), 1);

  return (
    <ScreenContainer padTop={false}>
      <PeriodNavigator mode="month" value={month} onChange={setMonth} />
      {failed ? (
        <View className="p-4">
          <Card>
            <Text className="text-sm text-muted-foreground">Couldn&apos;t load this month. Go back and try again.</Text>
          </Card>
        </View>
      ) : !data ? (
        <LoadingState message="Adding up your month..." icon="calendar-outline" />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <SalaryChecks month={month} />
          {/* The whole month in one sum: what came in, where it went, and what's left. */}
          <Card className="mb-3">
            <Pressable onPress={drill("in", "Money came in")} accessibilityRole="button" accessibilityLabel="Money came in, see transactions">
              <Text className="text-xs text-muted-foreground">Money came in</Text>
              <View className="flex-row items-center justify-between">
                <Text className="text-title font-bold text-foreground">{formatAmount(cameIn)}</Text>
                <Ionicons name="chevron-forward" size={15} color={theme.mutedForeground} />
              </View>
            </Pressable>

            <View className="mt-1">
              {data.salary > 0 ? (
                <SubRow label="Income" amount={data.salary} onPress={drill("income", "Income")} />
              ) : data.salaryDue ? (
                <View className="py-1">
                  <Text className="text-xs text-muted-foreground">Income due around {dueLabel}</Text>
                  {data.salaryDue.amount > 0 && (
                    <Text className="text-xs text-faint-foreground mt-0.5">{formatAmount(data.salaryDue.amount)} expected, not counted until it arrives</Text>
                  )}
                </View>
              ) : (
                // Nothing marked as income: asking beats showing a confident ₹0 on someone's pay.
                <Pressable onPress={() => router.push({ pathname: "/(tabs)/expenses", params: { preset: "credits" } })} className="py-1" accessibilityRole="button">
                  <Text className="text-xs" style={{ color: theme.primary }}>No income found. Already paid? Set the credit's type to Income</Text>
                </Pressable>
              )}
              {data.otherIncome > 0 && <SubRow label="Other money in" amount={data.otherIncome} onPress={drill("other", "Other money in")} />}
              {data.people.repaid > 0 && <SubRow label="Repaid to you" amount={data.people.repaid} onPress={drill("repaid", "Repaid to you")} />}
              {data.salaryMovedOut > 0 && (
                <Text className="text-xs text-faint-foreground mt-1">
                  {formatAmount(data.salaryMovedOut)} of income arrived this month but counts for another, by your income setting.
                </Text>
              )}
            </View>

            <View className="flex-row rounded-full overflow-hidden mt-3 mb-1" style={{ height: 10, backgroundColor: theme.alpha("foreground", 0.08), gap: 2 }}>
              {flow.filter((f) => f.amount > 0).map((f) => (
                <View key={f.key} style={{ width: `${(f.amount / barWhole) * 100}%`, backgroundColor: f.color }} />
              ))}
            </View>

            {flow.map((f) => (
              <View key={f.key}>
                <Pressable onPress={drill(f.section, f.label)} className="flex-row items-center py-2" accessibilityRole="button">
                  <View className="w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: f.color }} />
                  <Text className="text-sm text-foreground flex-1 mr-2">{f.label}</Text>
                  {cameIn > 0 && <Text className="text-xs text-muted-foreground mr-2">{Math.round((f.amount / cameIn) * 100)}%</Text>}
                  <Text className="text-sm font-semibold text-foreground">{formatAmount(f.amount)}</Text>
                  <Ionicons name="chevron-forward" size={13} color={theme.mutedForeground} style={{ marginLeft: 4 }} />
                </Pressable>
                {/* Only worth spelling out when it's more than one kind. */}
                {f.key === "invested" && data.saved.length > 1 && (
                  <View className="ml-4">
                    {data.saved.map((x) => <SubRow key={x.label} label={x.label} amount={x.amount} onPress={drill(x.section, x.label)} />)}
                  </View>
                )}
              </View>
            ))}

            <Pressable
              onPress={drill("left", beforePayDay ? "So far this month" : "What's left")}
              className="flex-row items-center justify-between pt-3 mt-1 border-t border-border"
              accessibilityRole="button"
            >
              <Text className="text-base font-semibold" style={{ color: leftColor }}>
                {beforePayDay ? "So far this month" : data.leftOver < 0 ? "More went out, by" : "What's left"}
              </Text>
              <Text className="text-xl font-bold" style={{ color: leftColor }}>{beforePayDay ? "−" : ""}{formatAmount(Math.abs(data.leftOver))}</Text>
            </Pressable>
          </Card>

          {data.categories.length > 0 && (
            <Card className="mb-3">
              <Heading>What you spent on</Heading>
              {categories.map((c) => (
                <Pressable key={c.categoryId ?? "none"} onPress={drill("spent", c.name, c.categoryId ?? "none")} className="py-1.5" accessibilityRole="button">
                  <View className="flex-row justify-between mb-1">
                    <Text className="text-xs text-muted-foreground flex-1 mr-3" numberOfLines={1}>{c.name}</Text>
                    <Text className="text-xs text-muted-foreground">{formatAmount(c.total)}</Text>
                  </View>
                  <ProgressBar value={data.spent > 0 ? c.total / data.spent : 0} color={theme.primary} height={5} animated={false} />
                </Pressable>
              ))}
              {data.categories.length > TOP_CATEGORIES && (
                <Pressable onPress={() => setShowAll((v) => !v)} className="pt-1.5" accessibilityRole="button">
                  <Text className="text-xs font-medium" style={{ color: theme.primary }}>
                    {showAll ? "Show less" : `See all ${data.categories.length} categories`}
                  </Text>
                </Pressable>
              )}
            </Card>
          )}

          <Card className="mb-3">
            <Heading>After your budget</Heading>
            {!data.afterBudget ? (
              <Pressable onPress={() => router.push("/settings/budget-config")} className="py-1.5" accessibilityRole="button">
                <Text className="text-sm" style={{ color: theme.primary }}>Set a budget to see what you can still save</Text>
              </Pressable>
            ) : data.moneyIn <= 0 ? (
              <Text className="text-sm text-muted-foreground py-1.5">Shows once money comes in this month</Text>
            ) : (
              <>
                <Row label="Money came in" amount={cameIn} onPress={drill("in", "Money came in")} />
                {data.people.billsShare > 0 && <Row label="Spent for others" amount={data.people.billsShare} sign="−" onPress={drill("bills", "Spent for others")} />}
                {data.adjustedOut > 0 && <Row label="Balance adjustments" amount={data.adjustedOut} sign="−" />}
                {data.savedTotal > 0 && <Row label="Invested" amount={data.savedTotal} sign="−" onPress={drill("saved", "Invested")} />}
                <Row label="Your budget for the month" amount={data.afterBudget.budget} sign="−" onPress={() => router.push("/(tabs)/budget")} />
                {data.afterBudget.overspend > 0 && (
                  <Row label="Spent beyond your budget" amount={data.afterBudget.overspend} sign="−" onPress={drill("spent", "Spent by you")} />
                )}
                <View className="flex-row justify-between items-center pt-2 mt-1 border-t border-border">
                  <Text className="text-sm font-semibold flex-1 mr-3" style={{ color: data.afterBudget.free < 0 ? theme.danger : theme.success }}>
                    {data.afterBudget.free < 0 ? "Short by" : "You can still save or spend"}
                  </Text>
                  <Text className="text-base font-bold" style={{ color: data.afterBudget.free < 0 ? theme.danger : theme.success }}>
                    {formatAmount(Math.abs(data.afterBudget.free))}
                  </Text>
                </View>
                {data.afterBudget.free < 0 && (
                  <Text className="text-xs text-muted-foreground mt-1">If you spend your full budget, this is how much more you'd need this month.</Text>
                )}
              </>
            )}
          </Card>

          {accounts.length > 0 && (
            <Card className="mb-3">
              <Text className="text-xs text-muted-foreground">{month === getCurrentMonth() ? "Cash available" : "Cash available at month end"}</Text>
              <Text className="text-title font-bold mt-0.5" style={{ color: cash < 0 ? theme.danger : theme.foreground }}>{formatAmount(cash)}</Text>
              <View className="flex-row rounded-full overflow-hidden mt-3 mb-1" style={{ height: 10, backgroundColor: theme.alpha("foreground", 0.08), gap: 2 }}>
                {cashGroups.filter((g) => g.total > 0).map((g) => (
                  <View key={g.key} style={{ flex: g.total, backgroundColor: g.color }} />
                ))}
              </View>
              {cashGroups.map((g, i) => (
                <Pressable key={g.key} onPress={() => router.push(g.route)} className={`flex-row items-center py-2.5 ${i < cashGroups.length - 1 ? "border-b border-border" : ""}`} accessibilityRole="button" accessibilityLabel={`${g.label}, see accounts`}>
                  <View className="w-9 h-9 rounded-full items-center justify-center mr-3" style={{ backgroundColor: theme.alpha("primary", 0.08) }}>
                    <Ionicons name={g.icon} size={18} color={g.color} />
                  </View>
                  <View className="flex-1 mr-2">
                    <Text className="text-sm font-medium text-foreground">{g.label}</Text>
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      {g.count} {g.count === 1 ? "account" : "accounts"}{cash > 0 && g.total > 0 ? ` · ${Math.round((g.total / cash) * 100)}%` : ""}
                    </Text>
                  </View>
                  <Text className="text-sm font-semibold text-foreground">{formatAmount(g.total)}</Text>
                  <Ionicons name="chevron-forward" size={13} color={theme.mutedForeground} style={{ marginLeft: 4 }} />
                </Pressable>
              ))}
            </Card>
          )}

          {data.waitingForReview > 0 && (
            <Pressable onPress={() => router.push("/expense/review-queue")} className="flex-row items-center px-1" accessibilityRole="button">
              <Ionicons name="time-outline" size={14} color={theme.mutedForeground} />
              <Text className="text-xs ml-1.5 flex-1" style={{ color: theme.primary }}>
                {data.waitingForReview} waiting for review {data.waitingForReview === 1 ? "isn't" : "aren't"} counted yet
              </Text>
            </Pressable>
          )}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}
