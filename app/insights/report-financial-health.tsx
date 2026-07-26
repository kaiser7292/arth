import { useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ScreenContainer, Card, SectionHeader, LoadingState } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount, formatCompact } from "@/utils/format";
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

function GradeBar({ label, grade, score, colorScheme }: { label: string; grade: string; score: number; colorScheme: "light" | "dark" }) {
  const color = gradeColor(grade, colorScheme);
  return (
    <View className="flex-row items-center gap-2 mb-2">
      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary w-20 text-right">
        {label}
      </Text>
      <View className="flex-1 h-1.5 bg-border-light dark:bg-border-dark rounded-full overflow-hidden">
        <View
          className="h-full rounded-full"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </View>
      <Text className="text-xs font-semibold w-6" style={{ color }}>
        {grade}
      </Text>
    </View>
  );
}

function StatBox({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View className="bg-surface-light-alt dark:bg-surface-dark-alt rounded-xl p-3 border border-border-light dark:border-border-dark flex-1">
      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-1">
        {label}
      </Text>
      <Text
        className="text-base font-bold"
        style={{ color: color || undefined }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

export default function FinancialHealthReportScreen() {
  const { colorScheme, colors } = useColorScheme();
  const status = StatusColors[colorScheme];
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
          <Text className="text-lg font-medium text-text-primary dark:text-text-dark-primary mt-4">
            Not enough data
          </Text>
          <Text className="text-sm text-center text-text-secondary dark:text-text-dark-secondary mt-2">
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
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary opacity-60">
            Generated {new Date(report.generatedAt).toLocaleDateString()}
          </Text>
        </View>

        {/* Grade Card */}
        <View className="px-4 mb-3">
          <Card>
            <View className="flex-row items-start justify-between">
              <View className="flex-1">
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary uppercase tracking-wider mb-1">
                  Overall grade
                </Text>
                <Text className="text-4xl font-bold" style={{ color: gc }}>
                  {report.overallGrade}
                </Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-1">
                  {report.gradeSummary}
                </Text>
              </View>
              <View className="flex-1 pl-2 pt-1">
                {report.dimensions.map((d) => (
                  <GradeBar
                    key={d.name}
                    label={d.name}
                    grade={d.grade}
                    score={d.score}
                    colorScheme={colorScheme}
                  />
                ))}
              </View>
            </View>
          </Card>
        </View>

        {/* Net Worth */}
        <View className="px-4">
          <SectionHeader title="Net Worth" />
          <View className="flex-row gap-3 mb-2">
            <StatBox label="Total assets" value={formatCompact(report.totalAssets)} color={status.success} />
            <StatBox label="Total liabilities" value={formatCompact(report.totalLiabilities)} color={status.danger} />
          </View>
          <Card>
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                Net financial worth
              </Text>
              <Text
                className="text-lg font-bold"
                style={{ color: report.netWorth >= 0 ? status.success : status.danger }}
              >
                {formatCompact(report.netWorth)}
              </Text>
            </View>
          </Card>
        </View>

        {/* Savings Rate Trend */}
        {report.monthlySavingsRates.length > 0 && (
          <View className="px-4 mt-4">
            <SectionHeader title="Savings Rate Trend" />
            <Card>
              <View className="flex-row items-end gap-1.5" style={{ height: 80 }}>
                {report.monthlySavingsRates.map((m, i) => {
                  const h = Math.max(4, (m.rate / 100) * 70);
                  const isLast = i === report.monthlySavingsRates.length - 1;
                  return (
                    <View key={m.month} className="flex-1 items-center gap-1">
                      <Text className="text-xs font-medium" style={{ color: status.success, fontSize: 9 }}>
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
                    className="flex-1 text-center text-text-secondary dark:text-text-dark-secondary"
                    style={{ fontSize: 9 }}
                  >
                    {m.month.slice(5)}
                  </Text>
                ))}
              </View>
            </Card>
          </View>
        )}

        {/* Key Metrics */}
        <View className="px-4 mt-4">
          <SectionHeader title="Key Metrics" />
          <View className="flex-row gap-3 mb-2">
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
              value={report.monthlyEMI > 0 ? formatCompact(report.monthlyEMI) : "None"}
              color={report.monthlyEMI > 0 ? status.warning : status.success}
            />
          </View>
        </View>

        {/* Emergency Fund Alert */}
        {report.emergencyGap > 0 && (
          <View className="px-4 mt-3">
            <Card>
              <View
                className="rounded-lg p-3"
                style={{ backgroundColor: status.dangerBg }}
              >
                <View className="flex-row items-center gap-2 mb-1">
                  <Ionicons name="warning-outline" size={14} color={status.danger} />
                  <Text className="text-xs font-semibold" style={{ color: status.danger }}>
                    Emergency fund gap
                  </Text>
                </View>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  You need {formatCompact(report.emergencyTarget)} (6 months expenses).
                  Current liquid buffer: {formatCompact(report.liquidAssets)}.
                  Gap: {formatCompact(report.emergencyGap)}.
                </Text>
              </View>
            </Card>
          </View>
        )}

        {/* Expense Composition */}
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
                      style={{
                        flex: c.percentage,
                        backgroundColor: barColors[i % barColors.length],
                      }}
                    />
                  );
                })}
              </View>
              {/* Legend */}
              {report.categoryBreakdown.slice(0, 7).map((c, i) => {
                const barColors = ["#2563EB", "#22C55E", "#F59E0B", "#8B5CF6", "#EC4899", "#0EA5E9", "#6B7280"];
                return (
                  <View key={c.categoryId} className="flex-row items-center justify-between py-1.5">
                    <View className="flex-row items-center gap-2">
                      <View
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: barColors[i % barColors.length] }}
                      />
                      <Text className="text-xs text-text-primary dark:text-text-dark-primary">
                        {c.categoryName}
                      </Text>
                    </View>
                    <View className="flex-row items-center gap-3">
                      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                        {Math.round(c.percentage)}%
                      </Text>
                      <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary w-16 text-right">
                        {formatCompact(c.amount)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </Card>
          </View>
        )}

        {/* Spending Spikes */}
        {report.spikingCategories.length > 0 && (
          <View className="px-4 mt-4">
            <SectionHeader title="Spending Spikes" />
            {report.spikingCategories.map((s) => (
              <Card key={s.categoryId}>
                <View className="flex-row items-center gap-2 mb-1">
                  <Ionicons name="trending-up" size={14} color={status.warning} />
                  <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary">
                    {s.categoryName}
                  </Text>
                </View>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  {formatAmount(s.currentMonth)} this month — {s.spikeMultiple.toFixed(1)}x your 3-month average of{" "}
                  {formatAmount(s.avgPrevious)}
                </Text>
              </Card>
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
