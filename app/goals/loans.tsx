import { useState, useCallback, useRef } from "react";
import { View, Pressable, ScrollView, RefreshControl } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, FAB, LoadingState, ProgressBar, ScreenContainer, Text } from "@/components/ui";
import { AnimatedNumber, PressableScale } from "@/components/motion";
import { CardNote, ClosedToggle, ShareBar, SummaryCard, shortDate } from "@/components/account/AccountCards";
import { useAlert } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  listAllLoansWithBankName,
  getLoanOutstandingsByLoanId,
  getCurrentEMIsByLoanId,
  getSchedulesByLoanIds,
  type LoanAccount,
} from "@/services/loan-accounts";
import {
  findLoanMergeCandidates,
  mergeLoanFinancialAccounts,
  type LoanMergeCandidate,
} from "@/services/loan-account-merge";
import { consumeLoansPreload } from "@/services/home-preload";
import { logger } from "@/utils/logger";
import { formatAmount } from "@/utils/format";
import { formatDate } from "@/utils/date";

import { useTheme } from "@/hooks/use-theme";
import { todayIso } from "@/utils/local-date";

const preloaded = consumeLoansPreload();

const LOAN_TYPE_LABEL: Record<string, string> = {
  personal: "Personal",
  home: "Home",
  auto: "Auto",
  education: "Education",
  business: "Business",
  gold: "Gold",
  against_fd: "Against FD",
  other: "Other",
};

