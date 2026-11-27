import { useState, useCallback } from "react";
import { TRANSFER_COLOR } from "@/constants/semantic-colors";
import { View, ScrollView, Pressable } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";

import { Card, LoadingState, ScreenContainer, SectionHeader, Text, ReportAmount } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { useDataRefresh } from "@/hooks/use-data-refresh";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getExpensesPaginated } from "@/services/expense-queries";
import { getFYStartMonth } from "@/services/settings";
import { getCurrentFY, getFYRange } from "@/utils/fiscal-year";
import { toIsoDate } from "@/utils/date";
import {
  generateFinancialHealthReport,
  type FinancialHealthReport,
} from "@/services/reports/financial-health-report";
import {
  exportFinancialHealthPDF,
  sharePDF,
} from "@/services/reports/report-pdf-export";
import { useTheme, type Theme } from "@/hooks/use-theme";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";
import { useAlert } from "@/hooks/use-alert";
import { isPartOn } from "@/services/customise";
import { getFinancialCockpit, type FinancialCockpitData } from "@/services/financial-cockpit";
import { scoreToGrade } from "@/utils/financial-cockpit";

/** What the plan's grade measures, said once (the yearly plan: savings, investing, spending, goals, headroom). */
const PLAN_GRADE_SUMMARY = "From your yearly plan: savings, investments, spending, goals and headroom, so far this year";

/** Takes the theme as an argument: this is a plain helper, not a component, so it must not
 *  call a hook. It is invoked from inside map callbacks, where a conditional hook call would
 *  break hook order. */
function gradeColor(grade: string, theme: Theme) {
  if (grade.startsWith("A")) return theme.success;
  if (grade.startsWith("B")) return theme.primary;
  if (grade.startsWith("C")) return theme.warning;
  return theme.danger;
}

