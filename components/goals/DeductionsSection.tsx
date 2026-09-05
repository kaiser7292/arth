import { View } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Card, CollapsibleSection, Input, Text } from "@/components/ui";
import { formatAmount } from "@/utils/expense-validation";
import type { SalaryCalculation, CapitalGainsTaxResult, BonusTaxResult } from "@/services/tax-engine";
import { BreakdownRow } from "./salary-helpers";
import { useTheme } from "@/hooks/use-theme";

// ─── Old Regime Deductions (CTC mode only) ────────────────

export interface OldRegimeDeductionsProps {
  deductions80C: string;
  onDeductions80CChange: (v: string) => void;
  deductions80D: string;
  onDeductions80DChange: (v: string) => void;
  hraExemption: string;
  onHraExemptionChange: (v: string) => void;
  homeLoan: string;
  onHomeLoanChange: (v: string) => void;
  otherDeductions: string;
  onOtherDeductionsChange: (v: string) => void;
}

export function OldRegimeDeductions({
  deductions80C,
  onDeductions80CChange,
  deductions80D,
  onDeductions80DChange,
  hraExemption,
  onHraExemptionChange,
  homeLoan,
  onHomeLoanChange,
  otherDeductions,
  onOtherDeductionsChange,
}: OldRegimeDeductionsProps) {
  return (
    <Card className="mb-4">
      <CollapsibleSection
        title="Old Regime Deductions"
        storageKey="salary_old_regime"
        defaultExpanded={false}
        icon="document-text-outline"
      >
        <View className="pt-2">
          <Text className="text-xs text-muted-foreground mb-2">
            These only affect the Old Tax Regime calculation.
          </Text>
          <Input
            label="Section 80C (max 1.5L)"
            value={deductions80C}
            onChangeText={onDeductions80CChange}
            keyboardType="numeric"
            placeholder="0"
            containerClassName="mb-2"
          />
          <Input
            label="Section 80D (max 75K)"
            value={deductions80D}
            onChangeText={onDeductions80DChange}
            keyboardType="numeric"
            placeholder="0"
            containerClassName="mb-2"
          />
          <Input
            label="HRA Exemption (Annual)"
            value={hraExemption}
            onChangeText={onHraExemptionChange}
            keyboardType="numeric"
            placeholder="0"
            containerClassName="mb-2"
          />
          <Input
            label="Home Loan Interest (max 2L)"
            value={homeLoan}
            onChangeText={onHomeLoanChange}
            keyboardType="numeric"
            placeholder="0"
            containerClassName="mb-2"
          />
          <Input
            label="Other Deductions"
            value={otherDeductions}
            onChangeText={onOtherDeductionsChange}
            keyboardType="numeric"
            placeholder="0"
          />
        </View>
      </CollapsibleSection>
    </Card>
  );
}

// ─── Annual Deductions Summary (CTC mode result) ──────────

export interface AnnualDeductionsProps {
  calculation: SalaryCalculation;
}

export function AnnualDeductions({ calculation }: AnnualDeductionsProps) {
  return (
    <Card title="Annual Deductions" className="mb-4">
      <BreakdownRow
        label="Income Tax"
        annual={
          calculation.selectedRegime === "new"
            ? calculation.newRegimeTax.totalTax
            : calculation.oldRegimeTax.totalTax
        }
      />
      <BreakdownRow
        label="Employee EPF + VPF"
        annual={calculation.epf.totalDeducted}
      />
      <BreakdownRow
        label="Professional Tax"
        annual={calculation.professionalTaxAnnual}
      />
      <View className="border-t border-border my-1" />
      <BreakdownRow
        label="Total Deductions"
        annual={
          (calculation.selectedRegime === "new"
            ? calculation.newRegimeTax.totalTax
            : calculation.oldRegimeTax.totalTax) +
          calculation.epf.totalDeducted +
          calculation.professionalTaxAnnual
        }
        highlight
      />
    </Card>
  );
}

// ─── Additional Income (shared both modes) ────────────────

export interface AdditionalIncomeProps {
  expectedBonus: string;
  onExpectedBonusChange: (v: string) => void;
  bonusTaxResult: BonusTaxResult | null;

  cgEquityLtcg: string;
  onCgEquityLtcgChange: (v: string) => void;
  cgEquityStcg: string;
  onCgEquityStcgChange: (v: string) => void;
  cgDebt: string;
  onCgDebtChange: (v: string) => void;
  cgFd: string;
  onCgFdChange: (v: string) => void;
  cgGold: string;
  onCgGoldChange: (v: string) => void;
  cgRealEstate: string;
  onCgRealEstateChange: (v: string) => void;
  capitalGainsTaxResult: CapitalGainsTaxResult | null;
  additionalIncomeNet: number;
}

