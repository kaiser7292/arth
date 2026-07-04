import { useState, useCallback } from "react";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  View,
  Text,
  ScrollView,
  Pressable,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card, PeriodNavigator, MetricRow, LoadingState } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  deriveYearlyPlan,
} from "@/services/yearly-plan";
import type { DerivedPlanSummary, InvestmentBucket } from "@/services/yearly-plan";
import { getSalaryProfileByFY } from "@/services/salary-profile";
import type { SalaryProfile } from "@/services/salary-profile";
import { getSavingsSnapshot } from "@/services/savings-tracker";
import type { SavingsSnapshot } from "@/utils/savings-calculations";
import { getMilestoneContributionForFY, getMilestoneTotalMonths } from "@/services/life-milestone";
import type { LifeMilestone } from "@/services/life-milestone";
import { getCurrentFY, getFYLabel } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";
import { formatAmount } from "@/utils/expense-validation";
import { formatCompact } from "@/utils/format";
import { StatusColors } from "@/constants/theme";
import { getRealityCheck, type RealityCheckData } from "@/services/financial-cockpit";
import {
  listActiveLoans,
  getSchedulesByLoanIds,
  getPrepaymentsByLoanIds,
  listAllLoansWithBankName,
} from "@/services/loan-accounts";
import type { LoanAccount } from "@/services/loan-accounts";
import { getFYRange } from "@/utils/fiscal-year";

interface LoanForecastRow {
  loanId: string;
  bankName: string;
  loanType: string;
  currentEMI: number;
  annualEmiTotal: number;
  annualPrepaymentTotal: number;
  annualOutflowTotal: number;
  currency: string;
}

