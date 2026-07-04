import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, Input } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac, acAlpha } from "@/utils/accent";
import { Toggle, StatePicker } from "./salary-helpers";
import { formatAmount } from "@/utils/expense-validation";
import { getFYMonthLabels } from "@/utils/fiscal-year";

// ─── Types ───────────────────────────────────────────────

export type MonthlyOverrides = Record<number, string>;

// ─── Props ────────────────────────────────────────────────

export interface SalaryInputFormProps {
  inputMode: "ctc" | "direct";

  // CTC mode fields
  ctc: string;
  onCtcChange: (v: string) => void;
  basicPct: string;
  onBasicPctChange: (v: string) => void;
  hraPct: string;
  onHraPctChange: (v: string) => void;
  isMetro: string;
  onIsMetroChange: (v: string) => void;
  epfMode: "full_basic" | "restricted";
  onEpfModeChange: (v: string) => void;
  epfInCTC: string;
  onEpfInCTCChange: (v: string) => void;
  gratuityInCTC: string;
  onGratuityInCTCChange: (v: string) => void;
  vpfMonthly: string;
  onVpfMonthlyChange: (v: string) => void;
  state: string | null;
  onStateChange: (v: string | null) => void;
  profTax: number;

  // Manual rupee-amount breakdown (v16.0.9)
  ctcMode: "percentage" | "manual";
  onCtcModeChange: (v: "percentage" | "manual") => void;
  manualBasic: string;
  onManualBasicChange: (v: string) => void;
  manualHra: string;
  onManualHraChange: (v: string) => void;
  manualSpecial: string;
  onManualSpecialChange: (v: string) => void;
  manualEmployerEPF: string;
  onManualEmployerEPFChange: (v: string) => void;
  manualGratuity: string;
  onManualGratuityChange: (v: string) => void;

  // Direct mode fields
  directMonthly: string;
  onDirectMonthlyChange: (v: string) => void;
  directAnnual: number;

  // Month-wise overrides (direct mode)
  monthlyOverrides?: MonthlyOverrides;
  onMonthlyOverridesChange?: (overrides: MonthlyOverrides) => void;
  fyStartMonth?: number;
}

// ─── Component ────────────────────────────────────────────

