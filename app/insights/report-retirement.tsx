import { useState, useCallback, useEffect } from "react";
import { View, Text, ScrollView, Pressable, Alert, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";

import { ScreenContainer, Card, SectionHeader, LoadingState } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatCompact } from "@/utils/format";
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
    if (raw) return { ...DEFAULT_RETIREMENT_INPUTS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_RETIREMENT_INPUTS;
}

function saveInputs(inputs: RetirementInputs) {
  settingsStorage.set(INPUTS_KEY, JSON.stringify(inputs));
}

function ChipSelector({
  options,
  value,
  onChange,
  colorScheme,
  tint,
}: {
  options: number[];
  value: number;
  onChange: (v: number) => void;
  colorScheme: "light" | "dark";
  tint: string;
}) {
  return (
    <View className="flex-row gap-2">
      {options.map((opt) => {
        const sel = opt === value;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            className="flex-1 py-2 rounded-lg items-center border"
            style={{
              backgroundColor: sel ? `${tint}18` : colorScheme === "dark" ? "#2a2a2a" : "#F5F5F3",
              borderColor: sel ? tint : colorScheme === "dark" ? "#444" : "#ddd",
              borderWidth: sel ? 1.5 : 0.5,
            }}
          >
            <Text
              className="text-sm"
              style={{
                color: sel ? tint : colorScheme === "dark" ? "#fff" : "#1a1a1a",
                fontWeight: sel ? "600" : "400",
              }}
            >
              {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function InputLabel({ text }: { text: string }) {
  return (
    <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary mb-2">
      {text}
    </Text>
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
            <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary mb-1">
              Configure your report
            </Text>
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-6">
              These assumptions drive the projections. Adjust to your situation.
            </Text>

            <View className="mb-5">
              <InputLabel text="Target retirement age" />
              <ChipSelector
                options={[45, 50, 55, 60]}
                value={inputs.retirementAge}
                onChange={(v) => setInputs((p) => ({ ...p, retirementAge: v }))}
                colorScheme={colorScheme}
                tint={tint}
              />
            </View>

            <View className="mb-5">
              <InputLabel text={`Expected investment return: ${inputs.expectedReturnPct}%`} />
              <Slider
                minimumValue={8}
                maximumValue={15}
                step={0.5}
                value={inputs.expectedReturnPct}
                onValueChange={(v) => setInputs((p) => ({ ...p, expectedReturnPct: v }))}
                minimumTrackTintColor={tint}
                maximumTrackTintColor={colorScheme === "dark" ? "#333" : "#ddd"}
                thumbTintColor={tint}
              />
              <View className="flex-row justify-between">
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary opacity-60">8% conservative</Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary opacity-60">15% aggressive</Text>
              </View>
            </View>

            <View className="mb-5">
              <InputLabel text={`Inflation rate: ${inputs.inflationPct}%`} />
              <Slider
                minimumValue={4}
                maximumValue={10}
                step={0.5}
                value={inputs.inflationPct}
                onValueChange={(v) => setInputs((p) => ({ ...p, inflationPct: v }))}
                minimumTrackTintColor="#F59E0B"
                maximumTrackTintColor={colorScheme === "dark" ? "#333" : "#ddd"}
                thumbTintColor="#F59E0B"
              />
            </View>

            <View className="mb-5">
              <InputLabel text="Number of children" />
              <ChipSelector
                options={[0, 1, 2]}
                value={inputs.numberOfChildren}
                onChange={(v) => setInputs((p) => ({ ...p, numberOfChildren: v }))}
                colorScheme={colorScheme}
                tint={tint}
              />
            </View>

            <View className="mb-5">
              <InputLabel text={`Salary growth rate: ${inputs.salaryGrowthPct}%`} />
              <Slider
                minimumValue={5}
                maximumValue={20}
                step={1}
                value={inputs.salaryGrowthPct}
                onValueChange={(v) => setInputs((p) => ({ ...p, salaryGrowthPct: v }))}
                minimumTrackTintColor={status.success}
                maximumTrackTintColor={colorScheme === "dark" ? "#333" : "#ddd"}
                thumbTintColor={status.success}
              />
            </View>

            <Pressable
              onPress={generate}
              className="rounded-xl p-3.5 items-center mt-2"
              style={{ backgroundColor: tint }}
              accessibilityRole="button"
            >
              <Text className="text-sm font-semibold text-white">Generate report</Text>
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
          <Text className="text-lg font-medium text-text-primary dark:text-text-dark-primary mt-4">
            Could not generate report
          </Text>
          <Text className="text-sm text-center text-text-secondary dark:text-text-dark-secondary mt-2">
            Make sure you have income and expense data in Arth.
          </Text>
          <Pressable onPress={() => setShowSheet(true)} className="mt-4">
            <Text className="text-sm font-medium" style={{ color: tint }}>Try again</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
      >
        {/* Timestamp + reconfigure */}
        <View className="px-4 pt-2 pb-1 flex-row justify-between items-center">
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary opacity-60">
            Generated {new Date(report.generatedAt).toLocaleDateString()}
          </Text>
          <Pressable onPress={() => setShowSheet(true)} hitSlop={8}>
            <Text className="text-xs font-medium" style={{ color: tint }}>Reconfigure</Text>
          </Pressable>
        </View>

        {/* Headline stats */}
        <View className="px-4 mb-3">
          <Card>
            <View className="flex-row items-center justify-between mb-3">
              <View>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  Retire at age {report.inputs.retirementAge}
                </Text>
                <Text className="text-2xl font-bold text-text-primary dark:text-text-dark-primary">
                  {report.yearsToRetirement} years to go
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Target corpus</Text>
                <Text className="text-lg font-bold" style={{ color: tint }}>
                  {formatCompact(report.targetCorpus)}
                </Text>
              </View>
            </View>
          </Card>
        </View>

        {/* Current snapshot */}
        <View className="px-4">
          <SectionHeader title="Current Snapshot" />
          <View className="flex-row gap-3 mb-2">
            <View className="flex-1 bg-surface-light-alt dark:bg-surface-dark-alt rounded-xl p-3 border border-border-light dark:border-border-dark">
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Monthly income</Text>
              <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary">{formatCompact(report.currentMonthlyInHand)}</Text>
            </View>
            <View className="flex-1 bg-surface-light-alt dark:bg-surface-dark-alt rounded-xl p-3 border border-border-light dark:border-border-dark">
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Monthly expenses</Text>
              <Text className="text-sm font-bold" style={{ color: status.danger }}>{formatCompact(report.currentMonthlyExpenses)}</Text>
            </View>
          </View>
          <View className="flex-row gap-3 mb-2">
            <View className="flex-1 bg-surface-light-alt dark:bg-surface-dark-alt rounded-xl p-3 border border-border-light dark:border-border-dark">
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Savings rate</Text>
              <Text className="text-sm font-bold" style={{ color: status.success }}>{Math.round(report.currentSavingsRate)}%</Text>
            </View>
            <View className="flex-1 bg-surface-light-alt dark:bg-surface-dark-alt rounded-xl p-3 border border-border-light dark:border-border-dark">
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Monthly surplus</Text>
              <Text className="text-sm font-bold" style={{ color: status.success }}>{formatCompact(report.currentMonthlySurplus)}</Text>
            </View>
          </View>
        </View>

        {/* Corpus Math */}
        <View className="px-4 mt-4">
          <SectionHeader title="The Math" />
          <Card>
            {[
              { label: "Monthly expenses at retirement", value: formatCompact(report.retirementMonthlyExpenseInflated), color: undefined },
              { label: "Annual expense (future)", value: formatCompact(report.retirementAnnualExpense), color: undefined },
              { label: "Target corpus (28x annual)", value: formatCompact(report.targetCorpus), color: tint },
              { label: "Existing assets at retirement", value: formatCompact(report.existingAssetsAtRetirement), color: status.success },
              { label: "Gap to fill", value: formatCompact(report.gapToFill), color: status.warning },
            ].map((row) => (
              <View key={row.label} className="flex-row justify-between items-center py-2 border-b border-border-light dark:border-border-dark">
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary flex-1">{row.label}</Text>
                <Text className="text-sm font-bold" style={row.color ? { color: row.color } : undefined}>{row.value}</Text>
              </View>
            ))}
          </Card>
        </View>

        {/* SIP Plan */}
        <View className="px-4 mt-4">
          <SectionHeader title="Required SIP" />
          <Card>
            <View className="items-center py-2">
              <Text className="text-3xl font-bold" style={{ color: status.success }}>
                {formatCompact(report.requiredMonthlySIP)}/mo
              </Text>
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-1">
                with {report.sipAnnualStepUpPct}% annual step-up for {report.yearsToRetirement} years
              </Text>
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
                Projected corpus: {formatCompact(report.projectedCorpus)}
              </Text>
            </View>
          </Card>
        </View>

        {/* Scenarios */}
        <View className="px-4 mt-4">
          <SectionHeader title="Scenarios" />
          <Card>
            {report.scenarios.map((s) => (
              <View key={s.label} className="flex-row justify-between items-center py-2 border-b border-border-light dark:border-border-dark">
                <View>
                  <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary">{s.label}</Text>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">{s.returnPct}% returns</Text>
                </View>
                <View className="items-end">
                  <Text className="text-sm font-bold" style={{ color: s.isAchievable ? status.success : status.danger }}>
                    {formatCompact(s.projectedCorpus)}
                  </Text>
                  <Text className="text-xs" style={{ color: s.isAchievable ? status.success : status.danger }}>
                    {s.isAchievable ? "On track" : "Falls short"}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </View>

        {/* Phase Plan */}
        <View className="px-4 mt-4">
          <SectionHeader title="Phase Plan" />
          {report.phases.map((phase, i) => {
            const phaseColors = ["#F59E0B", "#0F766E", "#1E293B", "#22C55E"];
            return (
              <Card key={i}>
                <View className="rounded-lg p-3 mb-2" style={{ backgroundColor: phaseColors[i] || "#333" }}>
                  <Text className="text-sm font-bold text-white">{phase.name}</Text>
                  <Text className="text-xs text-white opacity-70">{phase.yearRange}</Text>
                  <Text className="text-xs text-white opacity-70 mt-0.5">Income: {phase.monthlyIncomeEstimate}</Text>
                </View>
                <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary mb-1">
                  SIP Target: {phase.sipTarget}
                </Text>
                {phase.keyActions.map((action, j) => (
                  <View key={j} className="flex-row gap-2 items-start mb-1">
                    <Text className="text-xs" style={{ color: tint }}>→</Text>
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary flex-1">{action}</Text>
                  </View>
                ))}
              </Card>
            );
          })}
        </View>

        {/* Child Education */}
        {report.childEducation && (
          <View className="px-4 mt-4">
            <SectionHeader title="Child Education Fund" />
            <Card>
              <View className="flex-row gap-3 mb-2">
                <View className="flex-1">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Cost today</Text>
                  <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary">{formatCompact(report.childEducation.costTodayTotal)}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Inflated cost</Text>
                  <Text className="text-sm font-bold" style={{ color: status.danger }}>{formatCompact(report.childEducation.costInflated)}</Text>
                </View>
              </View>
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Monthly SIP</Text>
                  <Text className="text-sm font-bold" style={{ color: tint }}>{formatCompact(report.childEducation.monthlySIPNeeded)}/mo</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Projected corpus</Text>
                  <Text className="text-sm font-bold" style={{ color: status.success }}>{formatCompact(report.childEducation.projectedCorpus)}</Text>
                </View>
              </View>
            </Card>
          </View>
        )}

        {/* Risk Flags */}
        {report.risks.length > 0 && (
          <View className="px-4 mt-4">
            <SectionHeader title="Risk Flags" />
            {report.risks.map((risk, i) => {
              const riskColor = risk.severity === "critical" ? status.danger : risk.severity === "high" ? status.warning : tint;
              return (
                <View
                  key={i}
                  className="mb-2 rounded-lg p-3 border-l-4"
                  style={{
                    borderLeftColor: riskColor,
                    backgroundColor: colorScheme === "dark" ? "#1E1E1E" : "#F8FAFC",
                  }}
                >
                  <Text className="text-xs font-semibold uppercase mb-0.5" style={{ color: riskColor }}>
                    {risk.severity}
                  </Text>
                  <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary mb-0.5">
                    {risk.title}
                  </Text>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                    {risk.description}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Actions */}
        {report.actions.length > 0 && (
          <View className="px-4 mt-4">
            <SectionHeader title="Top Actions" />
            {report.actions.map((action) => (
              <View key={action.priority} className="flex-row gap-3 items-start mb-3">
                <View className="w-6 h-6 rounded-full bg-primary-600 items-center justify-center">
                  <Text className="text-xs font-bold text-white">{action.priority}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary">{action.title}</Text>
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">{action.description}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Disclaimer */}
        <View className="px-4 mt-4">
          <View className="rounded-lg p-3" style={{ backgroundColor: status.warningBg }}>
            <Text className="text-xs" style={{ color: status.warning }}>
              Projections use {report.inputs.expectedReturnPct}% return, {report.inputs.inflationPct}% inflation, {report.inputs.salaryGrowthPct}% salary growth.
              These are estimates, not financial advice. Review annually.
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
    </ScreenContainer>
  );
}
