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
import { getMonthAccounts, getMonthPeople, getMyMonth, type MonthAccount, type MyMonth } from "@/services/my-month";
import { formatAmount } from "@/utils/expense-validation";

const TOP_CATEGORIES = 5;

function Heading({ children }: { children: string }) {
  return <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{children}</Text>;
}

function Row({ label, amount, sign = "", onPress }: { label: string; amount: number; sign?: string; onPress?: () => void }) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} className="flex-row justify-between py-1.5" accessibilityRole={onPress ? "button" : undefined}>
      <Text className="text-sm text-foreground flex-1 mr-3">{label}</Text>
      <Text className="text-sm font-semibold text-foreground">{sign}{formatAmount(amount)}</Text>
    </Pressable>
  );
}

/** "This is my salary, how I spent it": money in, spent, saved, and what's left, for one month. */
export default function MyMonthScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ month?: string }>();
  const [month, setMonth] = useState(params.month ?? getCurrentMonth());
  const [data, setData] = useState<MyMonth | null>(null);
  const [accounts, setAccounts] = useState<MonthAccount[]>([]);
  const [people, setPeople] = useState<{ owedToYou: number; youOwe: number; together: number | null } | null>(null);
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
      setPeople(await getMonthPeople(DEFAULT_USER_ID, month).catch(() => null));
    }, [month]),
  );

  const categories = data ? (showAll ? data.categories : data.categories.slice(0, TOP_CATEGORIES)) : [];
  // Before pay day, being behind is just the calendar: no red, and it says so below.
  const beforePayDay = !!data?.salaryDue && data.leftOver < 0;
  const leftColor = beforePayDay ? theme.foreground : data && data.leftOver < 0 ? theme.danger : theme.success;
  const dueLabel = data?.salaryDue
    ? new Date(`${data.salaryDue.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
    : "";

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
          <Card className="mb-3">
            <Heading>Money in</Heading>
            {data.salary > 0 ? (
              <Row label="Income" amount={data.salary} />
            ) : data.salaryDue ? (
              <View className="py-1.5">
                <Text className="text-sm text-foreground">Income due around {dueLabel}</Text>
                {data.salaryDue.amount > 0 && (
                  <Text className="text-xs text-muted-foreground mt-0.5">{formatAmount(data.salaryDue.amount)} expected, not counted until it arrives</Text>
                )}
              </View>
            ) : (
              // Nothing marked as salary: asking beats showing a confident ₹0 on someone's pay.
              <Pressable onPress={() => router.push({ pathname: "/(tabs)/expenses", params: { preset: "credits" } })} className="py-1.5" accessibilityRole="button">
                <Text className="text-sm text-foreground">No income found this month</Text>
                <Text className="text-xs mt-0.5" style={{ color: theme.primary }}>
                  Already paid? Open the credit in Transactions and set its type to Income
                </Text>
              </Pressable>
            )}
            {data.otherIncome > 0 && <Row label="Other money in" amount={data.otherIncome} />}
            {data.salaryMovedOut > 0 && (
              <Text className="text-xs text-muted-foreground mt-1">
                {formatAmount(data.salaryMovedOut)} of income arrived this month but counts for another, by your income setting.
              </Text>
            )}
          </Card>

          <Card className="mb-3">
            <Heading>Spent</Heading>
            <Row label="Total" amount={data.spent} />
            {categories.map((c) => (
              <Pressable
                key={c.categoryId ?? "none"}
                disabled={!c.categoryId}
                onPress={() =>
                  router.push({
                    pathname: "/budget/transactions",
                    params: { filterMonth: month, categoryId: c.categoryId ?? "", title: c.name },
                  })
                }
                className="py-1.5"
                accessibilityRole="button"
              >
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

          <Card className="mb-3">
            <Heading>Saved or invested</Heading>
            {data.saved.length === 0 ? (
              <Text className="text-sm text-muted-foreground py-1.5">Nothing this month</Text>
            ) : (
              data.saved.map((s) => <Row key={s.label} label={s.label} amount={s.amount} />)
            )}
          </Card>

          {(data.people.billsShare > 0 || data.people.repaid > 0 || !!people?.owedToYou || !!people?.youOwe || !!people?.together) && (
            <Card className="mb-3">
              <Heading>With people</Heading>
              {data.people.billsShare > 0 && <Row label="Others' share of bills you paid" amount={data.people.billsShare} sign="−" />}
              {data.people.repaid > 0 && <Row label="Repaid to you" amount={data.people.repaid} sign="+" />}
              {(data.people.billsShare > 0 || data.people.repaid > 0) && (!!people?.owedToYou || !!people?.youOwe || !!people?.together) && (
                <View className="border-t border-border my-1" />
              )}
              {!!people?.owedToYou && <Row label="Owed to you now" amount={people.owedToYou} onPress={() => router.push("/hisaab/persons")} />}
              {!!people?.youOwe && <Row label="You owe now" amount={people.youOwe} onPress={() => router.push("/hisaab/persons")} />}
              {!!people?.together && (
                <Row
                  label="Your household spent together"
                  amount={people.together}
                  onPress={() => router.push({ pathname: "/together/transactions", params: { month } })}
                />
              )}
            </Card>
          )}

          <Card className="mb-3">
            <View className="flex-row justify-between items-center">
              <Text className="text-base font-semibold" style={{ color: leftColor }}>
                {beforePayDay ? "So far this month" : data.leftOver < 0 ? "Over by" : "Left over"}
              </Text>
              <Text className="text-xl font-bold" style={{ color: leftColor }}>{beforePayDay ? "−" : ""}{formatAmount(Math.abs(data.leftOver))}</Text>
            </View>
            <Text className="text-xs text-muted-foreground mt-1">{data.people.billsShare > 0 || data.people.repaid > 0 ? "Money in, minus spent and saved, with money to and from people" : "Money in, minus spent, minus saved"}</Text>
          </Card>

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
                <Row label="Money in" amount={data.moneyIn} />
                {data.people.repaid !== data.people.billsShare && (
                  <Row
                    label="With people"
                    amount={Math.abs(data.people.repaid - data.people.billsShare)}
                    sign={data.people.repaid > data.people.billsShare ? "+" : "−"}
                  />
                )}
                <Row label="Budget for the month" amount={data.afterBudget.setAside} sign="−" />
                {data.savedTotal > 0 && <Row label="Already saved" amount={data.savedTotal} sign="−" />}
                <View className="flex-row justify-between items-center pt-2 mt-1 border-t border-border">
                  <Text className="text-sm font-semibold flex-1 mr-3" style={{ color: data.afterBudget.free < 0 ? theme.danger : theme.success }}>
                    {data.afterBudget.free < 0 ? "Budget is more than your money in, by" : "You can still save or spend"}
                  </Text>
                  <Text className="text-base font-bold" style={{ color: data.afterBudget.free < 0 ? theme.danger : theme.success }}>
                    {formatAmount(Math.abs(data.afterBudget.free))}
                  </Text>
                </View>
              </>
            )}
          </Card>

          {accounts.length > 0 && (
            <Card className="mb-3">
              <Heading>{month === getCurrentMonth() ? "In your accounts now" : "In your accounts at month end"}</Heading>
              {accounts.map((a) => <Row key={a.id} label={a.name} amount={a.balance} />)}
              {accounts.length > 1 && (
                <View className="pt-1 mt-1 border-t border-border">
                  <Row label="Total" amount={accounts.reduce((s, a) => s + a.balance, 0)} />
                </View>
              )}
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
