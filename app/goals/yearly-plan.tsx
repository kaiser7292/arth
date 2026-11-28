import { useState, useCallback, useRef } from "react";
import { DEFAULT_USER_ID } from "@/constants/app";
import { View, ScrollView, Pressable } from "react-native";
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, Chip, FieldRow, LoadingState, PeriodNavigator, ProgressBar, ScreenContainer, SectionTitle, Text } from "@/components/ui";
import { StatTile, Statement } from "@/components/ui/LinkRow";
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
import { getFYStartMonth, getDataVersion } from "@/services/settings";
import { formatAmount } from "@/utils/expense-validation";
import { formatCompact, formatAmount as fmtFull } from "@/utils/format";

import { getRealityCheck, type RealityCheckData } from "@/services/financial-cockpit";
import { consumeYearlyPlanPreload } from "@/services/home-preload";
import {
  listActiveLoans,
  getSchedulesByLoanIds,
  getPrepaymentsByLoanIds,
  listAllLoansWithBankName,
} from "@/services/loan-accounts";
import type { LoanAccount } from "@/services/loan-accounts";
import { getFYRange } from "@/utils/fiscal-year";
import { useTheme } from "@/hooks/use-theme";
import { HeaderGlobalActions } from "@/components/ui/HeaderGlobalActions";

interface LoanForecastRow {
  loanId: string;
  bankName: string;
  loanType: string;
  currentEMI: number;
  annualEmiTotal: number;
  annualPrepaymentTotal: number;
  annualOutflowTotal: number;
  ytdOutflowTotal: number;
  currency: string;
}

interface PlanData {
  fy: string;
  derived: DerivedPlanSummary | null;
  profile: SalaryProfile | null;
  realityCheck: RealityCheckData | null;
  savings: SavingsSnapshot | null;
  loanForecast: LoanForecastRow[];
}

/**
 * The last plan worked out, kept across visits with the data version it was worked out at.
 * Reopening Yearly Plan with nothing written since (salary, milestones, buckets, loans,
 * transactions all bump the version) shows it at once instead of recalculating.
 */
let lastPlan: { stamp: string; data: PlanData } | null = null;

