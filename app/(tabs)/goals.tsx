import { isPartOn } from "@/services/customise";
import { useCustomisation } from "@/hooks/use-customisation";
import { Card, Chip, ContextualHeader, LoadingState, ProgressBar, ScreenContainer, SectionTitle, Text } from "@/components/ui";
import { GroupLabel, LinkRow } from "@/components/ui/LinkRow";
import { AnimatedNumber, Appear, PressableScale } from "@/components/motion";
import { DEFAULT_USER_ID } from "@/constants/app";

import { useDataRefresh } from "@/hooks/use-data-refresh";
import { getBalanceSheetColumn } from "@/services/balance-sheet";
import { getNetWorthHistory } from "@/services/net-worth-history";
import { getReadyReviewFY } from "@/services/reports/year-review";
import { getYoY } from "@/services/reports/yoy";
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
import { formatAmount, formatCompact } from "@/utils/format";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { tint } from "@/constants/brand";
import { todayIso } from "@/utils/local-date";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Consume preload once at module level (single-use, clears the cache slot)
const preloaded = consumeGoalsPreload();

export default function GoalsScreen() {
  useCustomisation();
  const router = useRouter();
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
  const [netWorthFYChange, setNetWorthFYChange] = useState<number | null>(null);
  /** Analyse tiles: this year vs the same months last year, and monthly take-home. */
  const [yoyTile, setYoyTile] = useState<{ spentPct: number | null; savedPts: number | null } | null>(null);
  const [takeHome, setTakeHome] = useState(0);
  const [insuranceCount, setInsuranceCount] = useState(0);
  const [insuranceAdequacy, setInsuranceAdequacy] = useState<InsuranceAdequacy | null>(null);
  const [cockpitData, setCockpitData] = useState<FinancialCockpitData | null>(preloaded?.cockpit ?? null);
  // If preloaded data is available the page is ready immediately; otherwise wait for first load
  const [setupChecked, setSetupChecked] = useState(preloaded != null);
  const [refreshing, setRefreshing] = useState(false);

  const [loadFailed, setLoadFailed] = useState(false);
  const loadGoals = useCallback(async () => {
    try {
      const fyStr = String(currentFY);
      const today = todayIso();
      const [salary, fetchedBuckets, fetchedMilestones, activeLoans, cockpit, emiMap] = await Promise.all([
        getSalaryProfileByFY(DEFAULT_USER_ID, fyStr),
        getBucketsByFY(DEFAULT_USER_ID, fyStr),
        getMilestonesForFY(DEFAULT_USER_ID, fyStr),
        listActiveLoans(DEFAULT_USER_ID),
        getFinancialCockpit(DEFAULT_USER_ID, fyStr),
        getCurrentEMIsByLoanId(DEFAULT_USER_ID, today),
      ]);
      setHasSalaryProfile(salary != null && salary.computed_monthly_in_hand > 0);
      setTakeHome(salary?.computed_monthly_in_hand || salary?.manual_monthly_in_hand || 0);
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
        const monthlyIncome = salary?.computed_monthly_in_hand || salary?.manual_monthly_in_hand || 0;
        const adeq = await getInsuranceAdequacy(DEFAULT_USER_ID, monthlyIncome * 12);
        setInsuranceAdequacy(adeq);
      } catch {
        // insurance not critical for page render
      }

      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      // DB not ready — leave setupChecked as-is so preloaded data stays visible
    }

    // Balance sheet is heavy — fetch separately so it never blocks the page render
    try {
      const today = todayIso();
      const bsCol = await getBalanceSheetColumn(DEFAULT_USER_ID, today, "Today", true, null);
      setNetWorth(bsCol?.netWorth ?? null);
    } catch {
      // Balance sheet not available yet
    }

    // Change since the FY started - from the month-end before the FY's first month.
    try {
      const { points } = await getNetWorthHistory(DEFAULT_USER_ID);
      const fyStartKey = `${currentFY}-${String(startMonth).padStart(2, "0")}`;
      const i = points.findIndex((p) => p.month >= fyStartKey);
      if (points.length >= 2 && i !== -1) {
        const base = points[Math.max(0, i - 1)];
        setNetWorthFYChange(points[points.length - 1].netWorth - base.netWorth);
      } else {
        setNetWorthFYChange(null);
      }
    } catch {
      // History is a nice-to-have on this row
    }

    // Analyse: Year over Year headline (cached by data version, so cheap on a repeat visit).
    try {
      const y = await getYoY(DEFAULT_USER_ID, currentFY, currentFY - 1, "same-period");
      const c = y.current;
      const b = y.base;
      setYoyTile(
        c.spent === 0 && b.spent === 0
          ? null
          : {
              spentPct: b.spent > 0 ? Math.round(((c.spent - b.spent) / b.spent) * 100) : null,
              savedPts: c.savedPct != null && b.savedPct != null ? Math.round(c.savedPct - b.savedPct) : null,
            },
      );
    } catch {
      setYoyTile(null);
    }
  }, [currentFY, startMonth]);

  // Reload only when something was written (data version), the FY or the day changed - switching back to
  // this tab with nothing changed keeps what's on screen.
  useDataRefresh(loadGoals, { skipKey: `${currentFY}|${new Date().toDateString()}` });

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

  const investColor = theme.data.transfer;
  const milestoneColor = theme.data.series[3];

  // Grade chip tone (only when cockpit data is available)
  const gradeTone: "success" | "primary" | "warning" | "danger" | "neutral" =
    hasCockpit && cockpitData && !cockpitData.healthProvisional
      ? cockpitData.healthGrade === "A+" || cockpitData.healthGrade === "A"
        ? "success"
        : cockpitData.healthGrade === "B"
          ? "primary"
          : cockpitData.healthGrade === "C"
            ? "warning"
            : "danger"
      : "neutral";

  // FY end label for on-track signal (e.g. "Mar 2026")
  const fyEndLabel = (() => {
    const startIdx = startMonth - 1;
    const endIdx = (startIdx + 11) % 12;
    const endYear = endIdx < startIdx ? currentFY + 1 : currentFY;
    return `${SHORT_MONTHS[endIdx]} ${endYear}`;
  })();

  if (!setupChecked) {
    return (
      <ScreenContainer>
        {loadFailed && <LoadFailedBanner onRetry={loadGoals} />}
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

  // "Apr – Nov · 8 of 12 months": the stretch of the FY so far.
  const fiscalMonth = cockpitData?.fiscalMonth ?? 0;
  const soFar =
    fiscalMonth > 0
      ? `${SHORT_MONTHS[startMonth - 1]} – ${SHORT_MONTHS[(startMonth - 1 + fiscalMonth - 1) % 12]} · ${fiscalMonth} of 12 months`
      : `${fyLabel}`;

  const savings = cockpitData?.savings;
  const headroom = cockpitData?.waterfall.breathingRoomMonthly ?? 0;
  const advisory = cockpitData && cockpitData.advisories.length > 0 ? cockpitData.advisories[0] : null;

  const yoySub =
    yoyTile && (yoyTile.spentPct != null || yoyTile.savedPts != null)
      ? [
          yoyTile.spentPct != null ? `Spending ${yoyTile.spentPct <= 0 ? "down" : "up"} ${Math.abs(yoyTile.spentPct)}%` : null,
          yoyTile.savedPts != null && yoyTile.savedPts !== 0
            ? `saving ${yoyTile.savedPts > 0 ? "up" : "down"} ${Math.abs(yoyTile.savedPts)} pts`
            : null,
        ]
          .filter(Boolean)
          .join(" · ") + " vs this time last year"
      : "Two financial years, side by side";

  const readyFY = getReadyReviewFY();

  return (
    <ScreenContainer>
      {loadFailed && <LoadFailedBanner onRetry={loadGoals} />}
      <ContextualHeader title="Goals" subtitle={`${fyLabel} · ${fyRange}`} />
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
        <View className="px-4 pt-3" style={{ gap: 20 }}>
          {/* ── Setup steps (new users) ── */}
          {!setupComplete && (
            <Card>
              <SectionTitle
                icon="list-outline"
                title="Set up your plan"
                hint={`${setupSteps.filter((s) => s.done).length} of 3 done · unlocks your ${fyLabel} plan`}
                className="mb-2"
              />
              {setupSteps.map((step, idx) => (
                <Pressable
                  key={step.label}
                  onPress={() => router.push({ pathname: step.route, params: { fy: String(currentFY) } })}
                  className={`flex-row items-center py-3 ${idx > 0 ? "border-t border-border" : ""}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${step.label}${step.done ? ", done" : ""}`}
                >
                  <Ionicons
                    name={step.done ? "checkmark-circle" : "ellipse-outline"}
                    size={20}
                    color={step.done ? theme.success : theme.faintForeground}
                    style={{ marginRight: 10 }}
                  />
                  <Text
                    className={`flex-1 text-body ${step.done ? "line-through text-muted-foreground" : "text-foreground font-semibold"}`}
                    numberOfLines={1}
                  >
                    {step.label}
                  </Text>
                  {!step.done && <Ionicons name="chevron-forward" size={16} color={theme.faintForeground} />}
                </Pressable>
              ))}
            </Card>
          )}

          {/* ── Financial health ── */}
          {hasCockpit && cockpitData && savings && (
            <Appear index={0}>
              <PressableScale
                onPress={() => router.push({ pathname: "/goals/yearly-plan", params: { fy: String(currentFY) } })}
                accessibilityRole="button"
                accessibilityLabel="Financial health, open yearly plan"
              >
                <Card>
                  <SectionTitle
                    icon="pulse-outline"
                    active
                    title="Financial health"
                    hint={soFar}
                    right={
                      <Chip variant="status" className="self-center"
                        tone={gradeTone}
                        icon="information-circle-outline"
                        label={cockpitData.healthProvisional ? "Early days" : `Grade ${cockpitData.healthGrade}`}
                        accessibilityLabel="Health grade, how it's worked out"
                        onPress={() =>
                          router.push({
                            pathname: "/goals/health-grade",
                            params: {
                              grade: cockpitData.healthGrade,
                              score: String(Math.round(cockpitData.healthScore)),
                              factorsJson: JSON.stringify(cockpitData.healthFactors),
                              provisional: cockpitData.healthProvisional ? "1" : "0",
                            },
                          })
                        }
                      />
                    }
                  />

                  <View className="flex-row items-end justify-between mt-3.5">
                    <View>
                      <Text className="text-meta text-muted-foreground">Savings rate</Text>
                      <Text className="text-hero font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                        {savings.actualRatePct.toFixed(0)}%
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-meta text-muted-foreground">Saved this FY</Text>
                      <AnimatedNumber value={savings.totalSaved} className="text-heading font-bold text-foreground" />
                    </View>
                  </View>

                  {/* Bar and "of target" only when a target is set (Financial Health rule) */}
                  {savings.targetSavings > 0 && (
                    <View className="mt-3.5" style={{ gap: 6 }}>
                      <ProgressBar
                        value={Math.min(1, savings.totalSaved / savings.targetSavings)}
                        color={savings.isOnTrack ? theme.primary : theme.warning}
                        height={8}
                        delay={250}
                      />
                      {savings.targetRatePct > 0 && (
                        <Text className="text-meta text-muted-foreground">
                          {Math.round(Math.min(100, (savings.totalSaved / savings.targetSavings) * 100))}% of your{" "}
                          {savings.targetRatePct.toFixed(0)}% target
                        </Text>
                      )}
                    </View>
                  )}

                  {savings.targetRatePct > 0 && cockpitData.monthsElapsed > 0 && (
                    <View className="flex-row items-center mt-2" style={{ gap: 6 }}>
                      <Ionicons
                        name={savings.isOnTrack ? "checkmark-circle" : "warning-outline"}
                        size={14}
                        color={savings.isOnTrack ? theme.success : theme.warning}
                      />
                      <Text
                        className="text-meta font-medium flex-1"
                        style={{ color: savings.isOnTrack ? theme.success : theme.warning }}
                        numberOfLines={2}
                      >
                        {savings.isOnTrack
                          ? `On track · projected ${savings.projectedYearEndRate.toFixed(0)}% by ${fyEndLabel}`
                          : `${formatAmount(savings.courseCorrectionPerMonth)} a month to reach ${savings.targetRatePct.toFixed(0)}% by ${fyEndLabel}`}
                      </Text>
                    </View>
                  )}

                  {/* Monthly headroom: label and what it means on the left (wraps if it must), the amount on the right */}
                  <View className="flex-row items-center border-t border-border mt-3.5 pt-3" style={{ gap: 12 }}>
                    <View className="flex-1" style={{ minWidth: 0 }}>
                      <Text className="text-meta text-muted-foreground">Monthly headroom</Text>
                      <Text
                        className="text-label"
                        style={{ color: headroom < 0 ? theme.danger : headroom === 0 ? theme.warning : theme.mutedForeground }}
                      >
                        {headroom < 0 ? "Commitments exceed income" : headroom === 0 ? "All income committed" : "After commitments"}
                      </Text>
                    </View>
                    <Text
                      className="text-body font-semibold"
                      style={{
                        color: headroom < 0 ? theme.danger : headroom === 0 ? theme.warning : theme.foreground,
                        fontVariant: ["tabular-nums"],
                        flexShrink: 0,
                      }}
                      numberOfLines={1}
                    >
                      {formatAmount(headroom)}
                    </Text>
                  </View>

                  {/* Advisory strip (only when there is one) */}
                  {advisory && (
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: "/goals/advisory-detail",
                          params: {
                            advisoryJson: JSON.stringify(advisory),
                            cockpitJson: JSON.stringify(cockpitData),
                          },
                        })
                      }
                      className="flex-row items-center rounded-control px-3 py-2.5 mt-3"
                      style={{ backgroundColor: theme.alpha("warning", 0.08), gap: 10, minHeight: 48 }}
                      accessibilityRole="button"
                      accessibilityLabel={advisory.title}
                    >
                      <Ionicons name="alert-circle-outline" size={18} color={theme.warning} />
                      <View className="flex-1">
                        <Text className="text-meta font-semibold text-foreground" numberOfLines={1}>
                          {advisory.title}
                        </Text>
                        <Text className="text-label text-muted-foreground" numberOfLines={2}>
                          {advisory.message}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
                    </Pressable>
                  )}
                </Card>
              </PressableScale>
            </Appear>
          )}

          {/* ── No cockpit but setup done ── */}
          {!hasCockpit && setupComplete && (
            <Card>
              <View className="items-center py-6">
                <Ionicons name="analytics-outline" size={48} color={theme.faintForeground} />
                <Text className="text-body font-semibold text-foreground mt-3">Building your cockpit...</Text>
                <Text className="text-meta text-muted-foreground text-center mt-1">
                  Add expenses and contributions to see your financial story.
                </Text>
              </View>
            </Card>
          )}

          {/* ── PLAN: Investment buckets + Life milestones ── */}
          <Appear index={1}>
            <GroupLabel>Plan</GroupLabel>
            <View className="flex-row" style={{ gap: 10 }}>
              <PlanTile
                icon="pie-chart-outline"
                color={investColor}
                title="Investments"
                sub={hasFYBuckets ? `${fyBuckets.length} ${fyBuckets.length === 1 ? "bucket" : "buckets"}` : "None added"}
                done={hasFYBuckets ? formatCompact(bucketContributed) : null}
                target={bucketTotalTarget > 0 ? formatCompact(bucketTotalTarget) : null}
                pct={bucketTotalTarget > 0 ? bucketProgressPct : null}
                onPress={() => router.push({ pathname: "/goals/investment-buckets", params: { fy: String(currentFY) } })}
              />
              <PlanTile
                icon="flag-outline"
                color={milestoneColor}
                title="Milestones"
                sub={
                  nextMilestone
                    ? `Next: ${nextMilestone.name} · ${fmtMonth(nextMilestone.target_date)}`
                    : hasMilestones
                      ? `${fyMilestones.length} ${fyMilestones.length === 1 ? "goal" : "goals"}`
                      : "None added"
                }
                done={hasMilestones ? formatCompact(milestoneTotalSaved) : null}
                target={milestoneTotalTarget > 0 ? formatCompact(milestoneTotalTarget) : null}
                pct={milestoneTotalTarget > 0 ? milestoneProgressPct : null}
                onPress={() => router.push("/goals/milestones")}
              />
            </View>
          </Appear>

          {/* ── TRACK: Loans, risk coverage, balance sheet ── */}
          <Appear index={2}>
            <GroupLabel>Track</GroupLabel>
            <View className="rounded-card bg-card border border-border overflow-hidden">
              {isPartOn("loans") && (
                <LinkRow
                  divider={false}
                  icon="business-outline"
                  color={theme.data.series[1]}
                  title="Loans & debt"
                  sub={
                    activeLoansCount > 0
                      ? `${activeLoansCount} ${activeLoansCount === 1 ? "loan" : "loans"} · ${formatAmount(totalMonthlyEMI)} a month`
                      : "No active loans"
                  }
                  onPress={() => router.push("/goals/loans")}
                />
              )}
              <LinkRow
                divider={isPartOn("loans")}
                icon="shield-checkmark-outline"
                color={theme.data.transfer}
                title="Risk coverage"
                sub={
                  insuranceCount > 0
                    ? `${insuranceCount} active ${insuranceCount === 1 ? "policy" : "policies"}${
                        insuranceAdequacy
                          ? ` · ${
                              insuranceAdequacy.gaps.length > 0
                                ? `${insuranceAdequacy.gaps.length} ${insuranceAdequacy.gaps.length > 1 ? "gaps" : "gap"}`
                                : "all covered"
                            }`
                          : ""
                      }`
                    : "Track your insurance policies"
                }
                onPress={() => router.push("/goals/risk-coverage")}
              />
              <LinkRow
                icon="scale-outline"
                color={theme.success}
                title="Balance sheet"
                sub={
                  netWorthFYChange != null && netWorthFYChange !== 0 && netWorth != null
                    ? `Net worth · ${netWorthFYChange > 0 ? "up" : "down"} ${formatCompact(Math.abs(netWorthFYChange))} this FY`
                    : "Net worth"
                }
                value={netWorth != null ? formatCompact(netWorth) : null}
                onPress={() => router.push("/goals/balance-sheet")}
              />
            </View>
          </Appear>

          {/* ── ANALYSE ── */}
          <Appear index={3}>
            <GroupLabel>Analyse</GroupLabel>
            <View className="rounded-card bg-card border border-border overflow-hidden">
              <LinkRow
                divider={false}
                icon="calendar-outline"
                title="Yearly plan"
                sub="Income, outflow and surplus"
                onPress={() => router.push({ pathname: "/goals/yearly-plan", params: { fy: String(currentFY) } })}
              />
              <LinkRow
                icon="bar-chart-outline"
                title="Year over year"
                sub={yoySub}
                onPress={() => router.push("/goals/yoy-comparison")}
              />
              {isPartOn("insights") && (
                <LinkRow
                  icon="sparkles-outline"
                  title="Year in review"
                  sub={readyFY != null ? `${getFYLabel(readyFY, startMonth)} is ready to swipe through` : `${fyLabel} so far, as a story`}
                  onPress={() =>
                    router.push({ pathname: "/insights/year-review", params: { fy: String(readyFY ?? currentFY) } })
                  }
                />
              )}
              <LinkRow
                icon="calculator-outline"
                title="Income calculator"
                sub={takeHome > 0 ? `Take-home ${formatAmount(takeHome)} a month` : "Salary, tax and in-hand pay"}
                onPress={() => router.push("/goals/salary-calculator")}
              />
            </View>
          </Appear>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

