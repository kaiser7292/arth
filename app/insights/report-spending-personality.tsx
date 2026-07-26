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
  generateSpendingPersonalityReport,
  type SpendingPersonalityReport,
} from "@/services/reports/spending-personality-report";
import {
  exportSpendingPersonalityPDF,
  sharePDF,
} from "@/services/reports/report-pdf-export";

function PersonalityBadge({ archetype, colorScheme }: { archetype: SpendingPersonalityReport["archetype"]; colorScheme: "light" | "dark" }) {
  return (
    <Card>
      <View className="items-center py-2">
        <Text style={{ fontSize: 40 }}>{archetype.emoji}</Text>
        <Text className="text-lg font-bold text-text-primary dark:text-text-dark-primary mt-2">
          {archetype.name}
        </Text>
        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary text-center mt-1 px-4">
          {archetype.description}
        </Text>
        <View className="flex-row flex-wrap justify-center gap-1.5 mt-3">
          {archetype.traits.map((trait) => (
            <View key={trait} className="px-2.5 py-1 rounded-full bg-surface-light-alt dark:bg-surface-dark-alt border border-border-light dark:border-border-dark">
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">{trait}</Text>
            </View>
          ))}
        </View>
      </View>
    </Card>
  );
}

export default function SpendingPersonalityReportScreen() {
  const { colorScheme, colors } = useColorScheme();
  const status = StatusColors[colorScheme];
  const tint = colors.tint;

  const [report, setReport] = useState<SpendingPersonalityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const data = await generateSpendingPersonalityReport(DEFAULT_USER_ID);
      setReport(data);
    } catch {}
    setLoading(false);
  }, []);

  useDataRefresh(loadData);

  async function handleExportPDF() {
    if (!report || exporting) return;
    setExporting(true);
    try {
      const uri = await exportSpendingPersonalityPDF(report);
      await sharePDF(uri);
    } catch (e: any) {
      Alert.alert("Export failed", e?.message || "Could not generate PDF");
    }
    setExporting(false);
  }

  if (loading) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Analyzing your spending DNA..." />
      </ScreenContainer>
    );
  }

  if (!report) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="person-outline" size={48} color={colors.textSecondary} />
          <Text className="text-lg font-medium text-text-primary dark:text-text-dark-primary mt-4">
            Not enough data
          </Text>
          <Text className="text-sm text-center text-text-secondary dark:text-text-dark-secondary mt-2">
            We need at least 2 months of spending data to identify your personality.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  const maxDayAmount = Math.max(...report.dayOfWeekPattern.map((d) => d.avgSpend), 1);

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        <View className="px-4 pt-2 pb-1">
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary opacity-60">
            Based on {report.monthsAnalyzed} months of data
          </Text>
        </View>

        {/* Personality archetype */}
        <View className="px-4 mb-2">
          <PersonalityBadge archetype={report.archetype} colorScheme={colorScheme} />
        </View>

        {/* Consistency score */}
        <View className="px-4">
          <Card>
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Consistency score</Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                  How predictable your spending is month-to-month
                </Text>
              </View>
              <Text className="text-2xl font-bold" style={{ color: report.consistencyScore >= 70 ? status.success : report.consistencyScore >= 40 ? status.warning : status.danger }}>
                {Math.round(report.consistencyScore)}
              </Text>
            </View>
            <View className="h-1.5 bg-border-light dark:bg-border-dark rounded-full overflow-hidden mt-2">
              <View
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, report.consistencyScore)}%`,
                  backgroundColor: report.consistencyScore >= 70 ? status.success : report.consistencyScore >= 40 ? status.warning : status.danger,
                }}
              />
            </View>
          </Card>
        </View>

        {/* Top categories */}
        {report.topCategories.length > 0 && (
          <View className="px-4 mt-4">
            <SectionHeader title="Top Spending Categories" />
            <Card>
              {report.topCategories.slice(0, 6).map((cat, i) => (
                <View key={cat.categoryId} className="mb-3">
                  <View className="flex-row items-center justify-between mb-1">
                    <Text className="text-xs text-text-primary dark:text-text-dark-primary flex-1">
                      {cat.categoryName}
                    </Text>
                    <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary">
                      {formatCompact(cat.totalSpent)}
                    </Text>
                    {cat.trend !== "stable" && (
                      <View className="ml-2">
                        <Ionicons
                          name={cat.trend === "rising" ? "trending-up" : "trending-down"}
                          size={12}
                          color={cat.trend === "rising" ? status.danger : status.success}
                        />
                      </View>
                    )}
                  </View>
                  <View className="h-1.5 bg-border-light dark:bg-border-dark rounded-full overflow-hidden">
                    <View
                      className="h-full rounded-full"
                      style={{
                        width: `${cat.percentage}%`,
                        backgroundColor: tint,
                        opacity: 1 - i * 0.12,
                      }}
                    />
                  </View>
                </View>
              ))}
            </Card>
          </View>
        )}

        {/* Top merchants */}
        {report.topMerchants.length > 0 && (
          <View className="px-4 mt-4">
            <SectionHeader title="Top Merchants" />
            <Card>
              {report.topMerchants.slice(0, 5).map((m, i) => (
                <View key={i} className="flex-row items-center justify-between py-2 border-b border-border-light dark:border-border-dark last:border-b-0">
                  <View className="flex-row items-center gap-2 flex-1">
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary w-4">{i + 1}</Text>
                    <Text className="text-xs text-text-primary dark:text-text-dark-primary">{m.merchant}</Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary">{formatCompact(m.totalSpent)}</Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">{m.transactionCount} txns</Text>
                  </View>
                </View>
              ))}
            </Card>
          </View>
        )}

        {/* Day of week pattern */}
        <View className="px-4 mt-4">
          <SectionHeader title="Day of Week Pattern" />
          <Card>
            <View className="flex-row items-end gap-1.5" style={{ height: 80 }}>
              {report.dayOfWeekPattern.map((d, i) => {
                const h = Math.max(4, (d.avgSpend / maxDayAmount) * 70);
                const isPeak = d.avgSpend === Math.max(...report.dayOfWeekPattern.map((x) => x.avgSpend));
                return (
                  <View key={d.day} className="flex-1 items-center gap-1">
                    <Text className="text-xs" style={{ fontSize: 8, color: isPeak ? status.warning : colors.textSecondary }}>
                      {formatCompact(d.avgSpend)}
                    </Text>
                    <View
                      className="w-full rounded-t"
                      style={{
                        height: h,
                        backgroundColor: isPeak ? status.warning : `${tint}30`,
                        borderWidth: isPeak ? 1 : 0,
                        borderColor: status.warning,
                      }}
                    />
                  </View>
                );
              })}
            </View>
            <View className="flex-row gap-1.5 mt-1">
              {report.dayOfWeekPattern.map((d) => (
                <Text
                  key={d.day}
                  className="flex-1 text-center text-text-secondary dark:text-text-dark-secondary"
                  style={{ fontSize: 9 }}
                >
                  {d.day.slice(0, 3)}
                </Text>
              ))}
            </View>
          </Card>
        </View>

        {/* Monthly trend */}
        {report.monthlyPattern.length > 1 && (
          <View className="px-4 mt-4">
            <SectionHeader title="Monthly Spending Trend" />
            <Card>
              {report.monthlyPattern.map((m, i) => {
                const maxMonth = Math.max(...report.monthlyPattern.map((x) => x.total), 1);
                const pct = (m.total / maxMonth) * 100;
                return (
                  <View key={m.month} className="flex-row items-center gap-2 mb-2">
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary w-12">{m.month.slice(5)}</Text>
                    <View className="flex-1 h-2 bg-border-light dark:bg-border-dark rounded-full overflow-hidden">
                      <View className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: tint }} />
                    </View>
                    <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary w-14 text-right">
                      {formatCompact(m.total)}
                    </Text>
                  </View>
                );
              })}
            </Card>
          </View>
        )}

        {/* Behavioral insights */}
        {report.insights.length > 0 && (
          <View className="px-4 mt-4">
            <SectionHeader title="Behavioral Insights" />
            {report.insights.map((insight, i) => (
              <Card key={i}>
                <View className="flex-row items-start gap-2">
                  <Text style={{ fontSize: 14 }}>{insight.icon}</Text>
                  <View className="flex-1">
                    <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary mb-0.5">
                      {insight.title}
                    </Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary leading-4">
                      {insight.detail}
                    </Text>
                  </View>
                </View>
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
