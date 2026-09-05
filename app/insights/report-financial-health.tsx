import { useState, useCallback } from "react";
import { View, ScrollView, Pressable, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { Card, LoadingState, ScreenContainer, SectionHeader, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";
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

function gradeColor(grade: string, colorScheme: "light" | "dark") {
  const s = StatusColors[colorScheme];
  if (grade.startsWith("A")) return s.success;
  if (grade.startsWith("B")) return "#3B82F6";
  if (grade.startsWith("C")) return s.warning;
  return s.danger;
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View className="bg-card rounded-xl p-3 border border-border flex-1">
      <Text className="text-xs text-muted-foreground mb-1">{label}</Text>
      <Text
        className="text-base font-bold text-foreground"
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
};

export default function FinancialHealthReportScreen() {
  const router = useRouter();
  const { colorScheme, colors } = useColorScheme();
  const status = StatusColors[colorScheme];
  const tint = colors.tint;
  const [report, setReport] = useState<FinancialHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const data = await generateFinancialHealthReport(DEFAULT_USER_ID);
      setReport(data);
    } catch {}
    setLoading(false);
  }, []);

  useDataRefresh(loadData);

  async function handleExportPDF() {
    if (!report || exporting) return;
    setExporting(true);
    try {
      const uri = await exportFinancialHealthPDF(report);
      await sharePDF(uri);
    } catch (e: any) {
      Alert.alert("Export failed", e?.message || "Could not generate PDF");
    }
    setExporting(false);
  }

  function getFYDates() {
    const startMonth = getFYStartMonth();
    const fyYear = getCurrentFY(startMonth);
    const { start, end } = getFYRange(fyYear, startMonth);
    return { startDate: toIsoDate(start), endDate: toIsoDate(end) };
  }

  async function drillCategory(categoryId: string, categoryName: string) {
    try {
      const { startDate, endDate } = getFYDates();
      const txns = await getExpensesPaginated(
        DEFAULT_USER_ID,
        { categoryIds: [categoryId], startDate, endDate, status: "approved" },
        200,
      );
      if (txns.length === 0) return;
      router.push({
        pathname: "/insights/filtered" as never,
        params: {
          expenseIds: txns.map((t) => t.id).join(","),
          title: categoryName,
        },
      });
    } catch {}
  }

  async function drillSpikeCategory(categoryId: string, categoryName: string) {
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
        pathname: "/insights/filtered" as never,
        params: {
          expenseIds: txns.map((t) => t.id).join(","),
          title: `${categoryName} — This Month`,
        },
      });
    } catch {}
  }

  async function drillFixedOrDiscretionary(type: "fixed" | "discretionary") {
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
        pathname: "/insights/filtered" as never,
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
        <LoadingState message="Analyzing your finances..." />
      </ScreenContainer>
    );
  }

  if (!report) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="analytics-outline" size={48} color={colors.textSecondary} />
          <Text className="text-lg font-medium text-foreground mt-4">
            Not enough data
          </Text>
          <Text className="text-sm text-center text-muted-foreground mt-2">
            Add expenses and set up your income profile to generate the Financial Health report.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  const gc = gradeColor(report.overallGrade, colorScheme);

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        {/* Generated timestamp */}
        <View className="px-4 pt-2 pb-1">
          <Text className="text-xs text-muted-foreground opacity-60">
            Generated {new Date(report.generatedAt).toLocaleDateString()}
          </Text>
        </View>

        {/* Overall Grade — hero card */}
        <View className="px-4 mb-3">
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
                <Text className="text-3xl font-bold" style={{ color: gc }}>
                  {report.overallGrade}
                </Text>
              </View>
              <Text className="text-sm font-semibold text-foreground">
                Score: {report.overallScore}/100
              </Text>
              <Text className="text-xs text-muted-foreground text-center mt-1 px-4">
                {report.gradeSummary}
              </Text>
            </View>
          </Card>
        </View>

        {/* Dimension grades — compact horizontal cards */}
        <View className="px-4 mb-1">
          <View className="flex-row flex-wrap gap-2">
            {report.dimensions.map((d) => {
              const dc = gradeColor(d.grade, colorScheme);
              const iconName = DIMENSION_ICONS[d.name] || "ellipse-outline";
              return (
                <View
                  key={d.name}
                  className="rounded-xl p-2.5 border"
                  style={{
                    borderColor: `${dc}30`,
                    backgroundColor: `${dc}08`,
                    width: "48%",
                    flexGrow: 1,
                  }}
                >
                  <View className="flex-row items-center gap-2 mb-1">
                    <Ionicons name={iconName as any} size={14} color={dc} />
                    <Text className="text-xs font-bold" style={{ color: dc }}>{d.grade}</Text>
                  </View>
                  <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>
                    {d.name}
                  </Text>
                  <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={2} style={{ fontSize: 10 }}>
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
            <StatBox label="Total assets" value={formatAmount(report.totalAssets)} color={status.success} />
            <StatBox label="Total liabilities" value={formatAmount(report.totalLiabilities)} color={status.danger} />
          </View>
          <Card>
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-muted-foreground">
                Net financial worth
              </Text>
              <Text
                className="text-lg font-bold"
                style={{ color: report.netWorth >= 0 ? status.success : status.danger }}
              >
                {formatAmount(report.netWorth)}
              </Text>
            </View>
          </Card>
        </View>

        {/* Savings Rate Trend */}
        {report.monthlySavingsRates.length > 0 && (
          <View className="px-4 mt-4">
            <SectionHeader title="Savings Rate Trend" />
            <Text className="text-xs text-muted-foreground mb-2 -mt-1 opacity-70">
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
                      <Text className="text-xs font-medium" style={{ color: m.rate >= 0 ? status.success : status.danger, fontSize: 9 }}>
                        {Math.round(m.rate)}%
                      </Text>
                      <View
                        className="w-full rounded-t"
                        style={{
                          height: h,
                          backgroundColor: isLast ? status.success : status.successBg,
                          borderWidth: isLast ? 1 : 0,
                          borderColor: status.success,
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
                    style={{ fontSize: 9 }}
                  >
                    {m.month}
                  </Text>
                ))}
              </View>
            </Card>

            {/* Monthly detail table */}
            <View className="mt-3">
              <Card>
                <Text className="text-xs font-semibold text-foreground mb-2">
                  Monthly breakdown
                </Text>
                {/* Header */}
                <View className="flex-row items-center pb-1.5 mb-1 border-b border-border">
                  <Text className="text-xs font-semibold text-muted-foreground w-10">Month</Text>
                  <Text className="text-xs font-semibold text-muted-foreground flex-1 text-right">Income</Text>
                  <Text className="text-xs font-semibold text-muted-foreground flex-1 text-right">Spent</Text>
                  <Text className="text-xs font-semibold text-muted-foreground flex-1 text-right">Saved</Text>
                  <Text className="text-xs font-semibold text-muted-foreground w-10 text-right">Rate</Text>
                </View>
                {report.monthlySavingsRates.map((m) => (
                  <View key={m.month} className="flex-row items-center py-1.5 border-b border-border">
                    <Text className="text-xs text-muted-foreground w-10">{m.month}</Text>
                    <Text className="text-xs text-foreground flex-1 text-right" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatAmount(m.income)}</Text>
                    <Text className="text-xs flex-1 text-right" style={{ color: status.danger }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatAmount(m.expenses)}</Text>
                    <Text className="text-xs font-medium flex-1 text-right" style={{ color: m.saved >= 0 ? status.success : status.danger }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      {formatAmount(m.saved)}
                    </Text>
                    <Text className="text-xs font-semibold w-10 text-right" style={{ color: m.rate >= 30 ? status.success : m.rate >= 0 ? status.warning : status.danger }}>
                      {Math.round(m.rate)}%
                    </Text>
                  </View>
                ))}
                {/* Average row */}
                <View className="flex-row items-center pt-2 mt-1">
                  <Text className="text-xs font-semibold text-foreground w-10">Avg</Text>
                  <Text className="text-xs font-semibold text-foreground flex-1 text-right" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                    {formatAmount(report.monthlySavingsRates.reduce((s, m) => s + m.income, 0) / report.monthlySavingsRates.length)}
                  </Text>
                  <Text className="text-xs font-semibold flex-1 text-right" style={{ color: status.danger }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                    {formatAmount(report.monthlySavingsRates.reduce((s, m) => s + m.expenses, 0) / report.monthlySavingsRates.length)}
                  </Text>
                  <Text className="text-xs font-semibold flex-1 text-right" style={{ color: status.success }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                    {formatAmount(report.monthlySavingsRates.reduce((s, m) => s + m.saved, 0) / report.monthlySavingsRates.length)}
                  </Text>
                  <Text className="text-xs font-bold w-10 text-right" style={{ color: report.avgSavingsRate >= 30 ? status.success : status.warning }}>
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
              color={report.currentSavingsRate >= 40 ? status.success : status.warning}
            />
            <StatBox
              label="Debt-to-income"
              value={`${Math.round(report.debtToIncomeRatio)}%`}
              color={report.debtToIncomeRatio <= 20 ? status.success : status.warning}
            />
          </View>
          <View className="flex-row gap-3">
            <StatBox
              label="Emergency buffer"
              value={`${report.emergencyMonths.toFixed(1)} mo`}
              color={report.emergencyMonths >= 3 ? status.success : status.danger}
            />
            <StatBox
              label="Monthly EMI"
              value={report.monthlyEMI > 0 ? formatAmount(report.monthlyEMI) : "None"}
              color={report.monthlyEMI > 0 ? status.warning : status.success}
            />
          </View>
        </View>

        {/* Emergency Fund Alert */}
        {report.emergencyGap > 0 && (
          <View className="px-4 mt-3">
            <Card>
              <View className="rounded-lg p-3" style={{ backgroundColor: status.dangerBg }}>
                <View className="flex-row items-center gap-2 mb-1">
                  <Ionicons name="warning-outline" size={14} color={status.danger} />
                  <Text className="text-xs font-semibold" style={{ color: status.danger }}>
                    Emergency fund gap
                  </Text>
                </View>
                <Text className="text-xs text-muted-foreground">
                  You need {formatAmount(report.emergencyTarget)} (6 months expenses).
                  Current liquid buffer: {formatAmount(report.liquidAssets)}.
                  Gap: {formatAmount(report.emergencyGap)}.
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
                  const barColors = ["#2563EB", "#22C55E", "#F59E0B", "#8B5CF6", "#EC4899", "#0EA5E9", "#6B7280"];
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
                const barColors = ["#2563EB", "#22C55E", "#F59E0B", "#8B5CF6", "#EC4899", "#0EA5E9", "#6B7280"];
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
                      <Text className="text-xs text-foreground">
                        {c.categoryName}
                      </Text>
                      <Ionicons name="chevron-forward" size={10} color={colors.textSecondary} />
                    </View>
                    <View className="flex-row items-center gap-3">
                      <Text className="text-xs text-muted-foreground">
                        {Math.round(c.percentage)}%
                      </Text>
                      <Text
                        className="text-xs font-semibold text-foreground text-right"
                        style={{ minWidth: 72 }}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.75}
                      >
                        {formatAmount(c.amount)}
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
                <View style={{ flex: report.fixedVsDiscretionary.fixed, backgroundColor: "#6B7280" }} />
                <View style={{ flex: report.fixedVsDiscretionary.discretionary, backgroundColor: tint }} />
              </View>
              <Pressable
                onPress={() => drillFixedOrDiscretionary("fixed")}
                className="flex-row items-center justify-between py-2 border-b border-border"
              >
                <View className="flex-row items-center gap-2">
                  <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#6B7280" }} />
                  <Text className="text-xs font-semibold text-foreground">
                    Fixed / Essential
                  </Text>
                  <Ionicons name="chevron-forward" size={10} color={colors.textSecondary} />
                </View>
                <View className="flex-row items-center gap-2">
                  <Text className="text-xs text-muted-foreground">
                    {Math.round(report.fixedVsDiscretionary.fixedPct)}%
                  </Text>
                  <Text
                    className="text-xs font-semibold text-foreground text-right"
                    style={{ minWidth: 72 }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                  >
                    {formatAmount(report.fixedVsDiscretionary.fixed)}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => drillFixedOrDiscretionary("discretionary")}
                className="flex-row items-center justify-between py-2"
              >
                <View className="flex-row items-center gap-2">
                  <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tint }} />
                  <Text className="text-xs font-semibold text-foreground">
                    Discretionary
                  </Text>
                  <Ionicons name="chevron-forward" size={10} color={colors.textSecondary} />
                </View>
                <View className="flex-row items-center gap-2">
                  <Text className="text-xs text-muted-foreground">
                    {Math.round(report.fixedVsDiscretionary.discretionaryPct)}%
                  </Text>
                  <Text
                    className="text-xs font-semibold text-foreground text-right"
                    style={{ minWidth: 72 }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                  >
                    {formatAmount(report.fixedVsDiscretionary.discretionary)}
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
                    <Ionicons name="trending-up" size={14} color={status.warning} />
                    <Text className="text-xs font-semibold text-foreground flex-1">
                      {s.categoryName}
                    </Text>
                    <Ionicons name="chevron-forward" size={12} color={colors.textSecondary} />
                  </View>
                  <Text className="text-xs text-muted-foreground">
                    {formatAmount(s.currentMonth)} this month — {s.spikeMultiple.toFixed(1)}x your 3-month average of{" "}
                    {formatAmount(s.avgPrevious)}
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
            className="rounded-xl p-3.5 items-center flex-row justify-center gap-2"
            style={{ backgroundColor: "#0F766E" }}
            disabled={exporting}
            accessibilityRole="button"
            accessibilityLabel="Download PDF"
          >
            <Ionicons name={exporting ? "hourglass-outline" : "download-outline"} size={18} color="white" />
            <Text className="text-sm font-semibold text-white">
              {exporting ? "Generating PDF..." : "Download PDF"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
