import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Pressable,
  Modal,
  Platform,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card, Input, Button } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Toggle } from "@/components/goals";
import { CalendarModal } from "@/components/ui/CalendarModal";
import { createLoan, type LoanType } from "@/services/loan-accounts";
import { computeEMI } from "@/services/loan-engine";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";
import { formatError } from "@/utils/error-message";
import { CURRENCIES } from "@/constants/currencies";
import {
  getLoanById,
  updateLoan,
  backfillPaidInstallments,
  getSchedule,
} from "@/services/loan-accounts";
import { useEffect } from "react";

const LOAN_TYPES: { label: string; value: LoanType }[] = [
  { label: "Personal", value: "personal" },
  { label: "Home", value: "home" },
  { label: "Auto", value: "auto" },
  { label: "Education", value: "education" },
  { label: "Business", value: "business" },
  { label: "Gold", value: "gold" },
  { label: "Against FD", value: "against_fd" },
  { label: "Other", value: "other" },
];

export default function AddLoanScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors } = useColorScheme();
  const headerHeight = useHeaderHeight();
  const { loanId } = useLocalSearchParams<{ loanId?: string }>();
  const isEdit = !!loanId;

  // Core fields
  const [loanType, setLoanType] = useState<LoanType>("personal");
  const [showLoanTypePicker, setShowLoanTypePicker] = useState(false);
  const [showDisbursementPicker, setShowDisbursementPicker] = useState(false);
  const [showEmiStartPicker, setShowEmiStartPicker] = useState(false);
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [agreementId, setAgreementId] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);

  // Amounts
  const [principalSanctioned, setPrincipalSanctioned] = useState("");
  const [principalDisbursed, setPrincipalDisbursed] = useState("");
  const [disbursementDate, setDisbursementDate] = useState("");
  const [emiStartDate, setEmiStartDate] = useState("");
  const [emiDayOfMonth, setEmiDayOfMonth] = useState("10");

  // Rate + tenure
  const [interestRatePa, setInterestRatePa] = useState("");
  const [interestType, setInterestType] = useState<"fixed" | "floating">("fixed");
  const [tenureMonths, setTenureMonths] = useState("");
  const [emiAmount, setEmiAmount] = useState("");

  // Fees
  const [processingFee, setProcessingFee] = useState("0");
  const [stampDuty, setStampDuty] = useState("0");
  const [insurancePremium, setInsurancePremium] = useState("0");

  // Prepayment rules
  const [prepayEarlyPct, setPrepayEarlyPct] = useState("0");
  const [prepayLatePct, setPrepayLatePct] = useState("0");
  const [prepayThresholdEmis, setPrepayThresholdEmis] = useState("");
  const [foreclosureWaiverMonths, setForeclosureWaiverMonths] = useState("");
  const [foreclosureWaiverMinAmount, setForeclosureWaiverMinAmount] = useState("");
  const [gstPct, setGstPct] = useState("18");

  // Penal
  const [penalRatePa, setPenalRatePa] = useState("0");
  const [penalRateCapPa, setPenalRateCapPa] = useState("0");

  // v17.5.0 — historical state (backfill when adding a loan already in progress)
  const [emisAlreadyPaid, setEmisAlreadyPaid] = useState("0");

  const [saving, setSaving] = useState(false);

  // v17.5.0 — Edit mode: hydrate fields from existing loan
  useEffect(() => {
    if (!loanId) return;
    (async () => {
      const loan = await getLoanById(loanId);
      if (!loan) return;
      const db = (await import("@/database")).getDatabase();
      const fa = await db.getFirstAsync<{ bank_name: string; account_label: string | null; account_identifier: string }>(
        "SELECT bank_name, account_label, account_identifier FROM financial_accounts WHERE id = ?;",
        loan.financial_account_id,
      );
      setLoanType(loan.loan_type);
      setBankName(fa?.bank_name ?? "");
      // v17.6.0 — load the FA's account_identifier as the user-visible bank
      // account number. Hide the auto-generated "loan-<timestamp>" placeholder
      // (shows blank so the user can enter the real last-4).
      const fallbackIdRegex = /^loan-\d+$/;
      setAccountNumber(
        fa?.account_identifier && !fallbackIdRegex.test(fa.account_identifier)
          ? fa.account_identifier
          : "",
      );
      setAgreementId(loan.agreement_id ?? "");
      setCurrency(loan.currency);
      setPrincipalSanctioned(String(loan.principal_sanctioned));
      setPrincipalDisbursed(String(loan.principal_disbursed));
      setDisbursementDate(loan.disbursement_date);
      setEmiStartDate(loan.emi_start_date);
      setEmiDayOfMonth(String(loan.emi_day_of_month));
      setInterestRatePa(String(loan.interest_rate_pa));
      setInterestType(loan.interest_type);
      setTenureMonths(String(loan.tenure_months));
      setEmiAmount(String(Math.round(loan.emi_amount)));
      setProcessingFee(String(loan.processing_fee));
      setStampDuty(String(loan.stamp_duty));
      setInsurancePremium(String(loan.insurance_premium));
      setPrepayEarlyPct(String(loan.prepayment_charge_pct_early));
      setPrepayLatePct(String(loan.prepayment_charge_pct_late));
      setPrepayThresholdEmis(
        loan.prepayment_charge_threshold_emis !== null
          ? String(loan.prepayment_charge_threshold_emis)
          : "",
      );
      setForeclosureWaiverMonths(
        loan.foreclosure_waiver_months !== null
          ? String(loan.foreclosure_waiver_months)
          : "",
      );
      setForeclosureWaiverMinAmount(
        loan.foreclosure_waiver_min_amount !== null
          ? String(loan.foreclosure_waiver_min_amount)
          : "",
      );
      setGstPct(String(loan.gst_pct));
      setPenalRatePa(String(loan.penal_rate_pa));
      setPenalRateCapPa(String(loan.penal_rate_cap_pa));

      // Seed emisAlreadyPaid from current schedule paid count
      const schedule = await getSchedule(loan.id);
      const paid = schedule.filter(
        (e) => e.status === "paid" || e.status === "prepaid",
      ).length;
      setEmisAlreadyPaid(String(paid));
    })();
  }, [loanId]);

  const suggestedEMI = useMemo(() => {
    const p = parseFloat(principalDisbursed);
    const r = parseFloat(interestRatePa);
    const n = parseInt(tenureMonths, 10);
    if (!p || !r || !n) return 0;
    return computeEMI(p, r, n);
  }, [principalDisbursed, interestRatePa, tenureMonths]);

  const handleSave = useCallback(async () => {
    // Validation
    const errors: string[] = [];
    if (!bankName.trim()) errors.push("Bank name is required.");
    // v17.6.0 — require digit-only account number so SMS matching works.
    const acctDigits = accountNumber.replace(/\D/g, "");
    if (!acctDigits || acctDigits.length < 3) {
      errors.push("Bank account number is required (enter at least the last 3-6 digits as shown on SMS / NACH).");
    }
    const pS = parseFloat(principalSanctioned);
    const pD = parseFloat(principalDisbursed);
    if (!pS || pS <= 0) errors.push("Principal sanctioned must be positive.");
    if (!pD || pD <= 0) errors.push("Principal disbursed must be positive.");
    if (!disbursementDate) errors.push("Disbursement date is required.");
    if (!emiStartDate) errors.push("EMI start date is required.");
    const emiDay = parseInt(emiDayOfMonth, 10);
    if (!emiDay || emiDay < 1 || emiDay > 31) errors.push("EMI day must be 1–31.");
    const rate = parseFloat(interestRatePa);
    if (!rate || rate <= 0) errors.push("Interest rate is required.");
    const tenure = parseInt(tenureMonths, 10);
    if (!tenure || tenure <= 0) errors.push("Tenure months must be positive.");

    if (errors.length > 0) {
      alert("Fix these fields", errors.join("\n"));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        user_id: DEFAULT_USER_ID,
        bank_name: bankName.trim(),
        account_identifier: acctDigits, // v17.6.0 — last-N digits as shown on SMS/NACH
        agreement_id: agreementId.trim() || undefined,
        loan_type: loanType,
        currency,
        principal_sanctioned: pS,
        principal_disbursed: pD,
        disbursement_date: disbursementDate,
        emi_start_date: emiStartDate,
        emi_day_of_month: emiDay,
        interest_rate_pa: rate,
        interest_type: interestType,
        interest_method: "reducing" as const,
        tenure_months: tenure,
        emi_amount: parseFloat(emiAmount) || suggestedEMI,
        processing_fee: parseFloat(processingFee) || 0,
        stamp_duty: parseFloat(stampDuty) || 0,
        insurance_premium: parseFloat(insurancePremium) || 0,
        prepayment_charge_pct_early: parseFloat(prepayEarlyPct) || 0,
        prepayment_charge_pct_late: parseFloat(prepayLatePct) || 0,
        prepayment_charge_threshold_emis: prepayThresholdEmis
          ? parseInt(prepayThresholdEmis, 10)
          : undefined,
        foreclosure_waiver_months: foreclosureWaiverMonths
          ? parseInt(foreclosureWaiverMonths, 10)
          : undefined,
        foreclosure_waiver_min_amount: foreclosureWaiverMinAmount
          ? parseFloat(foreclosureWaiverMinAmount)
          : undefined,
        penal_rate_pa: parseFloat(penalRatePa) || 0,
        penal_rate_cap_pa: parseFloat(penalRateCapPa) || 0,
        gst_pct: parseFloat(gstPct) || 18,
      };

      let savedLoanId: string;
      if (isEdit && loanId) {
        await updateLoan(loanId, payload);
        savedLoanId = loanId;
      } else {
        savedLoanId = await createLoan(payload);
      }

      // v17.5.0 — apply backfill. updateLoan already preserved paid_count
      // from existing schedule; for edit, we still re-backfill to honor any
      // user-tweaked value. For add, this marks the first N installments paid.
      const backfill = parseInt(emisAlreadyPaid, 10);
      if (!isNaN(backfill) && backfill > 0) {
        await backfillPaidInstallments(savedLoanId, backfill);
      }

      router.replace({ pathname: "/loans/[id]", params: { id: savedLoanId } } as never);
    } catch (e) {
      alert(isEdit ? "Couldn't update loan" : "Couldn't save loan", formatError("Save loan", e));
      setSaving(false);
    }
  }, [
    isEdit, loanId,
    bankName, accountNumber, agreementId, loanType, currency,
    principalSanctioned, principalDisbursed, disbursementDate, emiStartDate, emiDayOfMonth,
    interestRatePa, interestType, tenureMonths, emiAmount, suggestedEMI,
    processingFee, stampDuty, insurancePremium,
    prepayEarlyPct, prepayLatePct, prepayThresholdEmis, foreclosureWaiverMonths, foreclosureWaiverMinAmount,
    penalRatePa, penalRateCapPa, gstPct, emisAlreadyPaid,
    router, alert,
  ]);

  return (
    <ScreenContainer padTop={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 48, paddingTop: 12, paddingHorizontal: 16 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* Basics */}
          <Card title="Basics" className="mb-4">
            <Pressable
              onPress={() => setShowLoanTypePicker(true)}
              className="mb-3 py-3 px-3 rounded-lg border border-border-light dark:border-border-dark"
              accessibilityRole="button"
              accessibilityLabel="Choose loan type"
            >
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                Loan Type
              </Text>
              <View className="flex-row items-center justify-between mt-1">
                <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
                  {LOAN_TYPES.find((t) => t.value === loanType)?.label ?? "Personal"}
                </Text>
                <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
              </View>
            </Pressable>
            <Input
              label="Bank / Lender"
              value={bankName}
              onChangeText={setBankName}
              placeholder="e.g. Axis Bank"
              containerClassName="mb-3"
            />
            <Input
              label="Bank account number (last 4-6 digits)"
              value={accountNumber}
              onChangeText={setAccountNumber}
              keyboardType="numeric"
              placeholder="e.g. 7249 (as shown on EMI SMS or NACH mandate)"
              containerClassName="mb-3"
            />
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary -mt-2 mb-3">
              Used to match bank EMI reminders to this loan. If Arth already auto-detected this loan from an SMS, typing the same digits will merge the two cards.
            </Text>
            <Input
              label="Agreement ID (optional)"
              value={agreementId}
              onChangeText={setAgreementId}
              placeholder="e.g. PPR000810877249"
              containerClassName="mb-3"
            />
            <Pressable
              onPress={() => setShowCurrencyPicker(!showCurrencyPicker)}
              className="mb-3 py-3 px-3 rounded-lg border border-border-light dark:border-border-dark"
            >
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                Currency
              </Text>
              <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary mt-1">
                {currency} — {CURRENCIES.find((c) => c.code === currency)?.displayName ?? "—"}
              </Text>
            </Pressable>
            {showCurrencyPicker && (
              <ScrollView style={{ maxHeight: 240 }} className="mb-3">
                {CURRENCIES.filter((c) => c.code !== "NONE").slice(0, 15).map((c) => (
                  <Pressable
                    key={c.code}
                    onPress={() => {
                      setCurrency(c.code);
                      setShowCurrencyPicker(false);
                    }}
                    className="py-2 px-3 rounded-lg"
                    style={{ backgroundColor: c.code === currency ? colors.surface : undefined }}
                  >
                    <Text className="text-sm text-text-primary dark:text-text-dark-primary">
                      {c.code} · {c.displayName}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </Card>

          {/* Amounts */}
          <Card title="Amounts" className="mb-4">
            <Input
              label="Amount approved"
              value={principalSanctioned}
              onChangeText={setPrincipalSanctioned}
              keyboardType="numeric"
              placeholder="e.g. 1015000"
              containerClassName="mb-3"
            />
            <Input
              label="Amount received"
              value={principalDisbursed}
              onChangeText={setPrincipalDisbursed}
              keyboardType="numeric"
              placeholder="e.g. 1015000"
              containerClassName="mb-3"
            />
            <Pressable
              onPress={() => setShowDisbursementPicker(true)}
              className="mb-3 py-3 px-3 rounded-lg border flex-row items-center"
              style={{ borderColor: colors.border }}
              accessibilityRole="button"
              accessibilityLabel="Pick disbursement date"
            >
              <View className="flex-1">
                <Text className="text-xs" style={{ color: colors.textSecondary }}>
                  Disbursement Date
                </Text>
                <Text
                  className="text-sm mt-1"
                  style={{ color: disbursementDate ? colors.text : colors.textSecondary }}
                >
                  {disbursementDate || "Tap to pick"}
                </Text>
              </View>
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => setShowEmiStartPicker(true)}
              className="mb-3 py-3 px-3 rounded-lg border flex-row items-center"
              style={{ borderColor: colors.border }}
              accessibilityRole="button"
              accessibilityLabel="Pick EMI start date"
            >
              <View className="flex-1">
                <Text className="text-xs" style={{ color: colors.textSecondary }}>
                  EMI Start Date
                </Text>
                <Text
                  className="text-sm mt-1"
                  style={{ color: emiStartDate ? colors.text : colors.textSecondary }}
                >
                  {emiStartDate || "Tap to pick"}
                </Text>
              </View>
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
            </Pressable>
            <Input
              label="EMI Day of Month (1-31)"
              value={emiDayOfMonth}
              onChangeText={setEmiDayOfMonth}
              keyboardType="numeric"
              placeholder="10"
              maxLength={2}
            />
          </Card>

          {/* Rate + Tenure */}
          <Card title="Rate & Tenure" className="mb-4">
            <Input
              label="Interest Rate % p.a."
              value={interestRatePa}
              onChangeText={setInterestRatePa}
              keyboardType="numeric"
              placeholder="11.49"
              containerClassName="mb-3"
            />
            <Toggle
              label="Interest Type"
              options={[
                { label: "Fixed", value: "fixed" },
                { label: "Floating", value: "floating" },
              ]}
              value={interestType}
              onChange={(v) => setInterestType(v as "fixed" | "floating")}
            />
            <Input
              label="Tenure (months)"
              value={tenureMonths}
              onChangeText={setTenureMonths}
              keyboardType="numeric"
              placeholder="60"
              containerClassName="mb-3"
            />
            <Input
              label="EMI Amount (optional)"
              value={emiAmount}
              onChangeText={setEmiAmount}
              keyboardType="numeric"
              placeholder={suggestedEMI > 0 ? String(Math.round(suggestedEMI)) : "auto"}
            />
            {suggestedEMI > 0 && (
              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-1">
                Computed EMI: {formatAmount(Math.round(suggestedEMI))}
              </Text>
            )}
          </Card>

          {/* v17.5.0 — Historical: how many EMIs already paid? */}
          <Card title="Already in progress?" className="mb-4">
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-3">
              If this loan isn't brand new, how many EMIs have you already paid? Arth will mark those installments as paid so the outstanding principal matches reality.
            </Text>
            <Input
              label="EMIs paid so far"
              value={emisAlreadyPaid}
              onChangeText={setEmisAlreadyPaid}
              keyboardType="numeric"
              placeholder="0"
            />
          </Card>

          {/* Fees */}
          <Card title="Fees (one-time)" className="mb-4">
            <Input
              label="Processing Fee"
              value={processingFee}
              onChangeText={setProcessingFee}
              keyboardType="numeric"
              placeholder="0"
              containerClassName="mb-3"
            />
            <Input
              label="Stamp Duty"
              value={stampDuty}
              onChangeText={setStampDuty}
              keyboardType="numeric"
              placeholder="0"
              containerClassName="mb-3"
            />
            <Input
              label="Insurance Premium"
              value={insurancePremium}
              onChangeText={setInsurancePremium}
              keyboardType="numeric"
              placeholder="0"
            />
          </Card>

          {/* Prepayment rules */}
          <Card title="Prepayment / Foreclosure Rules" className="mb-4">
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-3">
              Charges the bank takes when you pay extra ahead of schedule. From your loan's Key Fact Sheet. Nothing to do with missing an EMI — that's Penal Charges below. Leave 0 if not applicable.
            </Text>
            <Input
              label="Standard prepayment charge %"
              value={prepayLatePct}
              onChangeText={setPrepayLatePct}
              keyboardType="numeric"
              placeholder="e.g. 2"
              containerClassName="mb-3"
            />
            <Input
              label="Reduced rate % (near end of tenure)"
              value={prepayEarlyPct}
              onChangeText={setPrepayEarlyPct}
              keyboardType="numeric"
              placeholder="e.g. 0 — 0 means no reduction"
              containerClassName="mb-3"
            />
            <Input
              label="Use reduced rate when remaining EMIs ≤"
              value={prepayThresholdEmis}
              onChangeText={setPrepayThresholdEmis}
              keyboardType="numeric"
              placeholder="e.g. 36"
              containerClassName="mb-3"
            />
            <Input
              label="No charge after N months"
              value={foreclosureWaiverMonths}
              onChangeText={setForeclosureWaiverMonths}
              keyboardType="numeric"
              placeholder="e.g. 12 — no foreclosure fee after this many months"
              containerClassName="mb-3"
            />
            <Input
              label="No charge if loan ≥ amount"
              value={foreclosureWaiverMinAmount}
              onChangeText={setForeclosureWaiverMinAmount}
              keyboardType="numeric"
              placeholder="e.g. 1000000 — big loans skip the fee"
              containerClassName="mb-3"
            />
            <Input
              label="GST %"
              value={gstPct}
              onChangeText={setGstPct}
              keyboardType="numeric"
              placeholder="18"
            />
          </Card>

          {/* Penal */}
          <Card title="Late-payment charges" className="mb-4">
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-3">
              What the bank charges if you miss an EMI. Different from prepayment charges above.
            </Text>
            <Input
              label="Late fee rate % per year"
              value={penalRatePa}
              onChangeText={setPenalRatePa}
              keyboardType="numeric"
              placeholder="e.g. 8"
              containerClassName="mb-3"
            />
            <Input
              label="Maximum late fee % per year"
              value={penalRateCapPa}
              onChangeText={setPenalRateCapPa}
              keyboardType="numeric"
              placeholder="e.g. 24 — caps the compounding"
            />
          </Card>

          <Button
            title={saving ? (isEdit ? "Updating…" : "Saving…") : (isEdit ? "Update Loan" : "Save Loan")}
            onPress={handleSave}
            loading={saving}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* v17.4.0 — Loan type picker modal */}
      <Modal
        visible={showLoanTypePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLoanTypePicker(false)}
      >
        <Pressable
          className="flex-1 bg-black/40"
          onPress={() => setShowLoanTypePicker(false)}
        >
          <View className="flex-1 justify-center px-8">
            <Pressable>
              <View
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: 16,
                  padding: 16,
                }}
              >
                <Text
                  className="text-base font-bold mb-3"
                  style={{ color: colors.text }}
                >
                  Loan Type
                </Text>
                {LOAN_TYPES.map((t) => (
                  <Pressable
                    key={t.value}
                    onPress={() => {
                      setLoanType(t.value);
                      setShowLoanTypePicker(false);
                    }}
                    className="py-3 flex-row items-center"
                  >
                    <View style={{ width: 24, marginRight: 12 }}>
                      {loanType === t.value && (
                        <Ionicons name="checkmark" size={20} color={colors.tint} />
                      )}
                    </View>
                    <Text
                      className="text-sm"
                      style={{
                        color: loanType === t.value ? colors.tint : colors.text,
                        fontWeight: loanType === t.value ? "600" : "400",
                      }}
                    >
                      {t.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* v17.4.0 — Date pickers */}
      <CalendarModal
        visible={showDisbursementPicker}
        onClose={() => setShowDisbursementPicker(false)}
        value={disbursementDate || new Date().toISOString().split("T")[0]}
        onChange={(d) => {
          setDisbursementDate(d);
          setShowDisbursementPicker(false);
          // If EMI start is empty or earlier than disbursement, auto-set
          if (!emiStartDate || emiStartDate < d) {
            setEmiStartDate(d);
          }
        }}
        maximumDate={null}
      />
      <CalendarModal
        visible={showEmiStartPicker}
        onClose={() => setShowEmiStartPicker(false)}
        value={
          emiStartDate ||
          disbursementDate ||
          new Date().toISOString().split("T")[0]
        }
        onChange={(d) => {
          setEmiStartDate(d);
          setShowEmiStartPicker(false);
          const day = parseInt(d.split("-")[2], 10);
          if (day >= 1 && day <= 31) setEmiDayOfMonth(String(day));
        }}
        minimumDate={
          disbursementDate ? new Date(disbursementDate + "T00:00:00") : undefined
        }
        maximumDate={null}
      />
    </ScreenContainer>
  );
}
