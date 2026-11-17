import { ForeclosureQuoteSheet } from "@/components/loans/ForeclosureQuoteSheet";

import { LinkInstallmentSheet } from "@/components/loans/LinkInstallmentSheet";
import { ActionRow, Card, Chip, FieldRow, LoadingState, ProgressBar, ScreenContainer, Text, type ActionRowItem } from "@/components/ui";
import { HeaderPill } from "@/components/ui/LinkRow";
import { FoldGroup } from "@/components/ui/FormParts";

import { getDatabase } from "@/database";
import { useAlert } from "@/hooks/use-alert";
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

import { formatDate } from "@/utils/date";
import { formatError } from "@/utils/error-message";
import { formatAmount } from "@/utils/format";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { todayIso } from "@/utils/local-date";

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
  const theme = useTheme();

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
    const today = todayIso();
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
    const todayStr = todayIso();
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
          <Text className="text-body text-muted-foreground text-center">
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
  const emisDone = schedule.filter((e) => e.status === "paid" || e.status === "prepaid").length;
  const emisToGo = schedule.filter((e) => e.status === "scheduled" || e.status === "overdue").length;

  const formatMoney = (n: number) =>
    loan.currency === "INR"
      ? formatAmount(n)
      : `${loan.currency} ${n.toLocaleString()}`;

  const isActive = loan.status === "active";

  const confirmDelete = () => {
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
              router.replace("/goals/loans");
            } catch (e) {
              alert("Couldn't delete", formatError("Delete loan", e));
            }
          },
        },
      ],
    );
  };
  const openEdit = () => router.push({ pathname: "/loans/add", params: { loanId: loan.id } });
  const openMore = () =>
    alert("This loan", undefined, [
      { text: "Edit loan details", onPress: openEdit },
      { text: "Delete loan", style: "destructive", onPress: confirmDelete },
      { text: "Cancel", style: "cancel" },
    ]);

  const actions: ActionRowItem[] = isActive
    ? [
        {
          key: "prepay",
          label: "Prepay",
          icon: "arrow-up-outline",
          onPress: () => router.push({ pathname: "/loans/[id]/prepayment", params: { id: loan.id } }),
        },
        { key: "payoff", label: "Payoff", icon: "checkbox-outline", onPress: () => setForeclosureSheetVisible(true) },
        {
          key: "correct",
          label: "Correct",
          icon: "create-outline",
          onPress: () => router.push({ pathname: "/loans/[id]/correction", params: { id: loan.id } }),
        },
        { key: "more", label: "More", icon: "ellipsis-horizontal", onPress: openMore },
      ]
    : [
        { key: "edit", label: "Edit", icon: "create-outline", onPress: openEdit },
        { key: "delete", label: "Delete", icon: "trash-outline", danger: true, onPress: confirmDelete },
      ];

  const lastPrepay = prepayments[0];

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen
        options={{
          title: "",
          headerRight: () => <HeaderPill label="Edit" onPress={openEdit} accessibilityLabel="Edit loan details" />,
        }}
      />
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Hero: what's left, and how far along */}
        <View className="items-center pb-4" style={{ gap: 4 }}>
          <View className="w-[52px] h-[52px] rounded-card items-center justify-center" style={{ backgroundColor: theme.alpha("warning", 0.1) }}>
            <Ionicons name="business-outline" size={24} color={theme.warning} />
          </View>
          <Text className="text-heading font-semibold text-foreground mt-2" numberOfLines={1}>
            {LOAN_TYPE_NAME[loan.loan_type] ?? loan.loan_type} · {bankName}
          </Text>
          <Text className="text-meta text-muted-foreground">{isActive ? "Left to repay" : "Closed"}</Text>
          <Text className="text-hero font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }} numberOfLines={1}>
            {formatMoney(outstanding)}
          </Text>
          <View className="w-full mt-2.5" style={{ gap: 6 }}>
            <ProgressBar value={progressPct / 100} color={theme.success} height={8} animated={false} />
            <View className="flex-row justify-between">
              <Text className="text-meta text-muted-foreground">
                {progressPct.toFixed(0)}% repaid · {formatMoney(principalPaid)} of {formatMoney(loan.principal_disbursed)}
              </Text>
              {schedule.length > 0 && (
                <Text className="text-meta text-muted-foreground">
                  {emisDone} of {schedule.length} EMIs
                </Text>
              )}
            </View>
          </View>
          {loan.currency !== "INR" && (
            <View className="mt-2 flex-row items-center px-2.5 py-1.5 rounded-control" style={{ backgroundColor: theme.alpha("primary", 0.08), gap: 6 }}>
              <Ionicons name="information-circle-outline" size={14} color={theme.primary} />
              <Text className="text-label text-muted-foreground">Displayed in native currency. Not converted to INR.</Text>
            </View>
          )}
        </View>

        <ActionRow items={actions} className="mb-3" />

        {/* Bank-sent EMI reminder: shown until dismissed or the due date passes. */}
        {isActive && loan.last_sms_reminder_due_date && loan.last_sms_reminder_due_date >= todayIso() && (
          <View className="mb-3 rounded-card px-4 py-3 flex-row items-start" style={{ backgroundColor: theme.alpha("primary", 0.08), gap: 10 }}>
            <Ionicons name="notifications-outline" size={18} color={theme.primary} style={{ marginTop: 1 }} />
            <View className="flex-1">
              <Text className="text-body font-semibold text-foreground">{bankName} reminder</Text>
              <Text className="text-meta text-muted-foreground mt-0.5">
                EMI of {formatMoney(Math.round(loan.last_sms_reminder_amount ?? nextEMI?.emi_amount ?? loan.emi_amount))} due on{" "}
                {formatDate(loan.last_sms_reminder_due_date)}.
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
            >
              <Ionicons name="close" size={16} color={theme.mutedForeground} />
            </Pressable>
          </View>
        )}

        <View style={{ gap: 12 }}>
          {/* Next EMI, with its interest / principal split */}
          {nextEMI && (
            <Pressable
              onPress={() => setLinkInstallment(nextEMI)}
              className="rounded-card bg-card border border-border px-4 py-3.5 flex-row items-center"
              style={{ gap: 12 }}
              accessibilityRole="button"
              accessibilityLabel={`Next EMI ${formatDate(nextEMI.due_date)}, ${formatMoney(Math.round(nextEMI.emi_amount))}`}
            >
              <View className="w-10 h-10 rounded-control items-center justify-center" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                <Ionicons name="calendar-outline" size={19} color={theme.primary} />
              </View>
              <View className="flex-1">
                <Text className="text-meta text-muted-foreground">Next EMI · {formatDate(nextEMI.due_date)}</Text>
                <Text className="text-heading font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                  {formatMoney(Math.round(nextEMI.emi_amount))}
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-meta text-muted-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                  {formatMoney(Math.round(nextEMI.interest_component))} interest
                </Text>
                <Text className="text-meta text-muted-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                  {formatMoney(Math.round(nextEMI.principal_component))} principal
                </Text>
              </View>
            </Pressable>
          )}

          {/* Summary */}
          <Card>
            <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-1">Summary</Text>
            <FieldRow label="Interest rate" value={`${loan.interest_rate_pa}% · ${loan.interest_type}`} divider={false} />
            <FieldRow label="Tenure" value={`${loan.tenure_months} months · EMI on the ${ordinal(loan.emi_day_of_month)}`} />
            <FieldRow label="Sanctioned" value={formatMoney(loan.principal_sanctioned)} />
            <FieldRow label="Disbursed" value={formatDate(loan.disbursement_date)} />
            {loan.agreement_id ? <FieldRow label="Agreement" value={loan.agreement_id} /> : null}
            <FieldRow label="Interest paid so far" value={formatMoney(Math.round(totalInterestPaidToDate))} />
            <FieldRow label="Interest still to pay" value={formatMoney(Math.round(totalInterestRemaining))} />
          </Card>

          {/* Repayment schedule — every EMI opens its transaction (link sheet) */}
          <FoldGroup
            title="Repayment schedule"
            sub={`${schedule.length} EMIs${emisToGo > 0 ? ` · ${emisToGo} to go` : ""}`}
            icon="list-outline"
          >
            <Text className="text-meta text-muted-foreground">
              {showFullSchedule ? `All ${schedule.length} installments` : `First 5 and last 5 of ${schedule.length} installments`}
            </Text>
            <View>
              {visibleSchedule.map((e, i) => {
                const tone = STATUS_PILL_COLOR[e.status];
                return (
                  <Pressable
                    key={e.id}
                    onPress={() => setLinkInstallment(e)}
                    className={`flex-row items-center py-2.5 ${i > 0 ? "border-t border-border" : ""}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Installment ${e.installment_num}, ${e.status}`}
                  >
                    <Text className="text-label text-muted-foreground" style={{ width: 36 }}>
                      #{e.installment_num}
                    </Text>
                    <View className="flex-1">
                      <Text className="text-body text-foreground">{formatDate(e.due_date)}</Text>
                      <Text className="text-label text-muted-foreground mt-0.5">
                        P {formatMoney(Math.round(e.principal_component))} · I {formatMoney(Math.round(e.interest_component))}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-body font-semibold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                        {formatMoney(Math.round(e.emi_amount))}
                      </Text>
                      <Text
                        className="text-label mt-0.5"
                        style={{ color: tone === "success" ? theme.success : tone === "danger" ? theme.danger : theme.mutedForeground }}
                      >
                        {e.status}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={theme.faintForeground} style={{ marginLeft: 6 }} />
                  </Pressable>
                );
              })}
            </View>
            {schedule.length > 10 && (
              <Pressable
                onPress={() => setShowFullSchedule(!showFullSchedule)}
                className="h-11 items-center justify-center rounded-pill border border-border bg-card"
                accessibilityRole="button"
              >
                <Text className="text-meta font-semibold" style={{ color: theme.primary }}>
                  {showFullSchedule ? "Show fewer" : `Show all ${schedule.length}`}
                </Text>
              </Pressable>
            )}
          </FoldGroup>

          {/* Prepayments */}
          {prepayments.length > 0 && (
            <FoldGroup
              title={`Prepayments · ${prepayments.length}`}
              sub={lastPrepay ? `Last: ${formatMoney(lastPrepay.amount)} on ${formatDate(lastPrepay.prepayment_date)}` : ""}
              icon="arrow-up-outline"
            >
              {prepayments.map((p, idx) => {
                const strategyLabel = p.strategy ? (p.strategy === "reduce_tenure" ? "Reduce tenure" : "Reduce EMI") : null;
                return (
                  <View key={p.id} className={`flex-row items-center py-2 ${idx > 0 ? "border-t border-border" : ""}`}>
                    <Pressable
                      onPress={() => {
                        // Prepayments made by linking an expense are managed from the expense;
                        // editing here would desync expense.amount from prepayment.amount.
                        if (p.linked_expense_id) {
                          router.push({ pathname: "/expense/[id]", params: { id: p.linked_expense_id } });
                        } else {
                          router.push({ pathname: "/loans/[id]/prepayment", params: { id: loan.id, prepaymentId: p.id } });
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={
                        p.linked_expense_id
                          ? `View linked expense for prepayment of ${formatMoney(p.amount)} on ${formatDate(p.prepayment_date)}`
                          : `Edit prepayment of ${formatMoney(p.amount)} on ${formatDate(p.prepayment_date)}`
                      }
                      className="flex-1 flex-row items-center"
                      style={{ gap: 10 }}
                    >
                      <View
                        className="w-9 h-9 rounded-control items-center justify-center"
                        style={{ backgroundColor: p.kind === "foreclosure" ? theme.alpha("warning", 0.1) : theme.alpha("primary", 0.1) }}
                      >
                        <Ionicons
                          name={p.kind === "foreclosure" ? "flag-outline" : "arrow-up-outline"}
                          size={18}
                          color={p.kind === "foreclosure" ? theme.warning : theme.primary}
                        />
                      </View>
                      <View className="flex-1">
                        <View className="flex-row items-center" style={{ gap: 6 }}>
                          <Text className="text-body font-semibold text-foreground shrink" numberOfLines={1}>
                            {p.kind === "foreclosure" ? "Foreclosure" : "Part payment"}
                          </Text>
                          {strategyLabel && <Chip variant="status" tone="primary" label={strategyLabel} />}
                        </View>
                        {p.prepayment_charge > 0 && (
                          <Text className="text-label text-muted-foreground mt-0.5" numberOfLines={1}>
                            Charge {formatMoney(p.prepayment_charge + p.gst_on_charge)}
                          </Text>
                        )}
                        {p.linked_expense_id && (
                          <Text className="text-label text-muted-foreground mt-0.5" numberOfLines={1}>
                            Linked from expense · manage there
                          </Text>
                        )}
                      </View>
                      <View className="items-end">
                        <Text className="text-body font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                          {formatMoney(p.amount)}
                        </Text>
                        <Text className="text-label text-muted-foreground mt-0.5">{formatDate(p.prepayment_date)}</Text>
                      </View>
                    </Pressable>
                    {/* Hidden when linked from an expense: the expense is the source of truth. */}
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
                                    alert("Couldn't delete prepayment", formatError("Delete prepayment", err));
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
                      >
                        <Ionicons name="trash-outline" size={18} color={theme.mutedForeground} />
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </FoldGroup>
          )}

          {/* Corrections */}
          {corrections.length > 0 && (
            <FoldGroup
              title={`Corrections · ${corrections.length}`}
              sub={corrections[0].reason ?? `From ${formatDate(corrections[0].effective_date)}`}
              icon="construct-outline"
            >
              {corrections.map((c, idx) => (
                <View key={c.id} className={`flex-row items-center py-2 ${idx > 0 ? "border-t border-border" : ""}`}>
                  <Pressable
                    onPress={() => router.push({ pathname: "/loans/[id]/correction", params: { id: loan.id, correctionId: c.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit correction on ${formatDate(c.effective_date)}`}
                    className="flex-1 flex-row items-center"
                    style={{ gap: 10 }}
                  >
                    <View className="w-9 h-9 rounded-control items-center justify-center" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                      <Ionicons name="construct-outline" size={18} color={theme.primary} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-body font-semibold text-foreground" numberOfLines={1}>
                        Correction
                      </Text>
                      <Text className="text-label text-muted-foreground mt-0.5" numberOfLines={1}>
                        EMI {formatMoney(Math.round(c.emi_amount))}
                        {c.tenure_remaining_months ? ` · ${c.tenure_remaining_months} EMIs` : ""}
                      </Text>
                      {c.reason && (
                        <Text className="text-label text-muted-foreground mt-0.5" numberOfLines={1}>
                          {c.reason}
                        </Text>
                      )}
                    </View>
                    <View className="items-end">
                      <Text className="text-body font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
                        {formatMoney(Math.round(c.outstanding_principal))}
                      </Text>
                      <Text className="text-label text-muted-foreground mt-0.5">{formatDate(c.effective_date)}</Text>
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
                  >
                    <Ionicons name="trash-outline" size={18} color={theme.mutedForeground} />
                  </Pressable>
                </View>
              ))}
            </FoldGroup>
          )}
        </View>
      </ScrollView>

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

const LOAN_TYPE_NAME: Record<string, string> = {
  personal: "Personal loan",
  home: "Home loan",
  auto: "Car loan",
  education: "Education loan",
  business: "Business loan",
  gold: "Gold loan",
  against_fd: "Loan against FD",
  other: "Loan",
};

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
