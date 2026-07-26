import { useState } from "react";
import { View, Text, ScrollView, Pressable, Alert, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ScreenContainer, Card, SectionHeader, LoadingState, EmptyState } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";
import { settingsStorage } from "@/services/storage";
import {
  generateLoanPayoffReport,
  DEFAULT_LOAN_PAYOFF_INPUTS,
  type LoanPayoffInputs,
  type LoanPayoffReport,
} from "@/services/reports/loan-payoff-report";
import {
  exportLoanPayoffPDF,
  sharePDF,
} from "@/services/reports/report-pdf-export";

const INPUTS_KEY = "report_loan_payoff_inputs";

function loadSavedInputs(): LoanPayoffInputs {
  try {
    const raw = settingsStorage.getString(INPUTS_KEY);
    if (raw) return { ...DEFAULT_LOAN_PAYOFF_INPUTS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_LOAN_PAYOFF_INPUTS;
}

function StrategyCard({
  strategy,
  isRecommended,
  colorScheme,
}: {
  strategy: LoanPayoffReport["avalanche"];
  isRecommended: boolean;
  colorScheme: "light" | "dark";
}) {
  const status = StatusColors[colorScheme];
  const borderColor = isRecommended ? status.success : colorScheme === "dark" ? "#2E2E2E" : "#E5E5E3";

  return (
    <Card>
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary">
          {strategy.name}
        </Text>
        {isRecommended && (
          <View className="px-2 py-0.5 rounded" style={{ backgroundColor: status.successBg }}>
            <Text className="text-xs font-semibold" style={{ color: status.success }}>Recommended</Text>
          </View>
        )}
      </View>
      <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-3">
        {strategy.description}
      </Text>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Debt-free by</Text>
          <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary">{strategy.debtFreeDate}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Interest saved</Text>
          <Text className="text-sm font-bold" style={{ color: status.success }}>{formatAmount(strategy.interestSaved)}</Text>
        </View>
      </View>
      <View className="flex-row gap-3 mt-2">
        <View className="flex-1">
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Months saved</Text>
          <Text className="text-sm font-bold" style={{ color: status.success }}>{strategy.monthsSaved}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Total interest</Text>
          <Text className="text-sm font-bold" style={{ color: status.warning }}>{formatAmount(strategy.totalInterestPaid)}</Text>
        </View>
      </View>
      {/* Timeline milestones */}
      {strategy.timeline.length > 0 && (
        <View className="mt-3 pt-3 border-t border-border-light dark:border-border-dark">
          <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary mb-2">Payoff timeline</Text>
          {strategy.timeline.map((step, i) => (
            <View key={i} className="flex-row items-center gap-2 mb-1.5">
              <View className="w-4 h-4 rounded-full items-center justify-center" style={{ backgroundColor: status.successBg }}>
                <Ionicons name="checkmark" size={10} color={status.success} />
              </View>
              <Text className="text-xs text-text-primary dark:text-text-dark-primary flex-1">
                {step.loanName}
              </Text>
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">{step.date}</Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

export default function LoanPayoffReportScreen() {
  const { colorScheme, colors } = useColorScheme();
  const status = StatusColors[colorScheme];
  const tint = colors.tint;

  const [inputs, setInputs] = useState<LoanPayoffInputs>(loadSavedInputs);
  const [report, setReport] = useState<LoanPayoffReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSheet, setShowSheet] = useState(true);
  const [noLoans, setNoLoans] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [extraText, setExtraText] = useState(String(inputs.extraMonthlyAmount));

  async function generate() {
    const amount = parseInt(extraText, 10) || DEFAULT_LOAN_PAYOFF_INPUTS.extraMonthlyAmount;
    const finalInputs = { extraMonthlyAmount: amount };
    setInputs(finalInputs);
    settingsStorage.set(INPUTS_KEY, JSON.stringify(finalInputs));
    setShowSheet(false);
    setLoading(true);
    try {
      const data = await generateLoanPayoffReport(DEFAULT_USER_ID, finalInputs);
      if (!data) {
        setNoLoans(true);
      } else {
        setReport(data);
      }
    } catch {}
    setLoading(false);
  }

  async function handleExportPDF() {
    if (!report || exporting) return;
    setExporting(true);
    try {
      const uri = await exportLoanPayoffPDF(report);
      await sharePDF(uri);
    } catch (e: any) {
      Alert.alert("Export failed", e?.message || "Could not generate PDF");
    }
    setExporting(false);
  }

  if (noLoans) {
    return (
      <ScreenContainer padTop={false}>
        <EmptyState
          icon="checkmark-circle-outline"
          title="No active loans"
          subtitle="You have no active loans to analyze. Great job staying debt-free!"
          fillScreen
        />
      </ScreenContainer>
    );
  }

  if (showSheet) {
    return (
      <ScreenContainer padTop={false}>
        <View className="px-4 pt-4 flex-1">
          <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary mb-1">
            Extra monthly payment
          </Text>
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-6">
            How much extra can you put toward debt each month, beyond your regular EMIs?
          </Text>

          <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary mb-2">
            Extra amount per month
          </Text>
          <TextInput
            className="bg-surface-light-alt dark:bg-surface-dark-alt border border-border-light dark:border-border-dark rounded-xl px-4 py-3 text-base text-text-primary dark:text-text-dark-primary"
            value={extraText}
            onChangeText={setExtraText}
            keyboardType="numeric"
            placeholder="10000"
            placeholderTextColor={colors.textSecondary}
          />

          <Pressable
            onPress={generate}
            className="rounded-xl p-3.5 items-center mt-6"
            style={{ backgroundColor: tint }}
            accessibilityRole="button"
          >
            <Text className="text-sm font-semibold text-white">Generate report</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  if (loading) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Simulating payoff strategies..." />
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
        <View className="px-4 pt-2 pb-1 flex-row justify-between items-center">
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary opacity-60">
            Generated {new Date(report.generatedAt).toLocaleDateString()}
          </Text>
          <Pressable onPress={() => setShowSheet(true)} hitSlop={8}>
            <Text className="text-xs font-medium" style={{ color: tint }}>Reconfigure</Text>
          </Pressable>
        </View>

        {/* Debt Snapshot */}
        <View className="px-4">
          <SectionHeader title="Debt Snapshot" />
          <View className="flex-row gap-3 mb-3">
            <View className="flex-1 bg-surface-light-alt dark:bg-surface-dark-alt rounded-xl p-3 border border-border-light dark:border-border-dark">
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Outstanding</Text>
              <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary" style={{ color: status.danger }}>{formatAmount(report.totalOutstanding)}</Text>
            </View>
            <View className="flex-1 bg-surface-light-alt dark:bg-surface-dark-alt rounded-xl p-3 border border-border-light dark:border-border-dark">
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Monthly EMI</Text>
              <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary">{formatAmount(report.totalMonthlyEMI)}</Text>
            </View>
          </View>
          <View className="flex-row gap-3 mb-3">
            <View className="flex-1 bg-surface-light-alt dark:bg-surface-dark-alt rounded-xl p-3 border border-border-light dark:border-border-dark">
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Avg rate</Text>
              <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary">{report.weightedAvgRate.toFixed(1)}%</Text>
            </View>
            <View className="flex-1 bg-surface-light-alt dark:bg-surface-dark-alt rounded-xl p-3 border border-border-light dark:border-border-dark">
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Extra/mo</Text>
              <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary" style={{ color: status.success }}>{formatAmount(report.inputs.extraMonthlyAmount)}</Text>
            </View>
          </View>
        </View>

        {/* Active Loans */}
        <View className="px-4">
          <SectionHeader title={`Active Loans (${report.loans.length})`} />
          {report.loans.map((loan) => (
            <Card key={loan.id}>
              <View className="flex-row justify-between items-start mb-1">
                <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary flex-1">{loan.name}</Text>
                <Text className="text-xs" style={{ color: status.danger }}>{loan.interestRate}%</Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  {formatAmount(loan.outstanding)} outstanding
                </Text>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  EMI {formatAmount(loan.emiAmount)}
                </Text>
              </View>
            </Card>
          ))}
        </View>

        {/* Natural vs Optimized */}
        <View className="px-4 mt-4">
          <SectionHeader title="Without Extra Payments" />
          <Card>
            <View className="flex-row justify-between items-center">
              <View>
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Debt-free by</Text>
                <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">{report.naturalEndDate}</Text>
              </View>
              <View className="items-end">
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Total interest</Text>
                <Text className="text-sm font-bold" style={{ color: status.danger }}>{formatAmount(report.naturalTotalInterest)}</Text>
              </View>
            </View>
          </Card>
        </View>

        {/* Strategies */}
        <View className="px-4 mt-4">
          <SectionHeader title="With Extra Payments" />
          <View className="mb-3">
            <StrategyCard
              strategy={report.avalanche}
              isRecommended={report.recommended === "avalanche"}
              colorScheme={colorScheme}
            />
          </View>
          <StrategyCard
            strategy={report.snowball}
            isRecommended={report.recommended === "snowball"}
            colorScheme={colorScheme}
          />
        </View>

        {/* After debt-free */}
        <View className="px-4 mt-4">
          <Card>
            <View className="rounded-lg p-3" style={{ backgroundColor: status.successBg }}>
              <Text className="text-xs font-semibold mb-1" style={{ color: status.success }}>
                After debt-free
              </Text>
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                You'll free up {formatAmount(report.postDebtFreeMonthlySurplus)}/month from EMIs.
                Redirect this to investments for maximum wealth building.
              </Text>
            </View>
          </Card>
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
