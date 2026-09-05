import { Card, ContextualHeader, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { STATUS_COLORS, TRANSFER_COLOR } from "@/constants/semantic-colors";
import { DEFAULT_USER_ID } from "@/constants/app";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { getBalanceSheetColumn } from "@/services/balance-sheet";
import { getFinancialCockpit } from "@/services/financial-cockpit";
import type { FinancialCockpitData } from "@/services/financial-cockpit";
import { consumeGoalsPreload } from "@/services/home-preload";
import { getMilestonesForFY, LifeMilestone } from "@/services/life-milestone";
import { getActivePolicies, getInsuranceAdequacy, type InsuranceAdequacy } from "@/services/insurance-policy";
import { listActiveLoans, getCurrentEMIsByLoanId } from "@/services/loan-accounts";
import { getSalaryProfileByFY } from "@/services/salary-profile";
import { getFYStartMonth } from "@/services/settings";
import { getBucketsByFY, InvestmentBucket } from "@/services/yearly-plan";

import { getCurrentFY, getFYLabel } from "@/utils/fiscal-year";
import { formatAmount } from "@/utils/format";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";

// Consume preload once at module level (single-use, clears the cache slot)
const preloaded = consumeGoalsPreload();

export default function GoalsScreen() {
  const router = useRouter();
  const { colors, colorScheme } = useColorScheme();
  const theme = useTheme();
  const startMonth = getFYStartMonth();
  const currentFY = getCurrentFY(startMonth);
  const fyLabel = getFYLabel(currentFY, startMonth);

  // Initialise from preload so the page renders instantly on first open
  const [hasSalaryProfile, setHasSalaryProfile] = useState(preloaded?.hasSalaryProfile ?? false);
  const [fyBuckets, setFyBuckets] = useState<InvestmentBucket[]>(preloaded?.fyBuckets ?? []);
  const [fyMilestones, setFyMilestones] = useState<LifeMilestone[]>(preloaded?.fyMilestones ?? []);
  const [activeLoansCount, setActiveLoansCount] = useState(preloaded?.activeLoansCount ?? 0);
  const [totalMonthlyEMI, setTotalMonthlyEMI] = useState(preloaded?.totalMonthlyEMI ?? 0);
  const [netWorth, setNetWorth] = useState<number | null>(null);
  const [insuranceCount, setInsuranceCount] = useState(0);
  const [insuranceAdequacy, setInsuranceAdequacy] = useState<InsuranceAdequacy | null>(null);
  const [cockpitData, setCockpitData] = useState<FinancialCockpitData | null>(preloaded?.cockpit ?? null);
  // If preloaded data is available the page is ready immediately; otherwise wait for first load
  const [setupChecked, setSetupChecked] = useState(preloaded != null);
  const [refreshing, setRefreshing] = useState(false);

  const loadGoals = useCallback(async () => {
    try {
      const fyStr = String(currentFY);
      const today = new Date().toISOString().split("T")[0];
      const [salary, fetchedBuckets, fetchedMilestones, activeLoans, cockpit, emiMap] = await Promise.all([
        getSalaryProfileByFY(DEFAULT_USER_ID, fyStr),
        getBucketsByFY(DEFAULT_USER_ID, fyStr),
        getMilestonesForFY(DEFAULT_USER_ID, fyStr),
        listActiveLoans(DEFAULT_USER_ID),
        getFinancialCockpit(DEFAULT_USER_ID, fyStr),
        getCurrentEMIsByLoanId(DEFAULT_USER_ID, today),
      ]);
      setHasSalaryProfile(salary != null && salary.computed_monthly_in_hand > 0);
      setFyBuckets(fetchedBuckets);
      setFyMilestones(fetchedMilestones);
      setActiveLoansCount(activeLoans.length);
      const liveEMI = activeLoans.reduce((s, l) => s + (emiMap.get(l.id) ?? l.emi_amount), 0);
      setTotalMonthlyEMI(liveEMI);
      setCockpitData(cockpit);
      setSetupChecked(true);

      // Insurance coverage summary
      try {
        const activePols = await getActivePolicies(DEFAULT_USER_ID);
        setInsuranceCount(activePols.length);
        const monthlyIncome = salary?.manual_monthly_in_hand || salary?.computed_monthly_in_hand || 0;
        const adeq = await getInsuranceAdequacy(DEFAULT_USER_ID, monthlyIncome * 12);
        setInsuranceAdequacy(adeq);
      } catch {
        // insurance not critical for page render
      }
    } catch {
      // DB not ready — leave setupChecked as-is so preloaded data stays visible
    }

    // Balance sheet is heavy — fetch separately so it never blocks the page render
    try {
      const today = new Date().toISOString().split("T")[0];
      const bsCol = await getBalanceSheetColumn(DEFAULT_USER_ID, today, "Today", true, null);
      setNetWorth(bsCol?.netWorth ?? null);
    } catch {
      // Balance sheet not available yet
    }
  }, [currentFY]);

  useDataRefresh(loadGoals);

  const hasFYBuckets = fyBuckets.length > 0;
  const hasMilestones = fyMilestones.length > 0;
  const setupComplete = hasSalaryProfile && hasFYBuckets && hasMilestones;
  const hasCockpit = cockpitData != null;

  const setupSteps = [
    { label: "Set your income", done: hasSalaryProfile, route: "/goals/salary-calculator" as const },
    { label: "Add investment goals", done: hasFYBuckets, route: "/goals/investment-buckets" as const },
    { label: "Add life goals", done: hasMilestones, route: "/goals/milestones" as const },
  ];

  const nextMilestone = fyMilestones.find((m) => !m.is_completed && m.target_date) ?? null;

  const bucketTotalTarget = fyBuckets.reduce((s, b) => s + b.annual_target, 0);
  const bucketContributed = fyBuckets.reduce((s, b) => s + b.current_contributed, 0);
  const bucketProgressPct = bucketTotalTarget > 0 ? Math.min(100, (bucketContributed / bucketTotalTarget) * 100) : 0;

  // Milestone progress: total saved / total target across all FY milestones
  const milestoneTotalTarget = fyMilestones.reduce((s, m) => s + m.target_amount, 0);
  const milestoneTotalSaved = fyMilestones.reduce((s, m) => s + m.current_saved, 0);
  const milestoneProgressPct =
    milestoneTotalTarget > 0 ? Math.min(100, (milestoneTotalSaved / milestoneTotalTarget) * 100) : 0;

  const accentColor = theme.primary;
  const accentBg = theme.primary + "14";

  // Grade pill colours (computed only when cockpit data is available)
  const gradeColorVal = hasCockpit && cockpitData
    ? (cockpitData.healthGrade === "A+" || cockpitData.healthGrade === "A"
        ? theme.success
        : cockpitData.healthGrade === "B"
          ? accentColor
          : cockpitData.healthGrade === "C"
            ? theme.warning
            : theme.danger)
    : colors.textSecondary;
  const gradeBgVal = hasCockpit && cockpitData
    ? (cockpitData.healthGrade === "A+" || cockpitData.healthGrade === "A"
        ? theme.alpha("success", 0.08)
        : cockpitData.healthGrade === "B"
          ? accentColor + "14"
          : cockpitData.healthGrade === "C"
            ? theme.alpha("warning", 0.08)
            : theme.alpha("danger", 0.08))
    : colors.border;

  // FY end label for on-track signal (e.g. "Mar 2026")
  const fyEndLabel = (() => {
    const short = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const startIdx = startMonth - 1;
    const endIdx = (startIdx + 11) % 12;
    const endYear = endIdx < startIdx ? currentFY + 1 : currentFY;
    return `${short[endIdx]} ${endYear}`;
  })();

  if (!setupChecked) {
    return (
      <ScreenContainer>
        <LoadingState message="Loading goals..." icon="trophy-outline" />
      </ScreenContainer>
    );
  }

  const fyRange = (() => {
    const fullMonths = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const startMonthIdx = getFYStartMonth() - 1; // 0-based
    const endMonthIdx = (startMonthIdx + 11) % 12;
    const startYear = currentFY;
    const endYear = endMonthIdx < startMonthIdx ? currentFY + 1 : currentFY;
    return `${fullMonths[startMonthIdx]} ${startYear} – ${fullMonths[endMonthIdx]} ${endYear}`;
  })();

  return (
    <ScreenContainer>
      <ContextualHeader
        title="Goals"
        subtitle={`${fyLabel} · ${fyRange}`}
      />
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
              <Text className="text-xs text-muted-foreground">
                {fyLabel} · Month {cockpitData?.fiscalMonth ?? "—"} of 12
              </Text>
              {!setupComplete && (
                <View className="flex-row items-center gap-1.5">
                  {setupSteps.map((s, i) => (
                    <View
                      key={i}
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: s.done ? theme.success : colors.border }}
                    />
                  ))}
                </View>
              )}
            </View>
            {cockpitData && (
              <View className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: colors.border }}>
                <View
                  className="h-full rounded-full"
                  style={{
                    width: `${(cockpitData.fiscalMonth / 12) * 100}%`,
                    backgroundColor: accentColor,
                  }}
                />
              </View>
            )}
          </View>

          {/* ── Setup strip (new users) ── */}
          {!setupComplete && (
            <Card className="mb-4">
              <Text className="text-xs text-muted-foreground mb-3">
                Complete these steps to unlock your {fyLabel} plan.
              </Text>
              {setupSteps.map((step, idx) => (
                <Pressable
                  key={idx}
                  onPress={() => router.push({ pathname: step.route, params: { fy: String(currentFY) } })}
                  className={`flex-row items-center py-2.5${idx < setupSteps.length - 1 ? " border-b border-border" : ""}`}
                >
                  <Ionicons
                    name={step.done ? "checkmark-circle" : "ellipse-outline"}
                    size={18}
                    color={step.done ? theme.success : colors.textSecondary}
                    style={{ marginRight: 10 }}
                  />
                  <Text
                    className={`flex-1 text-sm ${step.done ? "line-through text-muted-foreground" : "text-foreground font-medium"}`}
                  >
                    {step.label}
                  </Text>
                  {!step.done && <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />}
                </Pressable>
              ))}
            </Card>
          )}

          {/* ── Financial Health card ── */}
          {hasCockpit && cockpitData && (
            <Pressable
              onPress={() => router.push({ pathname: "/goals/yearly-plan", params: { fy: String(currentFY) } })}
              className="mb-4"
            >
              <Card>
                {/* Header: label + tappable grade pill + chevron */}
                <View className="flex-row items-center justify-between mb-3">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
                      Financial Health
                    </Text>
                    <Pressable
                      onPress={() =>
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        router.push({
                          pathname: "/goals/health-grade" as any,
                          params: {
                            grade: cockpitData.healthGrade,
                            score: String(Math.round(cockpitData.healthScore)),
                            factorsJson: JSON.stringify(cockpitData.healthFactors),
                          },
                        })
                      }
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <View
                        className="flex-row items-center gap-1 px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: gradeBgVal }}
                      >
                        <Text className="text-label font-bold" style={{ color: gradeColorVal }}>
                          Grade {cockpitData.healthGrade}
                        </Text>
                        <Ionicons name="information-circle-outline" size={10} color={gradeColorVal} />
                      </View>
                    </Pressable>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
                </View>

                {/* Metrics: Savings Rate | Monthly Headroom */}
                <View className="flex-row gap-4 mb-3">
                  <View className="flex-1">
                    <Text className="text-xs text-muted-foreground mb-0.5">Savings Rate</Text>
                    <Text className="text-xl font-bold text-foreground">
                      {cockpitData.savings.actualRatePct.toFixed(1)}%
                    </Text>
                    {cockpitData.savings.targetRatePct > 0 && (
                      <Text className="text-xs text-muted-foreground">
                        of {cockpitData.savings.targetRatePct.toFixed(0)}% target
                      </Text>
                    )}
                  </View>
                  {(() => {
                    const hRoom = cockpitData.waterfall.breathingRoomMonthly;
                    const hNeg  = hRoom < 0;
                    const hZero = hRoom === 0;
                    const hColor = hNeg
                      ? theme.danger
                      : hZero
                        ? theme.warning
                        : undefined;
                    return (
                      <View className="flex-1">
                        <Text className="text-xs text-muted-foreground mb-0.5">
                          Monthly Headroom
                        </Text>
                        <Text
                          className="text-xl font-bold text-foreground"
                          style={hColor ? { color: hColor } : undefined}
                        >
                          {hNeg ? `−${formatAmount(Math.abs(hRoom))}` : formatAmount(hRoom)}
                        </Text>
                        <Text
                          className="text-xs text-muted-foreground"
                          style={hColor ? { color: hColor } : undefined}
                        >
                          {hNeg ? "commitments exceed income" : hZero ? "all income committed" : "after commitments"}
                        </Text>
                      </View>
                    );
                  })()}
                </View>

                {/* Savings progress bar */}
                {cockpitData.savings.targetSavings > 0 && (
                  <View
                    className="h-1.5 rounded-full overflow-hidden"
                    style={{
                      backgroundColor: colors.border,
                      marginBottom: cockpitData.savings.targetRatePct > 0 && cockpitData.monthsElapsed > 0 ? 8 : 0,
                    }}
                  >
                    <View
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, (cockpitData.savings.totalSaved / cockpitData.savings.targetSavings) * 100)}%`,
                        backgroundColor: cockpitData.savings.isOnTrack
                          ? theme.success
                          : theme.warning,
                      }}
                    />
                  </View>
                )}

                {/* On-track signal */}
                {cockpitData.savings.targetRatePct > 0 && cockpitData.monthsElapsed > 0 && (
                  <View className="flex-row items-center gap-1.5">
                    <Ionicons
                      name={cockpitData.savings.isOnTrack ? "checkmark-circle" : "warning-outline"}
                      size={11}
                      color={
                        cockpitData.savings.isOnTrack
                          ? theme.success
                          : theme.warning
                      }
                    />
                    <Text
                      className="text-label font-medium"
                      style={{
                        color: cockpitData.savings.isOnTrack
                          ? theme.success
                          : theme.warning,
                      }}
                    >
                      {cockpitData.savings.isOnTrack
                        ? `On track · projected ${cockpitData.savings.projectedYearEndRate.toFixed(0)}% by ${fyEndLabel}`
                        : `${formatAmount(cockpitData.savings.courseCorrectionPerMonth)}/mo to reach ${cockpitData.savings.targetRatePct.toFixed(0)}% by ${fyEndLabel}`
                      }
                    </Text>
                  </View>
                )}
              </Card>
            </Pressable>
          )}

          {/* ── Advisory strip ── */}
          {cockpitData && cockpitData.advisories.length > 0 && (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/goals/advisory-detail",
                  params: {
                    advisoryJson: JSON.stringify(cockpitData.advisories[0]),
                    cockpitJson: JSON.stringify(cockpitData),
                  },
                })
              }
              className="mb-4"
            >
              <View
                className="flex-row items-center p-3 rounded-xl"
                style={{ backgroundColor: theme.alpha("warning", 0.08) }}
              >
                <Ionicons name="alert-circle-outline" size={18} color={theme.warning} />
                <View className="flex-1 ml-2.5">
                  <Text
                    className="text-sm font-medium"
                    style={{ color: theme.warning }}
                    numberOfLines={1}
                  >
                    {cockpitData.advisories[0].title}
                  </Text>
                  <Text
                    className="text-xs"
                    style={{ color: theme.warning, opacity: 0.8 }}
                    numberOfLines={2}
                  >
                    {cockpitData.advisories[0].message}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={theme.warning} />
              </View>
            </Pressable>
          )}

          {/* ── No cockpit but setup done ── */}
          {!hasCockpit && setupComplete && (
            <Card className="mb-4">
              <View className="items-center py-6">
                <Ionicons name="analytics-outline" size={48} color={colorScheme === "dark" ? STATUS_COLORS.muted : STATUS_COLORS.neutral} />
                <Text className="text-base font-medium text-foreground mt-3">
                  Building your cockpit...
                </Text>
                <Text className="text-sm text-muted-foreground text-center mt-1">
                  Add expenses and contributions to see your financial story.
                </Text>
              </View>
            </Card>
          )}

          {/* ── PLAN section: Investment Buckets + Life Milestones ── */}
          <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground mb-2">
            Plan
          </Text>
          <View className="flex-row gap-3 mb-4">
            {/* Investment Buckets */}
            <Pressable
              className="flex-1"
              onPress={() => router.push({ pathname: "/goals/investment-buckets", params: { fy: String(currentFY) } })}
            >
              <Card className="flex-1">
                <View className="flex-row items-center gap-2 mb-3">
                  <View
                    className="w-8 h-8 rounded-full items-center justify-center shrink-0"
                    style={{ backgroundColor: accentBg }}
                  >
                    <Ionicons name="pie-chart-outline" size={16} color={accentColor} />
                  </View>
                  <Text className="text-xs font-semibold text-muted-foreground flex-1" numberOfLines={1}>
                    Investment Buckets
                  </Text>
                </View>
                {fyBuckets.length > 0 ? (
                  <>
                    <Text className="text-base font-bold text-foreground">
                      {formatAmount(bucketContributed)}
                    </Text>
                    <Text className="text-xs text-muted-foreground mb-2" numberOfLines={1}>
                      of {formatAmount(bucketTotalTarget)} · {fyBuckets.length} buckets
                    </Text>
                    <View className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: colors.border }}>
                      <View
                        className="h-full rounded-full"
                        style={{ width: `${bucketProgressPct}%`, backgroundColor: accentColor }}
                      />
                    </View>
                  </>
                ) : (
                  <Text className="text-sm text-muted-foreground">
                    None added
                  </Text>
                )}
              </Card>
            </Pressable>

            {/* Life Milestones */}
            <Pressable
              className="flex-1"
              onPress={() => router.push("/goals/milestones")}
            >
              <Card className="flex-1">
                <View className="flex-row items-center gap-2 mb-3">
                  <View
                    className="w-8 h-8 rounded-full items-center justify-center shrink-0"
                    style={{ backgroundColor: "#14B8A614" }}
                  >
                    <Ionicons name="flag-outline" size={16} color="#14B8A6" />
                  </View>
                  <Text className="text-xs font-semibold text-muted-foreground flex-1" numberOfLines={1}>
                    Life Milestones
                  </Text>
                </View>
                {fyMilestones.length > 0 ? (
                  <>
                    <Text className="text-base font-bold text-foreground">
                      {formatAmount(milestoneTotalSaved)}
                    </Text>
                    <Text className="text-xs text-muted-foreground mb-2" numberOfLines={1}>
                      of {formatAmount(milestoneTotalTarget)} · {fyMilestones.length} goals
                    </Text>
                    <View className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: colors.border }}>
                      <View
                        className="h-full rounded-full"
                        style={{ width: `${milestoneProgressPct}%`, backgroundColor: "#14B8A6" }}
                      />
                    </View>
                  </>
                ) : (
                  <Text className="text-sm text-muted-foreground">
                    None added
                  </Text>
                )}
              </Card>
            </Pressable>
          </View>

          {/* ── TRACK section: Loans + Balance Sheet ── */}
          <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground mb-2">
            Track
          </Text>
          <Card className="mb-4">
            <Pressable
              onPress={() => router.push("/goals/loans" as never)}
              className="flex-row items-center py-3 border-b border-border"
            >
              <View
                className="w-9 h-9 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: "#F5945C14" }}
              >
                <Ionicons name="cash-outline" size={18} color="#F5945C" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-foreground">
                  Loans & Debt
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {activeLoansCount > 0
                    ? `${activeLoansCount} active · ${formatAmount(totalMonthlyEMI)}/mo EMI`
                    : "No active loans"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => router.push("/goals/risk-coverage" as never)}
              className="flex-row items-center py-3 border-b border-border"
            >
              <View
                className="w-9 h-9 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: "#8B5CF614" }}
              >
                <Ionicons name="shield-checkmark-outline" size={18} color={TRANSFER_COLOR} />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-foreground">
                  Risk Coverage
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {insuranceCount > 0
                    ? `${insuranceCount} active ${insuranceCount === 1 ? "policy" : "policies"}${insuranceAdequacy ? ` · ${insuranceAdequacy.gaps.length > 0 ? `${insuranceAdequacy.gaps.length} gap${insuranceAdequacy.gaps.length > 1 ? "s" : ""}` : "All covered"}` : ""}`
                    : "Track your insurance policies"}
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
                <Text className="text-sm font-medium text-foreground">
                  Balance Sheet
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {netWorth != null
                    ? `Net worth: ${formatAmount(netWorth)}`
                    : "Assets, liabilities & net worth"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </Pressable>
          </Card>

          {/* ── ANALYSE section ── */}
          <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground mb-2">
            Analyse
          </Text>
          <Card className="mb-4">
            <Pressable
              onPress={() => router.push("/goals/yoy-comparison")}
              className="flex-row items-center py-3 border-b border-border"
            >
              <View
                className="w-9 h-9 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: "#F59E0B14" }}
              >
                <Ionicons name="git-compare-outline" size={18} color={STATUS_COLORS.warning} />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-foreground">
                  Year-over-Year
                </Text>
                <Text className="text-xs text-muted-foreground">
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
                style={{ backgroundColor: theme.alpha("success", 0.08) }}
              >
                <Ionicons name="calculator-outline" size={18} color={theme.success} />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-foreground">
                  Income Calculator
                </Text>
                <Text className="text-xs text-muted-foreground">
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
