import { useState, useCallback, useEffect, useMemo } from "react";
import { View, Pressable,  ScrollView,  Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { Input, Sheet, Text } from "@/components/ui";

import { formatAmount } from "@/utils/format";
import {
  listActiveLoans,
  getSchedule,
  getPrepayments,
  loanToParams,
  loanToTerms,
  type LoanAccount,
  type LoanScheduleEntry,
  type LoanPrepaymentRow,
} from "@/services/loan-accounts";
import { computePrepaymentImpact } from "@/services/loan-engine";
import { DEFAULT_USER_ID } from "@/constants/app";
import { formatDate } from "@/utils/date";
import { getDatabase } from "@/database";
import { useTheme } from "@/hooks/use-theme";

/**
 * LoanPaymentPickerSheet — picker for linking an expense to a loan.
 *   Step 1: pick a loan
 *   Step 2a: if EMI, pick the installment
 *   Step 2b: if prepayment, pick strategy
 *   Step 3:  if prepayment, confirm kind (part payment vs foreclosure) and
 *            review the auto-computed charge + GST from the loan's configured
 *            rates (v17.5.13 — previously asked for manual charge entry,
 *            which defeated the whole point of storing the rates on the loan).
 *            The preview card mirrors the standalone PrepaymentSheet so the
 *            user sees exactly what they're agreeing to.
 */

type Step =
  | "loan"
  | "emi_installment"
  | "prepayment_strategy"
  | "prepayment_details";

type PrepaymentKind = "part_payment" | "foreclosure";

interface Props {
  visible: boolean;
  expenseAmount: number;
  expenseDate: string;
  onSubmit: (payload: {
    loan_account_id: string;
    kind: "emi" | "prepayment";
    schedule_entry_id?: string;
    strategy?: "reduce_tenure" | "reduce_emi";
    prepayment_kind?: PrepaymentKind;
    prepayment_charge?: number;
    gst_on_charge?: number;
  }) => void;
  onClose: () => void;
}

export function LoanPaymentPickerSheet({
  visible,
  expenseAmount,
  expenseDate,
  onSubmit,
  onClose,
}: Props) {
  const { colors, colorScheme } = useColorScheme();
  const theme = useTheme();

  const [step, setStep] = useState<Step>("loan");
  const [loans, setLoans] = useState<Array<LoanAccount & { bank_name: string }>>([]);
  const [selectedLoan, setSelectedLoan] = useState<LoanAccount | null>(null);
  const [chosenKind, setChosenKind] = useState<"emi" | "prepayment">("emi");
  const [schedule, setSchedule] = useState<LoanScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // v17.5.11 — payment-details step state (prepayment path only)
  const [chosenStrategy, setChosenStrategy] = useState<
    "reduce_tenure" | "reduce_emi"
  >("reduce_tenure");
  const [prepaymentKind, setPrepaymentKind] =
    useState<PrepaymentKind>("part_payment");
  // v17.5.13 — existing prepayments are needed by computePrepaymentImpact so
  // the preview includes prior prepayments' effect on outstanding principal.
  const [existingPrepayments, setExistingPrepayments] = useState<
    LoanPrepaymentRow[]
  >([]);
  // v17.5.15 — optional manual override for charge + GST on the expense →
  // loan flow. Auto-computed by default; expand to type bank-actual values.
  const [overrideExpanded, setOverrideExpanded] = useState(false);
  const [chargeOverride, setChargeOverride] = useState("");
  const [gstOverride, setGstOverride] = useState("");

  /**
   * v17.5.12 — current (live) EMI for the selected loan.
   * `loan.emi_amount` is the immutable sanctioned-at-disbursement value; if
   * a prior `reduce_emi` prepayment lowered the tail EMI, comparing against
   * the sanctioned number causes the trivial-path gate to misfire
   * (an expense that EQUALS the current EMI would still register as <
   * sanctioned EMI and skip the strategy step). Resolve the real EMI from
   * the loaded schedule instead — prefer the next scheduled installment,
   * else the most recent one, else fall back to the sanctioned value.
   */
  const currentEmi = (() => {
    if (!selectedLoan) return 0;
    const upcoming = schedule.find(
      (s) =>
        (s.status === "scheduled" || s.status === "overdue") &&
        s.due_date >= expenseDate,
    );
    if (upcoming) return upcoming.emi_amount;
    const prior = [...schedule]
      .filter((s) => s.due_date <= expenseDate)
      .pop();
    return prior?.emi_amount ?? selectedLoan.emi_amount;
  })();

  useEffect(() => {
    if (!visible) return;

    setStep("loan");
    setSelectedLoan(null);
    setChosenKind("emi");
    setSchedule([]);
    setChosenStrategy("reduce_tenure");
    setPrepaymentKind("part_payment");
    setExistingPrepayments([]);
    setOverrideExpanded(false);
    setChargeOverride("");
    setGstOverride("");
    (async () => {
      setLoading(true);
      try {
        const db = getDatabase();
        const active = await listActiveLoans(DEFAULT_USER_ID);
        const enriched = await Promise.all(
          active.map(async (l) => {
            const fa = await db.getFirstAsync<{ bank_name: string }>(
              "SELECT bank_name FROM financial_accounts WHERE id = ?;",
              l.financial_account_id,
            );
            return { ...l, bank_name: fa?.bank_name ?? "Loan" };
          }),
        );
        setLoans(enriched);
      } catch {
        setLoans([]);
      }
      setLoading(false);
    })();
  }, [visible]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);



  const handlePickLoan = useCallback(
    async (loan: LoanAccount) => {
      setSelectedLoan(loan);
      // Pick kind next — if there's a close-matching scheduled EMI, default to EMI
      const [rows, prepays] = await Promise.all([
        getSchedule(loan.id),
        getPrepayments(loan.id),
      ]);
      setSchedule(rows);
      setExistingPrepayments(prepays);
      // Decide flow: if any scheduled installment is near the date, default EMI. Else prepayment.
      const eligible = rows.filter((s) => s.status === "scheduled" || s.status === "overdue");
      if (eligible.length > 0) {
        setStep("emi_installment");
      } else {
        setChosenKind("prepayment");
        setStep("prepayment_strategy");
      }
    },
    [],
  );

  /**
   * v17.5.7 — trivial-path strategy short-circuit.
   * Mirrors the engine gate: when the prepayment amount is strictly less
   * than one EMI, the engine takes the "reduce principal only" path
   * regardless of the user's strategy pick. Skip the strategy step — but
   * v17.5.11: STILL show the payment-details step so the user can record
   * the prepayment kind + charges. Defaults strategy to reduce_tenure
   * (engine ignores it on the trivial path).
   */
  useEffect(() => {
    if (
      step === "prepayment_strategy" &&
      selectedLoan &&
      expenseAmount > 0 &&
      currentEmi > 0 &&
      expenseAmount < currentEmi
    ) {
      setChosenStrategy("reduce_tenure");
      setStep("prepayment_details");
    }
  }, [step, selectedLoan, expenseAmount, currentEmi]);

  const handlePickKind = (kind: "emi" | "prepayment") => {
    setChosenKind(kind);
    if (kind === "emi") setStep("emi_installment");
    else setStep("prepayment_strategy");
  };

  const handlePickInstallment = (scheduleEntryId: string) => {
    if (!selectedLoan) return;
    onSubmit({
        loan_account_id: selectedLoan.id,
        kind: "emi",
        schedule_entry_id: scheduleEntryId,
      });
  };

  const handlePickStrategy = (strategy: "reduce_tenure" | "reduce_emi") => {
    if (!selectedLoan) return;
    setChosenStrategy(strategy);
    setStep("prepayment_details");
  };

  /**
   * v17.5.13 — compute the prepayment impact (charge, GST, net applied,
   * interest saved, months saved / new EMI) from the loan's configured
   * rates via the engine. Mirrors the preview PrepaymentSheet shows on the
   * loan detail screen so the expense→loan path has the same transparency.
   */
  const impact = useMemo(() => {
    if (!selectedLoan || expenseAmount <= 0 || schedule.length === 0) return null;
    try {
      return computePrepaymentImpact(
        { ...loanToParams(selectedLoan), ...loanToTerms(selectedLoan) },
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
        existingPrepayments.map((p) => ({
          prepayment_date: p.prepayment_date,
          amount: p.amount,
          prepayment_charge: p.prepayment_charge,
          gst_on_charge: p.gst_on_charge,
          kind: p.kind,
          strategy: p.strategy ?? undefined,
        })),
        expenseAmount,
        expenseDate,
        chosenStrategy,
      );
    } catch {
      return null;
    }
  }, [
    selectedLoan,
    schedule,
    existingPrepayments,
    expenseAmount,
    expenseDate,
    chosenStrategy,
  ]);

  const handleSubmitPrepaymentDetails = useCallback(() => {
    if (!selectedLoan) return;
    // v17.5.13 — charge + GST auto-derived from the loan's configured rate
    // (prepayment_charge_pct_early/late + threshold + gst_pct). Replaces
    // the manual text inputs that asked the user to type these in.
    // v17.5.15 — optional user override. When the panel is expanded and
    // valid numeric values are entered, the user's figures win over the
    // auto-computed impact. Blank/invalid → fall back to impact.
    const autoCharge = impact?.charge ?? 0;
    const autoGst = impact?.gst ?? 0;
    const chargeTrim = chargeOverride.trim();
    const gstTrim = gstOverride.trim();
    const chargeNum = chargeTrim === "" ? NaN : parseFloat(chargeTrim);
    const gstNum = gstTrim === "" ? NaN : parseFloat(gstTrim);
    const charge =
      overrideExpanded && Number.isFinite(chargeNum) && chargeNum >= 0
        ? chargeNum
        : autoCharge;
    const gst =
      overrideExpanded && Number.isFinite(gstNum) && gstNum >= 0
        ? gstNum
        : autoGst;
    onSubmit({
        loan_account_id: selectedLoan.id,
        kind: "prepayment",
        strategy: chosenStrategy,
        prepayment_kind: prepaymentKind,
        prepayment_charge: charge < 0 ? 0 : charge,
        gst_on_charge: gst < 0 ? 0 : gst,
      });
  }, [
    selectedLoan,
    onSubmit,
    chosenStrategy,
    prepaymentKind,
    overrideExpanded,
    chargeOverride,
    gstOverride,
    impact,
  ]);

  if (!visible) return null;

  const eligibleInstallments = schedule
    .filter((s) => s.status === "scheduled" || s.status === "overdue")
    .filter((s) => {
      const daysDiff = Math.abs(
        (new Date(s.due_date).getTime() - new Date(expenseDate).getTime()) /
          86400000,
      );
      return daysDiff <= 35;
    })
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  return (
    <Sheet visible={visible} onClose={handleClose}>
      <View className="px-5 pb-3">
        <View className="flex-row items-center">
          {step !== "loan" && (
            <Pressable
              onPress={() => {
                if (step === "prepayment_details") {
                  // If this loan took the trivial-path skip, go back to
                  // the earlier step — else the strategy picker. Uses the
                  // live currentEmi (not the sanctioned emi_amount) to
                  // stay consistent with the forward-direction gate.
                  if (
                    selectedLoan &&
                    expenseAmount > 0 &&
                    currentEmi > 0 &&
                    expenseAmount < currentEmi
                  ) {
                    if (eligibleInstallments.length > 0) setStep("emi_installment");
                    else setStep("loan");
                  } else {
                    setStep("prepayment_strategy");
                  }
                } else if (step === "prepayment_strategy" && eligibleInstallments.length > 0) {
                  setStep("emi_installment");
                } else {
                  setStep("loan");
                  setSelectedLoan(null);
                }
              }}
              className="mr-2"
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Ionicons name="chevron-back" size={20} color={colors.text} />
            </Pressable>
          )}
          <Text className="text-base font-bold flex-1" style={{ color: colors.text }}>
            {step === "loan"
              ? "Mark as Loan Payment"
              : step === "emi_installment"
                ? selectedLoan
                  ? `${selectedLoan.agreement_id ?? "Loan"} - pick installment`
                  : "Pick installment"
                : step === "prepayment_strategy"
                  ? "Prepayment strategy"
                  : "Payment details"}
          </Text>
        </View>
        <Text className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>
          {formatAmount(expenseAmount)} on {formatDate(expenseDate)}
        </Text>
      </View>

      <ScrollView
        className="px-5"
        contentContainerStyle={{ paddingBottom: 8 }}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical={false}
        scrollEnabled={
          step === "loan" ? loans.length > 3 :
          step === "emi_installment" ? eligibleInstallments.length > 5 :
          step === "prepayment_strategy" ? false :
          true
        }
      >
        {loading && (
          <View className="px-5 py-8 items-center">
            <Text className="text-sm" style={{ color: colors.textSecondary }}>
              Loading…
            </Text>
          </View>
        )}

        {/* STEP 1 — pick loan */}
        {step === "loan" && !loading && (
          <>
            {loans.length === 0 ? (
              <View className="px-5 py-8 items-center">
                <Ionicons name="cash-outline" size={40} color={colors.textSecondary} />
                <Text
                  className="text-sm mt-3 text-center"
                  style={{ color: colors.textSecondary }}
                >
                  No active loans yet. Add one from Goals → Loans.
                </Text>
              </View>
            ) : (
              loans.map((l) => (
                <Pressable
                  key={l.id}
                  onPress={() => handlePickLoan(l)}
                  className="flex-row items-center py-3 px-4 rounded-xl mb-2"
                  style={{
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${l.bank_name} loan`}
                >
                  <View
                    className="w-9 h-9 rounded-full items-center justify-center mr-3"
                    style={{ backgroundColor: theme.alpha("primary", 0.08) }}
                  >
                    <Ionicons
                      name="cash-outline"
                      size={18}
                      color={theme.primary}
                    />
                  </View>
                  <View className="flex-1">
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: colors.text }}
                    >
                      {l.bank_name} · {l.loan_type}
                    </Text>
                    <Text
                      className="text-xs mt-0.5"
                      style={{ color: colors.textSecondary }}
                    >
                      EMI {formatAmount(l.emi_amount)} · {l.tenure_months}mo @ {l.interest_rate_pa}%
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>
              ))
            )}
          </>
        )}

        {/* STEP 2a — pick installment (EMI) */}
        {step === "emi_installment" && !loading && (
          <>
            {eligibleInstallments.length === 0 ? (
              <>
                <Text
                  className="text-sm mb-3"
                  style={{ color: colors.textSecondary }}
                >
                  No scheduled installments near this date. You can record this as a prepayment instead.
                </Text>
                <Pressable
                  onPress={() => handlePickKind("prepayment")}
                  className="flex-row items-center py-3 px-4 rounded-xl mb-2"
                  style={{
                    backgroundColor: theme.alpha("primary", 0.08),
                    borderWidth: 1,
                    borderColor: theme.alpha("primary", 0.25),
                  }}
                >
                  <Ionicons
                    name="trending-down-outline"
                    size={18}
                    color={theme.primary}
                  />
                  <Text
                    className="text-sm font-semibold ml-3 flex-1"
                    style={{ color: theme.primary }}
                  >
                    Record as prepayment
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  onPress={() => handlePickKind("prepayment")}
                  className="flex-row items-center py-3 px-4 rounded-xl mb-3"
                  style={{
                    backgroundColor: theme.alpha("primary", 0.05),
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Ionicons
                    name="trending-down-outline"
                    size={18}
                    color={theme.primary}
                  />
                  <View className="flex-1 ml-3">
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: colors.text }}
                    >
                      This is a prepayment, not an EMI
                    </Text>
                    <Text
                      className="text-xs mt-0.5"
                      style={{ color: colors.textSecondary }}
                    >
                      Over-and-above the schedule
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </Pressable>

                <Text
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: colors.textSecondary }}
                >
                  Scheduled installments
                </Text>
                {eligibleInstallments.map((s) => (
                  <Pressable
                    key={s.id}
                    onPress={() => handlePickInstallment(s.id)}
                    className="flex-row items-center py-3 px-4 rounded-xl mb-2"
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <View className="flex-1">
                      <Text
                        className="text-sm font-semibold"
                        style={{ color: colors.text }}
                      >
                        #{s.installment_num} · Due {formatDate(s.due_date)}
                      </Text>
                      <Text
                        className="text-xs mt-0.5"
                        style={{ color: colors.textSecondary }}
                      >
                        EMI {formatAmount(s.emi_amount)}
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                ))}
              </>
            )}
          </>
        )}

        {/* STEP 2b — pick prepayment strategy (design-system aligned: circle
            icon + title + sublabel + chevron, matches loan detail ActionTile) */}
        {step === "prepayment_strategy" && !loading && (
          <>
            <Text
              className="text-sm mb-3"
              style={{ color: colors.textSecondary }}
            >
              How should we apply this prepayment of {formatAmount(expenseAmount)}?
            </Text>
            <StrategyTile
              icon="calendar-clear-outline"
              label="Reduce tenure"
              sublabel="Keep EMI same. Loan ends earlier. Saves the most interest."
              recommended
              onPress={() => handlePickStrategy("reduce_tenure")}
              colors={colors}
              colorScheme={colorScheme}
            />
            <StrategyTile
              icon="trending-down-outline"
              label="Reduce EMI"
              sublabel="Keep remaining months same. Lower EMI going forward."
              onPress={() => handlePickStrategy("reduce_emi")}
              colors={colors}
              colorScheme={colorScheme}
            />
          </>
        )}

        {/* STEP 3 — prepayment payment details: kind + auto-derived charge (v17.5.13).
            Was: two manual text inputs asking the user to type the charge + GST.
            Now: auto-computed from the loan's configured prepayment_charge_pct_early/late
            + threshold_emis + gst_pct via computePrepaymentImpact. Preview card mirrors
            the standalone PrepaymentSheet for consistency. */}
        {step === "prepayment_details" && !loading && (
          <>
            <Text
              className="text-sm mb-3"
              style={{ color: colors.textSecondary }}
            >
              Review this prepayment of {formatAmount(expenseAmount)} before saving.
            </Text>

            {/* Kind toggle */}
            <Text
              className="text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: colors.textSecondary }}
            >
              Type
            </Text>
            <View className="flex-row mb-4">
              <KindChip
                label="Part payment"
                selected={prepaymentKind === "part_payment"}
                onPress={() => setPrepaymentKind("part_payment")}
                colors={colors}
                colorScheme={colorScheme}
              />
              <KindChip
                label="Foreclosure"
                selected={prepaymentKind === "foreclosure"}
                onPress={() => setPrepaymentKind("foreclosure")}
                colors={colors}
                colorScheme={colorScheme}
              />
            </View>

            {/* Preview — mirrors the PrepaymentSheet preview. Values are
                computed from the loan's configured charge rate + GST. */}
            {impact && (
              <View
                className="p-3 rounded-xl mb-3"
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text
                  className="text-xs font-semibold uppercase tracking-wider mb-2"
                  style={{ color: colors.textSecondary }}
                >
                  Preview
                </Text>
                <PreviewRow
                  label="Prepayment"
                  value={formatAmount(expenseAmount)}
                  colors={colors}
                />
                <PreviewRow
                  label="Charge"
                  value={impact.charge > 0 ? `− ${formatAmount(impact.charge)}` : "- waived"}
                  color={
                    impact.charge > 0
                      ? theme.danger
                      : theme.success
                  }
                  colors={colors}
                />
                <PreviewRow
                  label="GST (on charge)"
                  value={impact.gst > 0 ? `− ${formatAmount(impact.gst)}` : "-"}
                  colors={colors}
                />
                <View className="border-t border-border my-2" />
                <PreviewRow
                  label="Net applied to principal"
                  value={formatAmount(impact.netApplied)}
                  bold
                  colors={colors}
                />
                <View className="border-t border-border my-2" />
                <PreviewRow
                  label="Interest saved"
                  value={formatAmount(impact.interestSavedTotal)}
                  color={theme.success}
                  colors={colors}
                />
                {chosenStrategy === "reduce_tenure" && impact.monthsSaved > 0 && (
                  <PreviewRow
                    label="Months saved"
                    value={`${impact.monthsSaved}`}
                    color={theme.success}
                    colors={colors}
                  />
                )}
                {chosenStrategy === "reduce_emi" && impact.newEMI && (
                  <PreviewRow
                    label="New EMI"
                    value={formatAmount(Math.round(impact.newEMI))}
                    colors={colors}
                  />
                )}
              </View>
            )}
            {/* v17.5.15 — optional manual override for charge + GST.
                Same grammar as the override panel on the standalone
                PrepaymentSheet so the two flows feel symmetric. */}
            {impact && (
              <View className="mb-3">
                <Pressable
                  onPress={() => {
                    const next = !overrideExpanded;
                    setOverrideExpanded(next);
                    if (next && chargeOverride === "" && gstOverride === "") {
                      setChargeOverride(String(impact.charge));
                      setGstOverride(String(impact.gst));
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    overrideExpanded ? "Hide override charges" : "Override charges"
                  }
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
                      label="Charge"
                      value={chargeOverride}
                      onChangeText={setChargeOverride}
                      keyboardType="decimal-pad"
                      placeholder={String(Math.round(impact.charge))}
                      containerClassName="mb-2"
                    />
                    <Input
                      label="GST on charge"
                      value={gstOverride}
                      onChangeText={setGstOverride}
                      keyboardType="decimal-pad"
                      placeholder={String(Math.round(impact.gst))}
                      containerClassName="mb-1"
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
            <Text
              className="text-xs mb-4"
              style={{ color: colors.textSecondary }}
            >
              Charges are auto-computed from your loan's configured rates.
              The expense amount of {formatAmount(expenseAmount)} covers
              principal only; any charge shown above is over and above.
            </Text>

            <Pressable
              onPress={handleSubmitPrepaymentDetails}
              accessibilityRole="button"
              accessibilityLabel="Save prepayment"
              className="py-3 rounded-xl items-center mb-2"
              style={{ backgroundColor: theme.primary }}
            >
              <Text className="text-sm font-bold" style={{ color: "#FFFFFF" }}>
                Save prepayment
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <View className="px-5 pt-3">
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          className="py-3 rounded-xl items-center"
          style={{
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text
            className="text-sm font-semibold"
            style={{ color: colors.textSecondary }}
          >
            Cancel
          </Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

/**
 * v17.5.13 — preview row used inside the prepayment-details preview card.
 * Same shape as the `ImpactRow` in PrepaymentSheet, kept here as a local
 * helper to avoid cross-component coupling.
 */
function PreviewRow({
  label,
  value,
  color,
  bold,
  colors,
}: {
  label: string;
  value: string;
  color?: string;
  bold?: boolean;
  colors: ReturnType<typeof useColorScheme>["colors"];
}) {
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text className="text-xs" style={{ color: colors.textSecondary }}>
        {label}
      </Text>
      <Text
        className={`text-sm ${bold ? "font-bold" : "font-medium"}`}
        style={{ color: color ?? colors.text }}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * v17.5.11 — pill toggle chip used on the prepayment-details step. Same
 * visual grammar as the filter chips on the Expenses tab — accent-filled
 * when selected, muted surface when not.
 */
function KindChip({
  label,
  selected,
  onPress,
  colors,
  colorScheme,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColorScheme>["colors"];
  colorScheme: ReturnType<typeof useColorScheme>["colorScheme"];
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      className="flex-row items-center px-3 py-2 rounded-full mr-2"
      style={
        selected
          ? {
              backgroundColor: theme.alpha("primary", 0.1),
              borderWidth: 1,
              borderColor: theme.primary,
            }
          : {
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }
      }
    >
      <Text
        className="text-xs"
        style={
          selected
            ? { color: theme.primary, fontWeight: "600" }
            : { color: colors.textSecondary }
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * v17.5.7 — strategy tile matching the loan detail ActionTile design:
 * accent circle icon + title + sublabel + chevron. Optional "Recommended"
 * pill on the reduce_tenure option.
 */
function StrategyTile({
  icon,
  label,
  sublabel,
  recommended,
  onPress,
  colors,
  colorScheme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sublabel: string;
  recommended?: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColorScheme>["colors"];
  colorScheme: ReturnType<typeof useColorScheme>["colorScheme"];
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      <View
        className="flex-row items-center py-3 px-4 rounded-xl mb-2"
        style={{
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <View
          className="w-10 h-10 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: theme.alpha("primary", 0.08) }}
        >
          <Ionicons name={icon} size={20} color={theme.primary} />
        </View>
        <View className="flex-1">
          <View className="flex-row items-center">
            <Text className="text-sm font-semibold" style={{ color: colors.text }}>
              {label}
            </Text>
            {recommended && (
              <View
                className="ml-2 px-2 py-0.5 rounded-full"
                style={{ backgroundColor: theme.alpha("primary", 0.12) }}
              >
                <Text
                  className="text-label font-semibold uppercase"
                  style={{ color: theme.primary }}
                >
                  Recommended
                </Text>
              </View>
            )}
          </View>
          <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
            {sublabel}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
      </View>
    </Pressable>
  );
}