export function AdditionalIncome({
  expectedBonus,
  onExpectedBonusChange,
  bonusTaxResult,
  cgEquityLtcg,
  onCgEquityLtcgChange,
  cgEquityStcg,
  onCgEquityStcgChange,
  cgDebt,
  onCgDebtChange,
  cgFd,
  onCgFdChange,
  cgGold,
  onCgGoldChange,
  cgRealEstate,
  onCgRealEstateChange,
  capitalGainsTaxResult,
  additionalIncomeNet,
}: AdditionalIncomeProps) {
  
  const theme = useTheme();
  return (
    <Card className="mb-4">
      <CollapsibleSection
        title="Additional Income"
        storageKey="salary_additional_income"
        defaultExpanded={false}
        icon="add-circle-outline"
        rightContent={
          additionalIncomeNet > 0 ? (
            <Text className="text-xs font-medium text-success mr-2">
              +{formatAmount(additionalIncomeNet)}
            </Text>
          ) : undefined
        }
      >
        <View className="pt-2">
          {/* Bonus */}
          <Input
            label="Expected Annual Bonus"
            value={expectedBonus}
            onChangeText={onExpectedBonusChange}
            keyboardType="numeric"
            placeholder="e.g. 200000"
            containerClassName="mb-1"
          />
          {bonusTaxResult && bonusTaxResult.grossBonus > 0 && (
            <View className="mb-3 px-2 py-2 rounded-lg" style={{ backgroundColor: theme.alpha("primary", 0.08) }}>
              <Text className="text-xs text-muted-foreground">
                {formatAmount(bonusTaxResult.grossBonus)} gross{" "}
                <Text className="text-danger">
                  → Tax {formatAmount(bonusTaxResult.taxOnBonus)} ({bonusTaxResult.effectiveRate}%)
                </Text>
                {" → "}
                <Text className="font-semibold text-success">
                  Net {formatAmount(bonusTaxResult.netBonus)}
                </Text>
              </Text>
            </View>
          )}

          {/* Divider */}
          <View className="border-t border-border my-3" />

          {/* Capital Gains */}
          <Text className="text-xs font-semibold text-muted-foreground mb-2">
            Capital Gains (per asset type)
          </Text>

          <Input
            label="Equity LTCG (12.5%, Rs 1.25L exempt)"
            value={cgEquityLtcg}
            onChangeText={onCgEquityLtcgChange}
            keyboardType="numeric"
            placeholder="0"
            containerClassName="mb-2"
          />
          <Input
            label="Equity STCG (20%)"
            value={cgEquityStcg}
            onChangeText={onCgEquityStcgChange}
            keyboardType="numeric"
            placeholder="0"
            containerClassName="mb-2"
          />
          <Input
            label="Debt MF (at slab rate)"
            value={cgDebt}
            onChangeText={onCgDebtChange}
            keyboardType="numeric"
            placeholder="0"
            containerClassName="mb-2"
          />
          <Input
            label="FD Interest (at slab rate)"
            value={cgFd}
            onChangeText={onCgFdChange}
            keyboardType="numeric"
            placeholder="0"
            containerClassName="mb-2"
          />
          <Input
            label="Gold LTCG (12.5%)"
            value={cgGold}
            onChangeText={onCgGoldChange}
            keyboardType="numeric"
            placeholder="0"
            containerClassName="mb-2"
          />
          <Input
            label="Real Estate LTCG (12.5%)"
            value={cgRealEstate}
            onChangeText={onCgRealEstateChange}
            keyboardType="numeric"
            placeholder="0"
            containerClassName="mb-1"
          />

          {/* CG Tax Summary */}
          {capitalGainsTaxResult && capitalGainsTaxResult.items.length > 0 && (
            <View className="mt-2 px-2 py-2 rounded-lg" style={{ backgroundColor: theme.alpha("primary", 0.08) }}>
              {capitalGainsTaxResult.items.map((item) => (
                <View key={item.label} className="flex-row items-center justify-between py-1">
                  <Text className="text-xs text-muted-foreground flex-1">
                    {item.label} ({item.rate})
                  </Text>
                  <Text className="text-xs text-danger w-20 text-right">
                    -{formatAmount(item.tax)}
                  </Text>
                  <Text className="text-xs font-medium text-foreground w-24 text-right">
                    {formatAmount(item.net)}
                  </Text>
                </View>
              ))}
              <View className="border-t border-border my-1" />
              <View className="flex-row items-center justify-between py-1">
                <Text className="text-xs font-semibold text-foreground flex-1">
                  Total CG
                </Text>
                <Text className="text-xs font-semibold text-danger w-20 text-right">
                  -{formatAmount(capitalGainsTaxResult.totalTax)}
                </Text>
                <Text className="text-xs font-bold text-success w-24 text-right">
                  {formatAmount(capitalGainsTaxResult.totalNet)}
                </Text>
              </View>
            </View>
          )}
        </View>
      </CollapsibleSection>
    </Card>
  );
}
