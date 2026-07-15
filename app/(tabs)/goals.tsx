import { Card, LoadingState, ScreenContainer } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { StatusColors } from "@/constants/theme";
import { useCockpitData } from "@/hooks/use-cockpit-data";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getBalanceSheetColumn } from "@/services/balance-sheet";
import { getMilestonesForFY, LifeMilestone } from "@/services/life-milestone";
import { listActiveLoans } from "@/services/loan-accounts";
import { getSalaryProfileByFY } from "@/services/salary-profile";
import { getFYStartMonth } from "@/services/settings";
import { getBucketsByFY, InvestmentBucket } from "@/services/yearly-plan";
import { ac } from "@/utils/accent";
import { getCurrentFY, getFYLabel } from "@/utils/fiscal-year";
import { formatAmount } from "@/utils/format";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

export default function GoalsScreen() {
  const router = useRouter();
  const { accent, colors, colorScheme } = useColorScheme();
  const startMonth = getFYStartMonth();
  const currentFY = getCurrentFY(startMonth);
  const fyLabel = getFYLabel(currentFY, startMonth);

  const [hasSalaryProfile, setHasSalaryProfile] = useState(false);
  const [fyBuckets, setFyBuckets] = useState<InvestmentBucket[]>([]);
  const [fyMilestones, setFyMilestones] = useState<LifeMilestone[]>([]);
  const [activeLoansCount, setActiveLoansCount] = useState(0);
  const [totalMonthlyEMI, setTotalMonthlyEMI] = useState(0);
  const [netWorth, setNetWorth] = useState<number | null>(null);
  const [setupChecked, setSetupChecked] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadGoals = useCallback(async () => {
    try {
      const fyStr = String(currentFY);
      const [salary, fetchedBuckets, fetchedMilestones, activeLoans] = await Promise.all([
        getSalaryProfileByFY(DEFAULT_USER_ID, fyStr),
        getBucketsByFY(DEFAULT_USER_ID, fyStr),
        getMilestonesForFY(DEFAULT_USER_ID, fyStr),
        listActiveLoans(DEFAULT_USER_ID),
      ]);
      setHasSalaryProfile(salary != null && salary.computed_monthly_in_hand > 0);
      setFyBuckets(fetchedBuckets);
      setFyMilestones(fetchedMilestones);
      setActiveLoansCount(activeLoans.length);
      setTotalMonthlyEMI(activeLoans.reduce((s, l) => s + l.emi_amount, 0));
    } catch {
      // DB not ready
    }
    setSetupChecked(true);

    // Balance sheet is heavy — fetch separately so it never blocks the page render
    try {
      const today = new Date().toISOString().split("T")[0];
      const bsCol = await getBalanceSheetColumn(DEFAULT_USER_ID, today, "Today", true, null);
      setNetWorth(bsCol?.netWorth ?? null);
    } catch {
      // Balance sheet not available yet
    }
  }, [currentFY]);

  useFocusEffect(
    useCallback(() => {
      loadGoals();
    }, [loadGoals]),
  );

  const cockpit = useCockpitData();
  const hasSalaryInfo = hasSalaryProfile;
  const hasFYBuckets = fyBuckets.length > 0;
  const hasMilestones = fyMilestones.length > 0;
  const setupComplete = hasSalaryInfo && hasFYBuckets && hasMilestones;
  const hasCockpit = cockpit.data != null;

  const setupSteps = [
    { label: "Set your income", done: hasSalaryInfo, route: "/goals/salary-calculator" as const },
    { label: "Add investment goals", done: hasFYBuckets, route: "/goals/investment-buckets" as const },
    { label: "Add life goals", done: hasMilestones, route: "/goals/milestones" as const },
  ];

  const nextMilestone = fyMilestones.find((m) => !m.is_completed && m.target_date) ?? null;

  const bucketTotalTarget = fyBuckets.reduce((s, b) => s + b.annual_target, 0);
  const bucketContributed = fyBuckets.reduce((s, b) => s + b.current_contributed, 0);
  const bucketProgressPct = bucketTotalTarget > 0 ? Math.min(100, (bucketContributed / bucketTotalTarget) * 100) : 0;

  const accentColor = ac(accent, colorScheme, 500, 400);
  const accentBg = ac(accent, colorScheme, 500, 700) + "14";

  if (!setupChecked || cockpit.loading) {
    return (
      <ScreenContainer>
        <LoadingState message="Loading goals..." icon="trophy-outline" />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await loadGoals();
              setRefreshing(false);
            }}
          />
        }
      >
        <View className="px-4 pt-3">

          {/* ── FY Header strip ── */}
          <View className="mb-4">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                {fyLabel} · Month {cockpit.data?.fiscalMonth ?? "—"} of 12
              </Text>
              {!setupComplete && (
                <View className="flex-row items-center gap-1.5">
                  {setupSteps.map((s, i) => (
                    <View
                      key={i}
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: s.done ? StatusColors[colorScheme].success : colors.border }}
                    />
                  ))}
                </View>
              )}
            </View>
            {cockpit.data && (
              <View className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: colors.border }}>
                <View
                  className="h-full rounded-full"
                  style={{
                    width: `${(cockpit.data.fiscalMonth / 12) * 100}%`,
                    backgroundColor: accentColor,
                  }}
                />
              </View>
            )}
          </View>

          {/* ── Setup strip (new users) ── */}
          {!setupComplete && (
            <Card className="mb-4">
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-3">
                Complete these steps to unlock your {fyLabel} plan.
              </Text>
              {setupSteps.map((step, idx) => (
                <Pressable
                  key={idx}
                  onPress={() => router.push({ pathname: step.route, params: { fy: String(currentFY) } })}
                  className={`flex-row items-center py-2.5${idx < setupSteps.length - 1 ? " border-b border-border-light dark:border-border-dark" : ""}`}
                >
                  <Ionicons
                    name={step.done ? "checkmark-circle" : "ellipse-outline"}
                    size={18}
                    color={step.done ? StatusColors[colorScheme].success : colors.textSecondary}
                    style={{ marginRight: 10 }}
                  />
                  <Text
                    className={`flex-1 text-sm ${step.done ? "line-through text-text-secondary dark:text-text-dark-secondary" : "text-text-primary dark:text-text-dark-primary font-medium"}`}
                  >
                    {step.label}
                  </Text>
                  {!step.done && <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />}
                </Pressable>
              ))}
            </Card>
          )}

          {/* ── Financial Health card ── */}
          {hasCockpit && cockpit.data && (
            <Pressable
              onPress={() => router.push({ pathname: "/goals/yearly-plan", params: { fy: String(currentFY) } })}
              className="mb-4"
            >
              <Card>
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-xs font-semibold tracking-wider uppercase text-text-secondary dark:text-text-dark-secondary">
                    Financial Health
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
                </View>
                <View className="flex-row gap-4 mb-3">
                  <View className="flex-1">
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-0.5">Savings Rate</Text>
                    <Text className="text-xl font-bold text-text-primary dark:text-text-dark-primary">
                      {cockpit.data.savings.actualRatePct.toFixed(1)}%
                    </Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                      of {cockpit.data.savings.targetRatePct.toFixed(0)}% target
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-0.5">Saved This FY</Text>
                    <Text className="text-xl font-bold text-text-primary dark:text-text-dark-primary">
                      {formatAmount(cockpit.data.savings.totalSaved)}
                    </Text>
                    {cockpit.data.savings.targetSavings > 0 && (
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                        of {formatAmount(cockpit.data.savings.targetSavings)}
                      </Text>
                    )}
                  </View>
                </View>
                <View className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: colors.border }}>
                  <View
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, cockpit.data.savings.targetSavings > 0 ? (cockpit.data.savings.totalSaved / cockpit.data.savings.targetSavings) * 100 : 0)}%`,
                      backgroundColor: cockpit.data.savings.isOnTrack
                        ? StatusColors[colorScheme].success
                        : StatusColors[colorScheme].warning,
                    }}
                  />
                </View>
              </Card>
            </Pressable>
          )}

          {/* ── Advisory strip ── */}
          {cockpit.data && cockpit.data.advisories.length > 0 && (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/goals/advisory-detail",
                  params: {
                    advisoryJson: JSON.stringify(cockpit.data!.advisories[0]),
                    cockpitJson: JSON.stringify(cockpit.data),
                  },
                })
              }
              className="mb-4"
            >
              <View
                className="flex-row items-center p-3 rounded-xl"
                style={{ backgroundColor: StatusColors[colorScheme].warningBg }}
              >
                <Ionicons name="alert-circle-outline" size={18} color={StatusColors[colorScheme].warning} />
                <View className="flex-1 ml-2.5">
                  <Text
                    className="text-sm font-medium"
                    style={{ color: StatusColors[colorScheme].warning }}
                    numberOfLines={1}
                  >
                    {cockpit.data.advisories[0].title}
                  </Text>
                  <Text
                    className="text-xs"
                    style={{ color: StatusColors[colorScheme].warning, opacity: 0.8 }}
                    numberOfLines={2}
                  >
                    {cockpit.data.advisories[0].message}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={StatusColors[colorScheme].warning} />
              </View>
            </Pressable>
          )}

          {/* ── No cockpit but setup done ── */}
          {!hasCockpit && setupComplete && (
            <Card className="mb-4">
              <View className="items-center py-6">
                <Ionicons name="analytics-outline" size={48} color={colorScheme === "dark" ? "#A0A0A0" : "#6B7280"} />
                <Text className="text-base font-medium text-text-primary dark:text-text-dark-primary mt-3">
                  Building your cockpit...
                </Text>
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary text-center mt-1">
                  Add expenses and contributions to see your financial story.
                </Text>
              </View>
            </Card>
          )}

          {/* ── PLAN section ── */}
          <Text className="text-xs font-semibold tracking-wider uppercase text-text-secondary dark:text-text-dark-secondary mb-2">
            Plan
          </Text>
          <View className="flex-row gap-3 mb-4">
            {/* Yearly Plan */}
            <Pressable
              className="flex-1"
              onPress={() => router.push({ pathname: "/goals/yearly-plan", params: { fy: String(currentFY) } })}
            >
              <Card className="flex-1">
                <View
                  className="w-8 h-8 rounded-full items-center justify-center mb-3"
                  style={{ backgroundColor: colors.blue + "14" }}
                >
                  <Ionicons name="document-text-outline" size={16} color={colors.blue} />
                </View>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-0.5">Yearly Plan</Text>
                {cockpit.data && cockpit.data.savings.targetSavings > 0 ? (
                  <>
                    <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
                      {formatAmount(cockpit.data.savings.targetSavings)}
                    </Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-2">
                      target savings
                    </Text>
                    <View className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: colors.border }}>
                      <View
                        className="h-full rounded-full"
                        style={{
                          width: `${(cockpit.data.fiscalMonth / 12) * 100}%`,
                          backgroundColor: colors.blue,
                        }}
                      />
                    </View>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-1">
                      Month {cockpit.data.fiscalMonth} of 12
                    </Text>
                  </>
                ) : (
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
                    {fyLabel} plan
                  </Text>
                )}
              </Card>
            </Pressable>

            {/* Investment Buckets */}
            <Pressable
              className="flex-1"
              onPress={() => router.push({ pathname: "/goals/investment-buckets", params: { fy: String(currentFY) } })}
            >
              <Card className="flex-1">
                <View
                  className="w-8 h-8 rounded-full items-center justify-center mb-3"
                  style={{ backgroundColor: accentBg }}
                >
                  <Ionicons name="pie-chart-outline" size={16} color={accentColor} />
                </View>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-0.5">Buckets</Text>
                {fyBuckets.length > 0 ? (
                  <>
                    <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
                      {fyBuckets.length} active
                    </Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-2">
                      {formatAmount(bucketContributed)} of {formatAmount(bucketTotalTarget)}
                    </Text>
                    <View className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: colors.border }}>
                      <View
                        className="h-full rounded-full"
                        style={{ width: `${bucketProgressPct}%`, backgroundColor: accentColor }}
                      />
                    </View>
                  </>
                ) : (
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
                    None added
                  </Text>
                )}
              </Card>
            </Pressable>
          </View>

          {/* ── TRACK section ── */}
          <Text className="text-xs font-semibold tracking-wider uppercase text-text-secondary dark:text-text-dark-secondary mb-2">
            Track
          </Text>
          <Card className="mb-4">
            <Pressable
              onPress={() => router.push("/goals/milestones")}
              className="flex-row items-center py-3 border-b border-border-light dark:border-border-dark"
            >
              <View
                className="w-9 h-9 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: "#14B8A614" }}
              >
                <Ionicons name="flag-outline" size={18} color="#14B8A6" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
                  Life Milestones
                </Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  {fyMilestones.length > 0
                    ? `${fyMilestones.length} this FY${nextMilestone ? ` · Next: ${nextMilestone.name}` : ""}`
                    : "Add big life goals"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => router.push("/goals/loans" as never)}
              className="flex-row items-center py-3 border-b border-border-light dark:border-border-dark"
            >
              <View
                className="w-9 h-9 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: "#F5945C14" }}
              >
                <Ionicons name="cash-outline" size={18} color="#F5945C" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
                  Loans & Debt
                </Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  {activeLoansCount > 0
                    ? `${activeLoansCount} active · ${formatAmount(totalMonthlyEMI)}/mo EMI`
                    : "No active loans"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => router.push("/goals/balance-sheet" as never)}
              className="flex-row items-center py-3"
            >
              <View
                className="w-9 h-9 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: "#14B8A614" }}
              >
                <Ionicons name="scale-outline" size={18} color="#14B8A6" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
                  Balance Sheet
                </Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  {netWorth != null
                    ? `Net worth: ${formatAmount(netWorth)}`
                    : "Assets, liabilities & net worth"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Pressable>
          </Card>

          {/* ── ANALYSE section ── */}
          <Text className="text-xs font-semibold tracking-wider uppercase text-text-secondary dark:text-text-dark-secondary mb-2">
            Analyse
          </Text>
          <Card className="mb-4">
            <Pressable
              onPress={() => router.push("/goals/yoy-comparison")}
              className="flex-row items-center py-3 border-b border-border-light dark:border-border-dark"
            >
              <View
                className="w-9 h-9 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: "#F59E0B14" }}
              >
                <Ionicons name="git-compare-outline" size={18} color="#F59E0B" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
                  Year-over-Year
                </Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  Compare FY performance
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => router.push("/goals/salary-calculator")}
              className="flex-row items-center py-3"
            >
              <View
                className="w-9 h-9 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: StatusColors[colorScheme].successBg }}
              >
                <Ionicons name="calculator-outline" size={18} color={StatusColors[colorScheme].success} />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
                  Income Calculator
                </Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  CTC, tax & capital gains
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Pressable>
          </Card>

        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
