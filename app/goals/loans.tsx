import { useState, useCallback, useRef } from "react";
import { View, Text, Pressable, ScrollView, RefreshControl } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card, FAB, LoadingState } from "@/components/ui";
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
import { ac, acAlpha } from "@/utils/accent";

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
  const { colors, accent, colorScheme } = useColorScheme();
  const [loans, setLoans] = useState<Array<LoanAccount & {
    bank_name: string;
    outstanding: number;
    current_emi: number;
    remaining_months: number | null;
  }>>(preloaded?.loans ?? []);
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
    const today = new Date().toISOString().split("T")[0];
    const [all, outstandingMap, emiMap] = await Promise.all([
      listAllLoansWithBankName(DEFAULT_USER_ID),
      getLoanOutstandingsByLoanId(DEFAULT_USER_ID, today),
      getCurrentEMIsByLoanId(DEFAULT_USER_ID, today),
    ]);
    const allIds = all.map((l) => l.id);
    const scheduleMap = await getSchedulesByLoanIds(allIds);
    const enriched = all.map((loan) => ({
      ...loan,
      bank_name: loan.bank_name ?? "Loan",
      outstanding: outstandingMap.get(loan.id) ?? 0,
      current_emi: emiMap.get(loan.id) ?? loan.emi_amount,
      remaining_months: (scheduleMap.get(loan.id) ?? []).filter((e) => e.status === "scheduled").length,
    }));
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />
        }
      >
        {loans.length === 0 && (
          <Card className="mb-4">
            <View className="items-center py-8">
              <View
                className="w-14 h-14 rounded-full items-center justify-center mb-3"
                style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}
              >
                <Ionicons name="cash-outline" size={28} color={colors.blue} />
              </View>
              <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary mb-1">
                No loans yet
              </Text>
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary text-center px-6">
                Add a loan to track amortization, outstanding principal, and plan prepayments.
              </Text>
            </View>
          </Card>
        )}

        {activeLoans.length > 0 && (
          <>
            <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary uppercase tracking-wider mb-2">
              Active
            </Text>
            {activeLoans.map((loan) => (
              <LoanCard
                key={loan.id}
                loan={loan}
                onPress={() => router.push({ pathname: "/loans/[id]", params: { id: loan.id } } as never)}
              />
            ))}
          </>
        )}

        {closedLoans.length > 0 && (
          <>
            <Pressable
              onPress={() => setClosedLoansExpanded(e => !e)}
              className="flex-row items-center mt-4 mb-2"
            >
              <Ionicons name="archive-outline" size={14} color={colors.textSecondary} style={{ marginRight: 6 }} />
              <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary uppercase tracking-wider flex-1">
                {closedLoans.length} settled / closed {closedLoans.length === 1 ? "loan" : "loans"}
              </Text>
              <Ionicons name={closedLoansExpanded ? "chevron-up-outline" : "chevron-down-outline"} size={14} color={colors.textSecondary} />
            </Pressable>
            {closedLoansExpanded && closedLoans.map((loan) => (
              <LoanCard
                key={loan.id}
                loan={loan}
                onPress={() => router.push({ pathname: "/loans/[id]", params: { id: loan.id } } as never)}
              />
            ))}
          </>
        )}
      </ScrollView>

      <FAB
        icon="add"
        onPress={() => router.push("/loans/add" as never)}
        accessibilityLabel="Add loan"
      />
    </ScreenContainer>
  );
}

function LoanCard({
  loan,
  onPress,
}: {
  loan: LoanAccount & { bank_name: string; outstanding: number; current_emi: number; remaining_months: number | null };
  onPress: () => void;
}) {
  const { colors, accent, colorScheme } = useColorScheme();
  const progress =
    loan.principal_disbursed > 0
      ? Math.min(100, ((loan.principal_disbursed - loan.outstanding) / loan.principal_disbursed) * 100)
      : 0;
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card className="mb-3">
        <View className="flex-row items-start mb-2">
          <View
            className="w-10 h-10 rounded-full items-center justify-center mr-3"
            style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}
          >
            <Ionicons name="cash-outline" size={20} color={colors.blue} />
          </View>
          <View className="flex-1">
            <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
              {loan.bank_name} · {LOAN_TYPE_LABEL[loan.loan_type] ?? loan.loan_type}
            </Text>
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
              {loan.tenure_months}mo @ {loan.interest_rate_pa}% · EMI {formatAmount(Math.round(loan.current_emi))}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
              Outstanding
            </Text>
            <Text className="text-sm font-bold text-danger">
              {loan.currency === "INR" ? formatAmount(loan.outstanding) : `${loan.currency} ${loan.outstanding.toLocaleString()}`}
            </Text>
          </View>
        </View>
        <View
          style={{
            height: 4,
            backgroundColor: colors.border,
            borderRadius: 2,
            overflow: "hidden",
            marginTop: 4,
          }}
        >
          <View
            style={{
              height: 4,
              width: `${progress}%`,
              backgroundColor: ac(accent, colorScheme, 500, 400),
            }}
          />
        </View>
        <Text className="text-xs text-text-tertiary mt-1">
          {progress.toFixed(0)}% paid{loan.remaining_months != null ? ` · ${loan.remaining_months > 0 ? `${loan.remaining_months}mo remaining` : "Fully paid"}` : ""} · Disbursed {formatDate(loan.disbursement_date)}
        </Text>
      </Card>
    </Pressable>
  );
}
