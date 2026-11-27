import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, ProgressBar, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";

import type { HealthGrade, HealthFactor } from "@/utils/financial-cockpit";
import { useTheme } from "@/hooks/use-theme";
import { tint } from "@/constants/brand";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";
import { generateFinancialHealthReport, type FinancialHealthReport } from "@/services/reports/financial-health-report";

const GRADE_RANGES: [HealthGrade, string, string][] = [
  ["A+", "90–100", "Excellent"],
  ["A",  "80–89",  "Great"],
  ["B",  "70–79",  "Good"],
  ["C",  "55–69",  "Needs attention"],
  ["D",  "40–54",  "Critical"],
  ["F",  "0–39",   "Off-plan"],
];

const GRADE_DESC: Record<HealthGrade, string> = {
  "A+": "Excellent — your plan is firing on all cylinders",
  "A":  "Great — strong across the board with only minor gaps",
  "B":  "Good — solid foundation with a few areas to improve",
  "C":  "Needs attention — material gaps in one or more areas",
  "D":  "Critical — significant gaps, act now to avoid shortfalls",
  "F":  "Off-plan — major correction needed urgently",
};

/** Where each grade starts on the 0–100 bar, for the letters under it. */
const GRADE_FROM: [HealthGrade, number][] = [["F", 0], ["D", 40], ["C", 55], ["B", 70], ["A", 80], ["A+", 90]];

const NEXT_GRADE: Partial<Record<HealthGrade, HealthGrade>> = {
  "F": "D", "D": "C", "C": "B", "B": "A", "A": "A+",
};

const FACTOR_TIPS: Record<string, string> = {
  "Savings":     "Increase your savings rate towards your target",
  "Investments": "Catch up on investment contributions this FY",
  "Spending":    "Bring spending within your monthly budget",
  "Goals":       "Make consistent progress on milestones and buckets",
  "Surplus":     "Free up monthly headroom by trimming fixed commitments",
};

