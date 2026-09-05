import { ForeclosureQuoteSheet } from "@/components/loans/ForeclosureQuoteSheet";
import { LinkInstallmentSheet } from "@/components/loans/LinkInstallmentSheet";
import { Button, Card, LoadingState, MetricRow, ScreenContainer } from "@/components/ui";
import { StatusColors } from "@/constants/theme";
import { getDatabase } from "@/database";
import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
    deleteCorrection,
    deleteLoanFully,
    deletePrepayment,
    getCorrections,
    getLoanById,
    getLoanOutstandingAt,
    getPrepayments,
    getSchedule,
    recordPrepayment,
    type LoanAccount,
    type LoanCorrectionRow,
    type LoanPrepaymentRow,
    type LoanScheduleEntry
} from "@/services/loan-accounts";
import { clearEmiReminderOnLoan } from "@/services/loan-emi-reminder";
import { ac, acAlpha } from "@/utils/accent";
import { formatDate } from "@/utils/date";
import { formatError } from "@/utils/error-message";
import { formatAmount } from "@/utils/format";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

const STATUS_PILL_COLOR: Record<string, "success" | "danger" | "warning" | "info"> = {
  paid: "success",
  scheduled: "info",
  overdue: "danger",
  prepaid: "success",
  skipped: "warning",
};

