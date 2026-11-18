import { useState, useCallback, useMemo } from "react";
import { ChoiceField } from "@/components/ui/ChoiceField";
import { View, ScrollView, KeyboardAvoidingView, Pressable, Platform } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { useAlert } from "@/hooks/use-alert";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Chip, ChipWrap, Input, RadioRow, ScreenContainer, Segmented, Text } from "@/components/ui";
import { FoldGroup, FormFooter, FormGroup } from "@/components/ui/FormParts";
import { useTheme } from "@/hooks/use-theme";
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
import { todayIso } from "@/utils/local-date";

const LOAN_TYPES: { label: string; value: LoanType }[] = [
  { label: "Personal", value: "personal" },
  { label: "Home", value: "home" },
  { label: "Car", value: "auto" },
  { label: "Education", value: "education" },
  { label: "Business", value: "business" },
  { label: "Gold", value: "gold" },
  { label: "Against FD", value: "against_fd" },
  { label: "Other", value: "other" },
];

const LOAN_TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  personal: "person-outline",
  home: "home-outline",
  auto: "car-outline",
  education: "school-outline",
  business: "briefcase-outline",
  gold: "diamond-outline",
  against_fd: "lock-closed-outline",
  other: "document-text-outline",
};

export default function AddLoanScreen() {
  const router = useRouter();
  const alert = useAlert();
  const theme = useTheme();
  const headerHeight = useHeaderHeight();
  const { loanId } = useLocalSearchParams<{ loanId?: string }>();
  const isEdit = !!loanId;

  // Core fields
  const [loanType, setLoanType] = useState<LoanType>("personal");
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

      router.replace({ pathname: "/loans/[id]", params: { id: savedLoanId } });
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

  const unit = currency === "INR" ? "₹" : undefined;
  const feesFilled = [processingFee, stampDuty, insurancePremium].filter((v) => parseFloat(v) > 0).length;
  const prepayFilled = [prepayLatePct, prepayEarlyPct, prepayThresholdEmis, foreclosureWaiverMonths, foreclosureWaiverMinAmount].filter(
    (v) => parseFloat(v) > 0,
  ).length;
  const penalFilled = [penalRatePa, penalRateCapPa].filter((v) => parseFloat(v) > 0).length;
  const paidSoFar = parseInt(emisAlreadyPaid, 10) || 0;
  const dateRow = (label: string, value: string, onPress: () => void, a11y: string) => (
    <View>
      <Text className="text-label font-semibold text-muted-foreground mb-1.5">{label}</Text>
      <Pressable
        onPress={onPress}
        className="flex-row items-center rounded-control border border-border bg-card px-3"
        style={{ height: 48 }}
        accessibilityRole="button"
        accessibilityLabel={a11y}
      >
        <Text className={`flex-1 text-body ${value ? "text-foreground" : "text-faint-foreground"}`}>{value || "Tap to pick"}</Text>
        <Ionicons name="calendar-outline" size={16} color={theme.mutedForeground} />
      </Pressable>
    </View>
  );

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen options={{ title: isEdit ? "Edit loan" : "Add loan" }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 24, paddingTop: 12, paddingHorizontal: 16, gap: 12 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Basics */}
          <FormGroup icon="business-outline" title="Basics" hint="Who lent it and what for">
            <ChoiceField
              label="Loan type"
              value={loanType}
              options={LOAN_TYPES.map((t) => ({ value: t.value, label: t.label, icon: LOAN_TYPE_ICONS[t.value] ?? "document-text-outline" }))}
              onChange={setLoanType}
              color={theme.warning}
              searchPlaceholder="Search loan types"
            />
            <Input label="Bank or lender" value={bankName} onChangeText={setBankName} placeholder="e.g. Axis Bank" />
            <View>
              <Input
                label="Loan account number, last 4–6 digits"
                value={accountNumber}
                onChangeText={setAccountNumber}
                keyboardType="numeric"
                placeholder="e.g. 7249"
              />
              <Text className="text-label text-muted-foreground mt-1.5">
                As shown on the EMI message or NACH mandate. Used to match bank EMI reminders to this loan; if Arth already found
                this loan from a message, the same digits merge the two.
              </Text>
            </View>
          </FormGroup>

          {/* Amount, rate and tenure */}
          <FormGroup icon="calculator-outline" title="Amount, rate and tenure" hint="EMI is worked out for you">
            <View className="flex-row" style={{ gap: 10 }}>
              <Input
                label="Approved"
                prefix={unit}
                value={principalSanctioned}
                onChangeText={setPrincipalSanctioned}
                keyboardType="numeric"
                formula
                placeholder="1015000"
                containerClassName="flex-1"
              />
              <Input
                label="Received"
                prefix={unit}
                value={principalDisbursed}
                onChangeText={setPrincipalDisbursed}
                keyboardType="numeric"
                formula
                placeholder="1015000"
                containerClassName="flex-1"
              />
            </View>
            <View className="flex-row" style={{ gap: 10 }}>
              <Input
                label="Interest rate, a year"
                suffix="%"
                value={interestRatePa}
                onChangeText={setInterestRatePa}
                keyboardType="numeric"
                placeholder="11.49"
                containerClassName="flex-1"
              />
              <Input
                label="Tenure, in months"
                suffix="mo"
                value={tenureMonths}
                onChangeText={setTenureMonths}
                keyboardType="numeric"
                placeholder="60"
                containerClassName="flex-1"
              />
            </View>
            <Segmented<"fixed" | "floating">
              options={[
                { value: "fixed", label: "Fixed rate" },
                { value: "floating", label: "Floating rate" },
              ]}
              value={interestType}
              onChange={setInterestType}
            />
            <View className="flex-row" style={{ gap: 10 }}>
              <View className="flex-1">
                {dateRow("Disbursement date", disbursementDate, () => setShowDisbursementPicker(true), "Pick disbursement date")}
              </View>
              <View className="flex-1">{dateRow("EMI start date", emiStartDate, () => setShowEmiStartPicker(true), "Pick EMI start date")}</View>
            </View>
            <View className="flex-row" style={{ gap: 10 }}>
              <Input
                label="EMI day of the month"
                value={emiDayOfMonth}
                onChangeText={setEmiDayOfMonth}
                keyboardType="numeric"
                placeholder="10"
                maxLength={2}
                containerClassName="flex-1"
              />
              <Input
                label="EMI amount (optional)"
                prefix={unit}
                value={emiAmount}
                onChangeText={setEmiAmount}
                keyboardType="numeric"
                formula
                placeholder={suggestedEMI > 0 ? String(Math.round(suggestedEMI)) : "auto"}
                containerClassName="flex-1"
              />
            </View>
            {suggestedEMI > 0 && (
              <View className="flex-row items-center justify-between rounded-control px-3 py-2.5" style={{ backgroundColor: theme.alpha("primary", 0.08) }}>
                <Text className="text-meta text-muted-foreground">EMI on the {ordinal(parseInt(emiDayOfMonth, 10) || 1)}, worked out</Text>
                <Text className="text-body font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                  {formatAmount(Math.round(suggestedEMI))}
                </Text>
              </View>
            )}
          </FormGroup>

          <FoldGroup
            title="Already paying it?"
            sub={paidSoFar > 0 ? `${paidSoFar} EMIs paid so far` : "Optional · EMIs paid so far"}
            icon="time-outline"
            defaultOpen={isEdit && paidSoFar > 0}
          >
            <Text className="text-meta text-muted-foreground">
              If this loan isn&apos;t brand new, Arth marks the EMIs you&apos;ve already paid so the amount left matches reality.
            </Text>
            <Input label="EMIs paid so far" value={emisAlreadyPaid} onChangeText={setEmisAlreadyPaid} keyboardType="numeric" placeholder="0" />
          </FoldGroup>

          <FoldGroup
            title="One-time fees"
            sub={feesFilled > 0 ? `${feesFilled} of 3 filled` : "Optional · processing, stamp duty, insurance"}
            icon="receipt-outline"
          >
            <Input label="Processing fee" prefix={unit} value={processingFee} onChangeText={setProcessingFee} keyboardType="numeric" formula placeholder="0" />
            <Input label="Stamp duty" prefix={unit} value={stampDuty} onChangeText={setStampDuty} keyboardType="numeric" formula placeholder="0" />
            <Input
              label="Insurance premium"
              prefix={unit}
              value={insurancePremium}
              onChangeText={setInsurancePremium}
              keyboardType="numeric"
              formula
              placeholder="0"
            />
          </FoldGroup>

          <FoldGroup
            title="Prepayment rules"
            sub={prepayFilled > 0 ? `${prepayFilled} set · GST ${gstPct || 0}%` : "Optional · charges and when they stop"}
            icon="arrow-up-outline"
          >
            <Text className="text-meta text-muted-foreground">
              What the bank charges when you pay extra ahead of schedule, from your loan&apos;s Key Fact Sheet. Not for a missed EMI
              (that&apos;s late-payment charges). Leave 0 if it doesn&apos;t apply.
            </Text>
            <Input label="Standard prepayment charge" suffix="%" value={prepayLatePct} onChangeText={setPrepayLatePct} keyboardType="numeric" placeholder="2" />
            <Input
              label="Reduced charge near the end of the tenure"
              suffix="%"
              value={prepayEarlyPct}
              onChangeText={setPrepayEarlyPct}
              keyboardType="numeric"
              placeholder="0 means no reduction"
            />
            <Input
              label="Use the reduced charge when EMIs left are at most"
              value={prepayThresholdEmis}
              onChangeText={setPrepayThresholdEmis}
              keyboardType="numeric"
              placeholder="36"
            />
            <Input
              label="No charge after this many months"
              suffix="mo"
              value={foreclosureWaiverMonths}
              onChangeText={setForeclosureWaiverMonths}
              keyboardType="numeric"
              placeholder="12"
            />
            <Input
              label="No charge if the loan is at least"
              prefix={unit}
              value={foreclosureWaiverMinAmount}
              onChangeText={setForeclosureWaiverMinAmount}
              keyboardType="numeric"
              formula
              placeholder="1000000"
            />
            <Input label="GST on charges" suffix="%" value={gstPct} onChangeText={setGstPct} keyboardType="numeric" placeholder="18" />
          </FoldGroup>

          <FoldGroup
            title="Late-payment charges"
            sub={penalFilled > 0 ? `${penalRatePa}% a year, at most ${penalRateCapPa}%` : "Optional · 2 fields"}
            icon="warning-outline"
          >
            <Text className="text-meta text-muted-foreground">
              What the bank charges if you miss an EMI. Different from prepayment charges.
            </Text>
            <Input label="Late fee rate, a year" suffix="%" value={penalRatePa} onChangeText={setPenalRatePa} keyboardType="numeric" placeholder="8" />
            <Input
              label="Highest late fee rate, a year"
              suffix="%"
              value={penalRateCapPa}
              onChangeText={setPenalRateCapPa}
              keyboardType="numeric"
              placeholder="24"
            />
          </FoldGroup>

          <FoldGroup
            title="Agreement and currency"
            sub={`Optional · ${agreementId.trim() ? `agreement ${agreementId.trim()}` : "agreement ID"} · ${currency}`}
            icon="document-text-outline"
          >
            <Input label="Agreement ID" value={agreementId} onChangeText={setAgreementId} placeholder="e.g. PPR000810877249" />
            <View>
              <Text className="text-label font-semibold text-muted-foreground mb-1.5">Currency</Text>
              <Pressable
                onPress={() => setShowCurrencyPicker(!showCurrencyPicker)}
                className="flex-row items-center rounded-control border border-border bg-card px-3"
                style={{ height: 48 }}
                accessibilityRole="button"
                accessibilityLabel="Choose currency"
              >
                <Text className="flex-1 text-body text-foreground" numberOfLines={1}>
                  {currency} · {CURRENCIES.find((c) => c.code === currency)?.displayName ?? "-"}
                </Text>
                <Ionicons name={showCurrencyPicker ? "chevron-up" : "chevron-down"} size={16} color={theme.mutedForeground} />
              </Pressable>
              {showCurrencyPicker && (
                <ScrollView style={{ maxHeight: 240 }} className="mt-2" nestedScrollEnabled>
                  {CURRENCIES.filter((c) => c.code !== "NONE")
                    .slice(0, 15)
                    .map((c) => (
                      <RadioRow
                        key={c.code}
                        label={`${c.code} · ${c.displayName}`}
                        on={c.code === currency}
                        onPress={() => {
                          setCurrency(c.code);
                          setShowCurrencyPicker(false);
                        }}
                      />
                    ))}
                </ScrollView>
              )}
            </View>
          </FoldGroup>
        </ScrollView>

        <FormFooter
          primary={saving ? (isEdit ? "Saving…" : "Saving…") : isEdit ? "Save changes" : "Save loan"}
          onPrimary={handleSave}
          onCancel={() => router.back()}
          disabled={saving}
        />
      </KeyboardAvoidingView>

      {/* Date pickers */}
      <CalendarModal
        visible={showDisbursementPicker}
        onClose={() => setShowDisbursementPicker(false)}
        value={disbursementDate || todayIso()}
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
        value={emiStartDate || disbursementDate || todayIso()}
        onChange={(d) => {
          setEmiStartDate(d);
          setShowEmiStartPicker(false);
          const day = parseInt(d.split("-")[2], 10);
          if (day >= 1 && day <= 31) setEmiDayOfMonth(String(day));
        }}
        minimumDate={disbursementDate ? new Date(disbursementDate + "T00:00:00") : undefined}
        maximumDate={null}
      />
    </ScreenContainer>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
