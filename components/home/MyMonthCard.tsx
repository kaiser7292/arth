import { useCallback, useState } from "react";
import { Pressable, View, type GestureResponderEvent } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { AnimatedNumber, PressableScale } from "@/components/motion";
import { Card, ProgressBar, StatusPill, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getCurrentMonth } from "@/services/budget";
import { getMyMonth, type MyMonth } from "@/services/my-month";
import type { MyMonthSection } from "@/services/my-month-rows";
import { getDaysRemaining } from "@/utils/budget-helpers";
import { formatMonthLabel } from "@/utils/date";
import { formatAmount } from "@/utils/expense-validation";

const dayMonth = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export interface MyMonthBudget {
  spent: number;
  total: number;
  remaining: number;
  /** Spent as a share of the budget, 0 to 1 and above. */
  progress: number;
  label: string;
  color: string;
  daysLeft: number;
}

function SectionLabel({ children }: { children: string }) {
  return <Text className="text-xs font-semibold text-muted-foreground">{children}</Text>;
}

/**
 * The month on Home, one card with two questions. Cash flow: money in against money out, a bar showing
 * where it went, and a line on what that means. Budget, once one is set: how it's going against it,
 * tap for the Budget tab. Tap anywhere else for My Month. Self-loading; a section that can't load or
 * is turned off in Customise Arth is left out, and with neither there's no card.
 *
 * Money out is spent, saved and others' share of bills you paid; money in includes repayments. So in
 * minus out is exactly the page's left over.
 */
export function MyMonthCard({ showCashFlow = true, budget = null }: { showCashFlow?: boolean; budget?: MyMonthBudget | null }) {
  const router = useRouter();
  const theme = useTheme();
  const [data, setData] = useState<MyMonth | null>(null);
  const month = getCurrentMonth();

  useDataRefresh(
    useCallback(async () => {
      setData(await getMyMonth(DEFAULT_USER_ID, month).catch(() => null));
    }, [month]),
  );

  const cashFlow = showCashFlow ? data : null;
  if (!cashFlow && !budget) return null;

  return (
    <PressableScale onPress={() => router.push("/summary/my-month")} accessibilityRole="button" accessibilityLabel="Open My Month">
      <Card className="mx-4 mt-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-label font-semibold uppercase tracking-wider text-faint-foreground">
            My Month · {formatMonthLabel(month, "long").split(" ")[0]}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
        </View>

        {cashFlow && <CashFlow d={cashFlow} month={month} />}

        {budget && (
          <Pressable
            onPress={() => router.push("/(tabs)/budget")}
            accessibilityRole="button"
            accessibilityLabel="Budget, open Budget"
            className={cashFlow ? "mt-3 pt-3 border-t border-border" : "mt-2"}
          >
            <View className="flex-row items-center justify-between">
              <SectionLabel>Budget</SectionLabel>
              <StatusPill label={budget.label} color={budget.color} />
            </View>
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                router.push({ pathname: "/summary/my-month-rows", params: { month, section: "budget", title: "Spent against budget" } });
              }}
              className="flex-row items-baseline mt-1 self-start"
              accessibilityRole="button"
              accessibilityLabel="Spent against budget, see transactions"
            >
              <AnimatedNumber value={budget.spent} className="text-heading font-bold text-foreground" />
              <Text className="text-meta text-muted-foreground ml-1.5">of {formatAmount(budget.total)}</Text>
            </Pressable>
            <ProgressBar value={budget.progress} color={budget.color} height={8} animated className="mt-2" />
            <View className="flex-row justify-between mt-1.5">
              <Text className="text-xs font-medium" style={{ color: budget.remaining >= 0 ? theme.success : theme.danger }}>
                {budget.remaining >= 0 ? `${formatAmount(budget.remaining)} of budget left` : `${formatAmount(-budget.remaining)} over budget`}
              </Text>
              <Text className="text-xs text-faint-foreground">{budget.daysLeft} days left</Text>
            </View>
          </Pressable>
        )}
      </Card>
    </PressableScale>
  );
}