export default function LoanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const alert = useAlert();
  const { colors, accent, colorScheme } = useColorScheme();

  const [loan, setLoan] = useState<LoanAccount | null>(null);
  const [schedule, setSchedule] = useState<LoanScheduleEntry[]>([]);
  const [prepayments, setPrepayments] = useState<LoanPrepaymentRow[]>([]);
  const [corrections, setCorrections] = useState<LoanCorrectionRow[]>([]);
  const [bankName, setBankName] = useState<string>("");
  const [outstanding, setOutstanding] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [showFullSchedule, setShowFullSchedule] = useState(false);

  // v17.1.0 — foreclosure sheet (kept as-is)
  const [foreclosureSheetVisible, setForeclosureSheetVisible] = useState(false);
  const [linkInstallment, setLinkInstallment] = useState<LoanScheduleEntry | null>(null);
  // v17.6.0 — CSV schedule import sheet
  // v17.6.0 — CSV schedule import sheet

  const load = useCallback(async () => {
    if (!id) return;
    const l = await getLoanById(id);
    if (!l) {
      setLoaded(true);
      return;
    }
    setLoan(l);
    // v17.5.9 — after the loan is resolved, fan out the 5 independent
    // dependent reads in parallel (was 5 serial awaits → noticeable
    // open-delay on the detail screen).
    const db = getDatabase();
    const today = new Date().toISOString().split("T")[0];
    const [fa, scheduleRows, prepaymentRows, correctionRows, outstandingValue] =
      await Promise.all([
        db.getFirstAsync<{ bank_name: string }>(
          "SELECT bank_name FROM financial_accounts WHERE id = ?;",
          l.financial_account_id,
        ),
        getSchedule(l.id),
        getPrepayments(l.id),
        getCorrections(l.id),
        getLoanOutstandingAt(l.id, today),
      ]);
    setBankName(fa?.bank_name ?? "Loan");
    setSchedule(scheduleRows);
    setPrepayments(prepaymentRows);
    setCorrections(correctionRows);
    setOutstanding(outstandingValue);
    setLoaded(true);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // v17.5.3 — hooks MUST run before any conditional early-return. Moved
  // useMemo above the loading / not-found guards (fixes "Something went
  // wrong" crash when loaded flips false→true; rules-of-hooks violation).
  const {
    totalInterestPaidToDate,
    totalInterestRemaining,
    nextEMI,
  } = useMemo(() => {
    const paid = schedule.filter(
      (e) => e.status === "paid" || e.status === "prepaid",
    );
    const remaining = schedule.filter((e) => e.status === "scheduled");
    const todayStr = new Date().toISOString().split("T")[0];
    const upcoming = remaining
      .filter((e) => e.due_date >= todayStr)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
    return {
      totalInterestPaidToDate: paid.reduce((s, e) => s + e.interest_component, 0),
      totalInterestRemaining: remaining.reduce(
        (s, e) => s + e.interest_component,
        0,
      ),
      nextEMI: upcoming,
    };
  }, [schedule]);

  const visibleSchedule = useMemo(
    () =>
      showFullSchedule
        ? schedule
        : schedule.slice(0, 5).concat(schedule.slice(-5)),
    [schedule, showFullSchedule],
  );

  if (!loaded) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState icon="cash-outline" />
      </ScreenContainer>
    );
  }
  if (!loan) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-base text-muted-foreground text-center">
            Loan not found.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  const principalPaid = loan.principal_disbursed - outstanding;
  const progressPct =
    loan.principal_disbursed > 0
      ? Math.min(100, (principalPaid / loan.principal_disbursed) * 100)
      : 0;

  const formatMoney = (n: number) =>
    loan.currency === "INR"
      ? formatAmount(n)
      : `${loan.currency} ${n.toLocaleString()}`;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 40, paddingTop: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <Card className="mb-4">
          <Text className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
            {bankName} · {loan.loan_type}
          </Text>
          <View className="flex-row items-end justify-between mb-2">
            <View>
              <Text className="text-xs text-muted-foreground">
                Outstanding
              </Text>
              <Text className="text-3xl font-bold text-danger">
                {formatMoney(outstanding)}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text className="text-xs text-muted-foreground">
                EMI
              </Text>
              <Text className="text-base font-bold text-foreground">
                {formatMoney(Math.round(nextEMI?.emi_amount ?? loan.emi_amount))}
              </Text>
            </View>
          </View>

          {/* Progress */}
          <View
            style={{
              height: 6,
              backgroundColor: colors.border,
              borderRadius: 3,
              overflow: "hidden",
              marginTop: 8,
              marginBottom: 8,
            }}
          >
            <View
              style={{
                height: 6,
                width: `${progressPct}%`,
                backgroundColor: StatusColors[colorScheme].success,
              }}
            />
          </View>
          <Text className="text-xs text-faint-foreground">
            {progressPct.toFixed(0)}% paid · {formatMoney(principalPaid)} of {formatMoney(loan.principal_disbursed)}
          </Text>

          {loan.currency !== "INR" && (
            <View
              className="mt-3 flex-row items-center px-2 py-1.5 rounded-lg"
              style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}
            >
              <Ionicons name="information-circle-outline" size={14} color={colors.blue} />
              <Text className="text-xs ml-1" style={{ color: colors.textSecondary }}>
                Displayed in native currency. Not converted to INR.
              </Text>
            </View>
          )}
        </Card>

        {/* v17.6.0 — bank-sent EMI reminder banner. Stamped onto the loan
            when an "EMI of INR X for A/c XX... is due on DD-MM-YY" SMS
            matches this loan by (bank, account last-4). Shown until the
            user dismisses (or until the due date has passed — past-due
            reminders are cleared on load). */}
        {loan.status === "active" &&
          loan.last_sms_reminder_due_date &&
          loan.last_sms_reminder_due_date >= new Date().toISOString().split("T")[0] && (
            <View
              className="mb-3 rounded-xl px-4 py-3"
              style={{ backgroundColor: acAlpha(accent, 500, 0.1) }}
            >
              <View className="flex-row items-start">
                <Ionicons
                  name="notifications-outline"
                  size={18}
                  color={ac(accent, colorScheme, 600, 300)}
                  style={{ marginRight: 10, marginTop: 1 }}
                />
                <View className="flex-1">
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: ac(accent, colorScheme, 700, 200) }}
                  >
                    {bankName} reminder
                  </Text>
                  <Text
                    className="text-xs mt-0.5"
                    style={{ color: colors.text }}
                  >
                    EMI of {formatMoney(Math.round(loan.last_sms_reminder_amount ?? nextEMI?.emi_amount ?? loan.emi_amount))}{" "}
                    due on {formatDate(loan.last_sms_reminder_due_date)}.
                  </Text>
                </View>
                <Pressable
                  onPress={async () => {
                    try {
                      await clearEmiReminderOnLoan(loan.id);
                      await load();
                    } catch (e) {
                      alert("Couldn't dismiss", formatError("Dismiss reminder", e));
                    }
                  }}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss reminder"
                  className="w-7 h-7 items-center justify-center -mr-1"
                  style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                >
                  <Ionicons name="close" size={16} color={colors.textSecondary} />
                </Pressable>
              </View>
            </View>
          )}

        {/* v17.5.5 — Action section redesigned to match Home's Explore & Tools
            pattern: section label + individual Card tiles with colored circle
            icons, proper breathing room, chevron affordance. */}
        {loan.status === "active" && (
          <View className="mb-3">
            <Button
              title="Record Prepayment"
              onPress={() => router.push({
                pathname: "/loans/[id]/prepayment",
                params: { id: loan.id }
              } as never)}
            />
          </View>
        )}

        <Text className="text-xs font-semibold uppercase tracking-wider mb-2 mt-1"
          style={{ color: colors.textSecondary }}
        >
          Manage this loan
        </Text>

        {loan.status === "active" && (
          <>
            <ActionTile
              icon="calculator-outline"
              label="Foreclose quote"
              sublabel="See total to close the loan today"
              onPress={() => setForeclosureSheetVisible(true)}
              accent={accent}
              colors={colors}
              colorScheme={colorScheme}
            />
            <ActionTile
              icon="construct-outline"
              label="Manual correction"
              sublabel="Override outstanding / EMI / rate / remaining EMIs"
              onPress={() => router.push({
                pathname: "/loans/[id]/correction",
                params: { id: loan.id }
              } as never)}
              accent={accent}
              colors={colors}
              colorScheme={colorScheme}
            />
          </>
        )}
        <ActionTile
          icon="pencil-outline"
          label="Edit loan details"
          sublabel="Change rate, tenure, EMI day, fees…"
          onPress={() => router.push({ pathname: "/loans/add", params: { loanId: loan.id } } as never)}
          accent={accent}
          colors={colors}
          colorScheme={colorScheme}
        />
        <ActionTile
          icon="trash-outline"
          label="Delete loan"
          sublabel="Removes schedule + all prepayments"
          onPress={() => {
            alert(
              "Delete this loan?",
              "This removes the loan, its amortization schedule, and all recorded prepayments. Any expenses marked as payments against this loan keep existing as regular expenses. The loan also disappears from Account Master. This can't be undone.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: async () => {
                    try {
                      await deleteLoanFully(loan.id);
                      router.replace("/goals/loans" as never);
                    } catch (e) {
                      alert("Couldn't delete", formatError("Delete loan", e));
                    }
                  },
                },
              ],
            );
          }}
          accent={accent}
          colors={colors}
          colorScheme={colorScheme}
          danger
        />
        <View className="mb-4" />

        {/* Summary */}
        <Card title="Summary" className="mb-4">
          <MetricRow label="Agreement" value={loan.agreement_id ?? "-"} />
          <MetricRow
            label="Sanctioned"
            value={formatMoney(loan.principal_sanctioned)}
          />
          <MetricRow
            label="Interest rate"
            value={`${loan.interest_rate_pa}% ${loan.interest_type}`}
          />
          <MetricRow label="Tenure" value={`${loan.tenure_months} months`} />
          <MetricRow
            label="Disbursed"
            value={formatDate(loan.disbursement_date)}
          />
          <MetricRow
            label="EMI day"
            value={`${loan.emi_day_of_month} of each month`}
          />
          {nextEMI && (
            <MetricRow
              label="Next EMI"
              value={`${formatDate(nextEMI.due_date)}`}
            />
          )}
          <MetricRow
            label="Interest paid so far"
            value={formatMoney(Math.round(totalInterestPaidToDate))}
          />
          <MetricRow
            label="Interest remaining"
            value={formatMoney(Math.round(totalInterestRemaining))}
          />
        </Card>

        {/* Prepayments — v17.5.16: re-wrapped in <Card title="Prepayments · N">
            so the section visually matches Hero / Summary / Amortization Schedule
            which all use Card shells. Row silhouette (40×40 icon + title/metadata
            + right-aligned amount/date + trash) unchanged from v17.5.11; only
            the outer shell + inline header were dropped. Rows now use py-3
            only — Card.p-5 owns horizontal padding. */}
        {prepayments.length > 0 && (
          <Card title={`Prepayments · ${prepayments.length}`} className="mb-4">
            {prepayments.map((p, idx) => {
              const strategyLabel = p.strategy
                ? p.strategy === "reduce_tenure"
                  ? "Reduce tenure"
                  : "Reduce EMI"
                : null;
              return (
                <View
                  key={p.id}
                  className={`flex-row items-center py-3 ${
                    idx < prepayments.length - 1
                      ? "border-b border-border"
                      : ""
                  }`}
                >
                  <Pressable
                    onPress={() => {
                      // v17.5.13 — prepayments created by linking an expense
                      // are managed from the expense. Editing here would
                      // desync the expense.amount from prepayment.amount.
                      if (p.linked_expense_id) {
                        router.push({
                          pathname: "/expense/[id]",
                          params: { id: p.linked_expense_id },
                        } as never);
                      } else {
                        router.push({
                          pathname: "/loans/[id]/prepayment",
                          params: { id: loan.id, prepaymentId: p.id }
                        } as never);
                      }
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={
                      p.linked_expense_id
                        ? `View linked expense for prepayment of ${formatMoney(p.amount)} on ${formatDate(p.prepayment_date)}`
                        : `Edit prepayment of ${formatMoney(p.amount)} on ${formatDate(p.prepayment_date)}`
                    }
                    className="flex-1 flex-row items-center"
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  >
                    {/* Icon circle — accent tint for part-payment, warning
                        tint for foreclosure (it closes the loan — reads as
                        a terminal action, same grammar as the simulator
                        "fulfilled" check). */}
                    <View
                      className="w-10 h-10 rounded-full items-center justify-center mr-3"
                      style={{
                        backgroundColor:
                          p.kind === "foreclosure"
                            ? StatusColors[colorScheme].warning + "14"
                            : acAlpha(accent, 500, 0.08),
                      }}
                    >
                      <Ionicons
                        name={
                          p.kind === "foreclosure"
                            ? "flag-outline"
                            : "arrow-down-circle-outline"
                        }
                        size={20}
                        color={
                          p.kind === "foreclosure"
                            ? StatusColors[colorScheme].warning
                            : ac(accent, colorScheme, 600, 300)
                        }
                      />
                    </View>

                    {/* Left: title + strategy pill, then metadata line */}
                    <View className="flex-1 mr-3">
                      <View className="flex-row items-center">
                        <Text
                          className="text-sm font-semibold text-foreground shrink"
                          numberOfLines={1}
                        >
                          {p.kind === "foreclosure" ? "Foreclosure" : "Part payment"}
                        </Text>
                        {strategyLabel && (
                          <View
                            className="ml-1.5 px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: accent[500] + "1A" }}
                          >
                            <Text
                              className="text-label font-bold uppercase"
                              style={{ color: ac(accent, colorScheme, 600, 300) }}
                            >
                              {strategyLabel}
                            </Text>
                          </View>
                        )}
                      </View>
                      {p.prepayment_charge > 0 && (
                        <Text
                          className="text-xs text-muted-foreground mt-0.5"
                          numberOfLines={1}
                        >
                          Charge {formatMoney(p.prepayment_charge + p.gst_on_charge)}
                        </Text>
                      )}
                      {p.linked_expense_id && (
                        <Text
                          className="text-xs text-muted-foreground mt-0.5"
                          numberOfLines={1}
                        >
                          Linked from expense · manage there
                        </Text>
                      )}
                    </View>

                    {/* Right: amount + date, right-aligned (ExpenseListItem shape) */}
                    <View className="items-end shrink-0">
                      <Text
                        className="text-sm font-bold"
                        style={{ color: StatusColors[colorScheme].success }}
                      >
                        {formatMoney(p.amount)}
                      </Text>
                      <Text className="text-label text-muted-foreground mt-0.5">
                        {formatDate(p.prepayment_date)}
                      </Text>
                    </View>
                  </Pressable>

                  {/* Delete — 36×36 pressable at the row's right edge.
                      Hidden when this prepayment is linked from an expense:
                      the expense is the source of truth and deleting from
                      here would leave the expense pointing at nothing. The
                      user can delete the expense from the expense detail
                      screen; its hard-delete will also drop this row. */}
                  {!p.linked_expense_id && (
                  <Pressable
                    onPress={() => {
                      alert(
                        "Delete this prepayment?",
                        p.kind === "foreclosure"
                          ? "The loan will be reopened and the schedule recalculated as if this foreclosure never happened."
                          : "The amortization schedule will be recalculated as if this prepayment never happened.",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Delete",
                            style: "destructive",
                            onPress: async () => {
                              try {
                                await deletePrepayment(p.id);
                                await load();
                              } catch (err) {
                                alert(
                                  "Couldn't delete prepayment",
                                  formatError("Delete prepayment", err),
                                );
                              }
                            },
                          },
                        ],
                      );
                    }}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Delete prepayment"
                    className="ml-2 w-9 h-9 items-center justify-center"
                    style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={18}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                  )}
                </View>
              );
            })}
          </Card>
        )}

        {/* Manual Corrections — v17.5.16: wrapped in <Card title="Corrections · N">
            for consistency with Prepayments + rest of the loan detail sections.
            Row silhouette unchanged from v17.5.15. */}
        {corrections.length > 0 && (
          <Card title={`Corrections · ${corrections.length}`} className="mb-4">
            {corrections.map((c, idx) => (
              <View
                key={c.id}
                className={`flex-row items-center py-3 ${
                  idx < corrections.length - 1
                    ? "border-b border-border"
                    : ""
                }`}
              >
                <Pressable
                  onPress={() => {
                    router.push({
                      pathname: "/loans/[id]/correction",
                      params: { id: loan.id, correctionId: c.id }
                    } as never);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit correction on ${formatDate(c.effective_date)}`}
                  className="flex-1 flex-row items-center"
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <View
                    className="w-10 h-10 rounded-full items-center justify-center mr-3"
                    style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}
                  >
                    <Ionicons
                      name="construct-outline"
                      size={20}
                      color={ac(accent, colorScheme, 600, 300)}
                    />
                  </View>
                  <View className="flex-1 mr-3">
                    <Text
                      className="text-sm font-semibold text-foreground"
                      numberOfLines={1}
                    >
                      Correction
                    </Text>
                    <Text
                      className="text-xs text-muted-foreground mt-0.5"
                      numberOfLines={1}
                    >
                      EMI {formatMoney(Math.round(c.emi_amount))}
                      {c.tenure_remaining_months ? ` · ${c.tenure_remaining_months} EMIs` : ""}
                    </Text>
                    {c.reason && (
                      <Text
                        className="text-xs text-muted-foreground mt-0.5"
                        numberOfLines={1}
                      >
                        {c.reason}
                      </Text>
                    )}
                  </View>
                  <View className="items-end shrink-0">
                    <Text
                      className="text-sm font-bold text-foreground"
                    >
                      {formatMoney(Math.round(c.outstanding_principal))}
                    </Text>
                    <Text className="text-label text-muted-foreground mt-0.5">
                      {formatDate(c.effective_date)}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => {
                    alert(
                      "Delete this correction?",
                      "The amortization schedule will be recalculated as if this override was never applied.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: async () => {
                            try {
                              await deleteCorrection(c.id);
                              await load();
                            } catch (err) {
                              alert("Couldn't delete correction", formatError("Delete correction", err));
                            }
                          },
                        },
                      ],
                    );
                  }}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Delete correction"
                  className="ml-2 w-9 h-9 items-center justify-center"
                  style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
                </Pressable>
              </View>
            ))}
          </Card>
        )}

        {/* Schedule */}
        <Card title="Amortization Schedule" className="mb-4">
          <Text className="text-xs text-muted-foreground mb-3">
            {showFullSchedule
              ? `All ${schedule.length} installments`
              : `First 5 and last 5 of ${schedule.length} installments`}
          </Text>
          {visibleSchedule.map((e, i) => (
            <Pressable
              key={e.id}
              onPress={() => setLinkInstallment(e)}
              className={`flex-row items-center py-2 ${
                i < visibleSchedule.length - 1
                  ? "border-b border-border"
                  : ""
              }`}
              accessibilityRole="button"
              accessibilityLabel={`Installment ${e.installment_num}, ${e.status}`}
            >
              <View style={{ width: 36 }}>
                <Text className="text-xs text-muted-foreground">
                  #{e.installment_num}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-foreground">
                  {formatDate(e.due_date)}
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  P {formatMoney(Math.round(e.principal_component))} · I {formatMoney(Math.round(e.interest_component))}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text className="text-sm font-semibold text-foreground">
                  {formatMoney(Math.round(e.emi_amount))}
                </Text>
                <Text
                  className="text-xs mt-0.5"
                  style={{
                    color:
                      STATUS_PILL_COLOR[e.status] === "success"
                        ? StatusColors[colorScheme].success
                        : STATUS_PILL_COLOR[e.status] === "danger"
                          ? StatusColors[colorScheme].danger
                          : colors.textSecondary,
                  }}
                >
                  {e.status}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} style={{ marginLeft: 6 }} />
            </Pressable>
          ))}
          {schedule.length > 10 && (
            <Pressable
              onPress={() => setShowFullSchedule(!showFullSchedule)}
              className="mt-3 py-2 items-center rounded-lg"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
              accessibilityRole="button"
            >
              <Text className="text-sm font-medium" style={{ color: colors.tint }}>
                {showFullSchedule ? "Collapse" : `Show all ${schedule.length}`}
              </Text>
            </Pressable>
          )}
        </Card>
      </ScrollView>


      {/* v17.1.0 — Foreclosure quote */}
      <ForeclosureQuoteSheet
        visible={foreclosureSheetVisible}
        loan={loan}
        schedule={schedule}
        prepayments={prepayments}
        onClose={() => setForeclosureSheetVisible(false)}
        onForeclose={async (payload) => {
          setForeclosureSheetVisible(false);
          alert(
            "Foreclose loan?",
            `This records a foreclosure of ${formatMoney(payload.amount)} on ${payload.prepayment_date} and marks the loan closed. Undo-able from the Loans list.`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Foreclose",
                style: "destructive",
                onPress: async () => {
                  try {
                    await recordPrepayment(loan.id, {
                      ...payload,
                      kind: "foreclosure",
                    });
                    await load();
                  } catch (e) {
                    alert("Couldn't foreclose", formatError("Foreclosure", e));
                  }
                },
              },
            ],
          );
        }}
      />

      <LinkInstallmentSheet
        visible={linkInstallment !== null}
        installment={linkInstallment}
        onClose={() => setLinkInstallment(null)}
        onLinked={() => load()}
      />

    </ScreenContainer>
  );
}

/**
 * Compact action strip button — icon above label, equal-width flex cell.
 * Used on the loan detail screen to consolidate secondary actions
 * (Foreclose / Correct / Edit / Delete) into a single row.
 */
/**
 * v17.5.4 — horizontal action row with icon + title + sublabel + chevron.
 * Replaces the compressed 4-icon strip on loan detail.
 */
/**
 * v17.5.5 — ActionTile: individual Card-based action tile matching the
 * Home → Explore & Tools pattern. Colored circle icon (accent for normal,
 * danger for destructive), label + sublabel, right chevron.
 */
function ActionTile({
  icon,
  label,
  sublabel,
  onPress,
  accent,
  colors,
  colorScheme,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sublabel?: string;
  onPress: () => void;
  accent: ReturnType<typeof useColorScheme>["accent"];
  colors: ReturnType<typeof useColorScheme>["colors"];
  colorScheme: ReturnType<typeof useColorScheme>["colorScheme"];
  danger?: boolean;
}) {
  const circleBg = danger ? "#DC262616" : acAlpha(accent, 500, 0.08);
  const iconColor = danger ? "#DC2626" : ac(accent, colorScheme, 600, 300);
  const labelColor = danger ? "#DC2626" : colors.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      <Card className="mb-2">
        <View className="flex-row items-center">
          <View
            className="w-10 h-10 rounded-full items-center justify-center mr-3"
            style={{ backgroundColor: circleBg }}
          >
            <Ionicons name={icon} size={20} color={iconColor} />
          </View>
          <View className="flex-1">
            <Text
              className="text-sm font-semibold"
              style={{ color: labelColor }}
            >
              {label}
            </Text>
            {sublabel && (
              <Text
                className="text-xs mt-0.5"
                style={{ color: colors.textSecondary }}
              >
                {sublabel}
              </Text>
            )}
          </View>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={colors.textSecondary}
          />
        </View>
      </Card>
    </Pressable>
  );
}