function StatBox({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <View className="bg-card rounded-card p-3 border border-border flex-1">
      <Text className="text-label text-muted-foreground mb-1">{label}</Text>
      <Text
        className="text-body font-bold text-foreground"
        style={color ? { color } : undefined}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const DIMENSION_ICONS: Record<string, string> = {
  "Savings Rate": "trending-up-outline",
  "Debt Management": "card-outline",
  "Diversification": "pie-chart-outline",
  "Emergency Fund": "shield-checkmark-outline",
  "Spending Discipline": "pulse-outline",
  // The yearly plan's factors (services/financial-cockpit.ts)
  Savings: "trending-up-outline",
  Investments: "pie-chart-outline",
  Spending: "pulse-outline",
  Goals: "flag-outline",
  Surplus: "wallet-outline",
};

export default function FinancialHealthReportScreen() {
  const alert = useAlert();
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const tint = theme.primary;
  const [report, setReport] = useState<FinancialHealthReport | null>(null);
  /**
   * The grade on the Goals card comes from the yearly plan (services/financial-cockpit.ts), so the
   * report leads with that same grade and its factors. Without a plan, the report's own grade shows.
   */
  const [plan, setPlan] = useState<FinancialCockpitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [loadFailed, setLoadFailed] = useState(false);
  const loadData = useCallback(async () => {
    try {
      const fy = String(getCurrentFY(getFYStartMonth()));
      const [data, cockpit] = await Promise.all([
        generateFinancialHealthReport(DEFAULT_USER_ID),
        getFinancialCockpit(DEFAULT_USER_ID, fy).catch(() => null),
      ]);
      setReport(data);
      setPlan(cockpit);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
    setLoading(false);
  }, []);

  useDataRefresh(loadData);

  async function handleExportPDF() {
    if (!report || exporting) return;
    setExporting(true);
    try {
      const uri = await exportFinancialHealthPDF(
        plan
          ? {
              ...report,
              overallGrade: plan.healthGrade,
              overallScore: Math.round(plan.healthScore),
              gradeSummary: plan.healthProvisional
                ? `${PLAN_GRADE_SUMMARY}. Early days: under two months of this year so far, so read this grade as a first look.`
                : PLAN_GRADE_SUMMARY,
              // The table under the grade is the plan's factors too, as on screen.
              dimensions: plan.healthFactors.map((f) => ({ name: f.name, score: Math.round(f.score), grade: scoreToGrade(f.score), description: f.detail })),
            }
          : report,
      );
      await sharePDF(uri);
    } catch (e: any) {
      alert("Export failed", e?.message || "Could not generate PDF");
    }
    setExporting(false);
  }

  function getFYDates() {
    const startMonth = getFYStartMonth();
    const fyYear = getCurrentFY(startMonth);
    const { start, end } = getFYRange(fyYear, startMonth);
    return { startDate: toIsoDate(start), endDate: toIsoDate(end) };
  }

  /** The transaction lists open in Insights: with Insights switched off, say so instead. */
  function insightsOn(): boolean {
    if (isPartOn("insights")) return true;
    alert("Insights is off", "Turn Insights on in Settings → Customise Arth to see these transactions.");
    return false;
  }

  async function drillCategory(categoryId: string, categoryName: string) {
    if (!insightsOn()) return;
    try {
      const { startDate, endDate } = getFYDates();
      const txns = await getExpensesPaginated(
        DEFAULT_USER_ID,
        { categoryIds: [categoryId], startDate, endDate, status: "approved" },
        200,
      );
      if (txns.length === 0) return;
      router.push({
        pathname: "/insights/filtered",
        params: {
          expenseIds: txns.map((t) => t.id).join(","),
          title: categoryName,
        },
      });
    } catch {}
  }

  async function drillSpikeCategory(categoryId: string, categoryName: string) {
    if (!insightsOn()) return;
    try {
      const now = new Date();
      const startDate = toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
      const endDate = toIsoDate(now);
      const txns = await getExpensesPaginated(
        DEFAULT_USER_ID,
        { categoryIds: [categoryId], startDate, endDate, status: "approved" },
        200,
      );
      if (txns.length === 0) return;
      router.push({
        pathname: "/insights/filtered",
        params: {
          expenseIds: txns.map((t) => t.id).join(","),
          title: `${categoryName} — This Month`,
        },
      });
    } catch {}
  }

  async function drillFixedOrDiscretionary(type: "fixed" | "discretionary") {
    if (!insightsOn()) return;
    try {
      const { startDate, endDate } = getFYDates();
      const txns = await getExpensesPaginated(
        DEFAULT_USER_ID,
        {
          avoidability: type === "fixed" ? "unavoidable" : "avoidable",
          startDate,
          endDate,
          status: "approved",
        },
        200,
      );
      if (txns.length === 0) return;
      router.push({
        pathname: "/insights/filtered",
        params: {
          expenseIds: txns.map((t) => t.id).join(","),
          title: type === "fixed" ? "Fixed Expenses" : "Discretionary Expenses",
        },
      });
    } catch {}
  }

  if (loading) {
    return (
      <ScreenContainer padTop={false}>
        {loadFailed && <LoadFailedBanner onRetry={loadData} />}
        <LoadingState message="Analyzing your finances..." />
      </ScreenContainer>
    );
  }

  if (!report) {
    return (
      <ScreenContainer padTop={false}>
        {loadFailed && <LoadFailedBanner onRetry={loadData} />}
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="analytics-outline" size={48} color={theme.mutedForeground} />
          <Text className="text-heading font-medium text-foreground mt-4">
            Not enough data
          </Text>
          <Text className="text-meta text-center text-muted-foreground mt-2">
            Add expenses and set up your income profile to generate the Financial Health report.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  // One grade everywhere: the plan's (as on the Goals card), else the report's own.
  const shownGrade = plan ? plan.healthGrade : report.overallGrade;
  const shownScore = plan ? Math.round(plan.healthScore) : report.overallScore;
  // "Early days" reads neutral, as on the Goals card: too little of the year to grade on.
  const gc = plan?.healthProvisional ? theme.mutedForeground : gradeColor(shownGrade, theme);
  const openBreakdown = () =>
    plan &&
    router.push({
      pathname: "/goals/health-grade",
      params: {
        grade: plan.healthGrade,
        score: String(Math.round(plan.healthScore)),
        factorsJson: JSON.stringify(plan.healthFactors),
        provisional: plan.healthProvisional ? "1" : "0",
      },
    });

  return (
    <ScreenContainer padTop={false}>
      {loadFailed && <LoadFailedBanner onRetry={loadData} />}
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        {/* Generated timestamp */}
        <View className="px-4 pt-2 pb-1">
          <Text className="text-label text-muted-foreground opacity-60">
            Generated {new Date(report.generatedAt).toLocaleDateString()}
          </Text>
        </View>

        {/* Overall Grade — hero card: the yearly plan's grade, as on the Goals card. Tap for how it's worked out. */}
        <View className="px-4 mb-3">
          <Pressable onPress={openBreakdown} disabled={!plan} accessibilityRole={plan ? "button" : undefined} accessibilityLabel={`Grade ${shownGrade}, score ${shownScore} out of 100`}>
          <Card>
            <View className="items-center py-2">
              {/* Grade ring */}
              <View
                className="w-20 h-20 rounded-full items-center justify-center mb-2"
                style={{
                  borderWidth: 4,
                  borderColor: gc,
                  backgroundColor: `${gc}10`,
                }}
              >
                <Text className="text-display font-bold" style={{ color: gc }}>
                  {shownGrade}
                </Text>
              </View>
              <Text className="text-body font-semibold text-foreground">
                Score: {shownScore}/100
              </Text>
              <Text className="text-label text-muted-foreground text-center mt-1 px-4">
                {plan ? PLAN_GRADE_SUMMARY : report.gradeSummary}
              </Text>
              {plan?.healthProvisional && (
                <Text className="text-label text-muted-foreground text-center mt-1 px-4">Early days: under two months of this year so far.</Text>
              )}
              {plan && (
                <Text className="text-label font-semibold mt-2" style={{ color: theme.primary }}>How it's worked out ›</Text>
              )}
            </View>
          </Card>
          </Pressable>
        </View>

        {/* Dimension grades — compact horizontal cards */}
        <View className="px-4 mb-1">
          <View className="flex-row flex-wrap gap-2">
            {(plan
              ? plan.healthFactors.map((f) => ({ name: f.name, grade: `${Math.round(f.score)}/100`, description: f.detail }))
              : report.dimensions
            ).map((d) => {
              const dc = plan ? gradeColor(scoreToGrade(parseInt(d.grade, 10)), theme) : gradeColor(d.grade, theme);
              const iconName = DIMENSION_ICONS[d.name] || "ellipse-outline";
              return (
                <View
                  key={d.name}
                  className="rounded-card p-2.5 border"
                  style={{
                    borderColor: `${dc}30`,
                    backgroundColor: `${dc}08`,
                    width: "48%",
                    flexGrow: 1,
                  }}
                >
                  <View className="flex-row items-center gap-2 mb-1">
                    <Ionicons name={iconName as any} size={14} color={dc} />
                    <Text className="text-label font-bold" style={{ color: dc }}>{d.grade}</Text>
                  </View>
                  <Text className="text-label font-semibold text-foreground" numberOfLines={1}>
                    {d.name}
                  </Text>
                  <Text className="text-label text-muted-foreground mt-0.5" numberOfLines={2}>
                    {d.description}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Net Worth */}
        <View className="px-4 mt-4">
          <SectionHeader title="Net Worth" />
          <View className="flex-row gap-3 mb-3">
            <StatBox label="Total assets" value=<ReportAmount value={report.totalAssets} /> color={theme.success} />
            <StatBox label="Total liabilities" value=<ReportAmount value={report.totalLiabilities} /> color={theme.danger} />
          </View>
          <Card>
            <View className="flex-row items-center justify-between">
              <Text className="text-label text-muted-foreground">
                Net financial worth
              </Text>
              <Text
                className="text-heading font-bold"
                style={{ color: report.netWorth >= 0 ? theme.success : theme.danger }}
              >
                <ReportAmount value={report.netWorth} />
              </Text>
            </View>
          </Card>
        </View>

        {/* Savings Rate Trend */}
        {report.monthlySavingsRates.length > 0 && (
          <View className="px-4 mt-4">
            <SectionHeader title="Savings Rate Trend" />
            <Text className="text-label text-muted-foreground mb-2 -mt-1 opacity-70">
              Based on income from your salary profile
            </Text>
            <Card>
              {/* Bar chart */}
              <View className="flex-row items-end gap-1.5" style={{ height: 80 }}>
                {report.monthlySavingsRates.map((m, i) => {
                  const h = Math.max(4, (Math.max(0, m.rate) / 100) * 70);
                  const isLast = i === report.monthlySavingsRates.length - 1;
                  return (
                    <View key={m.month} className="flex-1 items-center gap-1">
                      <Text className="text-label font-medium" style={{ color: m.rate >= 0 ? theme.success : theme.danger }}>
                        {Math.round(m.rate)}%
                      </Text>
                      <View
                        className="w-full rounded-t"
                        style={{
                          height: h,
                          backgroundColor: isLast ? theme.success : theme.alpha("success", 0.08),
                          borderWidth: isLast ? 1 : 0,
                          borderColor: theme.success,
                        }}
                      />
                    </View>
                  );
                })}
              </View>
              <View className="flex-row gap-1.5 mt-1">
                {report.monthlySavingsRates.map((m) => (
                  <Text
                    key={m.month}
                    className="flex-1 text-center text-muted-foreground"
                   
                  >
                    {m.month}
                  </Text>
                ))}
              </View>
            </Card>

            {/* Monthly detail table */}
            <View className="mt-3">
              <Card>
                <Text className="text-label font-semibold text-foreground mb-2">
                  Monthly breakdown
                </Text>
                {/* Header */}
                <View className="flex-row items-center pb-1.5 mb-1 border-b border-border">
                  <Text className="text-label font-semibold text-muted-foreground w-12" numberOfLines={1}>Month</Text>
                  <Text className="text-label font-semibold text-muted-foreground flex-1 text-right">Income</Text>
                  <Text className="text-label font-semibold text-muted-foreground flex-1 text-right">Spent</Text>
                  <Text className="text-label font-semibold text-muted-foreground flex-1 text-right">Saved</Text>
                  <Text className="text-label font-semibold text-muted-foreground w-10 text-right">Rate</Text>
                </View>
                {report.monthlySavingsRates.map((m) => (
                  <View key={m.month} className="flex-row items-center py-1.5 border-b border-border">
                    <Text className="text-label text-muted-foreground w-12">{m.month}</Text>
                    <Text className="text-label text-foreground flex-1 text-right" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}><ReportAmount value={m.income} /></Text>
                    <Text className="text-label flex-1 text-right" style={{ color: theme.danger }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}><ReportAmount value={m.expenses} /></Text>
                    <Text className="text-label font-medium flex-1 text-right" style={{ color: m.saved >= 0 ? theme.success : theme.danger }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      <ReportAmount value={m.saved} />
                    </Text>
                    <Text className="text-label font-semibold w-10 text-right" style={{ color: m.rate >= 30 ? theme.success : m.rate >= 0 ? theme.warning : theme.danger }}>
                      {Math.round(m.rate)}%
                    </Text>
                  </View>
                ))}
                {/* Average row */}
                <View className="flex-row items-center pt-2 mt-1">
                  <Text className="text-label font-semibold text-foreground w-12">Avg</Text>
                  <Text className="text-label font-semibold text-foreground flex-1 text-right" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                    <ReportAmount value={report.monthlySavingsRates.reduce((s, m) => s + m.income, 0) / report.monthlySavingsRates.length} />
                  </Text>
                  <Text className="text-label font-semibold flex-1 text-right" style={{ color: theme.danger }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                    <ReportAmount value={report.monthlySavingsRates.reduce((s, m) => s + m.expenses, 0) / report.monthlySavingsRates.length} />
                  </Text>
                  <Text className="text-label font-semibold flex-1 text-right" style={{ color: theme.success }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                    <ReportAmount value={report.monthlySavingsRates.reduce((s, m) => s + m.saved, 0) / report.monthlySavingsRates.length} />
                  </Text>
                  <Text className="text-label font-bold w-10 text-right" style={{ color: report.avgSavingsRate >= 30 ? theme.success : theme.warning }}>
                    {Math.round(report.avgSavingsRate)}%
                  </Text>
                </View>
              </Card>
            </View>
          </View>
        )}

        {/* Key Metrics */}
        <View className="px-4 mt-4">
          <SectionHeader title="Key Metrics" />
          <View className="flex-row gap-3 mb-3">
            <StatBox
              label="Savings rate"
              value={`${Math.round(report.currentSavingsRate)}%`}
              color={report.currentSavingsRate >= 40 ? theme.success : theme.warning}
            />
            <StatBox
              label="Debt-to-income"
              value={`${Math.round(report.debtToIncomeRatio)}%`}
              color={report.debtToIncomeRatio <= 20 ? theme.success : theme.warning}
            />
          </View>
          <View className="flex-row gap-3">
            <StatBox
              label="Emergency buffer"
              value={`${report.emergencyMonths.toFixed(1)} mo`}
              color={report.emergencyMonths >= 3 ? theme.success : theme.danger}
            />
            <StatBox
              label="Monthly EMI"
              value={report.monthlyEMI > 0 ? <ReportAmount value={report.monthlyEMI} /> : "None"}
              color={report.monthlyEMI > 0 ? theme.warning : theme.success}
            />
          </View>
        </View>

        {/* Emergency Fund Alert */}
        {report.emergencyGap > 0 && (
          <View className="px-4 mt-3">
            <Card>
              <View className="rounded-control p-3" style={{ backgroundColor: theme.alpha("danger", 0.08) }}>
                <View className="flex-row items-center gap-2 mb-1">
                  <Ionicons name="warning-outline" size={14} color={theme.danger} />
                  <Text className="text-label font-semibold" style={{ color: theme.danger }}>
                    Emergency fund gap
                  </Text>
                </View>
                <Text className="text-label text-muted-foreground">
                  You need <ReportAmount value={report.emergencyTarget} /> (6 months expenses).
                  Current liquid buffer: <ReportAmount value={report.liquidAssets} />.
                  Gap: <ReportAmount value={report.emergencyGap} />.
                </Text>
              </View>
            </Card>
          </View>
        )}

        {/* Expense Composition — tap to drill down to transaction list */}
        {report.categoryBreakdown.length > 0 && (
          <View className="px-4 mt-4">
            <SectionHeader title="Expense Composition" />
            <Card>
              {/* Stacked bar */}
              <View className="flex-row h-3 rounded-full overflow-hidden mb-3">
                {report.categoryBreakdown.slice(0, 7).map((c, i) => {
                  const barColors = [theme.primary, theme.success, theme.warning, TRANSFER_COLOR, "#EC4899", "#0EA5E9", theme.mutedForeground];
                  return (
                    <View
                      key={c.categoryId}
                      style={{ flex: c.percentage, backgroundColor: barColors[i % barColors.length] }}
                    />
                  );
                })}
              </View>
              {/* Legend — tap to navigate */}
              {report.categoryBreakdown.slice(0, 7).map((c, i) => {
                const barColors = [theme.primary, theme.success, theme.warning, TRANSFER_COLOR, "#EC4899", "#0EA5E9", theme.mutedForeground];
                return (
                  <Pressable
                    key={c.categoryId}
                    onPress={() => drillCategory(c.categoryId, c.categoryName)}
                    className="flex-row items-center justify-between py-1.5"
                  >
                    <View className="flex-row items-center gap-2">
                      <View
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: barColors[i % barColors.length] }}
                      />
                      <Text className="text-label text-foreground">
                        {c.categoryName}
                      </Text>
                      <Ionicons name="chevron-forward" size={10} color={theme.mutedForeground} />
                    </View>
                    <View className="flex-row items-center gap-3">
                      <Text className="text-label text-muted-foreground">
                        {Math.round(c.percentage)}%
                      </Text>
                      <Text
                        className="text-label font-semibold text-foreground text-right"
                        style={{ minWidth: 72 }}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.75}
                      >
                        <ReportAmount value={c.amount} />
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </Card>
          </View>
        )}

        {/* Fixed vs Discretionary — with drilldowns */}
        {report.fixedVsDiscretionary && (report.fixedVsDiscretionary.fixed > 0 || report.fixedVsDiscretionary.discretionary > 0) && (
          <View className="px-4 mt-4">
            <SectionHeader title="Fixed vs Discretionary" />
            <Card>
              <View className="flex-row h-2.5 rounded-full overflow-hidden mb-3">
                <View style={{ flex: report.fixedVsDiscretionary.fixed, backgroundColor: theme.mutedForeground }} />
                <View style={{ flex: report.fixedVsDiscretionary.discretionary, backgroundColor: tint }} />
              </View>
              <Pressable
                onPress={() => drillFixedOrDiscretionary("fixed")}
                className="flex-row items-center justify-between py-2 border-b border-border"
              >
                <View className="flex-row items-center gap-2">
                  <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: theme.mutedForeground }} />
                  <Text className="text-label font-semibold text-foreground">
                    Fixed / Essential
                  </Text>
                  <Ionicons name="chevron-forward" size={10} color={theme.mutedForeground} />
                </View>
                <View className="flex-row items-center gap-2">
                  <Text className="text-label text-muted-foreground">
                    {Math.round(report.fixedVsDiscretionary.fixedPct)}%
                  </Text>
                  <Text
                    className="text-label font-semibold text-foreground text-right"
                    style={{ minWidth: 72 }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                  >
                    <ReportAmount value={report.fixedVsDiscretionary.fixed} />
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => drillFixedOrDiscretionary("discretionary")}
                className="flex-row items-center justify-between py-2"
              >
                <View className="flex-row items-center gap-2">
                  <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tint }} />
                  <Text className="text-label font-semibold text-foreground">
                    Discretionary
                  </Text>
                  <Ionicons name="chevron-forward" size={10} color={theme.mutedForeground} />
                </View>
                <View className="flex-row items-center gap-2">
                  <Text className="text-label text-muted-foreground">
                    {Math.round(report.fixedVsDiscretionary.discretionaryPct)}%
                  </Text>
                  <Text
                    className="text-label font-semibold text-foreground text-right"
                    style={{ minWidth: 72 }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                  >
                    <ReportAmount value={report.fixedVsDiscretionary.discretionary} />
                  </Text>
                </View>
              </Pressable>
            </Card>
          </View>
        )}

        {/* Spending Spikes — tap to drill down */}
        {report.spikingCategories.length > 0 && (
          <View className="px-4 mt-4">
            <SectionHeader title="Spending Spikes" />
            {report.spikingCategories.map((s) => (
              <Pressable key={s.categoryId} onPress={() => drillSpikeCategory(s.categoryId, s.categoryName)} className="mb-3">
                <Card>
                  <View className="flex-row items-center gap-2 mb-1">
                    <Ionicons name="trending-up" size={14} color={theme.warning} />
                    <Text className="text-label font-semibold text-foreground flex-1">
                      {s.categoryName}
                    </Text>
                    <Ionicons name="chevron-forward" size={12} color={theme.mutedForeground} />
                  </View>
                  <Text className="text-label text-muted-foreground">
                    <ReportAmount value={s.currentMonth} /> this month — {s.spikeMultiple.toFixed(1)}x your 3-month average of{" "}
                    <ReportAmount value={s.avgPrevious} />
                  </Text>
                </Card>
              </Pressable>
            ))}
          </View>
        )}

        {/* Download PDF */}
        <View className="px-4 mt-6">
          <Pressable
            onPress={handleExportPDF}
            className="rounded-card p-3.5 items-center flex-row justify-center gap-2"
            style={{ backgroundColor: theme.primary }}
            disabled={exporting}
            accessibilityRole="button"
            accessibilityLabel="Download PDF"
          >
            <Ionicons name={exporting ? "hourglass-outline" : "download-outline"} size={18} color="white" />
            <Text className="text-body font-semibold text-white">
              {exporting ? "Generating PDF..." : "Download PDF"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