export default function YearlyPlanScreen() {
  const router = useRouter();
  const { colors, accent, colorScheme } = useColorScheme();
  const { fy } = useLocalSearchParams<{ fy?: string }>();
  const startMonth = getFYStartMonth();

  const targetFY = fy ?? String(getCurrentFY(startMonth));
  const targetFYNum = parseInt(targetFY, 10);

  const [derived, setDerived] = useState<DerivedPlanSummary | null>(null);
  const [profile, setProfile] = useState<SalaryProfile | null>(null);
  const [buckets, setBuckets] = useState<InvestmentBucket[]>([]);
  const [milestones, setMilestones] = useState<LifeMilestone[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [realityCheck, setRealityCheck] = useState<RealityCheckData | null>(null);
  const [savings, setSavings] = useState<SavingsSnapshot | null>(null);
  const [loanForecast, setLoanForecast] = useState<LoanForecastRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const [derivedResult, profileResult] = await Promise.all([
            deriveYearlyPlan(DEFAULT_USER_ID, targetFY),
            getSalaryProfileByFY(DEFAULT_USER_ID, targetFY),
          ]);
          if (cancelled) return;
          setDerived(derivedResult);
          setProfile(profileResult);
          setBuckets(derivedResult._buckets);
          setMilestones(derivedResult._milestones);
          setLoaded(true);

          const [rc, snap, loans] = await Promise.all([
            getRealityCheck(DEFAULT_USER_ID, targetFY, derivedResult),
            getSavingsSnapshot(DEFAULT_USER_ID, targetFYNum),
            listActiveLoans(DEFAULT_USER_ID),
          ]);
          if (!cancelled) {
            setRealityCheck(rc);
            setSavings(snap);
          }

          // v17.5.0 — loan forecast: per-loan EMI + prepayment outflow within FY window
          if (loans.length > 0 && !cancelled) {
            const { start: fyStart, end: fyEnd } = getFYRange(targetFYNum, startMonth);
            const pad = (d: Date) =>
              `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            const fyStartStr = pad(fyStart);
            const fyEndStr = pad(fyEnd);
            // v17.5.9 — batched: 3 queries total regardless of loan count
            // (was 3 × N serial queries per focus on Yearly Plan screen).
            const loanIds = loans.map((l) => l.id);
            const [schedules, prepayments, loansWithBank] = await Promise.all([
              getSchedulesByLoanIds(loanIds),
              getPrepaymentsByLoanIds(loanIds),
              listAllLoansWithBankName(DEFAULT_USER_ID),
            ]);
            const bankByLoan = new Map(
              loansWithBank.map((l) => [l.id, l.bank_name]),
            );
            const rows: LoanForecastRow[] = loans.map((loan) => {
              const schedule = schedules.get(loan.id) ?? [];
              const loanPrepayments = prepayments.get(loan.id) ?? [];
              const annualEmiTotal = schedule
                .filter((e) => e.due_date >= fyStartStr && e.due_date <= fyEndStr)
                .reduce((s, e) => s + e.emi_amount, 0);
              const annualPrepaymentTotal = loanPrepayments
                .filter((p) => p.prepayment_date >= fyStartStr && p.prepayment_date <= fyEndStr)
                .reduce((s, p) => s + p.amount, 0);
              const currentEMI = schedule
                .filter((e) => e.due_date <= fyEndStr)
                .slice(-1)[0]?.emi_amount ?? loan.emi_amount;
              return {
                loanId: loan.id,
                bankName: bankByLoan.get(loan.id) ?? "Loan",
                loanType: loan.loan_type,
                currentEMI,
                annualEmiTotal,
                annualPrepaymentTotal,
                annualOutflowTotal: annualEmiTotal + annualPrepaymentTotal,
                currency: loan.currency,
              };
            });
            if (!cancelled) setLoanForecast(rows);
          } else if (!cancelled) {
            setLoanForecast([]);
          }
        } catch {
          // DB not ready
        }
        if (!cancelled) setLoaded(true);
      })();
      return () => { cancelled = true; };
    }, [targetFY]),
  );

  // FY navigation
  const navigateToFY = useCallback(
    (newFY: number) => {
      router.setParams({ fy: String(newFY) });
    },
    [router],
  );

  if (!loaded) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Loading your plan..." icon="document-text-outline" />
      </ScreenContainer>
    );
  }

  const fyLabel = getFYLabel(targetFYNum, startMonth);

  return (
    <ScreenContainer padTop={false} keyboardAware>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View className="px-4 py-4">
          {/* FY Navigator */}
          <PeriodNavigator
            mode="fy"
            value={targetFYNum}
            onChange={navigateToFY}
            variant="inline"
          />

          {/* Income Card */}
          <Card className="mb-4">
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center">
                <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary">
                  Income
                </Text>
                {profile?.status === "draft" && (
                  <View className="ml-2 px-2 py-0.5 rounded-full" style={{ backgroundColor: StatusColors[colorScheme].warningBg }}>
                    <Text className="text-[10px] font-bold" style={{ color: StatusColors[colorScheme].warning }}>DRAFT</Text>
                  </View>
                )}
              </View>
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/goals/salary-calculator",
                    params: { fy: targetFY },
                  })
                }
                className="flex-row items-center"
              >
                <Ionicons name="create-outline" size={14} color={colors.blue} />
                <Text className="text-xs font-medium ml-1" style={{ color: accent[500] }}>
                  Edit
                </Text>
              </Pressable>
            </View>
            <MetricRow
              label="Annual Salary (In-Hand)"
              value={formatAmount(derived?.annual_salary_in_hand ?? 0)}
              icon="wallet-outline"
            />
            <MetricRow
              label="Expected Bonus"
              value={formatAmount(derived?.expected_bonus ?? 0)}
              icon="gift-outline"
            />
            <MetricRow
              label="Expected Capital Gains"
              value={formatAmount(derived?.expected_capital_gains ?? 0)}
              icon="trending-up-outline"
            />
            <View className="h-px bg-border-light dark:bg-border-dark my-2" />
            <MetricRow
              label="Total Income"
              value={formatAmount(derived?.total_income ?? 0)}
              bold
              color={StatusColors[colorScheme].success}
            />
          </Card>

          {/* Investments Card */}
          <Card className="mb-4">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary">
                Investments
              </Text>
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/goals/investment-buckets",
                    params: { fy: targetFY },
                  })
                }
                className="flex-row items-center"
              >
                <Ionicons name="settings-outline" size={14} color={colors.blue} />
                <Text className="text-xs font-medium ml-1" style={{ color: accent[500] }}>
                  Manage
                </Text>
              </Pressable>
            </View>
            {buckets.length > 0 ? (
              buckets.map((b) => {
                const linkedMs = b.linked_milestone_id
                  ? milestones.find((m) => m.id === b.linked_milestone_id)
                  : null;
                return (
                  <MetricRow
                    key={b.id}
                    label={b.name}
                    value={formatAmount(b.annual_target)}
                    sublabel={linkedMs ? `Feeds "${linkedMs.name}"` : undefined}
                    icon="pie-chart-outline"
                  />
                );
              })
            ) : (
              <Text className="text-xs text-text-tertiary py-2">
                No investment buckets for this FY
              </Text>
            )}
            <View className="h-px bg-border-light dark:bg-border-dark my-2" />
            <MetricRow
              label="Total Investments"
              value={formatAmount(derived?.total_planned_investments ?? 0)}
              bold
              color={colors.blue}
            />
          </Card>

          {/* Milestones Card */}
          <Card className="mb-4">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary">
                Milestones
              </Text>
              <Pressable
                onPress={() => router.push("/goals/milestones")}
                className="flex-row items-center"
              >
                <Ionicons name="settings-outline" size={14} color={colors.blue} />
                <Text className="text-xs font-medium ml-1" style={{ color: accent[500] }}>
                  Manage
                </Text>
              </Pressable>
            </View>
            {milestones.length > 0 ? (
              milestones.map((m) => {
                const linkedBuckets = buckets.filter((b) => b.linked_milestone_id === m.id);
                const fullContribution = getMilestoneContributionForFY(m, targetFY);
                const parts: string[] = [];
                if (linkedBuckets.length > 0) {
                  const names = linkedBuckets.map((b) => b.name).join(", ");
                  parts.push(`Fed by "${names}"`);
                }
                const totalMo = getMilestoneTotalMonths(m);
                if (totalMo > 12) {
                  const yrs = m.duration_years || 0;
                  const mos = m.duration_months || 0;
                  if (yrs > 0 && mos > 0) parts.push(`${yrs}yr ${mos}mo`);
                  else if (yrs > 0) parts.push(`${yrs}yr`);
                  else parts.push(`${mos}mo`);
                }
                return (
                  <MetricRow
                    key={m.id}
                    label={m.name}
                    value={formatAmount(fullContribution)}
                    sublabel={parts.length > 0 ? parts.join(" · ") : undefined}
                    icon="flag-outline"
                  />
                );
              })
            ) : (
              <Text className="text-xs text-text-tertiary py-2">
                No active milestones for this FY
              </Text>
            )}
            <View className="h-px bg-border-light dark:bg-border-dark my-2" />
            {(() => {
              const totalMilestoneNeed = milestones.reduce(
                (s, m) => s + getMilestoneContributionForFY(m, targetFY), 0,
              );
              const totalInvestmentContribution = milestones.reduce((s, m) => {
                const linked = buckets.filter((b) => b.linked_milestone_id === m.id);
                return s + linked.reduce((t, b) => t + b.annual_target, 0);
              }, 0);
              const remainingDirect = derived?.total_planned_milestones ?? 0;
              return (
                <>
                  <MetricRow
                    label="Total Milestones"
                    value={formatAmount(totalMilestoneNeed)}
                    icon="flag-outline"
                  />
                  <MetricRow
                    label="Investment Contribution"
                    value={formatAmount(Math.min(totalInvestmentContribution, totalMilestoneNeed))}
                    sublabel="Covered by linked investment buckets"
                    icon="pie-chart-outline"
                  />
                  <MetricRow
                    label="Remaining Direct Contribution"
                    value={formatAmount(remainingDirect)}
                    bold
                    color={colors.blue}
                  />
                </>
              );
            })()}
          </Card>

          {/* v17.5.0 — Loans & Debt forecast block */}
          <Card className="mb-4">
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center flex-1">
                <View
                  className="w-9 h-9 rounded-full items-center justify-center mr-3"
                  style={{ backgroundColor: accent[500] + "14" }}
                >
                  <Ionicons name="cash-outline" size={18} color={colors.blue} />
                </View>
                <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
                  Loans & Debt
                </Text>
              </View>
              <Pressable
                onPress={() => router.push("/goals/loans" as never)}
                accessibilityRole="button"
                accessibilityLabel="Manage loans"
                className="flex-row items-center"
              >
                <Ionicons name="create-outline" size={14} color={colors.blue} />
                <Text className="text-xs font-medium ml-1" style={{ color: accent[500] }}>
                  Manage
                </Text>
              </Pressable>
            </View>

            {loanForecast.length === 0 ? (
              <View className="py-3">
                <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
                  No active loans.
                </Text>
                <Pressable
                  onPress={() => router.push("/loans/add" as never)}
                  className="mt-3 py-2 rounded-lg items-center"
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                >
                  <Text className="text-sm font-medium" style={{ color: accent[500] }}>
                    Add a loan
                  </Text>
                </Pressable>
              </View>
            ) : (
              <>
                {loanForecast.map((row, i) => {
                  const fmt = (n: number) =>
                    row.currency === "INR"
                      ? formatAmount(Math.round(n))
                      : `${row.currency} ${Math.round(n).toLocaleString()}`;
                  return (
                    <Pressable
                      key={row.loanId}
                      onPress={() => router.push({ pathname: "/loans/[id]", params: { id: row.loanId } } as never)}
                      className={`py-2.5 ${
                        i < loanForecast.length - 1
                          ? "border-b border-border-light dark:border-border-dark"
                          : ""
                      }`}
                    >
                      <View className="flex-row items-center justify-between mb-1">
                        <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary flex-1">
                          {row.bankName} · {row.loanType}
                        </Text>
                        <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
                      </View>
                      <View className="flex-row justify-between mt-1">
                        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                          Monthly EMI
                        </Text>
                        <Text className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                          {fmt(row.currentEMI)}
                        </Text>
                      </View>
                      <View className="flex-row justify-between mt-0.5">
                        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                          EMI outflow this FY
                        </Text>
                        <Text className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                          {fmt(row.annualEmiTotal)}
                        </Text>
                      </View>
                      {row.annualPrepaymentTotal > 0 && (
                        <View className="flex-row justify-between mt-0.5">
                          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                            Prepayments this FY
                          </Text>
                          <Text className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                            {fmt(row.annualPrepaymentTotal)}
                          </Text>
                        </View>
                      )}
                      <View className="flex-row justify-between mt-1">
                        <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary">
                          Total annual outflow
                        </Text>
                        <Text className="text-xs font-bold" style={{ color: StatusColors[colorScheme].danger }}>
                          {fmt(row.annualOutflowTotal)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
                {/* Grand total across all loans (INR only) */}
                {(() => {
                  const inrLoans = loanForecast.filter((r) => r.currency === "INR");
                  if (inrLoans.length === 0) return null;
                  const grandTotal = inrLoans.reduce((s, r) => s + r.annualOutflowTotal, 0);
                  const asPctOfIncome =
                    derived && derived.total_income > 0
                      ? Math.round((grandTotal / derived.total_income) * 100)
                      : 0;
                  return (
                    <View className="mt-3 pt-3 border-t border-border-light dark:border-border-dark">
                      <View className="flex-row justify-between">
                        <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary">
                          Debt servicing this year
                        </Text>
                        <Text className="text-sm font-bold" style={{ color: StatusColors[colorScheme].danger }}>
                          −{formatAmount(grandTotal)}
                        </Text>
                      </View>
                      {asPctOfIncome > 0 && (
                        <Text className="text-xs text-text-tertiary mt-1">
                          {asPctOfIncome}% of your annual income goes to EMIs + prepayments
                        </Text>
                      )}
                    </View>
                  );
                })()}
              </>
            )}
          </Card>

          {/* Expenses Card */}
          <Card className="mb-4">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary">
                Expenses (Annualized)
              </Text>
              <Pressable
                onPress={() => router.push("/(tabs)/budget")}
                className="flex-row items-center"
              >
                <Ionicons name="create-outline" size={14} color={colors.blue} />
                <Text className="text-xs font-medium ml-1" style={{ color: accent[500] }}>
                  Edit Budget
                </Text>
              </Pressable>
            </View>
            <MetricRow
              label="Estimated Annual Expenses"
              value={formatAmount(derived?.total_planned_expenses ?? 0)}
              icon="receipt-outline"
              color={StatusColors[colorScheme].danger}
            />
            <Text className="text-xs text-text-tertiary mt-1">
              Based on your monthly budget averages
            </Text>
          </Card>

          {/* Summary */}
          <Card title="Plan Summary" className="mb-4">
            {(() => {
              // v17.5.1 — Debt servicing is a real outflow too. Roll it into the summary.
              const debtServicingInr = loanForecast
                .filter((r) => r.currency === "INR")
                .reduce((s, r) => s + r.annualOutflowTotal, 0);
              const baseOutflow = derived?.total_outflow ?? 0;
              const outflowWithDebt = baseOutflow + debtServicingInr;
              const surplusWithDebt = (derived?.total_income ?? 0) - outflowWithDebt;
              return (
                <>
                  <MetricRow
                    label="Total Income"
                    value={formatAmount(derived?.total_income ?? 0)}
                    icon="arrow-down-circle-outline"
                    color={StatusColors[colorScheme].success}
                  />
                  <View className="h-px bg-border-light dark:bg-border-dark my-2" />
                  <MetricRow
                    label="Expenses"
                    value={formatAmount(derived?.total_planned_expenses ?? 0)}
                    icon="receipt-outline"
                  />
                  <MetricRow
                    label="Investments & Milestones"
                    value={formatAmount((derived?.total_planned_investments ?? 0) + (derived?.total_planned_milestones ?? 0))}
                    icon="pie-chart-outline"
                    sublabel={
                      (derived?.total_planned_milestones ?? 0) > 0
                        ? `${formatCompact(derived?.total_planned_investments ?? 0)} investments + ${formatCompact(derived?.total_planned_milestones ?? 0)} direct milestone`
                        : undefined
                    }
                  />
                  {debtServicingInr > 0 && (
                    <MetricRow
                      label="Debt Servicing"
                      value={formatAmount(debtServicingInr)}
                      icon="card-outline"
                      sublabel={
                        loanForecast.some((r) => r.currency !== "INR")
                          ? "EMIs + prepayments (INR loans only)"
                          : "EMIs + prepayments"
                      }
                    />
                  )}
                  <View className="h-px bg-border-light dark:bg-border-dark my-2" />
                  <MetricRow
                    label="Total Outflow"
                    value={formatAmount(outflowWithDebt)}
                    icon="arrow-up-circle-outline"
                    color={StatusColors[colorScheme].danger}
                    bold
                  />
                  <View className="h-px bg-border-light dark:bg-border-dark my-2" />
                  <MetricRow
                    label="Surplus / Deficit"
                    value={`${surplusWithDebt < 0 ? "-" : ""}${formatAmount(Math.abs(surplusWithDebt))}`}
                    icon={
                      surplusWithDebt >= 0
                        ? "checkmark-circle-outline"
                        : "alert-circle-outline"
                    }
                    color={surplusWithDebt >= 0 ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger}
                    bold
                  />
                </>
              );
            })()}
            <View className="h-px bg-border-light dark:bg-border-dark my-2" />
            <MetricRow
              label="Planned Savings Rate"
              value={`${derived?.savings_rate ?? 0}%`}
              icon="stats-chart-outline"
            />
            {savings && savings.monthsElapsed > 0 && (
              <MetricRow
                label="Actual Savings Rate"
                value={`${savings.actualSavingsRatePct}%`}
                icon="pulse-outline"
                color={
                  savings.actualSavingsRatePct >= (derived?.savings_rate ?? 0)
                    ? StatusColors[colorScheme].success
                    : StatusColors[colorScheme].danger
                }
              />
            )}

            {/* Achievability (uses debt-adjusted surplus) */}
            {derived && derived.total_income > 0 && (() => {
              const debtServicingInr = loanForecast
                .filter((r) => r.currency === "INR")
                .reduce((s, r) => s + r.annualOutflowTotal, 0);
              const adjustedSurplus = derived.total_income - (derived.total_outflow + debtServicingInr);
              const isPositive = adjustedSurplus >= 0;
              return (
                <View
                  className="mt-3 flex-row items-center justify-center py-2 rounded-lg"
                  style={{
                    backgroundColor: isPositive
                      ? StatusColors[colorScheme].successBg
                      : StatusColors[colorScheme].dangerBg,
                  }}
                >
                  <Ionicons
                    name={isPositive ? "checkmark-circle" : "alert-circle"}
                    size={18}
                    color={isPositive ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger}
                  />
                  <Text
                    className="ml-2 text-sm font-medium"
                    style={{
                      color: isPositive ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger,
                    }}
                  >
                    {isPositive
                      ? "Plan is achievable"
                      : "Plan has a deficit - review your targets"}
                  </Text>
                </View>
              );
            })()}
          </Card>

          {/* Reality Check */}
          {realityCheck && realityCheck.monthsElapsed > 0 && (
            <Card title={realityCheck.isPastFY ? "Year-End Review" : "Reality Check"} className="mb-4">
              {/* Status badge */}
              <View
                className="flex-row items-center px-3 py-2 rounded-lg mb-3"
                style={{
                  backgroundColor: realityCheck.overallStatus === "on_track"
                    ? StatusColors[colorScheme].successBg
                    : StatusColors[colorScheme].dangerBg,
                }}
              >
                <Ionicons
                  name={realityCheck.overallStatus === "on_track" ? "checkmark-circle" : "alert-circle"}
                  size={16}
                  color={realityCheck.overallStatus === "on_track" ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger}
                />
                <Text
                  className="text-xs font-semibold ml-1.5"
                  style={{
                    color: realityCheck.overallStatus === "on_track"
                      ? StatusColors[colorScheme].success
                      : StatusColors[colorScheme].danger,
                  }}
                >
                  {realityCheck.isPastFY
                    ? (realityCheck.netSurplusProjected >= realityCheck.netSurplusPlanned
                        ? "Finished better than planned"
                        : "Finished behind plan")
                    : realityCheck.overallStatus === "on_track"
                      ? "On track to achieve your plan"
                      : "Course correction needed"}
                </Text>
                {!realityCheck.isPastFY && (
                  <Text className="text-xs text-text-tertiary ml-auto">
                    Month {realityCheck.monthsElapsed}/12
                  </Text>
                )}
              </View>

              {/* Table header */}
              <View className="flex-row items-center mb-1.5 pb-1 border-b border-border-light dark:border-border-dark">
                <Text className="flex-1 text-[10px] font-semibold text-text-tertiary">
                  Category
                </Text>
                <Text className="w-16 text-[10px] font-semibold text-text-tertiary text-right">
                  {realityCheck.isPastFY ? "Planned" : "Expected"}
                </Text>
                <Text className="w-16 text-[10px] font-semibold text-text-tertiary text-right">
                  Actual
                </Text>
                <Text className="w-20 text-[10px] font-semibold text-text-tertiary text-right">
                  Status
                </Text>
              </View>

              {/* Rows */}
              {realityCheck.rows.map((row) => (
                <View key={row.label} className="py-2 border-b border-border-light dark:border-border-dark">
                  <View className="flex-row items-center">
                    <Text className="flex-1 text-xs font-medium text-text-primary dark:text-text-dark-primary">
                      {row.label}
                    </Text>
                    <Text className="w-16 text-xs text-text-secondary dark:text-text-dark-secondary text-right">
                      {formatCompact(realityCheck.isPastFY ? row.planned : row.proratedTarget)}
                    </Text>
                    <Text className="w-16 text-xs font-medium text-text-primary dark:text-text-dark-primary text-right">
                      {formatCompact(row.actualYTD)}
                    </Text>
                    <Text
                      className="w-20 text-xs font-bold text-right"
                      style={{
                        color: Math.abs(row.gap) < 1
                          ? StatusColors[colorScheme].muted
                          : row.isAhead
                            ? StatusColors[colorScheme].success
                            : StatusColors[colorScheme].danger,
                      }}
                    >
                      {row.gapLabel}
                    </Text>
                  </View>
                  {!realityCheck.isPastFY && !row.isAhead && Math.abs(row.gap) >= 1 && (
                    <View className="flex-row items-center mt-1">
                      <Ionicons name="arrow-forward" size={10} color={StatusColors[colorScheme].danger} style={{ marginRight: 4 }} />
                      <Text className="text-[10px] font-medium" style={{ color: StatusColors[colorScheme].danger }}>
                        {row.correctionLabel} to get back on track
                      </Text>
                    </View>
                  )}
                  {!realityCheck.isPastFY && row.isAhead && Math.abs(row.gap) >= 1 && (
                    <View className="flex-row items-center mt-1">
                      <Ionicons name="checkmark" size={10} color={StatusColors[colorScheme].success} style={{ marginRight: 4 }} />
                      <Text className="text-[10px] font-medium" style={{ color: StatusColors[colorScheme].success }}>
                        {row.correctionLabel}
                      </Text>
                    </View>
                  )}
                </View>
              ))}

              {/* Net surplus comparison */}
              <View className="flex-row items-center justify-between mt-3 pt-2">
                <Text className="text-xs font-bold text-text-primary dark:text-text-dark-primary">
                  {realityCheck.isPastFY ? "Actual Surplus" : "Projected Surplus"}
                </Text>
                <Text
                  className="text-xs font-bold"
                  style={{
                    color: realityCheck.netSurplusProjected >= 0
                      ? StatusColors[colorScheme].success
                      : StatusColors[colorScheme].danger,
                  }}
                >
                  {realityCheck.netSurplusProjected >= 0 ? "" : "-"}{formatCompact(Math.abs(realityCheck.netSurplusProjected))}
                  <Text className="text-[10px] font-normal text-text-tertiary">
                    {" "}(plan: {formatCompact(realityCheck.netSurplusPlanned)})
                  </Text>
                </Text>
              </View>

              {/* Action summary */}
              {realityCheck.summaryLines.length > 0 && (
                <View
                  className="mt-3 p-2.5 rounded-lg"
                  style={{
                    backgroundColor: realityCheck.overallStatus === "on_track"
                      ? StatusColors[colorScheme].successBg
                      : StatusColors[colorScheme].dangerBg,
                  }}
                >
                  {realityCheck.summaryLines.map((line, i) => (
                    <View key={i} className="flex-row items-center mb-0.5">
                      <Text className="text-[10px] mr-1.5">
                        {line.startsWith("Cut") || line.startsWith("Add") ? "→" : "✓"}
                      </Text>
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                        {line}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </Card>
          )}

          {/* Data sources */}
          {derived && derived.sources.length > 0 && (
            <View className="px-2 mb-4">
              <Text className="text-xs font-medium text-text-tertiary mb-1">
                Data sources:
              </Text>
              {derived.sources.map((s, i) => (
                <Text key={i} className="text-xs text-text-tertiary">
                  {s}
                </Text>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