/** "2027-03-15" -> "Mar 2027". */
function fmtMonth(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m] = iso.split("-");
  const i = Number(m) - 1;
  return i >= 0 && i < 12 ? `${SHORT_MONTHS[i]} ${y}` : iso;
}

/** One of the two Plan cards: icon, title, a live line, "₹6.8L of ₹12L" and a bar when there's a target. */
function PlanTile({
  icon,
  color,
  title,
  sub,
  done,
  target,
  pct,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  sub: string;
  done: string | null;
  target: string | null;
  pct: number | null;
  onPress: () => void;
}) {
  return (
    <PressableScale className="flex-1" fill onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      <View className="flex-1 rounded-card bg-card border border-border p-3.5" style={{ gap: 10 }}>
        <View className="w-8 h-8 rounded-control items-center justify-center" style={{ backgroundColor: tint(color, 0.1) }}>
          <Ionicons name={icon} size={17} color={color} />
        </View>
        <View>
          <Text className="text-body font-bold text-foreground" numberOfLines={1}>
            {title}
          </Text>
          <Text className="text-meta text-muted-foreground" numberOfLines={1}>
            {sub}
          </Text>
        </View>
        {done != null && (
          <Text className="text-meta font-semibold text-foreground" style={{ fontVariant: ["tabular-nums"] }} numberOfLines={1}>
            {done}
            {target != null && <Text className="text-meta text-muted-foreground"> of {target}</Text>}
          </Text>
        )}
        {pct != null && <ProgressBar value={pct / 100} color={color} height={6} animated={false} />}
      </View>
    </PressableScale>
  );
}