export default function HealthGradeScreen() {
  const { grade, score, factorsJson, provisional } = useLocalSearchParams<{
    grade: string;
    score: string;
    factorsJson: string;
    provisional?: string;
  }>();
  const early = provisional === "1";
  const router = useRouter();
  // The key numbers from the full health report (emergency fund, EMIs, spread): one grade on screen,
  // the report's measures under it (Nov 2026 Insights redesign).
  const [report, setReport] = useState<FinancialHealthReport | null>(null);
  useEffect(() => {
    let live = true;
    generateFinancialHealthReport(DEFAULT_USER_ID)
      .then((r) => live && setReport(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const { colors } = useColorScheme();
  const theme = useTheme();
  const accentColor = theme.primary;

  const healthGrade = (grade ?? "B") as HealthGrade;
  const healthScore = parseFloat(score ?? "0");
  let factors: HealthFactor[] = [];
  try { factors = JSON.parse(factorsJson ?? "[]"); } catch { /* ignore */ }

  const isGood = healthGrade === "A+" || healthGrade === "A";
  const isOK   = healthGrade === "B";
  const isWarn = healthGrade === "C";

  const mainColor = isGood
    ? theme.success
    : isOK
      ? accentColor
      : isWarn
        ? theme.warning
        : theme.danger;

  const mainBg = isGood
    ? theme.alpha("success", 0.08)
    : isOK
      ? tint(accentColor, 0.08)
      : isWarn
        ? theme.alpha("warning", 0.08)
        : theme.alpha("danger", 0.08);

  const nextG = NEXT_GRADE[healthGrade];
  const nextFrom = nextG ? GRADE_FROM.find(([g]) => g === nextG)?.[1] ?? null : null;
  const toNext = nextFrom != null ? Math.max(1, nextFrom - Math.round(healthScore)) : null;
  const weakFactors = [...factors]
    .filter((f) => f.status !== "positive")
    .sort((a, b) => a.score * a.weight - b.score * b.weight)
    .slice(0, 2);

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View className="px-4 py-4">

          {/* Grade hero: the grade, the score once (owner, Nov 2026: it showed twice), and the bar
               with each grade's letter under where it starts. */}
          <Card className="mb-4">
            <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Financial Health Grade
            </Text>
            <View className="flex-row items-end justify-between mb-1" style={{ gap: 12 }}>
              <Text className="text-5xl font-bold" style={{ color: mainColor }}>
                {healthGrade}
              </Text>
              <Text className="text-heading font-bold mb-1.5" style={{ color: mainColor, fontVariant: ["tabular-nums"] }}>
                {Math.round(healthScore)}
                <Text className="text-meta font-normal text-faint-foreground"> / 100</Text>
              </Text>
            </View>
            <Text className="text-meta text-muted-foreground">
              {GRADE_DESC[healthGrade]}
            </Text>
            {early && (
              <Text className="text-label text-muted-foreground mt-2">
                Early days: under two months of this year so far, so one big bill moves this a lot. Read it as a first look.
              </Text>
            )}

            <View className="mt-4">
              <ProgressBar value={healthScore / 100} color={mainColor} height={8} animated={false} />
              <View style={{ height: 16, marginTop: 4 }}>
                {GRADE_FROM.map(([g, from], i) => {
                  const to = GRADE_FROM[i + 1]?.[1] ?? 100;
                  const isCurrent = g === healthGrade;
                  return (
                    <Text
                      key={g}
                      className={`text-label text-center ${isCurrent ? "font-bold" : ""}`}
                      style={{
                        position: "absolute",
                        left: `${(from + to) / 2}%`,
                        width: 28,
                        marginLeft: -14,
                        color: isCurrent ? mainColor : theme.faintForeground,
                      }}
                    >
                      {g}
                    </Text>
                  );
                })}
              </View>
            </View>
            {nextG && toNext != null && (
              <Text className="text-label text-muted-foreground mt-1">
                {toNext} {toNext === 1 ? "point" : "points"} to {nextG}
              </Text>
            )}
          </Card>

          {/* Key numbers: each opens where it comes from. */}
          {report && (report.monthlyIncome > 0 || report.totalAssets > 0) && (() => {
            const groups = Array.from(new Set(report.assetBreakdown.filter((a) => a.amount > 0).map((a) => a.group)));
            const tiles = [
              {
                key: "saving",
                label: "Saving",
                value: `${Math.round(report.currentSavingsRate)}%`,
                unit: "of income",
                note: report.avgSavingsRate > 0 ? `${Math.round(report.avgSavingsRate)}% on average` : "This month so far",
                tone: report.currentSavingsRate >= 20 ? theme.success : theme.mutedForeground,
                href: "/goals/yearly-plan",
              },
              {
                key: "emergency",
                label: "Emergency fund",
                value: report.emergencyMonths.toFixed(1).replace(/\.0$/, ""),
                unit: report.emergencyMonths === 1 ? "month" : "months",
                note: report.emergencyMonths >= 3 ? "3 to 6 is the usual aim" : `${formatAmount(Math.round(report.emergencyGap))} short of 6`,
                tone: report.emergencyMonths >= 3 ? theme.success : theme.warning,
                href: "/goals/balance-sheet",
              },
              {
                key: "emis",
                label: "EMIs",
                value: `${Math.round(report.debtToIncomeRatio)}%`,
                unit: "of income",
                note: report.monthlyEMI <= 0 ? "No loans" : report.debtToIncomeRatio <= 40 ? "Under the 40% limit" : "Above the 40% limit",
                tone: report.debtToIncomeRatio > 40 ? theme.danger : theme.mutedForeground,
                href: "/goals/loans",
              },
              {
                key: "spread",
                label: "Spread",
                value: String(groups.length),
                unit: groups.length === 1 ? "kind" : "kinds",
                note: groups.slice(0, 4).join(", ") || "Nothing yet",
                tone: theme.mutedForeground,
                href: "/goals/balance-sheet",
              },
            ];
            return (
              <View className="mb-4">
                <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">Key numbers</Text>
                <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                  {tiles.map((t) => (
                    <Pressable
                      key={t.key}
                      onPress={() => router.push(t.href as never)}
                      className="rounded-card bg-card border border-border p-3.5"
                      style={{ width: "48.5%", gap: 2 }}
                      accessibilityRole="button"
                      accessibilityLabel={`${t.label}, ${t.value} ${t.unit}. ${t.note}`}
                    >
                      <Text className="text-meta text-muted-foreground">{t.label}</Text>
                      <Text className="text-heading font-bold text-foreground">
                        {t.value}
                        <Text className="text-meta font-normal text-muted-foreground"> {t.unit}</Text>
                      </Text>
                      <Text className="text-label" style={{ color: t.tone }} numberOfLines={1}>{t.note}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })()}

          {/* Factors breakdown */}
          {factors.length > 0 && (
            <Card className="mb-4">
              <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                What's driving this grade
              </Text>
              {factors.map((f, i) => {
                const fColor = f.status === "positive"
                  ? theme.success
                  : f.status === "neutral"
                    ? theme.mutedForeground
                    : theme.warning;
                return (
                  <View
                    key={f.name}
                    className={`py-3${i < factors.length - 1 ? " border-b border-border" : ""}`}
                  >
                    <View className="flex-row items-center justify-between mb-2">
                      <View className="flex-row items-center gap-2">
                        <Ionicons
                          name={
                            f.status === "positive"
                              ? "checkmark-circle"
                              : f.status === "neutral"
                                ? "remove-circle-outline"
                                : "alert-circle"
                          }
                          size={15}
                          color={fColor}
                        />
                        <Text className="text-body font-medium text-foreground">
                          {f.name}
                        </Text>
                        <Text className="text-label text-faint-foreground">
                          {Math.round(f.weight * 100)}% wt
                        </Text>
                      </View>
                      <Text className="text-label font-semibold" style={{ color: fColor }}>
                        {Math.round(f.score)}/100
                      </Text>
                    </View>
                    <ProgressBar value={(Math.max(2, f.score)) / 100} color={fColor} height={6} animated={false} className="mb-1.5" />
                    <Text className="text-label text-faint-foreground">{f.detail}</Text>
                  </View>
                );
              })}
            </Card>
          )}

          {/* Tips to reach next grade */}
          {nextG && weakFactors.length > 0 && (
            <Card className="mb-4">
              <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                To reach Grade {nextG}
              </Text>
              {weakFactors.map((f, i) => (
                <View
                  key={f.name}
                  className={`flex-row items-start gap-2${i > 0 ? " mt-2.5" : ""}`}
                >
                  <Ionicons
                    name="arrow-forward-circle-outline"
                    size={15}
                    color={accentColor}
                    style={{ marginTop: 1 }}
                  />
                  <Text className="text-meta text-foreground flex-1">
                    {FACTOR_TIPS[f.name] ?? "Improve this area"}
                  </Text>
                </View>
              ))}
            </Card>
          )}

          {/* The full report: net worth, savings trend, spending mix, spikes, and the PDF. */}
          <Pressable
            onPress={() => router.push("/goals/financial-health")}
            className="rounded-card bg-card border border-border px-4 mb-4 flex-row items-center"
            style={{ minHeight: 56, gap: 12 }}
            accessibilityRole="button"
          >
            <Ionicons name="document-text-outline" size={18} color={theme.mutedForeground} />
            <View className="flex-1">
              <Text className="text-body font-semibold text-foreground">Full report</Text>
              <Text className="text-meta text-muted-foreground">Net worth, savings trend, spending mix, and a PDF</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
          </Pressable>

          {/* Grade scale reference */}
          <Card>
            <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Grade scale
            </Text>
            {GRADE_RANGES.map(([g, range, label]) => {
              const isCurrent = g === healthGrade;
              return (
                <View
                  key={g}
                  className="flex-row items-center py-2 rounded-control"
                  style={isCurrent ? { backgroundColor: mainBg, paddingHorizontal: 8, marginHorizontal: -8 } : {}}
                >
                  <Text
                    className="text-body font-bold w-8"
                    style={{ color: isCurrent ? mainColor : theme.mutedForeground }}
                  >
                    {g}
                  </Text>
                  <Text className="text-label text-faint-foreground w-16">{range}</Text>
                  <Text
                    className={`text-label flex-1 ${isCurrent ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                  >
                    {label}
                  </Text>
                  {isCurrent && (
                    <View className="w-2 h-2 rounded-full" style={{ backgroundColor: mainColor }} />
                  )}
                </View>
              );
            })}
          </Card>

        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