export default function LoansListScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors, colorScheme } = useColorScheme();
  const theme = useTheme();
  const [loans, setLoans] = useState<LoanRow[]>(preloaded?.loans ?? []);
  const [loaded, setLoaded] = useState(preloaded != null);
  const [refreshing, setRefreshing] = useState(false);
  const [closedLoansExpanded, setClosedLoansExpanded] = useState(false);
  // v17.6.0 — session-local record of merge prompts the user dismissed.
  // Keyed by `${loanFaId}:${candidateFaId}` so we don't nag them every time
  // they visit the loans list, but we re-check after the app is killed.
  const dismissedMergesRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    // v17.5.2 — two batched queries instead of N+1:
    // 1. JOIN loans + financial_accounts for bank_name
    // 2. getLoanOutstandingsByFA batches schedule+prepayments per loan internally
    const today = todayIso();
    const [all, outstandingMap, emiMap] = await Promise.all([
      listAllLoansWithBankName(DEFAULT_USER_ID),
      getLoanOutstandingsByLoanId(DEFAULT_USER_ID, today),
      getCurrentEMIsByLoanId(DEFAULT_USER_ID, today),
    ]);
    const allIds = all.map((l) => l.id);
    const scheduleMap = await getSchedulesByLoanIds(allIds);
    const enriched: LoanRow[] = all.map((loan) => {
      const schedule = scheduleMap.get(loan.id) ?? [];
      // The next instalment not yet paid; overdue when its date has passed.
      const next = schedule
        .filter((e) => e.status === "scheduled" || e.status === "overdue")
        .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
      return {
        ...loan,
        bank_name: loan.bank_name ?? "Loan",
        outstanding: outstandingMap.get(loan.id) ?? 0,
        current_emi: emiMap.get(loan.id) ?? loan.emi_amount,
        remaining_months: schedule.filter((e) => e.status === "scheduled").length,
        next_due_date: next?.due_date ?? null,
        next_due_amount: next?.emi_amount ?? null,
        next_overdue: !!next && next.due_date < today,
      };
    });
    setLoans(enriched);
    setLoaded(true);
  }, []);

  const promptMergeCandidate = useCallback(
    (candidate: LoanMergeCandidate) => {
      const key = `${candidate.loanFaId}:${candidate.candidateFaId}`;
      if (dismissedMergesRef.current.has(key)) return;
      const expensesLine =
        candidate.candidateExpenseCount > 0
          ? `\n\nMerging will repoint ${candidate.candidateExpenseCount} SMS-linked ${candidate.candidateExpenseCount === 1 ? "expense" : "expenses"} onto your loan's account card.`
          : "";
      alert(
        "Merge duplicate loan accounts?",
        `Two ${candidate.bankName} loan cards look like the same account:\n• Your loan (entered manually)\n• ${candidate.candidateLabel ?? `Account XX${candidate.candidateIdentifier.slice(-4)}`} - auto-detected from SMS${expensesLine}`,
        [
          {
            text: "Keep separate",
            style: "cancel",
            onPress: () => {
              dismissedMergesRef.current.add(key);
            },
          },
          {
            text: "Merge",
            onPress: async () => {
              try {
                await mergeLoanFinancialAccounts(
                  candidate.loanFaId,
                  candidate.candidateFaId,
                );
                dismissedMergesRef.current.add(key);
                await load();
              } catch (e) {
                logger.warn("Merge loan accounts failed (non-fatal)", e);
                alert(
                  "Couldn't merge",
                  "Something went wrong while merging the two accounts. Your data is unchanged.",
                );
              }
            },
          },
        ],
      );
    },
    [alert, load],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        await load();
        if (cancelled) return;
        // v17.6.0 — after the list renders, look for Tier-2 merge candidates
        // and surface the first one. Multi-candidate loans are still shown
        // one-at-a-time; the user can dismiss one and the next prompts on
        // next focus.
        try {
          const candidates = await findLoanMergeCandidates(DEFAULT_USER_ID);
          if (cancelled || candidates.length === 0) return;
          const firstUndismissed = candidates.find(
            (c) => !dismissedMergesRef.current.has(`${c.loanFaId}:${c.candidateFaId}`),
          );
          if (firstUndismissed) {
            promptMergeCandidate(firstUndismissed);
          }
        } catch (e) {
          logger.warn("Loan merge scan failed (non-fatal)", e);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [load, promptMergeCandidate]),
  );

  const activeLoans = loans.filter((l) => l.status === "active");
  const closedLoans = loans.filter((l) => l.status !== "active");

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!loaded) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState icon="cash-outline" message="Loading loans..." />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1 px-4"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80, paddingTop: 12 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.mutedForeground} />
        }
      >
        {loans.length === 0 && (
          <Card className="mb-4">
            <View className="items-center py-8">
              <View
                className="w-14 h-14 rounded-full items-center justify-center mb-3"
                style={{ backgroundColor: theme.alpha("primary", 0.08) }}
              >
                <Ionicons name="cash-outline" size={28} color={theme.data.series[3]} />
              </View>
              <Text className="text-body font-semibold text-foreground mb-1">
                No loans yet
              </Text>
              <Text className="text-meta text-muted-foreground text-center px-6">
                Add a loan to track amortization, outstanding principal, and plan prepayments.
              </Text>
            </View>
          </Card>
        )}

        {/* Summary: what's still to repay across active loans, the EMIs a month and the next one
            (owner, Nov 2026, "Arth account cards"). */}
        {activeLoans.length > 0 && (() => {
          const inr = activeLoans.filter((l) => l.currency === "INR");
          const owed = inr.reduce((s, l) => s + l.outstanding, 0);
          const disbursed = inr.reduce((s, l) => s + l.principal_disbursed, 0);
          const repaid = Math.max(0, disbursed - owed);
          const emis = inr.reduce((s, l) => s + l.current_emi, 0);
          const next = inr.filter((l) => l.next_due_date).sort((a, b) => a.next_due_date!.localeCompare(b.next_due_date!))[0];
          const overdue = inr.filter((l) => l.next_overdue);
          return (
            <View style={{ marginHorizontal: -16 }}>
              <SummaryCard
                label={`Still to repay · ${activeLoans.length} ${activeLoans.length === 1 ? "loan" : "loans"}`}
                amount={owed}
                under={disbursed > 0 ? <Text className="text-meta text-muted-foreground">{formatAmount(repaid)} repaid so far · {Math.round((repaid / disbursed) * 100)}%</Text> : undefined}
              >
                {disbursed > 0 && <ShareBar value={repaid / disbursed} color={theme.primary} height={8} />}
                <View className="flex-row" style={{ gap: 8 }}>
                  <View className="flex-1 rounded-control p-3" style={{ gap: 4, backgroundColor: theme.background }}>
                    <Text className="text-meta text-muted-foreground">EMIs a month</Text>
                    <Text className="text-heading font-bold text-foreground">{formatAmount(Math.round(emis))}</Text>
                  </View>
                  <View className="flex-1 rounded-control p-3" style={{ gap: 4, backgroundColor: theme.background }}>
                    <Text className="text-meta text-muted-foreground">{overdue.length > 0 ? "Overdue" : "Next EMI"}</Text>
                    <Text className="text-heading font-bold" style={{ color: overdue.length > 0 ? theme.danger : theme.foreground }}>
                      {overdue.length > 0 ? formatAmount(Math.round(overdue.reduce((s, l) => s + (l.next_due_amount ?? 0), 0))) : next ? shortDate(next.next_due_date) : "None"}
                    </Text>
                    {overdue.length === 0 && next && (
                      <Text className="text-label text-muted-foreground" numberOfLines={1}>{next.bank_name} · {formatAmount(Math.round(next.next_due_amount ?? 0))}</Text>
                    )}
                    {overdue.length > 0 && (
                      <Text className="text-label text-muted-foreground" numberOfLines={1}>{overdue.length} {overdue.length === 1 ? "EMI" : "EMIs"} past due</Text>
                    )}
                  </View>
                </View>
              </SummaryCard>
            </View>
          );
        })()}

        {activeLoans.length > 0 && (
          <>
            <Text className="text-label font-semibold text-muted-foreground uppercase tracking-wider mt-3 mb-2 px-1">
              Active
            </Text>
            {activeLoans.map((loan) => (
              <LoanCard
                key={loan.id}
                loan={loan}
                onPress={() => router.push({ pathname: "/loans/[id]", params: { id: loan.id } })}
              />
            ))}
          </>
        )}

        {closedLoans.length > 0 && (
          <>
            <View style={{ marginHorizontal: -16 }}>
              <ClosedToggle count={closedLoans.length} noun={{ one: "settled or closed loan", many: "settled or closed loans" }} open={closedLoansExpanded} onToggle={() => setClosedLoansExpanded((e) => !e)} />
            </View>
            {closedLoansExpanded && closedLoans.map((loan) => (
              <LoanCard
                key={loan.id}
                loan={loan}
                onPress={() => router.push({ pathname: "/loans/[id]", params: { id: loan.id } })}
              />
            ))}
          </>
        )}
      </ScrollView>

      <FAB
        icon="add"
        onPress={() => router.push("/loans/add")}
        accessibilityLabel="Add loan"
      />
    </ScreenContainer>
  );
}

