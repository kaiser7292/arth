import { useState } from "react";
import { View, Text, ScrollView, Pressable, Alert, TextInput } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Ionicons } from "@expo/vector-icons";

import { ScreenContainer, Card, SectionHeader, LoadingState } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";
import { settingsStorage } from "@/services/storage";
import {
  generateRetirementReport,
  DEFAULT_RETIREMENT_INPUTS,
  type RetirementInputs,
  type RetirementReport,
} from "@/services/reports/retirement-report";
import {
  exportRetirementPDF,
  sharePDF,
} from "@/services/reports/report-pdf-export";

const INPUTS_KEY = "report_retirement_inputs";

function loadSavedInputs(): RetirementInputs {
  try {
    const raw = settingsStorage.getString(INPUTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const { numberOfChildren: _n, educationInflationPct: _e, ...rest } = parsed;
      return { ...DEFAULT_RETIREMENT_INPUTS, ...rest };
    }
  } catch {}
  return DEFAULT_RETIREMENT_INPUTS;
}

function saveInputs(inputs: RetirementInputs) {
  settingsStorage.set(INPUTS_KEY, JSON.stringify(inputs));
}

function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (abs >= 1_00_00_000) return s + "₹" + (abs / 1_00_00_000).toFixed(1) + " Cr";
  if (abs >= 1_00_000) return s + "₹" + (abs / 1_00_000).toFixed(1) + " L";
  return formatAmount(n);
}

