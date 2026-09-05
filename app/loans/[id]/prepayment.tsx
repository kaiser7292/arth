import { Toggle } from "@/components/goals";
import { Button, Input, ScreenContainer, Text } from "@/components/ui";
import { CalendarModal } from "@/components/ui/CalendarModal";
import { StatusColors } from "@/constants/theme";
import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
    getLoanById,
    getPrepayments,
    getSchedule,
    type LoanAccount,
    type LoanPrepaymentRow,
    type LoanScheduleEntry,
    loanToParams,
    loanToTerms,
    recordPrepayment,
    updatePrepayment,
} from "@/services/loan-accounts";
import { computePrepaymentImpact } from "@/services/loan-engine";
import { formatDate } from "@/utils/date";
import { formatAmount } from "@/utils/format";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";

export default function PrepaymentForm() {
  const { id, prepaymentId } = useLocalSearchParams<{ id: string; prepaymentId?: string }>();
  const router = useRouter();
  const alert = useAlert();
  const { colors, colorScheme, accent } = useColorScheme();

  const [loan, setLoan] = useState<LoanAccount | null>(null);
  const [schedule, setSchedule] = useState<LoanScheduleEntry[]>([]);
  const [prepayments, setPrepayments] = useState<LoanPrepaymentRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const [amount, setAmount] = useState("");
  const [strategy, setStrategy] = useState<"reduce_tenure" | "reduce_emi">("reduce_tenure");
  const [prepayDate, setPrepayDate] = useState(new Date().toISOString().split("T")[0]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [overrideExpanded, setOverrideExpanded] = useState(false);
  const [chargeOverride, setChargeOverride] = useState("");
  const [gstOverride, setGstOverride] = useState("");

  useEffect(() => {
    async function loadData() {
      if (!id) return;
      try {
        const [l, sched, preps] = await Promise.all([
          getLoanById(id),
          getSchedule(id),
          getPrepayments(id),
        ]);
        setLoan(l);
        setSchedule(sched);
        setPrepayments(preps);
        setLoaded(true);

        // If editing, populate form
        if (prepaymentId && preps) {
          const existing = preps.find((p) => p.id === prepaymentId);
          if (existing) {
            setAmount(String(existing.amount));
            setStrategy(existing.strategy ?? "reduce_tenure");
            setPrepayDate(existing.prepayment_date);
            setChargeOverride(String(existing.prepayment_charge));
            setGstOverride(String(existing.gst_on_charge));
            setOverrideExpanded(true);
          }
        }
      } catch (e) {
        console.error("Failed to load loan data:", e);
        alert("Error", "Failed to load loan data. Please try again.");
      }
    }
    loadData();
  }, [id, prepaymentId, alert]);

  const amountNum = parseFloat(amount) || 0;

  const currentEmi = useMemo(() => {
    if (!loan) return 0;
    const upcoming = schedule.find(
      (s) =>
        (s.status === "scheduled" || s.status === "overdue") &&
        s.due_date >= prepayDate,
    );
    if (upcoming) return upcoming.emi_amount;
    const prior = [...schedule]
      .filter((s) => s.due_date <= prepayDate)
      .pop();
    return prior?.emi_amount ?? loan.emi_amount;
  }, [schedule, prepayDate, loan]);

  const impact = useMemo(() => {
    if (!loan || amountNum <= 0) return null;
    try {
      const otherPrepayments = prepaymentId
        ? prepayments.filter((p) => p.id !== prepaymentId)
        : prepayments;
      return computePrepaymentImpact(
        { ...loanToParams(loan), ...loanToTerms(loan) },
        schedule.map((e) => ({
          id: e.id,
          installment_num: e.installment_num,
          due_date: e.due_date,
          opening_principal: e.opening_principal,
          emi_amount: e.emi_amount,
          principal_component: e.principal_component,
          interest_component: e.interest_component,
          closing_principal: e.closing_principal,
          status: e.status,
        })),
        otherPrepayments.map((p) => ({
          prepayment_date: p.prepayment_date,
          amount: p.amount,
          prepayment_charge: p.prepayment_charge,
          gst_on_charge: p.gst_on_charge,
          kind: p.kind,
          strategy: p.strategy ?? undefined,
        })),
        amountNum,
        prepayDate,
        strategy,
      );
    } catch {
      return null;
    }
  }, [loan, schedule, prepayments, prepaymentId, amountNum, prepayDate, strategy]);

  const formatMoney = (n: number) =>
    loan?.currency === "INR"
      ? formatAmount(n)
      : `${loan?.currency} ${n.toLocaleString()}`;

  const handleSave = async () => {
    if (!loan || !impact || amountNum <= 0 || !id) return;
    
    setSaving(true);
    try {
      const effectiveStrategy =
        amountNum < currentEmi ? "reduce_tenure" : strategy;
      
      const chargeTrim = chargeOverride.trim();
      const gstTrim = gstOverride.trim();
      const chargeNum = chargeTrim === "" ? NaN : parseFloat(chargeTrim);
      const gstNum = gstTrim === "" ? NaN : parseFloat(gstTrim);
      const finalCharge =
        overrideExpanded && Number.isFinite(chargeNum) && chargeNum >= 0
          ? chargeNum
          : impact.charge;
      const finalGst =
        overrideExpanded && Number.isFinite(gstNum) && gstNum >= 0
          ? gstNum
          : impact.gst;

      const payload = {
        prepayment_date: prepayDate,
        amount: amountNum,
        prepayment_charge: finalCharge,
        gst_on_charge: finalGst,
        kind: "part_payment" as const,
        strategy: effectiveStrategy,
      };

      if (prepaymentId) {
        await updatePrepayment(prepaymentId, payload);
      } else {
        await recordPrepayment(id, payload);
      }
      
      router.back();
    } catch (e) {
      console.error("Failed to save prepayment:", e);
      alert("Error", prepaymentId ? "Failed to update prepayment" : "Failed to record prepayment");
    } finally {
      setSaving(false);
    }
  };

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
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <View className="px-4 pt-4 pb-8">
            <View className="mb-4">
              <Text className="text-sm" style={{ color: colors.textSecondary }}>
                Part-payment applied against principal. Charges computed from your loan's terms.
              </Text>
            </View>

            <View className="gap-3 pb-4">
              <Input
                label={`Amount (${loan.currency})`}
                value={amount}
                onChangeText={setAmount}
                keyboardType="numeric"
                formula
                placeholder="e.g. 50000"
              />

              <Pressable
              onPress={() => setShowDatePicker(true)}
              className="py-3 px-3 rounded-lg border flex-row items-center"
              style={{ borderColor: colors.border }}
            >
              <View className="flex-1">
                <Text className="text-xs" style={{ color: colors.textSecondary }}>
                  Prepayment Date
                </Text>
                <Text
                  className="text-sm mt-1"
                  style={{ color: prepayDate ? colors.text : colors.textSecondary }}
                >
                  {prepayDate ? formatDate(prepayDate) : "Tap to pick"}
                </Text>
              </View>
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
            </Pressable>

            {amountNum >= currentEmi && (
              <Toggle
                label="Strategy"
                options={[
                  { label: "Reduce Tenure", value: "reduce_tenure" },
                  { label: "Reduce EMI", value: "reduce_emi" },
                ]}
                value={strategy}
                onChange={(v) => setStrategy(v as "reduce_tenure" | "reduce_emi")}
              />
            )}
            
            {amountNum > 0 && amountNum < currentEmi && (
              <View
                className="p-2.5 rounded-lg"
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
              >
                <Text className="text-xs" style={{ color: colors.textSecondary }}>
                  Small prepayment ({formatMoney(amountNum)} &lt; EMI of {formatMoney(Math.round(currentEmi))}). Applied straight to principal - tenure and EMI stay the same, the last installment gets smaller.
                </Text>
              </View>
            )}

            {impact && amountNum > 0 && (
              <View
                className="p-3 rounded-xl"
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
              >
                <Text className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: colors.textSecondary }}>
                  Preview
                </Text>
                <ImpactRow label="Prepayment" value={formatMoney(amountNum)} />
                <ImpactRow
                  label="Charge"
                  value={impact.charge > 0 ? `− ${formatMoney(impact.charge)}` : "- waived"}
                  color={impact.charge > 0 ? "danger" : "success"}
                />
                <ImpactRow
                  label="GST (on charge)"
                  value={impact.gst > 0 ? `− ${formatMoney(impact.gst)}` : "-"}
                />
                <View className="border-t border-border my-2" />
                <ImpactRow
                  label="Net applied to principal"
                  value={formatMoney(impact.netApplied)}
                  bold
                />
                <View className="border-t border-border my-2" />
                <ImpactRow
                  label="Interest saved"
                  value={formatMoney(impact.interestSavedTotal)}
                  color="success"
                />
                {amountNum >= currentEmi && strategy === "reduce_tenure" && impact.monthsSaved > 0 && (
                  <ImpactRow
                    label="Months saved"
                    value={`${impact.monthsSaved}`}
                    color="success"
                  />
                )}
                {amountNum >= currentEmi && strategy === "reduce_emi" && impact.newEMI && (
                  <ImpactRow
                    label="New EMI"
                    value={formatMoney(Math.round(impact.newEMI))}
                  />
                )}
              </View>
            )}

            {impact && amountNum > 0 && (
              <View>
                <Pressable
                  onPress={() => {
                    const next = !overrideExpanded;
                    setOverrideExpanded(next);
                    if (next && chargeOverride === "" && gstOverride === "") {
                      setChargeOverride(String(impact.charge));
                      setGstOverride(String(impact.gst));
                    }
                  }}
                  className="flex-row items-center py-2"
                >
                  <Ionicons
                    name={overrideExpanded ? "chevron-down" : "chevron-forward"}
                    size={14}
                    color={colors.textSecondary}
                  />
                  <Text
                    className="text-xs ml-1"
                    style={{ color: colors.textSecondary }}
                  >
                    Override charges (optional)
                  </Text>
                </Pressable>
                {overrideExpanded && (
                  <View
                    className="p-3 rounded-xl"
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <Input
                      label={`Charge (${loan.currency})`}
                      value={chargeOverride}
                      onChangeText={setChargeOverride}
                      keyboardType="decimal-pad"
                      placeholder={String(Math.round(impact.charge))}
                      containerClassName="mb-2"
                    />
                    <Input
                      label={`GST on charge (${loan.currency})`}
                      value={gstOverride}
                      onChangeText={setGstOverride}
                      keyboardType="decimal-pad"
                      placeholder={String(Math.round(impact.gst))}
                    />
                    <Text
                      className="text-label mt-1"
                      style={{ color: colors.textSecondary }}
                    >
                      Your values override the auto-computed ones. Leave blank to use the auto figures.
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>

          <View className="flex-row mt-4 gap-3 pb-4">
            <Button
              title="Cancel"
              variant="outline"
              onPress={() => router.back()}
              className="flex-1"
            />
            <Button
              title={prepaymentId ? "Save" : "Record"}
              onPress={handleSave}
              disabled={amountNum <= 0 || !impact || saving}
              loading={saving}
              className="flex-1"
            />
          </View>
        </View>
      </ScrollView>

      <CalendarModal
        visible={showDatePicker}
        onClose={() => setShowDatePicker(false)}
        value={prepayDate || new Date().toISOString().split("T")[0]}
        onChange={(d) => {
          setPrepayDate(d);
          setShowDatePicker(false);
        }}
        minimumDate={new Date(loan.disbursement_date + "T00:00:00")}
        maximumDate={null}
      />
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

function ImpactRow({
  label,
  value,
  color,
  bold,
}: {
  label: string;
  value: string;
  color?: "success" | "danger";
  bold?: boolean;
}) {
  const { colors, colorScheme } = useColorScheme();
  const valueColor =
    color === "success"
      ? StatusColors[colorScheme].success
      : color === "danger"
        ? StatusColors[colorScheme].danger
        : colors.text;
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text className="text-xs" style={{ color: colors.textSecondary }}>
        {label}
      </Text>
      <Text
        className={`text-sm ${bold ? "font-bold" : "font-medium"}`}
        style={{ color: valueColor }}
      >
        {value}
      </Text>
    </View>
  );
}
