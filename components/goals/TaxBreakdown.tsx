import { useState } from "react";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { formatAmount } from "@/utils/expense-validation";
import type { SalaryCalculation } from "@/services/tax-engine";
import { TaxRow } from "./salary-helpers";

import { useTheme } from "@/hooks/use-theme";

// ─── Props ────────────────────────────────────────────────

export interface TaxBreakdownProps {
  calculation: SalaryCalculation;
}

// ─── Component ────────────────────────────────────────────

export function TaxBreakdown({ calculation }: TaxBreakdownProps) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [compareTab, setCompareTab] = useState<"new" | "old">("new");

  return (
    <>
      {/* Tax Comparison */}
      <Card title="Tax Comparison" className="mb-4">
        {/* Regime tabs */}
        <View className="flex-row rounded-lg border border-border overflow-hidden mb-3">
          <Pressable
            onPress={() => setCompareTab("new")}
            className={`flex-1 py-2 items-center ${
              compareTab === "new"
                ? ""
                : "bg-card"
            }`}
            style={compareTab === "new" ? { backgroundColor: theme.primary } : undefined}
          >
            <Text
              className={`text-sm font-medium ${
                compareTab === "new"
                  ? "text-primary-foreground"
                  : "text-muted-foreground"
              }`}
            >
              New Regime
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setCompareTab("old")}
            className={`flex-1 py-2 items-center ${
              compareTab === "old"
                ? ""
                : "bg-card"
            }`}
            style={compareTab === "old" ? { backgroundColor: theme.primary } : undefined}
          >
            <Text
              className={`text-sm font-medium ${
                compareTab === "old"
                  ? "text-primary-foreground"
                  : "text-muted-foreground"
              }`}
            >
              Old Regime
            </Text>
          </Pressable>
        </View>

        {/* Tax details for selected tab */}
        {(() => {
          const tax =
            compareTab === "new"
              ? calculation.newRegimeTax
              : calculation.oldRegimeTax;
          const isSelected =
            compareTab === calculation.selectedRegime;

          return (
            <>
              {isSelected && (
                <View className="flex-row items-center mb-2 px-2 py-1.5 rounded-lg bg-success/8">
                  <Ionicons
                    name="checkmark-circle"
                    size={16}
                    color={theme.success}
                  />
                  <Text className="text-xs font-medium text-success ml-1">
                    Better regime - saves you{" "}
                    {formatAmount(
                      Math.abs(
                        calculation.newRegimeTax.totalTax -
                          calculation.oldRegimeTax.totalTax,
                      ),
                    )}
                  </Text>
                </View>
              )}

              <TaxRow
                label="Taxable Income"
                value={formatAmount(tax.taxableIncome)}
              />
              <TaxRow
                label="Base Tax"
                value={formatAmount(tax.baseTax)}
              />
              {tax.rebate87A > 0 && (
                <TaxRow
                  label="Section 87A Rebate"
                  value={`-${formatAmount(tax.rebate87A)}`}
                  color={theme.success}
                />
              )}
              {tax.marginalRelief > 0 && (
                <TaxRow
                  label="Marginal Relief"
                  value={`-${formatAmount(tax.marginalRelief)}`}
                  color={theme.success}
                />
              )}
              {tax.surcharge > 0 && (
                <TaxRow
                  label="Surcharge"
                  value={formatAmount(tax.surcharge)}
                />
              )}
              <TaxRow
                label="Health & Edu Cess (4%)"
                value={formatAmount(tax.cess)}
              />
              <View className="border-t border-border my-1" />
              <TaxRow
                label="Total Tax"
                value={formatAmount(tax.totalTax)}
                color={theme.danger}
              />
              <TaxRow
                label="Effective Rate"
                value={`${tax.effectiveRate}%`}
                color={colors.blue}
              />
            </>
          );
        })()}
      </Card>

      {/* Side-by-Side Summary */}
      <Card title="Regime Summary" className="mb-4">
        <View className="flex-row">
          <View className="flex-1 items-center py-2">
            <Text className="text-xs text-muted-foreground mb-1">
              New Regime
            </Text>
            <Text className="text-base font-bold text-foreground">
              {formatAmount(calculation.newRegimeTax.totalTax)}
            </Text>
            <Text className="text-xs text-faint-foreground">
              {calculation.newRegimeTax.effectiveRate}% eff.
            </Text>
            {calculation.selectedRegime === "new" && (
              <View className="mt-1 px-2 py-0.5 rounded-full bg-success/8">
                <Text className="text-label font-medium text-success">
                  BETTER
                </Text>
              </View>
            )}
          </View>
          <View className="w-px bg-border" />
          <View className="flex-1 items-center py-2">
            <Text className="text-xs text-muted-foreground mb-1">
              Old Regime
            </Text>
            <Text className="text-base font-bold text-foreground">
              {formatAmount(calculation.oldRegimeTax.totalTax)}
            </Text>
            <Text className="text-xs text-faint-foreground">
              {calculation.oldRegimeTax.effectiveRate}% eff.
            </Text>
            {calculation.selectedRegime === "old" && (
              <View className="mt-1 px-2 py-0.5 rounded-full bg-success/8">
                <Text className="text-label font-medium text-success">
                  BETTER
                </Text>
              </View>
            )}
          </View>
        </View>
      </Card>
    </>
  );
}