function NumberRow({
  label,
  value,
  onChange,
  suffix,
  hint,
  colorScheme,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  hint?: string;
  colorScheme: "light" | "dark";
}) {
  const [text, setText] = useState(String(value));

  return (
    <View className="flex-row items-center justify-between py-3 border-b border-border">
      <View className="flex-1 mr-3">
        <Text className="text-sm text-foreground">{label}</Text>
        {hint ? (
          <Text className="text-xs text-muted-foreground mt-0.5 opacity-60">
            {hint}
          </Text>
        ) : null}
      </View>
      <View className="flex-row items-center">
        <TextInput
          keyboardType="decimal-pad"
          value={text}
          onChangeText={setText}
          onEndEditing={() => {
            const n = parseFloat(text);
            if (!isNaN(n) && n > 0) {
              onChange(n);
              setText(String(n));
            } else {
              setText(String(value));
            }
          }}
          selectTextOnFocus
          className="text-sm font-semibold text-right"
          style={{
            color: colorScheme === "dark" ? "#fff" : "#1a1a1a",
            backgroundColor: colorScheme === "dark" ? "#1E1E1E" : "#F5F5F3",
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colorScheme === "dark" ? "#333" : "#ddd",
            minWidth: 60,
            paddingHorizontal: 10,
            paddingVertical: 6,
          }}
        />
        {suffix ? (
          <Text className="text-xs text-muted-foreground ml-1.5 w-8">
            {suffix}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function MetricBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View className="flex-1 bg-card rounded-xl p-3 border border-border">
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <Text
        className="text-sm font-bold text-foreground"
        style={color ? { color } : undefined}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
    </View>
  );
}

export default function RetirementReportScreen() {
  const { colorScheme, colors } = useColorScheme();
  const status = StatusColors[colorScheme];
  const tint = colors.tint;

  const [inputs, setInputs] = useState<RetirementInputs>(loadSavedInputs);
  const [report, setReport] = useState<RetirementReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSheet, setShowSheet] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [expandedDrawdown, setExpandedDrawdown] = useState<number | null>(null);
  const [showScoreInfo, setShowScoreInfo] = useState(false);

  async function generate() {
    setShowSheet(false);
    setLoading(true);
    saveInputs(inputs);
    try {
      const data = await generateRetirementReport(DEFAULT_USER_ID, inputs);
      setReport(data);
    } catch {}
    setLoading(false);
  }

  async function handleExportPDF() {
    if (!report || exporting) return;
    setExporting(true);
    try {
      const uri = await exportRetirementPDF(report);
      await sharePDF(uri);
    } catch (e: any) {
      Alert.alert("Export failed", e?.message || "Could not generate PDF");
    }
    setExporting(false);
  }

  if (showSheet) {
    return (
      <ScreenContainer padTop={false}>
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <View className="px-4 pt-4">
            <Text className="text-base font-bold text-foreground mb-1">
              Configure your retirement plan
            </Text>
            <Text className="text-xs text-muted-foreground mb-4">
              Adjust these assumptions to match your situation.
            </Text>

            <Card>
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Personal
              </Text>
              <NumberRow
                label="Your current age"
                value={inputs.currentAge}
                onChange={(v) => setInputs((p) => ({ ...p, currentAge: v }))}
                suffix="yrs"
                colorScheme={colorScheme}
              />
              <NumberRow
                label="Target retirement age"
                value={inputs.retirementAge}
                onChange={(v) => setInputs((p) => ({ ...p, retirementAge: v }))}
                suffix="yrs"
                colorScheme={colorScheme}
              />
              <NumberRow
                label="Life expectancy"
                value={inputs.lifeExpectancy}
                onChange={(v) => setInputs((p) => ({ ...p, lifeExpectancy: v }))}
                suffix="yrs"
                hint="Plan for longevity"
                colorScheme={colorScheme}
              />
            </Card>

            <View className="mt-3">
              <Card>
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Returns & Growth
                </Text>
                <NumberRow
                  label="Expected investment return"
                  value={inputs.expectedReturnPct}
                  onChange={(v) => setInputs((p) => ({ ...p, expectedReturnPct: v }))}
                  suffix="%"
                  hint="Pre-retirement CAGR"
                  colorScheme={colorScheme}
                />
                <NumberRow
                  label="Salary growth rate"
                  value={inputs.salaryGrowthPct}
                  onChange={(v) => setInputs((p) => ({ ...p, salaryGrowthPct: v }))}
                  suffix="%"
                  colorScheme={colorScheme}
                />
                <NumberRow
                  label="Post-retirement portfolio yield"
                  value={inputs.retirementPortfolioYieldPct}
                  onChange={(v) => setInputs((p) => ({ ...p, retirementPortfolioYieldPct: v }))}
                  suffix="%"
                  hint="Conservative post-retirement return"
                  colorScheme={colorScheme}
                />
              </Card>
            </View>

            <View className="mt-3">
              <Card>
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Inflation
                </Text>
                <NumberRow
                  label="General inflation"
                  value={inputs.inflationPct}
                  onChange={(v) => setInputs((p) => ({ ...p, inflationPct: v }))}
                  suffix="%"
                  colorScheme={colorScheme}
                />
                <NumberRow
                  label="Healthcare inflation"
                  value={inputs.healthcareInflationPct}
                  onChange={(v) => setInputs((p) => ({ ...p, healthcareInflationPct: v }))}
                  suffix="%"
                  hint="India avg ~10%"
                  colorScheme={colorScheme}
                />
              </Card>
            </View>

            <View className="mt-3">
              <Card>
                <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Post-Retirement
                </Text>
                <NumberRow
                  label="Expenses (% of current)"
                  value={inputs.postRetirementExpensePct}
                  onChange={(v) => setInputs((p) => ({ ...p, postRetirementExpensePct: v }))}
                  suffix="%"
                  hint="75% is typical — no EMIs, less commute"
                  colorScheme={colorScheme}
                />
              </Card>
            </View>

            <Pressable
              onPress={generate}
              className="rounded-xl p-3.5 items-center mt-4"
              style={{ backgroundColor: tint }}
              accessibilityRole="button"
            >
              <Text className="text-sm font-semibold text-white">Generate Report</Text>
            </Pressable>
          </View>
        </ScrollView>
      </ScreenContainer>
    );
  }

  if (loading) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Computing your retirement plan..." />
      </ScreenContainer>
    );
  }

  if (!report) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="alert-circle-outline" size={48} color={colors.textSecondary} />
          <Text className="text-lg font-medium text-foreground mt-4">
            Could not generate report
          </Text>
          <Pressable onPress={() => setShowSheet(true)} className="mt-4">
            <Text className="text-sm font-medium" style={{ color: tint }}>Try again</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  const scoreColor = report.readinessScore >= 70 ? status.success
    : report.readinessScore >= 40 ? status.warning
    : status.danger;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        {/* Timestamp + reconfigure */}
        <View className="px-4 pt-2 pb-1 flex-row justify-between items-center">
          <Text className="text-xs text-muted-foreground opacity-60">
            Generated {new Date(report.generatedAt).toLocaleDateString()}
          </Text>
          <Pressable onPress={() => setShowSheet(true)} hitSlop={8}>
            <Text className="text-xs font-medium" style={{ color: tint }}>Reconfigure</Text>
          </Pressable>
        </View>

        {/* ── 1. READINESS SCORE ── */}
        <View className="px-4 mb-3">
          <Card>
            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <View className="flex-row items-center gap-1.5 mb-1">
                  <Text className="text-xs text-muted-foreground uppercase tracking-wider">
                    Retirement readiness
                  </Text>
                  <Pressable onPress={() => setShowScoreInfo(true)} hitSlop={10}>
                    <Ionicons name="information-circle-outline" size={14} color={tint} />
                  </Pressable>
                </View>
                <Text className="text-3xl font-bold" style={{ color: scoreColor }}>
                  {report.readinessScore}/100
                </Text>
                <Text className="text-xs text-muted-foreground mt-1">
                  {report.readinessLabel}
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-xs text-muted-foreground">
                  Age {report.currentAge} → Retire at
                </Text>
                <Text className="text-2xl font-bold text-foreground">
                  {report.inputs.retirementAge}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {report.yearsToRetirement} yrs to go
                </Text>
              </View>
            </View>
            <View className="h-2 bg-border rounded-full overflow-hidden mt-3">
              <View
                className="h-full rounded-full"
                style={{ width: `${report.readinessScore}%`, backgroundColor: scoreColor }}
              />
            </View>
          </Card>
        </View>

        {/* ── 2. WHERE YOU STAND TODAY ── */}
        <View className="px-4">
          <SectionHeader title="Where You Stand Today" />
          <View className="flex-row gap-3 mb-3">
            <MetricBox label="Monthly income" value={formatAmount(report.currentMonthlyInHand)} />
            <MetricBox label="Monthly expenses" value={formatAmount(report.currentMonthlyExpenses)} color={status.danger} />
          </View>
          <View className="flex-row gap-3 mb-3">
            <MetricBox label="Savings rate" value={`${Math.round(report.currentSavingsRate)}%`} color={status.success} />
            <MetricBox label="Monthly surplus" value={formatAmount(report.currentMonthlySurplus)} color={status.success} />
          </View>
          <View className="flex-row gap-3">
            <MetricBox label="Net worth" value={formatAmount(report.netWorth)} color={report.netWorth >= 0 ? status.success : status.danger} />
            <MetricBox label="Monthly EMI" value={report.monthlyEMI > 0 ? formatAmount(report.monthlyEMI) : "None"} color={report.monthlyEMI > 0 ? status.warning : status.success} />
          </View>
        </View>

        {/* ── 3. RETIREMENT TARGET ── */}
        <View className="px-4 mt-4">
          <SectionHeader title="Your Retirement Target" />
          <Card>
            <Text className="text-xs text-muted-foreground mb-2 opacity-70">
              Expenses reduced to {report.inputs.postRetirementExpensePct}% post-retirement
            </Text>
            {[
              { label: "Monthly expenses today (excl. EMI)", value: formatAmount(report.retirementMonthlyExpenseToday) },
              { label: `At retirement (${report.inputs.inflationPct}% inflation × ${report.inputs.postRetirementExpensePct}%)`, value: formatAmount(report.retirementMonthlyExpenseInflated), color: status.warning },
              { label: "Annual expense (future)", value: formatAmount(report.retirementAnnualExpense) },
              { label: "Target corpus (28× annual)", value: fmtCompact(report.targetCorpus), color: tint },
              { label: `Existing assets at retirement (${report.inputs.expectedReturnPct}%)`, value: fmtCompact(report.existingAssetsAtRetirement), color: status.success },
              { label: "Gap to fill via SIP", value: fmtCompact(report.gapToFill), color: report.gapToFill > 0 ? status.danger : status.success },
            ].map((row) => (
              <View key={row.label} className="flex-row justify-between items-center py-2 border-b border-border">
                <Text className="text-xs text-muted-foreground flex-1 mr-3">{row.label}</Text>
                <Text
                  className="text-sm font-bold text-foreground"
                  style={row.color ? { color: row.color } : undefined}
                  numberOfLines={1}
                >
                  {row.value}
                </Text>
              </View>
            ))}
          </Card>
        </View>

        {/* ── 4. HOW TO GET THERE ── */}
        <View className="px-4 mt-4">
          <SectionHeader title="How To Get There" />
          <Card>
            <View className="items-center py-2">
              <Text className="text-3xl font-bold" style={{ color: status.success }}>
                {formatAmount(report.requiredMonthlySIP)}/mo
              </Text>
              <Text className="text-xs text-muted-foreground mt-1">
                with {report.sipAnnualStepUpPct}% annual step-up for {report.yearsToRetirement} years
              </Text>
              <Text className="text-xs text-muted-foreground mt-0.5">
                Projected corpus: {fmtCompact(report.projectedCorpus)}
              </Text>
            </View>
          </Card>
        </View>

        {/* Corpus Growth Roadmap */}
        {report.corpusMilestones.length > 0 && (
          <View className="px-4 mt-3">
            <Card>
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Corpus Growth Roadmap
              </Text>
              <View className="flex-row items-center pb-1.5 mb-1 border-b border-border">
                <Text className="text-xs font-semibold text-muted-foreground w-10">Year</Text>
                <Text className="text-xs font-semibold text-muted-foreground w-10">Age</Text>
                <Text className="text-xs font-semibold text-muted-foreground flex-1 text-right">SIP/mo</Text>
                <Text className="text-xs font-semibold text-muted-foreground flex-1 text-right">Corpus</Text>
              </View>
              {report.corpusMilestones.map((cm, i) => {
                const isLast = i === report.corpusMilestones.length - 1;
                return (
                  <View key={cm.year} className="flex-row items-center py-2 border-b border-border">
                    <Text className="text-xs text-muted-foreground w-10">{cm.year}</Text>
                    <Text className="text-xs text-foreground w-10">{cm.age}</Text>
                    <Text className="text-xs text-muted-foreground flex-1 text-right" numberOfLines={1}>
                      {fmtCompact(cm.sipMonthly)}
                    </Text>
                    <Text
                      className="text-xs font-semibold flex-1 text-right"
                      style={{ color: isLast ? status.success : tint }}
                      numberOfLines={1}
                    >
                      {fmtCompact(cm.corpusAccumulated)}
                    </Text>
                  </View>
                );
              })}
            </Card>
          </View>
        )}

        {/* ── 5. SCENARIOS & SENSITIVITY ── */}
        <View className="px-4 mt-4">
          <SectionHeader title="Scenarios & Sensitivity" />

          {/* Return scenarios */}
          <Card>
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Return Scenarios
            </Text>
            {report.scenarios.map((s) => (
              <View key={s.label} className="flex-row justify-between items-center py-2 border-b border-border">
                <View>
                  <Text className="text-xs font-semibold text-foreground">{s.label}</Text>
                  <Text className="text-xs text-muted-foreground">{s.returnPct}% returns</Text>
                </View>
                <View className="items-end">
                  <Text className="text-sm font-bold" style={{ color: s.isAchievable ? status.success : status.danger }} numberOfLines={1}>
                    {fmtCompact(s.projectedCorpus)}
                  </Text>
                  <Text className="text-xs" style={{ color: s.isAchievable ? status.success : status.danger }}>
                    {s.isAchievable ? "On track" : "Falls short"}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </View>

        {/* What-if retire at */}
        {report.ageWhatIf.length > 0 && (
          <View className="px-4 mt-3">
            <Card>
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                What If You Retire At...
              </Text>
              <View className="flex-row items-center pb-1.5 mb-1 border-b border-border">
                <Text className="text-xs font-semibold text-muted-foreground w-12">Age</Text>
                <Text className="text-xs font-semibold text-muted-foreground flex-1 text-right">Target</Text>
                <Text className="text-xs font-semibold text-muted-foreground flex-1 text-right">SIP/mo</Text>
                <Text className="text-xs font-semibold text-muted-foreground w-14 text-right">Ok?</Text>
              </View>
              {report.ageWhatIf.map((w) => (
                <View key={w.retireAt} className="flex-row items-center py-2 border-b border-border">
                  <Text className="text-xs font-semibold text-foreground w-12">
                    {w.retireAt}
                    {w.retireAt === report.inputs.retirementAge ? " ✓" : ""}
                  </Text>
                  <Text className="text-xs text-muted-foreground flex-1 text-right" numberOfLines={1}>
                    {fmtCompact(w.targetCorpus)}
                  </Text>
                  <Text className="text-xs font-semibold flex-1 text-right" style={{ color: tint }} numberOfLines={1}>
                    {fmtCompact(w.requiredSIP)}
                  </Text>
                  <Text className="text-xs font-bold w-14 text-right" style={{ color: w.feasible ? status.success : status.danger }}>
                    {w.feasible ? "Yes" : "No"}
                  </Text>
                </View>
              ))}
            </Card>
          </View>
        )}

        {/* ── 6. LIFE GOALS ── */}
        {report.milestones.length > 0 && (
          <View className="px-4 mt-4">
            <SectionHeader title="Life Goals Along The Way" />
            <Text className="text-xs text-muted-foreground mb-2 -mt-1 opacity-70">
              Costs inflated at {report.inputs.inflationPct}% to target year
            </Text>
            {report.milestones.map((m, i) => (
              <View key={i} className="mb-3">
                <Card>
                  <View className="flex-row items-center justify-between mb-1.5">
                    <Text className="text-xs font-semibold text-foreground flex-1">{m.name}</Text>
                    <View className="items-end">
                      <Text className="text-xs text-muted-foreground">
                        {m.yearsAway > 0 ? `${m.yearsAway} yrs away` : "Due now"}
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row gap-3 mb-2">
                    <View className="flex-1">
                      <Text className="text-xs text-muted-foreground">Today's cost</Text>
                      <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>
                        {fmtCompact(m.targetAmount)}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-xs text-muted-foreground">Inflated cost</Text>
                      <Text className="text-xs font-semibold" style={{ color: status.warning }} numberOfLines={1}>
                        {fmtCompact(m.inflatedCost)}
                      </Text>
                    </View>
                  </View>
                  <View className="h-1.5 bg-border rounded-full overflow-hidden mb-1.5">
                    <View
                      className="h-full rounded-full"
                      style={{ width: `${m.progressPct}%`, backgroundColor: m.progressPct >= 50 ? status.success : status.warning }}
                    />
                  </View>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-xs text-muted-foreground">
                      {formatAmount(m.currentSaved)} saved · {m.progressPct}%
                    </Text>
                    <Text className="text-xs font-semibold" style={{ color: tint }} numberOfLines={1}>
                      {formatAmount(m.monthlyNeeded)}/mo
                    </Text>
                  </View>
                  <Text className="text-xs text-muted-foreground mt-1 opacity-70">
                    {m.impactOnRetirement}
                  </Text>
                </Card>
              </View>
            ))}
          </View>
        )}

        {/* ── 7. PHASE PLAN ── */}
        <View className="px-4 mt-4">
          <SectionHeader title="Your Journey — Phase Plan" />
          {report.phases.map((phase, i) => {
            const phaseColors = ["#F59E0B", "#0F766E", "#1E40AF", "#22C55E"];
            return (
              <View key={i} className="mb-3">
                <Card>
                  <View className="rounded-lg p-3 mb-2" style={{ backgroundColor: phaseColors[i % phaseColors.length] }}>
                    <Text className="text-sm font-bold text-white">{phase.name}</Text>
                    <Text className="text-xs text-white opacity-70">{phase.yearRange}</Text>
                  </View>
                  <View className="flex-row gap-3 mb-2">
                    <View className="flex-1">
                      <Text className="text-xs text-muted-foreground">Est. income</Text>
                      <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>
                        {phase.monthlyIncomeEstimate}/mo
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-xs text-muted-foreground">SIP target</Text>
                      <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>
                        {phase.sipTarget}/mo
                      </Text>
                    </View>
                  </View>
                  <View className="rounded-md p-2 mb-2 bg-card">
                    <Text className="text-xs text-muted-foreground">
                      {phase.allocation}
                    </Text>
                  </View>
                  {phase.goals.length > 0 && (
                    <View className="mb-2">
                      <Text className="text-xs font-semibold text-muted-foreground mb-1">Goals</Text>
                      {phase.goals.map((goal, j) => (
                        <View key={j} className="flex-row gap-2 items-start mb-0.5">
                          <Text className="text-xs" style={{ color: tint }}>•</Text>
                          <Text className="text-xs text-foreground flex-1">{goal}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {phase.keyActions.map((action, j) => (
                    <View key={j} className="flex-row gap-2 items-start mb-1">
                      <Text className="text-xs" style={{ color: tint }}>→</Text>
                      <Text className="text-xs text-muted-foreground flex-1">{action}</Text>
                    </View>
                  ))}
                </Card>
              </View>
            );
          })}
        </View>

        {/* ── 8. AFTER RETIREMENT ── */}
        {report.drawdownPlan.length > 0 && (
          <View className="px-4 mt-4">
            <SectionHeader title="After Retirement — Drawdown" />
            <Text className="text-xs text-muted-foreground mb-2 -mt-1 opacity-70">
              Includes {report.inputs.healthcareInflationPct}% healthcare inflation escalation
            </Text>
            {report.drawdownPlan.map((d, di) => (
              <Card key={d.withdrawalRate} className="mb-3">
                <Pressable onPress={() => setExpandedDrawdown(expandedDrawdown === di ? null : di)}>
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1">
                      <Text className="text-xs font-semibold text-foreground">
                        {d.withdrawalRate}% withdrawal rate
                      </Text>
                      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                        {fmtCompact(d.monthlyWithdrawal)}/mo · {fmtCompact(d.annualWithdrawal)}/yr
                      </Text>
                    </View>
                    <View className="flex-row items-center gap-2">
                      <View className="items-end">
                        <Text
                          className="text-sm font-bold"
                          style={{ color: d.sustainable ? status.success : status.danger }}
                        >
                          {d.corpusLastsYears >= 60 ? "60+" : d.corpusLastsYears} yrs
                        </Text>
                        <Text className="text-xs" style={{ color: d.sustainable ? status.success : status.danger }}>
                          {d.sustainable ? "Sustainable" : "Runs out"}
                        </Text>
                      </View>
                      <Ionicons
                        name={expandedDrawdown === di ? "chevron-up" : "chevron-down"}
                        size={14}
                        color={colors.textSecondary}
                      />
                    </View>
                  </View>
                </Pressable>

                {expandedDrawdown === di && d.yearByYear.length > 0 && (
                  <>
                    <View className="border-t border-border mt-3 pt-2">
                      <View className="flex-row items-center pb-1.5 mb-1 border-b border-border">
                        <Text className="text-xs font-semibold text-muted-foreground w-8">Age</Text>
                        <Text className="text-xs font-semibold text-muted-foreground flex-1 text-right">Start</Text>
                        <Text className="text-xs font-semibold text-muted-foreground flex-1 text-right">Out</Text>
                        <Text className="text-xs font-semibold text-muted-foreground flex-1 text-right">End</Text>
                      </View>
                      {d.yearByYear.slice(0, 15).map((yy) => (
                        <View key={yy.year} className="flex-row items-center py-1 border-b border-border">
                          <Text className="text-xs text-muted-foreground w-8">{yy.age}</Text>
                          <Text className="text-xs text-foreground flex-1 text-right" numberOfLines={1}>
                            {fmtCompact(yy.corpusStart)}
                          </Text>
                          <Text className="text-xs flex-1 text-right" style={{ color: status.danger }} numberOfLines={1}>
                            {fmtCompact(yy.withdrawal)}
                          </Text>
                          <Text
                            className="text-xs font-semibold flex-1 text-right"
                            style={{ color: yy.corpusEnd > 0 ? status.success : status.danger }}
                            numberOfLines={1}
                          >
                            {fmtCompact(yy.corpusEnd)}
                          </Text>
                        </View>
                      ))}
                      {d.yearByYear.length > 15 && (
                        <Text className="text-xs text-muted-foreground text-center mt-2 opacity-60">
                          +{d.yearByYear.length - 15} more years in PDF
                        </Text>
                      )}
                    </View>
                  </>
                )}
              </Card>
            ))}
          </View>
        )}

        {/* ── 9. INSURANCE COVERAGE ── */}
        {report.insuranceCoverage && (report.insuranceCoverage.term || report.insuranceCoverage.health || report.insuranceCoverage.car.hasActive) && (
          <View className="px-4 mt-4">
            <SectionHeader title="Risk Coverage" />
            <Card>
              {report.insuranceCoverage.term && (
                <View className="flex-row items-center justify-between py-2 border-b border-border">
                  <View className="flex-row items-center gap-2">
                    <Ionicons name="shield-checkmark-outline" size={14} color={report.insuranceCoverage.term.isAdequate ? status.success : status.warning} />
                    <Text className="text-xs text-foreground">Term Life</Text>
                  </View>
                  <Text className="text-xs font-medium" style={{ color: report.insuranceCoverage.term.isAdequate ? status.success : status.warning }}>
                    {fmtCompact(report.insuranceCoverage.term.sumInsured)} ({Math.round(report.insuranceCoverage.term.ratio)}× income)
                  </Text>
                </View>
              )}
              {report.insuranceCoverage.health && (
                <View className="flex-row items-center justify-between py-2 border-b border-border">
                  <View className="flex-row items-center gap-2">
                    <Ionicons name="medkit-outline" size={14} color={report.insuranceCoverage.health.isAdequate ? status.success : status.warning} />
                    <Text className="text-xs text-foreground">Health</Text>
                  </View>
                  <Text className="text-xs font-medium" style={{ color: report.insuranceCoverage.health.isAdequate ? status.success : status.warning }}>
                    {fmtCompact(report.insuranceCoverage.health.sumInsured)} ({report.insuranceCoverage.health.familySize} members)
                  </Text>
                </View>
              )}
              {report.insuranceCoverage.car.hasActive && (
                <View className="flex-row items-center justify-between py-2">
                  <View className="flex-row items-center gap-2">
                    <Ionicons name="car-outline" size={14} color={status.success} />
                    <Text className="text-xs text-foreground">Car</Text>
                  </View>
                  <Text className="text-xs font-medium" style={{ color: status.success }}>Active</Text>
                </View>
              )}
            </Card>
          </View>
        )}

        {/* ── 10. RISKS & ACTIONS ── */}
        {report.risks.length > 0 && (
          <View className="px-4 mt-4">
            <SectionHeader title="Risk Flags" />
            {report.risks.map((risk, i) => {
              const riskColor = risk.severity === "critical" ? status.danger : risk.severity === "high" ? status.warning : tint;
              return (
                <View
                  key={i}
                  className="mb-3 rounded-lg p-3 border-l-4"
                  style={{
                    borderLeftColor: riskColor,
                    backgroundColor: colorScheme === "dark" ? "#1E1E1E" : "#F8FAFC",
                  }}
                >
                  <Text className="text-xs font-semibold uppercase mb-0.5" style={{ color: riskColor }}>
                    {risk.severity}
                  </Text>
                  <Text className="text-xs font-semibold text-foreground mb-0.5">
                    {risk.title}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {risk.description}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {report.actions.length > 0 && (
          <View className="px-4 mt-4">
            <SectionHeader title="Action Items" />
            {report.actions.map((action) => (
              <View key={action.priority} className="flex-row gap-3 items-start mb-3">
                <View className="w-6 h-6 rounded-full items-center justify-center" style={{ backgroundColor: tint }}>
                  <Text className="text-xs font-bold text-white">{action.priority}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-xs font-semibold text-foreground">{action.title}</Text>
                  <Text className="text-xs text-muted-foreground">{action.description}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── DISCLAIMER ── */}
        <View className="px-4 mt-4">
          <View className="rounded-lg p-3" style={{ backgroundColor: status.warningBg }}>
            <Text className="text-xs" style={{ color: status.warning }}>
              Projections use {report.inputs.expectedReturnPct}% return, {report.inputs.inflationPct}% inflation, {report.inputs.healthcareInflationPct}% healthcare inflation, {report.inputs.salaryGrowthPct}% salary growth, life expectancy {report.inputs.lifeExpectancy} yrs, post-retirement expenses at {report.inputs.postRetirementExpensePct}% of current, portfolio yield {report.inputs.retirementPortfolioYieldPct}%.
              These are estimates, not financial advice.
            </Text>
          </View>
        </View>

        {/* Download PDF */}
        <View className="px-4 mt-4">
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

      {/* Readiness Score breakdown sheet */}
      {report && (() => {
        const corpusPct = Math.min(100, (report.projectedCorpus / Math.max(1, report.targetCorpus)) * 100);
        const corpusScore = Math.round(corpusPct * 0.4);

        const sr = report.currentSavingsRate;
        const savingsScore = sr >= 40 ? 25 : sr >= 30 ? 20 : sr >= 20 ? 12 : Math.round(Math.max(0, sr * 0.5));

        const emergencyMonths = report.currentMonthlyExpenses > 0
          ? report.totalAssets / report.currentMonthlyExpenses : 0;
        const emergencyScore = emergencyMonths >= 6 ? 15 : emergencyMonths >= 3 ? 10 : Math.round(emergencyMonths * 2);

        const dti = report.currentMonthlyInHand > 0
          ? (report.monthlyEMI / report.currentMonthlyInHand) * 100 : 0;
        const debtScore = dti === 0 ? 20 : dti <= 20 ? 15 : dti <= 40 ? 8 : 2;

        const dimensions = [
          {
            label: "Corpus Progress",
            weight: 40,
            score: corpusScore,
            max: 40,
            detail: `Projected ${Math.round(corpusPct)}% of target corpus`,
            color: corpusScore >= 30 ? status.success : corpusScore >= 16 ? status.warning : status.danger,
          },
          {
            label: "Savings Rate",
            weight: 25,
            score: savingsScore,
            max: 25,
            detail: `${Math.round(sr)}% of income saved`,
            color: savingsScore >= 20 ? status.success : savingsScore >= 12 ? status.warning : status.danger,
          },
          {
            label: "Emergency Fund",
            weight: 15,
            score: emergencyScore,
            max: 15,
            detail: `${Math.round(emergencyMonths * 10) / 10} months of expenses covered`,
            color: emergencyScore >= 10 ? status.success : emergencyScore >= 6 ? status.warning : status.danger,
          },
          {
            label: "Debt Load",
            weight: 20,
            score: debtScore,
            max: 20,
            detail: dti === 0 ? "No EMI obligations" : `${Math.round(dti)}% of income goes to EMIs`,
            color: debtScore >= 15 ? status.success : debtScore >= 8 ? status.warning : status.danger,
          },
        ];

        return (
          <BottomSheet visible={showScoreInfo} onClose={() => setShowScoreInfo(false)}>
            <View className="px-5 pb-4">
              <Text className="text-base font-bold text-foreground mb-1">
                Readiness Score Breakdown
              </Text>
              <Text className="text-xs text-muted-foreground mb-4">
                Your score of {report.readinessScore}/100 is computed from four dimensions, each weighted by importance.
              </Text>

              {dimensions.map((d) => (
                <View key={d.label} className="mb-4">
                  <View className="flex-row items-center justify-between mb-1">
                    <Text className="text-xs font-semibold text-foreground">
                      {d.label}
                    </Text>
                    <Text className="text-xs font-bold" style={{ color: d.color }}>
                      {d.score}/{d.max}
                    </Text>
                  </View>
                  <View className="h-2 bg-border rounded-full overflow-hidden mb-1">
                    <View
                      className="h-full rounded-full"
                      style={{ width: `${(d.score / d.max) * 100}%`, backgroundColor: d.color }}
                    />
                  </View>
                  <Text className="text-xs text-muted-foreground opacity-70">
                    {d.detail} · {d.weight}% weight
                  </Text>
                </View>
              ))}

              {/* Score bands */}
              <View className="pt-3 border-t border-border">
                <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Score Bands
                </Text>
                {[
                  { range: "80–100", label: "Strong", desc: "Well on track", color: status.success },
                  { range: "60–79", label: "Good", desc: "A few areas to strengthen", color: "#3B82F6" },
                  { range: "40–59", label: "Needs work", desc: "Significant gaps remain", color: status.warning },
                  { range: "0–39", label: "At risk", desc: "Urgent action needed", color: status.danger },
                ].map((b) => (
                  <View key={b.range} className="flex-row items-center gap-2 mb-1.5">
                    <View className="w-2 h-2 rounded-full" style={{ backgroundColor: b.color }} />
                    <Text className="text-xs text-foreground w-12 font-medium">
                      {b.range}
                    </Text>
                    <Text className="text-xs text-muted-foreground flex-1">
                      {b.label} — {b.desc}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </BottomSheet>
        );
      })()}
    </ScreenContainer>
  );
}