type LoanRow = LoanAccount & {
  bank_name: string;
  outstanding: number;
  current_emi: number;
  remaining_months: number | null;
  /** The next unpaid instalment (missing on a preloaded row until the screen loads). */
  next_due_date?: string | null;
  next_due_amount?: number | null;
  next_overdue?: boolean;
};

function LoanCard({ loan, onPress }: { loan: LoanRow; onPress: () => void }) {
  const theme = useTheme();
  const progress =
    loan.principal_disbursed > 0
      ? Math.min(100, ((loan.principal_disbursed - loan.outstanding) / loan.principal_disbursed) * 100)
      : 0;
  const active = loan.status === "active";
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={`${loan.bank_name} loan`}>
      <View className="rounded-card bg-card border border-border p-4 mb-2" style={{ gap: 12 }}>
        <View className="flex-row items-center" style={{ gap: 12 }}>
          <View className="w-10 h-10 rounded-control items-center justify-center" style={{ backgroundColor: theme.alpha("danger", 0.08) }}>
            <Ionicons name={loan.loan_type === "home" ? "home-outline" : loan.loan_type === "auto" ? "car-outline" : loan.loan_type === "education" ? "school-outline" : "cash-outline"} size={20} color={active ? theme.danger : theme.mutedForeground} />
          </View>
          <View className="flex-1" style={{ minWidth: 0 }}>
            <Text className="text-body font-bold text-foreground" numberOfLines={1}>
              {loan.bank_name} · {LOAN_TYPE_LABEL[loan.loan_type] ?? loan.loan_type}
            </Text>
            <Text className="text-meta text-muted-foreground" numberOfLines={1}>
              {loan.interest_rate_pa}% · {loan.tenure_months}mo · EMI {formatAmount(Math.round(loan.current_emi))}
            </Text>
          </View>
          <View className="items-end" style={{ maxWidth: "45%" }}>
            {loan.currency === "INR" ? (
              <AnimatedNumber value={loan.outstanding} className="text-heading font-bold text-foreground" />
            ) : (
              <Text className="text-heading font-bold text-foreground">{`${loan.currency} ${loan.outstanding.toLocaleString()}`}</Text>
            )}
            <Text className="text-meta text-muted-foreground">left to repay</Text>
          </View>
        </View>
        {/* Repaid so far - fills when the card appears. */}
        <ProgressBar value={progress / 100} color={theme.primary} height={6} delay={200} />
        <View className="flex-row justify-between" style={{ gap: 8 }}>
          <Text className="text-label text-muted-foreground">{progress.toFixed(0)}% paid · since {formatDate(loan.disbursement_date)}</Text>
          {loan.remaining_months != null && (
            <Text className="text-label text-muted-foreground">{loan.remaining_months > 0 ? `${loan.remaining_months} months left` : "Fully paid"}</Text>
          )}
        </View>
        {active && loan.next_overdue && loan.next_due_date && (
          <CardNote boxed tone="danger" text={`EMI overdue since ${shortDate(loan.next_due_date)} · ${formatAmount(Math.round(loan.next_due_amount ?? 0))}`} />
        )}
      </View>
    </PressableScale>
  );
}
