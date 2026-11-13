import { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { PeriodBar } from "@/components/insights/PeriodBar";
import { Card, EmptyState, LoadingState, ProgressBar, ScreenContainer, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getCurrentMonth } from "@/services/budget";
import { getCashFlow, type CashFlow } from "@/services/cash-flow";
import { BALANCE_ADJUSTMENTS } from "@/services/my-month";
import type { MyMonthSection } from "@/services/my-month-rows";
import { getFYStartMonth } from "@/services/settings";
import { formatMonthLabel } from "@/utils/date";
import { formatAmount } from "@/utils/expense-validation";
import { insightPeriodRange, isInsightPeriod, type InsightPeriod } from "@/utils/insight-periods";

const TOP_CATEGORIES = 5;

/** Money in and out over any period, for anyone with or without a budget. Every figure opens its transactions. */
export default function CashFlowScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ period?: string }>();
  const [period, setPeriod] = useState<InsightPeriod>(isInsightPeriod(params.period) ? params.period : "last_6m");
  const [customStart, setCustomStart] = useState(getCurrentMonth());
  const [customEnd, setCustomEnd] = useState(getCurrentMonth());
  const fyStartMonth = getFYStartMonth();
  const [loaded, setLoaded] = useState<{ key: string; flow: CashFlow } | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const range = insightPeriodRange(period, fyStartMonth, customStart, customEnd);
  const rangeKey = `${range.startMonth}:${range.endMonth}`;
  const wanted = useRef(rangeKey);
  wanted.current = rangeKey;
  const flow = loaded?.key === rangeKey ? loaded.flow : null;

  useDataRefresh(
    useCallback(async () => {
      const key = `${range.startMonth}:${range.endMonth}`;
      try {
        const next = await getCashFlow(DEFAULT_USER_ID, range.startMonth, range.endMonth);
        if (wanted.current !== key) return;
        setLoaded({ key, flow: next });
        setFailed(false);
      } catch {
        if (wanted.current === key) setFailed(true);
      }
    }, [range.startMonth, range.endMonth]),
  );

  /** Opens the transactions behind a figure, across the whole period. */
  const drill = (section: MyMonthSection, title: string, categoryId?: string) => () => {
    // Balance adjustments live in the accounts' ledgers, not in a list of transactions.
    if (title === BALANCE_ADJUSTMENTS) {
      router.push("/reconciliation/bank-accounts");
      return;
    }
    router.push({
      pathname: "/summary/my-month-rows",
      params: {
        month: range.startMonth,
        endMonth: range.endMonth,
        section,
        title,
        ...(categoryId ? { categoryId } : {}),
      },
    });
  };

  const hasMoney = !!flow && (flow.cameIn > 0 || flow.wentOut > 0);
  const short = !!flow && flow.left < 0;
  const quietShort = !!flow && short && flow.months.length === 1 && flow.incomeStillDue;
  const leftColor = quietShort ? theme.foreground : short ? theme.danger : theme.success;
  const biggest = Math.max(1, ...(flow?.months ?? []).flatMap((m) => [m.cameIn, m.wentOut]));
  const whole = Math.max(1, flow?.wentOut ?? 1);
  const where = flow
    ? [
        {
          key: "invested",
          label: flow.investedBack > 0 ? `Invested, after ${formatAmount(flow.investedBack)} taken out` : "Invested",
          amount: flow.invested,
          color: theme.warning,
          section: "saved" as const,
        },
        { key: "spent", label: "Spent by you", amount: flow.spent, color: theme.primary, section: "spent" as const },
        { key: "others", label: "Spent for others", amount: flow.forOthers, color: theme.alpha("primary", 0.45), section: "bills" as const },
        { key: "adjusted", label: BALANCE_ADJUSTMENTS, amount: flow.adjusted, color: theme.mutedForeground, section: "spent" as const },
      ].filter((w) => w.amount > 0)
    : [];
  const categories = showAll ? (flow?.categories ?? []) : (flow?.categories ?? []).slice(0, TOP_CATEGORIES);

  return (
    <ScreenContainer padTop={false}>
      <PeriodBar
        period={period}
        fyStartMonth={fyStartMonth}
        customStart={customStart}
        customEnd={customEnd}
        onPeriod={setPeriod}
        onCustomStart={setCustomStart}
        onCustomEnd={setCustomEnd}
      />
      {failed ? (
        <EmptyState icon="alert-circle-outline" title="Couldn't work this out" subtitle="Go back and try again." />
      ) : !flow ? (
        <LoadingState message="Adding it up..." icon="swap-vertical-outline" />
      ) : !hasMoney ? (
        <EmptyState icon="swap-vertical-outline" title="Nothing in this period" subtitle="Pick a longer period, or add some transactions." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60 }}>
          <Card className="mb-3">
            <Pressable onPress={drill("left", "What's left")} accessibilityRole="button" accessibilityLabel="What's left, see transactions">
              <Text className="text-xs text-muted-foreground">
                {quietShort ? "So far this month" : short ? "More went out than came in, by" : "Left in this period"}
              </Text>
              <View className="flex-row items-center justify-between">
                <Text className="text-title font-bold" style={{ color: leftColor }}>{formatAmount(Math.abs(flow.left))}</Text>
                <Ionicons name="chevron-forward" size={15} color={theme.mutedForeground} />
              </View>
              {flow.left > 0 && flow.cameIn > 0 && (
                <Text className="text-xs text-muted-foreground">{Math.round((flow.left / flow.cameIn) * 100)}% of what came in</Text>
              )}
              {quietShort && <Text className="text-xs text-muted-foreground">Your income for this month hasn't come yet</Text>}
            </Pressable>
            <View className="mt-3 pt-1 border-t border-border">
              <Row dot={theme.success} label="Came in" amount={flow.cameIn} bold onPress={drill("in", "Came in")} />
              <Row dot={theme.primary} label="Went out" amount={flow.wentOut} bold onPress={drill("out", "Went out")} />
            </View>
          </Card>

          {flow.months.length > 1 && (
            <Card className="mb-3">
              <Heading>Month by month</Heading>
              {[...flow.months].reverse().map((m) => (
                <Pressable
                  key={m.month}
                  onPress={() => router.push({ pathname: "/summary/my-month", params: { month: m.month } })}
                  className="flex-row items-center py-2"
                  accessibilityRole="button"
                  accessibilityLabel={`${formatMonthLabel(m.month)}, ${m.left < 0 ? "short by" : "left"} ${formatAmount(Math.abs(m.left))}. Open My Month`}
                >
                  <Text className="text-xs text-muted-foreground" style={{ width: 62 }} numberOfLines={1}>{formatMonthLabel(m.month)}</Text>
                  <View className="flex-1 mx-2" style={{ gap: 3 }}>
                    <View className="rounded-full" style={{ height: 6, minWidth: m.cameIn > 0 ? 3 : 0, width: `${(m.cameIn / biggest) * 100}%`, backgroundColor: theme.success }} />
                    <View className="rounded-full" style={{ height: 6, minWidth: m.wentOut > 0 ? 3 : 0, width: `${(m.wentOut / biggest) * 100}%`, backgroundColor: theme.primary }} />
                  </View>
                  <Text className="text-xs font-semibold text-right" style={{ width: 76, color: m.left < 0 ? theme.danger : theme.success }} numberOfLines={1}>
                    {m.left < 0 ? "−" : "+"}{formatAmount(Math.abs(m.left))}
                  </Text>
                  <Ionicons name="chevron-forward" size={13} color={theme.mutedForeground} style={{ marginLeft: 2 }} />
                </Pressable>
              ))}
              <Text className="text-label text-faint-foreground mt-1">Top bar came in, lower bar went out. Tap a month to open it.</Text>
            </Card>
          )}

          <Card className="mb-3">
            <Heading>Where it came from</Heading>
            {flow.income > 0 && <Row label="Income" amount={flow.income} onPress={drill("income", "Income")} />}
            {flow.otherIn > 0 && <Row label="Other money in" amount={flow.otherIn} onPress={drill("other", "Other money in")} />}
            {flow.repaid > 0 && <Row label="Repaid to you" amount={flow.repaid} onPress={drill("repaid", "Repaid to you")} />}
            {flow.adjustedIn > 0 && <Row label={BALANCE_ADJUSTMENTS} amount={flow.adjustedIn} onPress={drill("spent", BALANCE_ADJUSTMENTS)} />}
            {flow.fromInvestments > 0 && <Row label="Back from investments" amount={flow.fromInvestments} onPress={drill("saved", "Investments")} />}
            {flow.cameIn === 0 && <Text className="text-sm text-muted-foreground">Nothing came in during this period.</Text>}
          </Card>

          {where.length > 0 && (
            <Card className="mb-3">
              <Heading>Where it went</Heading>
              <View className="flex-row rounded-full overflow-hidden mb-1" style={{ height: 10, gap: 2 }}>
                {where.map((w) => <View key={w.key} style={{ flex: w.amount / whole, backgroundColor: w.color }} />)}
              </View>
              {where.map((w) => (
                <Row key={w.key} dot={w.color} label={w.label} amount={w.amount} percent={Math.round((w.amount / whole) * 100)} onPress={drill(w.section, w.label)} />
              ))}
            </Card>
          )}

          {flow.categories.length > 0 && (
            <Card className="mb-3">
              <Heading>What you spent on</Heading>
              {categories.map((c) => (
                <Pressable key={c.categoryId ?? "none"} onPress={drill("spent", c.name, c.categoryId ?? "none")} className="py-1.5" accessibilityRole="button">
                  <View className="flex-row justify-between mb-1">
                    <Text className="text-xs text-muted-foreground flex-1 mr-3" numberOfLines={1}>{c.name}</Text>
                    <Text className="text-xs text-muted-foreground">{formatAmount(c.total)}</Text>
                  </View>
                  <ProgressBar value={flow.spent > 0 ? c.total / flow.spent : 0} color={theme.primary} height={5} animated={false} />
                </Pressable>
              ))}
              {flow.categories.length > TOP_CATEGORIES && (
                <Pressable onPress={() => setShowAll((v) => !v)} className="pt-1.5" accessibilityRole="button">
                  <Text className="text-xs font-medium" style={{ color: theme.primary }}>
                    {showAll ? "Show less" : `See all ${flow.categories.length} categories`}
                  </Text>
                </Pressable>
              )}
            </Card>
          )}

          {flow.waitingForReview > 0 && (
            <Pressable onPress={() => router.push("/expense/review-queue")} accessibilityRole="button">
              <Text className="text-xs text-muted-foreground px-1">
                {flow.waitingForReview} {flow.waitingForReview === 1 ? "transaction is" : "transactions are"} waiting for review and not in these numbers. <Text className="text-xs font-medium" style={{ color: theme.primary }}>Review</Text>
              </Text>
            </Pressable>
          )}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

function Heading({ children }: { children: string }) {
  return <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{children}</Text>;
}

function Row({
  label,
  amount,
  dot,
  percent,
  bold,
  onPress,
}: {
  label: string;
  amount: number;
  dot?: string;
  percent?: number;
  bold?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} className="flex-row items-center py-2" accessibilityRole="button" accessibilityLabel={`${label}, ${formatAmount(amount)}, see transactions`}>
      {dot && <View className="w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: dot }} />}
      <Text className={`text-sm text-foreground flex-1 mr-2 ${bold ? "font-medium" : ""}`} numberOfLines={1}>{label}</Text>
      {percent != null && <Text className="text-xs text-muted-foreground mr-2">{percent}%</Text>}
      <Text className="text-sm font-semibold text-foreground">{formatAmount(amount)}</Text>
      <Ionicons name="chevron-forward" size={13} color={theme.mutedForeground} style={{ marginLeft: 4 }} />
    </Pressable>
  );
}
