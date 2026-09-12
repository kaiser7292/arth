import { useCallback, useEffect, useState } from "react";
import { View, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Input, Sheet, Text } from "@/components/ui";
import { CalendarModal } from "@/components/ui/CalendarModal";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import { completeFDDetails } from "@/services/investment-accounts";
import type { CompoundingFreq, InterestMethod } from "@/services/investment-engine";
import { formatDate } from "@/utils/date";
import { formatError } from "@/utils/error-message";
import { useTheme } from "@/hooks/use-theme";

const COMPOUNDING_OPTIONS: { value: CompoundingFreq; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annually", label: "Annually" },
];

interface CompleteFDDetailsSheetProps {
  visible: boolean;
  financialAccountId: string;
  startDate: string;
  onDone: () => void;
  onClose: () => void;
}

/**
 * Fills in the interest rate/maturity date of an FD that was created without
 * them (services/investment-accounts.ts:createFDAccountShell, via the "Mark
 * as Fixed Deposit" quick-create) and generates its schedule.
 */
export function CompleteFDDetailsSheet({
  visible,
  financialAccountId,
  startDate,
  onDone,
  onClose,
}: CompleteFDDetailsSheetProps) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  const alert = useAlert();

  const [interestRate, setInterestRate] = useState("");
  const [interestMethod, setInterestMethod] = useState<InterestMethod>("compound");
  const [compoundingFreq, setCompoundingFreq] = useState<CompoundingFreq>("quarterly");
  const [maturityDate, setMaturityDate] = useState("");
  const [showMaturityPicker, setShowMaturityPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setInterestRate("");
      setInterestMethod("compound");
      setCompoundingFreq("quarterly");
      setMaturityDate("");
    }
  }, [visible]);

  const handleClose = useCallback(() => onClose(), [onClose]);

  const handleSave = useCallback(async () => {
    const errors: string[] = [];
    const r = parseFloat(interestRate);
    if (!(r > 0)) errors.push("Interest rate must be a positive number.");
    if (!maturityDate) errors.push("Maturity date is required.");
    else if (maturityDate <= startDate) errors.push("Maturity date must be after the start date.");
    if (interestMethod === "compound" && !compoundingFreq) errors.push("Compounding frequency is required for compound interest.");

    if (errors.length > 0) {
      alert("Fix these fields", errors.join("\n"));
      return;
    }

    setSaving(true);
    try {
      await completeFDDetails(financialAccountId, {
        interest_rate_pa: r,
        interest_method: interestMethod,
        compounding_freq: interestMethod === "compound" ? compoundingFreq : undefined,
        maturity_date: maturityDate,
      });
      onDone();
    } catch (e) {
      alert("Couldn't save", formatError("Complete fixed deposit details", e));
    } finally {
      setSaving(false);
    }
  }, [interestRate, maturityDate, startDate, interestMethod, compoundingFreq, financialAccountId, alert, onDone]);

  if (!visible) return null;

  return (
    <Sheet visible={visible} onClose={handleClose}>
      <View className="px-5 pb-3">
        <Text className="text-base font-bold" style={{ color: colors.text }}>
          Complete Fixed Deposit Details
        </Text>
        <Text className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>
          Started {formatDate(startDate)}. Add the rate and maturity date to compute its schedule.
        </Text>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
        <View className="px-5">
          <Input
            label="Interest rate (% per year)"
            value={interestRate}
            onChangeText={setInterestRate}
            placeholder="e.g. 7.1"
            keyboardType="numeric"
            containerClassName="mb-3"
          />

          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Interest type
          </Text>
          <View className="flex-row gap-2 mb-3">
            {([{ value: "compound", label: "Compound" }, { value: "simple", label: "Simple" }] as const).map((opt) => {
              const active = interestMethod === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setInterestMethod(opt.value)}
                  className="flex-1 py-2.5 rounded-xl items-center border"
                  style={{
                    backgroundColor: active ? theme.primary + "20" : colors.surface,
                    borderColor: active ? theme.primary : colors.border,
                  }}
                >
                  <Text className="text-sm font-semibold" style={{ color: active ? theme.primary : colors.textSecondary }}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {interestMethod === "compound" && (
            <>
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Compounding frequency
              </Text>
              <View className="flex-row gap-2 mb-3">
                {COMPOUNDING_OPTIONS.map((opt) => {
                  const active = compoundingFreq === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => setCompoundingFreq(opt.value)}
                      className="flex-1 py-2.5 rounded-xl items-center border"
                      style={{
                        backgroundColor: active ? theme.primary + "20" : colors.surface,
                        borderColor: active ? theme.primary : colors.border,
                      }}
                    >
                      <Text className="text-sm font-semibold" style={{ color: active ? theme.primary : colors.textSecondary }}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Matures
          </Text>
          <Pressable
            onPress={() => setShowMaturityPicker(true)}
            className="flex-row items-center justify-between border border-border rounded-lg px-3 py-3 mb-3"
          >
            <Text className="text-sm" style={{ color: maturityDate ? colors.text : colors.textSecondary }}>
              {maturityDate ? formatDate(maturityDate) : "Select maturity date"}
            </Text>
            <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      </ScrollView>

      <View className="flex-row px-5 pt-3 pb-1 gap-3">
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          className="flex-1 py-3 rounded-xl items-center"
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
        >
          <Text className="text-sm font-semibold" style={{ color: colors.textSecondary }}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          accessibilityRole="button"
          className="flex-1 py-3 rounded-xl items-center"
          style={{ backgroundColor: theme.primary, opacity: saving ? 0.6 : 1 }}
        >
          <Text className="text-sm font-semibold text-primary-foreground">{saving ? "Saving…" : "Save"}</Text>
        </Pressable>
      </View>

      <CalendarModal
        visible={showMaturityPicker}
        onClose={() => setShowMaturityPicker(false)}
        value={maturityDate || startDate}
        onChange={(d) => {
          setMaturityDate(d);
          setShowMaturityPicker(false);
        }}
        maximumDate={null}
      />
    </Sheet>
  );
}