export function SalaryInputForm({
  inputMode,
  ctc,
  onCtcChange,
  basicPct,
  onBasicPctChange,
  hraPct,
  onHraPctChange,
  isMetro,
  onIsMetroChange,
  epfMode,
  onEpfModeChange,
  epfInCTC,
  onEpfInCTCChange,
  gratuityInCTC,
  onGratuityInCTCChange,
  vpfMonthly,
  onVpfMonthlyChange,
  state,
  onStateChange,
  profTax,
  ctcMode,
  onCtcModeChange,
  manualBasic,
  onManualBasicChange,
  manualHra,
  onManualHraChange,
  manualSpecial,
  onManualSpecialChange,
  manualEmployerEPF,
  onManualEmployerEPFChange,
  manualGratuity,
  onManualGratuityChange,
  directMonthly,
  onDirectMonthlyChange,
  directAnnual,
  monthlyOverrides,
  onMonthlyOverridesChange,
  fyStartMonth = 4,
}: SalaryInputFormProps) {
  const { colors, accent, colorScheme } = useColorScheme();
  const [showMonthWise, setShowMonthWise] = useState(false);

  if (inputMode === "direct") {
    const monthLabels = getFYMonthLabels(fyStartMonth);
    const overrides = monthlyOverrides ?? {};
    const hasAnyOverride = Object.keys(overrides).length > 0;
    const overrideCount = Object.keys(overrides).length;

    return (
      <>
        <Card className="mb-4">
          <View className="flex-row items-center mb-3">
            <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}>
              <Ionicons
                name="wallet-outline"
                size={20}
                color={colors.blue}
              />
            </View>
            <View>
              <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
                Direct Salary Input
              </Text>
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                Enter your take-home salary directly
              </Text>
            </View>
          </View>

          <Input
            label="Default Monthly In-Hand"
            value={directMonthly}
            onChangeText={onDirectMonthlyChange}
            keyboardType="numeric"
            placeholder="e.g. 150000"
          />

          {/* Customize by Month toggle */}
          <Pressable
            className="flex-row items-center justify-between mt-3 py-2"
            onPress={() => setShowMonthWise(!showMonthWise)}
          >
            <View className="flex-row items-center">
              <Ionicons
                name={showMonthWise ? "chevron-up" : "chevron-down"}
                size={16}
                color={ac(accent, colorScheme, 500, 200)}
              />
              <Text
                className="text-xs font-medium ml-1"
                style={{ color: ac(accent, colorScheme, 500, 200) }}
              >
                Customize by Month
              </Text>
              {hasAnyOverride && !showMonthWise && (
                <View
                  className="ml-2 px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: acAlpha(accent, 500, 0.12) }}
                >
                  <Text
                    className="text-[10px] font-semibold"
                    style={{ color: ac(accent, colorScheme, 500, 200) }}
                  >
                    {overrideCount} customized
                  </Text>
                </View>
              )}
            </View>
            {hasAnyOverride && showMonthWise && (
              <Pressable
                onPress={() => onMonthlyOverridesChange?.({})}
                hitSlop={8}
              >
                <Text className="text-xs text-danger">
                  Reset All
                </Text>
              </Pressable>
            )}
          </Pressable>

          {showMonthWise && (
            <View className="mt-1">
              <Text className="text-[10px] text-text-tertiary mb-2">
                Override specific months. Empty = uses default above.
              </Text>
              {monthLabels.map((label, index) => {
                const overrideValue = overrides[index];
                const isOverridden = overrideValue !== undefined;

                return (
                  <View
                    key={index}
                    className="flex-row items-center mb-1.5"
                  >
                    <Text
                      className={`w-10 text-xs font-medium ${
                        isOverridden
                          ? ""
                          : "text-text-secondary dark:text-text-dark-secondary"
                      }`}
                      style={isOverridden ? { color: ac(accent, colorScheme, 500, 200) } : undefined}
                    >
                      {label}
                    </Text>
                    <View className="flex-1 mx-2">
                      <Input
                        value={isOverridden ? overrideValue : ""}
                        onChangeText={(v) => {
                          const next = { ...overrides };
                          if (v === "") {
                            delete next[index];
                          } else {
                            next[index] = v;
                          }
                          onMonthlyOverridesChange?.(next);
                        }}
                        keyboardType="numeric"
                        placeholder={directMonthly || "0"}
                        containerClassName="mb-0"
                      />
                    </View>
                    {isOverridden && (
                      <Pressable
                        onPress={() => {
                          const next = { ...overrides };
                          delete next[index];
                          onMonthlyOverridesChange?.(next);
                        }}
                        hitSlop={8}
                        className="w-7 h-7 items-center justify-center"
                      >
                        <Ionicons
                          name="close-circle"
                          size={16}
                          color={colors.textSecondary}
                        />
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </Card>

        {/* Direct mode summary */}
        {directAnnual > 0 && (
          <Card className="mb-4">
            <View className="items-center py-2">
              <Text className="text-xs font-semibold tracking-wider uppercase text-text-secondary dark:text-text-dark-secondary mb-1">
                Annual In-Hand
              </Text>
              <Text className="text-3xl font-bold text-success">
                {formatAmount(directAnnual)}
              </Text>
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-0.5">
                {formatAmount(directAnnual / 12)} / month avg
              </Text>
              {hasAnyOverride && (
                <Text className="text-xs text-text-tertiary mt-1">
                  {overrideCount} month{overrideCount > 1 ? "s" : ""} customized
                </Text>
              )}
            </View>
          </Card>
        )}

        {/* Empty state for direct mode */}
        {directAnnual <= 0 && (
          <Card className="mb-4">
            <View className="items-center py-6">
              <View className="w-14 h-14 rounded-full items-center justify-center mb-3" style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}>
                <Ionicons
                  name="wallet-outline"
                  size={28}
                  color={colors.blue}
                />
              </View>
              <Text className="text-base font-medium text-text-primary dark:text-text-dark-primary mb-1">
                Enter your salary
              </Text>
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary text-center px-4">
                Enter your monthly take-home salary. No tax calculation
                needed - just the amount you receive.
              </Text>
            </View>
          </Card>
        )}
      </>
    );
  }

  // CTC mode
  return (
    <>
      {/* CTC Input */}
      <Card className="mb-4">
        <View className="flex-row items-center mb-3">
          <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}>
            <Ionicons
              name="cash-outline"
              size={20}
              color={colors.blue}
            />
          </View>
          <View>
            <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
              Annual CTC
            </Text>
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
              Enter your cost-to-company
            </Text>
          </View>
        </View>

        <Input
          label="Annual CTC"
          value={ctc}
          onChangeText={onCtcChange}
          keyboardType="numeric"
          placeholder="e.g. 2000000"
          containerClassName="mb-3"
        />

        <Toggle
          label="Breakdown Mode"
          options={[
            { label: "By Percentage", value: "percentage" },
            { label: "Manual Amounts", value: "manual" },
          ]}
          value={ctcMode}
          onChange={(v) => onCtcModeChange(v as "percentage" | "manual")}
        />

        {ctcMode === "percentage" ? (
          <View className="flex-row">
            <View className="flex-1 mr-2">
              <Input
                label="Basic %"
                value={basicPct}
                onChangeText={onBasicPctChange}
                keyboardType="numeric"
                placeholder="40"
              />
            </View>
            <View className="flex-1">
              <Input
                label="HRA % of Basic"
                value={hraPct}
                onChangeText={onHraPctChange}
                keyboardType="numeric"
                placeholder="50"
              />
            </View>
          </View>
        ) : (
          <View>
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-2">
              Enter rupee amounts from your offer letter. Leave Special Allowance blank to auto-fill from remainder.
            </Text>
            <Input
              label="Basic"
              value={manualBasic}
              onChangeText={onManualBasicChange}
              keyboardType="numeric"
              placeholder="e.g. 800000"
              containerClassName="mb-2"
            />
            <Input
              label="HRA"
              value={manualHra}
              onChangeText={onManualHraChange}
              keyboardType="numeric"
              placeholder="e.g. 400000"
              containerClassName="mb-2"
            />
            <Input
              label="Special Allowance (optional)"
              value={manualSpecial}
              onChangeText={onManualSpecialChange}
              keyboardType="numeric"
              placeholder="auto from remainder"
              containerClassName="mb-2"
            />
            <Input
              label="Employer EPF"
              value={manualEmployerEPF}
              onChangeText={onManualEmployerEPFChange}
              keyboardType="numeric"
              placeholder="e.g. 21600"
              containerClassName="mb-2"
            />
            <Input
              label="Gratuity"
              value={manualGratuity}
              onChangeText={onManualGratuityChange}
              keyboardType="numeric"
              placeholder="e.g. 38480"
            />
          </View>
        )}
      </Card>

      {/* EPF & Settings */}
      <Card title="EPF & Settings" className="mb-4">
        <Toggle
          label="EPF Mode"
          options={[
            { label: "Minimum (15K)", value: "restricted" },
            { label: "12% of Basic Pay", value: "full_basic" },
          ]}
          value={epfMode}
          onChange={onEpfModeChange}
        />

        <Toggle
          label="Employer EPF in CTC?"
          options={[
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ]}
          value={epfInCTC}
          onChange={onEpfInCTCChange}
        />

        <Toggle
          label="Gratuity in CTC?"
          options={[
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ]}
          value={gratuityInCTC}
          onChange={onGratuityInCTCChange}
        />

        <Toggle
          label="Metro City?"
          options={[
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ]}
          value={isMetro}
          onChange={onIsMetroChange}
        />

        <Input
          label="Voluntary PF (Monthly)"
          value={vpfMonthly}
          onChangeText={onVpfMonthlyChange}
          keyboardType="numeric"
          placeholder="0"
          containerClassName="mb-3"
        />

        <StatePicker value={state} onChange={onStateChange} />
        <View className="flex-row items-center px-1">
          <Ionicons
            name="information-circle-outline"
            size={14}
            color={colors.textSecondary}
          />
          <Text className="text-xs text-text-tertiary ml-1">
            Professional Tax: {formatAmount(profTax)}/year
          </Text>
        </View>
      </Card>
    </>
  );
}