function CashFlow({ d, month }: { d: MyMonth; month: string }) {
  const theme = useTheme();
  const router = useRouter();
  const drill = (section: MyMonthSection, title: string) => (e: GestureResponderEvent) => {
    e.stopPropagation();
    router.push({ pathname: "/summary/my-month-rows", params: { month, section, title } });
  };
  const moneyIn = d.moneyIn + d.people.repaid;
  const moneyOut = d.spent + d.savedTotal + d.people.billsShare + d.adjustedOut;
  const left = Math.max(0, d.leftOver);
  const daysLeft = Math.max(1, getDaysRemaining(month));
  const due = d.salaryDue;

  // Before pay day, more going out than coming in is just the calendar, not a problem.
  const message = due
    ? `Income due around ${dayMonth(due.date)}${due.amount > 0 ? `, ${formatAmount(due.amount)} expected` : ""}`
    : d.salaryMissing
      ? "No income found yet. Tap to check your credits"
      : moneyIn <= 0
        ? "No money in yet this month"
        : d.leftOver < 0
          ? `${formatAmount(-d.leftOver)} more went out than came in`
          : `${formatAmount(left)} left, about ${formatAmount(Math.floor(left / daysLeft))} a day for ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`;
  const messageColor = due || d.salaryMissing || moneyIn <= 0 ? theme.mutedForeground : d.leftOver < 0 ? theme.danger : theme.success;

  const whole = Math.max(moneyIn, moneyOut, 1);
  const segments = [
    { key: "Invested", value: d.savedTotal, color: theme.warning, section: "saved" as const },
    { key: "Spent by you", value: d.spent, color: theme.primary, section: "spent" as const },
    { key: "For others", value: d.people.billsShare, color: theme.alpha("primary", 0.45), section: "bills" as const },
    { key: "Balance adjustments", value: d.adjustedOut, color: theme.mutedForeground, section: "spent" as const },
    { key: "Left", value: left, color: theme.success, section: "left" as const },
  ];

  return (
    <>
      <View className="mt-1.5">
        <SectionLabel>Cash flow</SectionLabel>
      </View>
      <View className="flex-row mt-1.5">
        <Pressable onPress={drill("in", "Money in")} className="flex-1 mr-3" accessibilityRole="button" accessibilityLabel="Money in, see transactions">
          <View className="flex-row items-center">
            <Ionicons name="arrow-down-circle" size={15} color={theme.success} />
            <Text className="text-xs text-muted-foreground ml-1">Money in</Text>
          </View>
          <AnimatedNumber value={moneyIn} className="text-heading font-bold text-foreground mt-0.5" numberOfLines={1} />
        </Pressable>
        <Pressable onPress={drill("out", "Money out")} className="flex-1" accessibilityRole="button" accessibilityLabel="Money out, see transactions">
          <View className="flex-row items-center">
            <Ionicons name="arrow-up-circle" size={15} color={theme.danger} />
            <Text className="text-xs text-muted-foreground ml-1">Money out</Text>
          </View>
          <AnimatedNumber value={moneyOut} className="text-heading font-bold text-foreground mt-0.5" numberOfLines={1} />
        </Pressable>
      </View>

      {/* Out against in: an empty track past the coloured part is what hasn't gone anywhere yet. */}
      <View className="flex-row rounded-full overflow-hidden mt-3" style={{ height: 8, backgroundColor: theme.alpha("foreground", 0.08), gap: 2 }}>
        {segments.filter((s) => s.value > 0).map((s) => (
          <View key={s.key} style={{ width: `${(s.value / whole) * 100}%`, backgroundColor: s.color }} />
        ))}
      </View>
      <View className="flex-row flex-wrap mt-1.5" style={{ columnGap: 14 }}>
        {segments.map((s) => (
          <Pressable key={s.key} onPress={drill(s.section, s.key)} hitSlop={6} className="flex-row items-center" accessibilityRole="button">
            <View className="w-2 h-2 rounded-full mr-1" style={{ backgroundColor: s.color }} />
            <Text className="text-label text-muted-foreground">
              {s.key} {formatAmount(s.value)}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text className="text-xs font-medium mt-2.5" style={{ color: messageColor }} numberOfLines={2}>
        {message}
      </Text>
    </>
  );
}
