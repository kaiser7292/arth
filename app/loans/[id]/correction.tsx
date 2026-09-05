import { Button, Input, ScreenContainer, Text } from "@/components/ui";

import { CalendarModal } from "@/components/ui/CalendarModal";
import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
    type LoanAccount,
    type LoanCorrectionRow,
    createCorrection,
    deleteCorrection,
    getLoanById,
    getLoanOutstandingAt,
    updateCorrection,
} from "@/services/loan-accounts";
import { formatDate } from "@/utils/date";
import { formatAmount } from "@/utils/format";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";

export default function CorrectionForm() {
  const theme = useTheme();
  const { id, correctionId } = useLocalSearchParams<{ id: string; correctionId?: string }>();
  const router = useRouter();
  const alert = useAlert();
  const { colors } = useColorScheme();

  const [loan, setLoan] = useState<LoanAccount | null>(null);
  const [computedOutstanding, setComputedOutstanding] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split("T")[0]);
  const [outstanding, setOutstanding] = useState("");
  const [emi, setEmi] = useState("");
  const [tenureRemaining, setTenureRemaining] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [reason, setReason] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    async function loadData() {
      if (!id) return;
      try {
        const [l, outstanding] = await Promise.all([
          getLoanById(id),
          getLoanOutstandingAt(id, new Date().toISOString().split("T")[0]),
        ]);
        setLoan(l);
        setComputedOutstanding(outstanding);
        setLoaded(true);

        // If editing, populate form
        if (correctionId && l) {
          // Need to load existing correction data
          // For now, we'll handle this by passing correction data via params
          // or loading from the corrections list
          const { getDatabase } = require("@/database");
          const db = getDatabase();
          const correction = await db.getFirstAsync(
            "SELECT * FROM loan_corrections WHERE id = ?;",
            correctionId,
          ) as LoanCorrectionRow | null;
          if (correction) {
            setEffectiveDate(correction.effective_date);
            setOutstanding(String(correction.outstanding_principal));
            setEmi(String(correction.emi_amount));
            setTenureRemaining(
              correction.tenure_remaining_months !== null
                ? String(correction.tenure_remaining_months)
                : "",
            );
            setInterestRate(
              correction.interest_rate_pa != null ? String(correction.interest_rate_pa) : "",
            );
            setReason(correction.reason ?? "");
          }
        } else if (l) {
          setEffectiveDate(new Date().toISOString().split("T")[0]);
          setOutstanding(String(Math.round(outstanding)));
          setEmi(String(Math.round(l.emi_amount)));
          setTenureRemaining("");
          setReason("");
        }
      } catch (e) {
        console.error("Failed to load loan data:", e);
        alert("Error", "Failed to load loan data. Please try again.");
      }
    }
    loadData();
  }, [id, correctionId, alert]);

  const outstandingNum = parseFloat(outstanding) || 0;
  const emiNum = parseFloat(emi) || 0;
  const tenureNum = tenureRemaining ? parseInt(tenureRemaining, 10) : undefined;
  const rateNum = interestRate ? parseFloat(interestRate) : undefined;

  const canSubmit = outstandingNum > 0 && emiNum > 0 && (rateNum === undefined || (rateNum > 0 && rateNum < 100));

  const handleSave = async () => {
    if (!loan || !canSubmit || !id) return;
    
    setSaving(true);
    try {
      const payload = {
        effective_date: effectiveDate,
        outstanding_principal: outstandingNum,
        emi_amount: emiNum,
        tenure_remaining_months: tenureNum,
        interest_rate_pa: rateNum,
        reason: reason.trim() || undefined,
      };

      if (correctionId) {
        await updateCorrection(correctionId, payload);
      } else {
        await createCorrection(id, payload);
      }
      
      router.back();
    } catch (e) {
      console.error("Failed to save correction:", e);
      alert("Error", correctionId ? "Failed to update correction" : "Failed to submit correction");
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!correctionId) return;
    
    alert(
      "Deactivate this correction?",
      "This will remove the correction and the schedule will regenerate without it. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Deactivate",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteCorrection(correctionId);
              router.back();
            } catch (e) {
              console.error("Failed to deactivate correction:", e);
              alert("Error", "Failed to deactivate correction");
            }
          },
        },
      ],
    );
  };

  const formatMoney = (n: number) =>
    loan?.currency === "INR"
      ? formatAmount(n)
      : `${loan?.currency} ${n.toLocaleString()}`;

  if (!loaded || !loan) {
    return (
      <ScreenContainer>
        <View className="flex-1 items-center justify-center">
          <Text style={{ color: colors.textSecondary }}>Loading...</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="px-4 pt-4 pb-8">
            <View className="mb-4">
              <Text className="text-sm" style={{ color: colors.textSecondary }}>
                Override Arth's computed numbers when they don't match your bank's. The schedule regenerates from this date forward.
              </Text>
            </View>

            <View className="gap-3 pb-4">
              <Pressable
                onPress={() => setShowDatePicker(true)}
                className="py-3 px-3 rounded-lg border flex-row items-center"
                style={{ borderColor: colors.border }}
              >
                <View className="flex-1">
                  <Text className="text-xs" style={{ color: colors.textSecondary }}>
                    Effective Date
                  </Text>
                  <Text
                    className="text-sm mt-1"
                    style={{ color: effectiveDate ? colors.text : colors.textSecondary }}
                  >
                    {effectiveDate ? formatDate(effectiveDate) : "Tap to pick"}
                  </Text>
                </View>
                <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              </Pressable>

              <Input
                label={`Outstanding Principal (${loan.currency})`}
                value={outstanding}
                onChangeText={setOutstanding}
                keyboardType="numeric"
                formula
                placeholder="e.g. 500000"
              />
              <Text className="text-xs mb-3" style={{ color: colors.textSecondary }}>
                Arth's computed value: {formatMoney(Math.round(computedOutstanding))}
              </Text>

              <Input
                label="EMI Amount"
                value={emi}
                onChangeText={setEmi}
                keyboardType="numeric"
                formula
                placeholder="e.g. 25000"
              />
              <Text className="text-xs mb-3" style={{ color: colors.textSecondary }}>
                Arth's computed value: {formatMoney(Math.round(loan.emi_amount))}
              </Text>

              <Input
                label="Tenure Remaining (months, optional)"
                value={tenureRemaining}
                onChangeText={setTenureRemaining}
                keyboardType="numeric"
                placeholder="e.g. 120"
              />

              <Input
                label="New Interest Rate % (optional)"
                value={interestRate}
                onChangeText={setInterestRate}
                keyboardType="decimal-pad"
                placeholder={`Current: ${loan.interest_rate_pa}%`}
              />
              <Text className="text-xs mb-3" style={{ color: colors.textSecondary }}>
                Fill this only if your bank changed the rate (floating-rate repricing).
              </Text>

              <Input
                label="Reason (optional)"
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. Rate reset, repricing, statement reconciliation"
              />
            </View>

            {correctionId && (
              <Pressable
                onPress={handleDeactivate}
                className="mb-3 py-3 rounded-xl items-center"
                style={{ backgroundColor: theme.danger }}
              >
                <Text className="text-sm font-medium text-white">Deactivate This Correction</Text>
              </Pressable>
            )}

            <View className="flex-row gap-3 pb-4">
              <Button
                title="Cancel"
                variant="outline"
                onPress={() => router.back()}
                className="flex-1"
              />
              <Button
                title={correctionId ? "Save" : "Submit"}
                onPress={handleSave}
                disabled={!canSubmit || saving}
                loading={saving}
                className="flex-1"
              />
            </View>
          </View>
        </ScrollView>

        <CalendarModal
          visible={showDatePicker}
          onClose={() => setShowDatePicker(false)}
          value={effectiveDate || new Date().toISOString().split("T")[0]}
          onChange={(d) => {
            setEffectiveDate(d);
            setShowDatePicker(false);
          }}
          minimumDate={new Date(loan.disbursement_date + "T00:00:00")}
          maximumDate={null}
        />
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