export default function YearlyPlanScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { fy } = useLocalSearchParams<{ fy?: string }>();
  const startMonth = getFYStartMonth();

  const targetFY = fy ?? String(getCurrentFY(startMonth));
  const targetFYNum = parseInt(targetFY, 10);

  const cached = lastPlan?.data.fy === targetFY ? lastPlan.data : null;
  const [derived, setDerived] = useState<DerivedPlanSummary | null>(cached?.derived ?? null);
  const [profile, setProfile] = useState<SalaryProfile | null>(cached?.profile ?? null);
  const [buckets, setBuckets] = useState<InvestmentBucket[]>(cached?.derived?._buckets ?? []);
  const [milestones, setMilestones] = useState<LifeMilestone[]>(cached?.derived?._milestones ?? []);
  const [loaded, setLoaded] = useState(cached != null);

  const [realityCheck, setRealityCheck] = useState<RealityCheckData | null>(cached?.realityCheck ?? null);
  const [savings, setSavings] = useState<SavingsSnapshot | null>(cached?.savings ?? null);
  const [loanForecast, setLoanForecast] = useState<LoanForecastRow[]>(cached?.loanForecast ?? []);
  const shownStampRef = useRef<string | null>(null);

  const applyPlan = useCallback((d: PlanData) => {
    setDerived(d.derived);
    setProfile(d.profile);
    setBuckets(d.derived?._buckets ?? []);
    setMilestones(d.derived?._milestones ?? []);
    setRealityCheck(d.realityCheck);
    setSavings(d.savings);
    setLoanForecast(d.loanForecast);
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        // Stamp includes the FY being viewed, not just the data version. Version alone
        // asks "has anything been written?" - and changing the FY writes nothing, so the
        // guard swallowed the reload and left the previous year's plan on screen.
        // The day is in it too: Reality Check's year-to-date targets move with the date, not just with writes.
        const stamp = `${getDataVersion()}|${targetFY}|${new Date().toDateString()}`;
        if (shownStampRef.current === stamp) return; // already showing exactly this
        if (lastPlan?.stamp === stamp) {
          // Worked out on an earlier visit and nothing has changed since.
          shownStampRef.current = stamp;
          applyPlan(lastPlan.data);
          return;
        }
        try {
          // Use preloaded data on first open (current FY only).
          const preload = consumeYearlyPlanPreload();
          const usePreload = preload && preload.fy === targetFY;

          // Phase 1: core plan data + loan list (loan list is cheap; needed for Phase 2)
          const [derivedResult, profileResult, loans] = await Promise.all([
            usePreload ? Promise.resolve(preload.derived) : deriveYearlyPlan(DEFAULT_USER_ID, targetFY),
            usePreload ? Promise.resolve(preload.profile) : getSalaryProfileByFY(DEFAULT_USER_ID, targetFY),
            listActiveLoans(DEFAULT_USER_ID),
          ]);
          if (cancelled) return;

          const loanIds = loans.map((l) => l.id);
          const { start: fyStart, end: fyEnd } = getFYRange(targetFYNum, startMonth);
          const pad = (d: Date) =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const fyStartStr = pad(fyStart);
          const fyEndStr = pad(fyEnd);

          // Phase 2: everything else in parallel — reality check, savings, and full loan details.
          // getSchedulesByLoanIds / getPrepaymentsByLoanIds both handle empty arrays safely.
          const [rc, snap, schedules, prepayments, loansWithBank] = await Promise.all([
            getRealityCheck(DEFAULT_USER_ID, targetFY, derivedResult ?? undefined),
            getSavingsSnapshot(DEFAULT_USER_ID, targetFYNum),
            getSchedulesByLoanIds(loanIds),
            getPrepaymentsByLoanIds(loanIds),
            listAllLoansWithBankName(DEFAULT_USER_ID),
          ]);
          if (cancelled) return;

          const bankByLoan = new Map(loansWithBank.map((l) => [l.id, l.bank_name]));
          const todayStr = pad(new Date());
          const loanRows: LoanForecastRow[] = loans.map((loan) => {
            const schedule = schedules.get(loan.id) ?? [];
            const loanPrepayments = prepayments.get(loan.id) ?? [];
            const annualEmiTotal = schedule
              .filter((e) => e.due_date >= fyStartStr && e.due_date <= fyEndStr)
              .reduce((s, e) => s + e.emi_amount, 0);
            const annualPrepaymentTotal = loanPrepayments
              .filter((p) => p.prepayment_date >= fyStartStr && p.prepayment_date <= fyEndStr)
              .reduce((s, p) => s + p.amount, 0);
            const ytdEmiTotal = schedule
              .filter((e) => e.due_date >= fyStartStr && e.due_date <= todayStr)
              .reduce((s, e) => s + e.emi_amount, 0);
            const ytdPrepaymentTotal = loanPrepayments
              .filter((p) => p.prepayment_date >= fyStartStr && p.prepayment_date <= todayStr)
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
              ytdOutflowTotal: ytdEmiTotal + ytdPrepaymentTotal,
              currency: loan.currency,
            };
          });

          // Set everything at once — screen renders with complete data on first paint.
          // The stamp is recorded only now: a load cut short by leaving the screen must run
          // again on return (recording it up front left the loader up for good).
          const data: PlanData = { fy: targetFY, derived: derivedResult, profile: profileResult, realityCheck: rc, savings: snap, loanForecast: loanRows };
          lastPlan = { stamp, data };
          shownStampRef.current = stamp;
          applyPlan(data);
        } catch {
          if (!cancelled) setLoaded(true);
        }
      })();
      return () => { cancelled = true; };
    }, [targetFY, applyPlan]),
  );

  // FY navigation
  const navigateToFY = useCallback(
    (newFY: number) => {
      router.setParams({ fy: String(newFY) });
    },
    [router],
  );

  const header = (
    <Stack.Screen
      options={{
        title: "Yearly plan",
        // Year over year sits with Search and Hide amounts: the same screen Insights opens.
        headerRight: () => (
          <HeaderGlobalActions
            leading={
              <Pressable
                onPress={() => router.push("/goals/yoy-comparison")}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Year over year"
                style={{ padding: 4 }}
              >
                <Ionicons name="swap-horizontal-outline" size={20} color={theme.primary} />
              </Pressable>
            }
          />
        ),
      }}
    />
  );

  if (!loaded) {
    return (
      <ScreenContainer padTop={false}>
        {header}
        <LoadingState message="Loading your plan..." icon="document-text-outline" />
      </ScreenContainer>
    );
  }

  const fyLabel = getFYLabel(targetFYNum, startMonth);
  const hasActuals = realityCheck != null && realityCheck.monthsElapsed > 0;
  const showActual = hasActuals;

  // Debt servicing is a real outflow too (INR loans only), rolled into the totals.
  const inrLoans = loanForecast.filter((r) => r.currency === "INR");
  const debtServicingInr = inrLoans.reduce((s, r) => s + r.annualOutflowTotal, 0);
  const totalIncome = derived?.total_income ?? 0;
  const outflowWithDebt = (derived?.total_outflow ?? 0) + debtServicingInr;
  const surplusWithDebt = totalIncome - outflowWithDebt;

  // Plan vs actual: the debt-servicing line worked out the same way the reality-check rows are.
  const debtYTD = inrLoans.reduce((s, r) => s + r.ytdOutflowTotal, 0);
  const monthsElapsed = realityCheck?.monthsElapsed ?? 0;
  const debtProrated = monthsElapsed > 0 ? Math.round((debtServicingInr / 12) * monthsElapsed) : 0;
  const debtGap = debtYTD - debtProrated;
  const debtProjYearEnd =
    realityCheck && !realityCheck.isPastFY && monthsElapsed > 0 && debtYTD > 0
      ? Math.round((debtYTD / monthsElapsed) * 12)
      : debtServicingInr;
  const netSurplusProj = realityCheck ? realityCheck.netSurplusProjected - debtProjYearEnd : surplusWithDebt;
  const netSurplusPlanned = realityCheck ? realityCheck.netSurplusPlanned - debtServicingInr : surplusWithDebt;

  const heroSurplus = showActual ? netSurplusProj : surplusWithDebt;
  const status: { label: string; tone: "success" | "danger" } = showActual
    ? realityCheck!.isPastFY
      ? netSurplusProj >= netSurplusPlanned
        ? { label: "Better than planned", tone: "success" }
        : { label: "Behind plan", tone: "danger" }
      : realityCheck!.overallStatus === "on_track"
        ? { label: "On track", tone: "success" }
        : { label: "Needs a correction", tone: "danger" }
    : surplusWithDebt >= 0
      ? { label: "Achievable", tone: "success" }
      : { label: "Deficit", tone: "danger" };

  const plannedRate = derived?.savings_rate ?? 0;
  const actualRate = savings && savings.monthsElapsed > 0 ? savings.actualSavingsRatePct : null;

  const totalMilestoneNeed = milestones.reduce((s, m) => s + getMilestoneContributionForFY(m, targetFY), 0);
  const totalBucketForMilestones = milestones.reduce((s, m) => {
    const linked = buckets.filter((b) => b.linked_milestone_id === m.id);
    return s + linked.reduce((t, b) => t + b.annual_target, 0);
  }, 0);
  const coveredByBuckets = Math.min(totalBucketForMilestones, totalMilestoneNeed);

  const fmtLoan = (row: LoanForecastRow, n: number) =>
    row.currency === "INR" ? formatAmount(Math.round(n)) : `${row.currency} ${Math.round(n).toLocaleString()}`;

  return (
    <ScreenContainer padTop={false} keyboardAware>
      {header}
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-4 py-3" style={{ gap: 12 }}>
          <PeriodNavigator mode="fy" value={targetFYNum} onChange={navigateToFY} variant="inline" />


          {/* ── Hero: the year's surplus, as income − outflow ── */}
          <Card>
            <View className="flex-row items-center justify-between">
              <Text className="text-meta text-muted-foreground flex-1" numberOfLines={1}>
                {fyLabel}
              </Text>
              <Chip variant="status" className="self-center" tone={status.tone} label={status.label} />
            </View>
            {/* "Year-end projected surplus", then "Planned surplus: …" under it (owner, Nov 2026). */}
            <Text className="text-meta text-muted-foreground mt-3">
              {showActual
                ? `${realityCheck!.isPastFY ? "Year-end actual" : "Year-end projected"} ${heroSurplus >= 0 ? "surplus" : "deficit"}`
                : `Planned ${heroSurplus >= 0 ? "surplus" : "deficit"}`}
            </Text>
            <Text
              className="text-hero font-bold"
              style={{ color: heroSurplus >= 0 ? theme.success : theme.danger, fontVariant: ["tabular-nums"] }}
              numberOfLines={1}
            >
              {heroSurplus >= 0 ? "+" : "−"}
              {fmtFull(Math.abs(heroSurplus))}
            </Text>
            {showActual && (
              <Text className="text-meta text-muted-foreground mt-0.5">
                {netSurplusPlanned >= 0 ? "Planned surplus" : "Planned deficit"}: {fmtFull(Math.abs(netSurplusPlanned))}
              </Text>
            )}
            <View className="flex-row mt-3.5" style={{ gap: 8 }}>
              <StatTile label="Inflow" value={formatAmount(totalIncome)} />
              <StatTile label="Outflow" value={formatAmount(outflowWithDebt)} />
            </View>
            {realityCheck && !realityCheck.isPastFY && hasActuals && (
              <Text className="text-label text-faint-foreground mt-2">Month {realityCheck.monthsElapsed} of 12</Text>
            )}
          </Card>

          {/* ── Savings rate: planned vs actual ── */}
          <Card>
            <SectionTitle
              icon="stats-chart-outline"
              active
              title="Savings rate"
              hint={`Planned ${plannedRate}%${actualRate != null ? ` · actual so far ${actualRate}%` : ""}`}
            />
            {plannedRate > 0 && actualRate != null && (
              <View className="mt-3" style={{ gap: 6 }}>
                <ProgressBar
                  value={Math.min(1, actualRate / plannedRate)}
                  color={actualRate >= plannedRate ? theme.success : theme.warning}
                  height={8}
                  animated={false}
                />
                <View className="flex-row justify-between">
                  <Text className="text-meta font-semibold text-foreground">Actual {actualRate}%</Text>
                  <Text className="text-meta text-muted-foreground">Target {plannedRate}%</Text>
                </View>
              </View>
            )}
          </Card>

          {/* ── Income ── */}
          <Card>
            <SectionTitle
              icon="arrow-down-outline"
              color={theme.success}
              title="Inflow"
              right={
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  {profile?.status === "draft" && <Chip variant="status" className="self-center" tone="warning" label="Draft" />}
                  <Text className="text-body font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                    {formatAmount(totalIncome)}
                  </Text>
                </View>
              }
              className="mb-1"
            />
            <FieldRow label="Salary, in hand" value={formatAmount(derived?.annual_salary_in_hand ?? 0)} divider={false} />
            {!!derived?.salary_actuals?.months && (
              <Text className="text-label text-muted-foreground -mt-1 mb-1">
                Actual salary for {derived.salary_actuals.months} {derived.salary_actuals.months === 1 ? "month" : "months"}, the plan for the rest
                {Math.abs(derived.salary_actuals.difference) >= 1
                  ? `: ${formatAmount(Math.abs(derived.salary_actuals.difference))} ${derived.salary_actuals.difference > 0 ? "more" : "less"} than planned`
                  : ""}
              </Text>
            )}
            <FieldRow label="Expected bonus" value={formatAmount(derived?.expected_bonus ?? 0)} />
            <FieldRow label="Capital gains" value={formatAmount(derived?.expected_capital_gains ?? 0)} />
            <FieldRow
              label="Change in the income calculator"
              onPress={() => router.push({ pathname: "/goals/salary-calculator", params: { fy: targetFY } })}
            />
          </Card>

          {/* ── Outflow, as a statement that adds up ── */}
          <Card>
            <SectionTitle icon="arrow-up-outline" title="Outflow" className="mb-1" />
            <Statement
              lines={[
                {
                  label: "Expenses",
                  sub: "From your monthly budget",
                  amount: formatAmount(derived?.total_planned_expenses ?? 0),
                  onPress: () => router.push("/settings/budget-config"),
                },
                ...(debtServicingInr > 0
                  ? [
                      {
                        label: "Debt servicing",
                        sub: loanForecast.some((r) => r.currency !== "INR") ? "EMIs + prepayments (INR loans only)" : "EMIs + prepayments",
                        amount: formatAmount(debtServicingInr),
                        sign: "+" as const,
                        onPress: () => router.push("/goals/loans"),
                      },
                    ]
                  : []),
                {
                  label: "Investments",
                  amount: formatAmount(derived?.total_planned_investments ?? 0),
                  sign: "+" as const,
                  onPress: () => router.push({ pathname: "/goals/investment-buckets", params: { fy: targetFY } }),
                },
                {
                  label: "Milestones, paid directly",
                  sub: coveredByBuckets > 0 ? `${formatCompact(coveredByBuckets)} more covered by buckets` : undefined,
                  amount: formatAmount(derived?.total_planned_milestones ?? 0),
                  sign: "+" as const,
                  onPress: () => router.push("/goals/milestones"),
                },
              ]}
              total={{ label: "Total outflow", amount: formatAmount(outflowWithDebt) }}
            />
          </Card>

          {showActual && realityCheck ? (
            /* ── Plan vs actual: each line, expected so far against what happened ── */
            <Card>
              <SectionTitle
                icon="pulse-outline"
                active
                title={realityCheck.isPastFY ? "Year-end review" : "Plan vs actual"}
                hint={realityCheck.isPastFY ? "Planned against what happened" : "Expected by now against what happened"}
                className="mb-1"
              />
              {realityCheck.rows.map((row) => (
                <ActualRow
                  key={row.label}
                  label={row.label}
                  planned={row.planned}
                  proratedTarget={row.proratedTarget}
                  actualYTD={row.actualYTD}
                  gap={row.gap}
                  isAhead={row.isAhead}
                  gapLabel={row.gapLabel}
                  correctionLabel={row.correctionLabel}
                  isPastFY={realityCheck.isPastFY}
                  projYearEnd={
                    !realityCheck.isPastFY && realityCheck.monthsElapsed > 0
                      ? Math.round((row.actualYTD / realityCheck.monthsElapsed) * 12)
                      : null
                  }
                />
              ))}
              {debtServicingInr > 0 && (
                <ActualRow
                  label="Debt servicing"
                  planned={debtServicingInr}
                  proratedTarget={debtProrated}
                  actualYTD={debtYTD}
                  gap={debtGap}
                  isAhead={debtGap <= 0}
                  gapLabel={
                    Math.abs(debtGap) < 1 ? "On track" : debtGap > 0 ? `${formatCompact(debtGap)} over` : `${formatCompact(Math.abs(debtGap))} under`
                  }
                  correctionLabel={debtGap > 0 ? `${formatCompact(debtGap)} above expected` : ""}
                  isPastFY={realityCheck.isPastFY}
                  projYearEnd={!realityCheck.isPastFY ? debtProjYearEnd : null}
                />
              )}
              <View className="flex-row items-center justify-between border-t border-border pt-3 mt-1">
                <Text className="text-body font-bold text-foreground">
                  {realityCheck.isPastFY ? "Actual surplus" : "Projected surplus"}
                </Text>
                <Text
                  className="text-body font-bold"
                  style={{ color: netSurplusProj >= 0 ? theme.success : theme.danger, fontVariant: ["tabular-nums"] }}
                >
                  {fmtFull(netSurplusProj)}
                </Text>
              </View>
              {realityCheck.summaryLines.length > 0 && (
                <View className="mt-3 p-3 rounded-control" style={{ backgroundColor: theme.alpha("foreground", 0.04), gap: 4 }}>
                  {realityCheck.summaryLines.map((line, i) => (
                    <View key={i} className="flex-row">
                      <Text className="text-meta text-muted-foreground mr-1.5">
                        {line.startsWith("Cut") || line.startsWith("Add") ? "→" : "✓"}
                      </Text>
                      <Text className="text-meta text-muted-foreground flex-1">{line}</Text>
                    </View>
                  ))}
                </View>
              )}
            </Card>
          ) : null}

          {/* Data sources */}
          {derived && derived.sources.length > 0 && (
            <View className="px-1">
              <Text className="text-label font-semibold text-faint-foreground mb-1">Data sources</Text>
              {derived.sources.map((s, i) => (
                <Text key={i} className="text-label text-faint-foreground">
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

function MiniLine({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <View className="flex-row justify-between mt-0.5">
      <Text className={`text-meta ${bold ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</Text>
      <Text className={`text-meta text-foreground ${bold ? "font-bold" : ""}`} style={{ fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
    </View>
  );
}

/** One line of Plan vs actual: expected so far, actual, the gap chip and the year-end projection. */
function ActualRow({
  label,
  planned,
  proratedTarget,
  actualYTD,
  gap,
  isAhead,
  gapLabel,
  correctionLabel,
  isPastFY,
  projYearEnd,
}: {
  label: string;
  planned: number;
  proratedTarget: number;
  actualYTD: number;
  gap: number;
  isAhead: boolean;
  gapLabel: string;
  correctionLabel: string;
  isPastFY: boolean;
  projYearEnd: number | null;
}) {
  const theme = useTheme();
  const even = Math.abs(gap) < 1;
  const tone = even ? "neutral" : isAhead ? "success" : "danger";
  return (
    <View className="py-3 border-t border-border">
      <View className="flex-row items-center justify-between mb-1.5">
        <Text className="text-body font-semibold text-foreground flex-1" numberOfLines={1}>
          {label}
        </Text>
        <Chip variant="status" className="self-center" tone={tone} label={gapLabel} />
      </View>
      <MiniLine label={isPastFY ? "Planned" : "Expected so far"} value={fmtFull(isPastFY ? planned : proratedTarget)} />
      <MiniLine label="Actual" value={fmtFull(actualYTD)} bold />
      {!isPastFY && projYearEnd !== null && (
        <MiniLine label={`Year-end projection · ${fmtFull(planned)} planned`} value={fmtFull(projYearEnd)} />
      )}
      {!isPastFY && !even && correctionLabel !== "" && (
        <View className="flex-row items-center mt-1" style={{ gap: 6 }}>
          <Ionicons name={isAhead ? "checkmark" : "arrow-forward"} size={12} color={isAhead ? theme.success : theme.danger} />
          <Text className="text-meta font-semibold flex-1" style={{ color: isAhead ? theme.success : theme.danger }}>
            {isAhead ? correctionLabel : `${correctionLabel} to get back on track`}
          </Text>
        </View>
      )}
    </View>
  );
}
