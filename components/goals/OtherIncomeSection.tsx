import { View } from "react-native";
import { Card, CollapsibleSection, Input, Text } from "@/components/ui";
import { formatAmount } from "@/utils/expense-validation";
import type { OtherIncomeResult } from "@/services/tax-engine";
import { Toggle, BreakdownRow } from "./salary-helpers";
import { BusinessInputs, BusinessWarnings, InlineNote, type BusinessInputsProps } from "./BusinessIncomeSection";

export interface OtherIncomeSectionProps {
  /** Salaried users can add a side business; business users already have one. */
  allowSideBusiness: boolean;
  sideBusinessEnabled: boolean;
  onSideBusinessEnabledChange: (v: boolean) => void;
  sideBusiness: BusinessInputsProps;

  rentalRent: string;
  onRentalRentChange: (v: string) => void;
  rentalMunicipalTax: string;
  onRentalMunicipalTaxChange: (v: string) => void;
  rentalLoanInterest: string;
  onRentalLoanInterestChange: (v: string) => void;

  result: OtherIncomeResult | null;
  /** Regime the primary income was worked out in — flagged when the combined best differs. */
  primaryRegime: "new" | "old";
}

/**
 * Side income stacked on the main income: freelance / business on the side, and rent from
 * a let-out property. Tax is on the combined income, so this shows the EXTRA tax it adds.
 */
export function OtherIncomeSection({
  allowSideBusiness,
  sideBusinessEnabled,
  onSideBusinessEnabledChange,
  sideBusiness,
  rentalRent,
  onRentalRentChange,
  rentalMunicipalTax,
  onRentalMunicipalTaxChange,
  rentalLoanInterest,
  onRentalLoanInterestChange,
  result,
  primaryRegime,
}: OtherIncomeSectionProps) {
  return (
    <Card className="mb-4">
      <CollapsibleSection
        title="Other Income"
        storageKey="salary_other_income"
        defaultExpanded={false}
        icon="layers-outline"
        rightContent={
          result && result.netCash !== 0 ? (
            <Text className={`text-xs font-medium mr-2 ${result.netCash > 0 ? "text-success" : "text-danger"}`}>
              {result.netCash > 0 ? "+" : ""}
              {formatAmount(result.netCash)}
            </Text>
          ) : undefined
        }
      >
        <View className="pt-2">
          <Text className="text-xs text-muted-foreground mb-3">
            Regular income besides your main one. Tax is worked out on your total income, so each
            rupee here is taxed at your highest slab.
          </Text>

          {allowSideBusiness && (
            <>
              <Toggle
                label="Freelance or Business on the Side?"
                options={[
                  { label: "No", value: "no" },
                  { label: "Yes", value: "yes" },
                ]}
                value={sideBusinessEnabled ? "yes" : "no"}
                onChange={(v) => onSideBusinessEnabledChange(v === "yes")}
              />
              {sideBusinessEnabled && (
                <View className="mb-1">
                  <BusinessInputs {...sideBusiness} />
                  {result?.sideBusiness && (
                    <View className="mt-3">
                      <BusinessWarnings business={result.sideBusiness} />
                    </View>
                  )}
                </View>
              )}
              <View className="border-t border-border my-3" />
            </>
          )}

          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Rent from a Let-Out Property
          </Text>
          <Input
            label="Annual Rent Received"
            value={rentalRent}
            onChangeText={onRentalRentChange}
            keyboardType="numeric"
            placeholder="0"
            containerClassName="mb-2"
          />
          <View className="flex-row">
            <View className="flex-1 mr-2">
              <Input
                label="Municipal Tax Paid"
                value={rentalMunicipalTax}
                onChangeText={onRentalMunicipalTaxChange}
                keyboardType="numeric"
                placeholder="0"
              />
            </View>
            <View className="flex-1">
              <Input
                label="Home Loan Interest on It"
                value={rentalLoanInterest}
                onChangeText={onRentalLoanInterestChange}
                keyboardType="numeric"
                placeholder="0"
              />
            </View>
          </View>
          <Text className="text-xs text-faint-foreground mt-2">
            30% of rent (after municipal tax) is deducted automatically for repairs. Your own home's
            loan interest goes under Old Regime Deductions instead.
          </Text>

          {result && (
            <View className="mt-3">
              {result.sideBusiness && (
                <BreakdownRow
                  label={result.sideBusiness.appliedScheme === "regular" ? "Side Business Profit" : "Side Presumptive Profit"}
                  annual={result.sideBusinessProfit}
                />
              )}
              {(result.rentalIncome !== 0 || result.rentalCountedNew !== 0) && (
                <BreakdownRow label="Taxable Rent" annual={result.rentalIncome} />
              )}
              <BreakdownRow label="Extra Tax" annual={-result.extraTax} />
              <View className="border-t border-border my-1" />
              <BreakdownRow label="Net Other Income" annual={result.netCash} monthly={result.netCash / 12} highlight />

              {result.rentalIncome < 0 && (
                <InlineNote className="mt-2">
                  {result.rentalCountedOld < 0
                    ? `The rental loss of ${formatAmount(-result.rentalIncome)} lowers tax only in the Old Regime (up to ₹2L a year, shared with your own home's loan interest).`
                    : "A rental loss can't reduce tax in the New Regime."}
                </InlineNote>
              )}
              {result.bestRegime !== primaryRegime && (
                <InlineNote tone="warning" icon="swap-horizontal-outline" className="mt-2">
                  With this income the {result.bestRegime === "new" ? "New" : "Old"} Regime works out
                  cheaper overall ({formatAmount(result.combinedTax)} total tax).
                  {result.sideBusiness
                    ? " With business income you can leave the New Regime only once (and return once), so check before you switch."
                    : ""}
                </InlineNote>
              )}
            </View>
          )}
        </View>
      </CollapsibleSection>
    </Card>
  );
}
