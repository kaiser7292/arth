import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, Button, Input } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac, acAlpha } from "@/utils/accent";
import { StatusColors } from "@/constants/theme";
import { formatAmount } from "@/utils/expense-validation";
import type { SalaryCalculation, BonusTaxResult, CapitalGainsTaxResult } from "@/services/tax-engine";
import { BreakdownRow } from "./salary-helpers";

// ─── CTC Results Display ──────────────────────────────────
// Hero card + CTC Breakdown + EPF Contributions + Empty state

export interface SalarySummaryProps {
  calculation: SalaryCalculation | null;
  manualInHand?: string;
  onManualInHandChange?: (value: string) => void;
}

export function MonthlyInHandHero({ calculation, manualInHand, onManualInHandChange }: SalarySummaryProps) {
  const { accent, colorScheme } = useColorScheme();
  const [showCorrectionInput, setShowCorrectionInput] = useState(false);

  if (!calculation) return null;

  const parsedManual = parseFloat(manualInHand ?? "") || 0;
  const hasManualCorrection = parsedManual > 0 && parsedManual !== calculation.monthlyInHand;
  const effectiveMonthlyInHand = hasManualCorrection ? parsedManual : calculation.monthlyInHand;
  const effectiveAnnualInHand = hasManualCorrection ? parsedManual * 12 : calculation.annualInHand;
  const correctionAmount = hasManualCorrection ? parsedManual - calculation.monthlyInHand : 0;

  return (
    <Card className="mb-4">
      <View className="items-center py-2">
        <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground mb-1">
          Monthly In-Hand
        </Text>
        <Text className="text-3xl font-bold text-success">
          {formatAmount(effectiveMonthlyInHand)}
        </Text>
        <Text className="text-sm text-muted-foreground mt-0.5">
          {formatAmount(effectiveAnnualInHand)} / year
        </Text>
        <View className="mt-2 px-3 py-1 rounded-full" style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}>
          <Text className="text-xs" style={{ color: ac(accent, colorScheme, 500, 200) }}>
            Best regime:{" "}
            {calculation.selectedRegime === "new"
              ? "New"
              : "Old"}{" "}
            Tax Regime
          </Text>
        </View>

        {!hasManualCorrection && !showCorrectionInput && (
          <Pressable className="mt-2" onPress={() => setShowCorrectionInput(true)}>
            <Text
              className="text-xs"
              style={{ color: ac(accent, colorScheme, 500, 200) }}
            >
              Not matching your payslip?
            </Text>
          </Pressable>
        )}

        {(showCorrectionInput || hasManualCorrection) && (
          <View className="mt-3 w-full">
            {hasManualCorrection && (
              <View className="flex-row items-center justify-center mb-2">
                <Text className="text-xs text-muted-foreground">
                  Calculated: {formatAmount(calculation.monthlyInHand)}
                </Text>
                <Text
                  className="text-xs font-semibold ml-1"
                  style={{ color: correctionAmount > 0 ? StatusColors[colorScheme].success : StatusColors[colorScheme].danger }}
                >
                  · Manual Correction: {correctionAmount > 0 ? "+" : ""}
                  {formatAmount(correctionAmount)}
                </Text>
              </View>
            )}
            <Input
              label="Actual in-hand amount"
              value={manualInHand ?? ""}
              onChangeText={onManualInHandChange ?? (() => {})}
              keyboardType="numeric"
              placeholder="Enter actual amount"
              containerClassName="mb-1"
            />
            {hasManualCorrection ? (
              <Pressable
                onPress={() => {
                  onManualInHandChange?.("");
                  setShowCorrectionInput(false);
                }}
                className="mt-1"
              >
                <Text
                  className="text-xs text-center"
                  style={{ color: ac(accent, colorScheme, 500, 200) }}
                >
                  Reset to calculated
                </Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => setShowCorrectionInput(false)} className="mt-1">
                <Text className="text-xs text-center text-muted-foreground">
                  Cancel
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </Card>
  );
}

export function SalarySummary({ calculation }: { calculation: SalaryCalculation | null }) {
  const { colors, accent } = useColorScheme();

  if (!calculation) {
    return (
      <Card className="mb-4">
        <View className="items-center py-6">
          <View className="w-14 h-14 rounded-full items-center justify-center mb-3" style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}>
            <Ionicons
              name="calculator-outline"
              size={28}
              color={colors.blue}
            />
          </View>
          <Text className="text-base font-medium text-foreground mb-1">
            Enter your CTC
          </Text>
          <Text className="text-sm text-muted-foreground text-center px-4">
            Input your annual CTC above to see a full salary
            breakdown with tax calculations for both regimes.
          </Text>
        </View>
      </Card>
    );
  }

  return (
    <>
      {/* CTC Breakdown */}
      <Card title="CTC Breakdown" className="mb-4">
        <BreakdownRow
          label="Annual CTC"
          annual={calculation.ctcBreakdown.annualCTC}
          highlight
        />
        <View className="border-t border-border my-1" />
        <BreakdownRow
          label="Basic"
          annual={calculation.ctcBreakdown.basic}
          monthly={calculation.ctcBreakdown.basic / 12}
        />
        <BreakdownRow
          label="HRA"
          annual={calculation.ctcBreakdown.hra}
          monthly={calculation.ctcBreakdown.hra / 12}
        />
        <BreakdownRow
          label="Special Allowance"
          annual={calculation.ctcBreakdown.specialAllowance}
          monthly={calculation.ctcBreakdown.specialAllowance / 12}
        />
        <BreakdownRow
          label="Employer EPF"
          annual={calculation.ctcBreakdown.employerEPF}
          monthly={calculation.ctcBreakdown.employerEPF / 12}
        />
        <BreakdownRow
          label="Gratuity"
          annual={calculation.ctcBreakdown.gratuity}
          monthly={calculation.ctcBreakdown.gratuity / 12}
        />
        <View className="border-t border-border my-1" />
        <BreakdownRow
          label="Gross Salary"
          annual={calculation.ctcBreakdown.grossSalary}
          monthly={calculation.ctcBreakdown.grossSalary / 12}
          highlight
        />
      </Card>

      {/* EPF Contributions */}
      <Card title="EPF Contributions" className="mb-4">
        <BreakdownRow
          label="Employee EPF (12%)"
          annual={calculation.epf.employeeContribution}
          monthly={calculation.epf.employeeContribution / 12}
        />
        <BreakdownRow
          label="Employer EPF (3.67%)"
          annual={calculation.epf.employerEPF}
        />
        <BreakdownRow
          label="Employer EPS (8.33%)"
          annual={calculation.epf.employerEPS}
        />
        {calculation.epf.vpf > 0 && (
          <BreakdownRow
            label="VPF"
            annual={calculation.epf.vpf}
            monthly={calculation.epf.vpf / 12}
          />
        )}
        <View className="border-t border-border my-1" />
        <BreakdownRow
          label="Total Deducted"
          annual={calculation.epf.totalDeducted}
          monthly={calculation.epf.totalDeducted / 12}
          highlight
        />
      </Card>
    </>
  );
}

// ─── Grand Total + CG Reference + Save Buttons ───────────

export interface SalaryFooterProps {
  inputMode: "ctc" | "direct";
  manualInHand?: string;
  calculation: SalaryCalculation | null;
  directAnnual: number;
  hasSalaryData: boolean;
  totalIncome: number;
  bonusTaxResult: BonusTaxResult | null;
  expectedBonus: string;
  capitalGainsTaxResult: CapitalGainsTaxResult | null;
  saving: boolean;
  onSaveDraft: () => void;
  onSaveComplete: () => void;
  onCapitalGainsReference: () => void;
}

export function SalaryFooter({
  inputMode,
  manualInHand,
  calculation,
  directAnnual,
  hasSalaryData,
  totalIncome,
  bonusTaxResult,
  expectedBonus,
  capitalGainsTaxResult,
  saving,
  onSaveDraft,
  onSaveComplete,
  onCapitalGainsReference,
}: SalaryFooterProps) {
  const { colors, accent, colorScheme } = useColorScheme();

  const parsedManualFtr = parseFloat(manualInHand ?? "") || 0;
  const effectiveAnnualSalary = inputMode === "ctc"
    ? (parsedManualFtr > 0 ? parsedManualFtr * 12 : (calculation?.annualInHand ?? 0))
    : directAnnual;

  return (
    <>
      {/* Grand Total */}
      {totalIncome > 0 && hasSalaryData && (
        <Card className="mb-4">
          <View className="items-center py-2">
            <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground mb-1">
              Total Annual Income
            </Text>
            <Text className="text-3xl font-bold text-success">
              {formatAmount(totalIncome)}
            </Text>
            <View className="mt-2">
              <View className="flex-row items-center justify-center">
                <Text className="text-xs text-faint-foreground">
                  Salary:{" "}
                  {formatAmount(effectiveAnnualSalary)}
                </Text>
              </View>
              {(bonusTaxResult ? bonusTaxResult.netBonus : (parseFloat(expectedBonus) || 0)) > 0 && (
                <View className="flex-row items-center justify-center mt-0.5">
                  <Text className="text-xs text-faint-foreground">
                    + Bonus:{" "}
                    {formatAmount(
                      bonusTaxResult ? bonusTaxResult.netBonus : (parseFloat(expectedBonus) || 0),
                    )}
                    {bonusTaxResult ? " (net)" : ""}
                  </Text>
                </View>
              )}
              {capitalGainsTaxResult && capitalGainsTaxResult.totalNet > 0 && (
                <View className="flex-row items-center justify-center mt-0.5">
                  <Text className="text-xs text-faint-foreground">
                    + Capital Gains: {formatAmount(capitalGainsTaxResult.totalNet)} (net)
                  </Text>
                </View>
              )}
            </View>
          </View>
        </Card>
      )}

      {/* Capital Gains Reference Link */}
      <Pressable
        onPress={onCapitalGainsReference}
        className="mb-4"
      >
        <Card>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-1">
              <View
                className="w-9 h-9 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}
              >
                <Ionicons
                  name="trending-up-outline"
                  size={18}
                  color={colors.blue}
                />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-foreground">
                  Capital Gains Reference
                </Text>
                <Text className="text-xs text-muted-foreground">
                  Tax rates by asset class, holding period & FY
                </Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.textSecondary}
            />
          </View>
        </Card>
      </Pressable>

      {/* Save buttons */}
      {hasSalaryData && (
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Button
              title={saving ? "Saving..." : "Save Draft"}
              onPress={onSaveDraft}
              loading={saving}
              variant="outline"
            />
          </View>
          <View className="flex-1">
            <Button
              title={saving ? "Saving..." : "Save & Use"}
              onPress={onSaveComplete}
              loading={saving}
            />
          </View>
        </View>
      )}

      {/* Save Draft button for empty state (no salary yet) */}
      {!hasSalaryData && (
        <Button
          title={saving ? "Saving..." : "Save Draft"}
          onPress={onSaveDraft}
          loading={saving}
          variant="outline"
        />
      )}
    </>
  );
}
