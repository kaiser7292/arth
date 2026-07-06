import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, SectionList,
  Text, View, ScrollView,
} from "react-native";
import { Card, ScreenContainer } from "@/components/ui";
import { useAlert, type AlertButton } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { getMonthBalanceSummary, computeUnseededBalance, isAccountSeeded } from "@/services/account-balance";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getSession,
  getItems,
  updateItem,
  updateSession,
  type ReconciliationSession,
  type ReconciliationItem,
  type ExcludeReason,
} from "@/services/reconciliation/reconciliation-crud";

type Tab = "matched" | "missing" | "extra" | "excluded";

const EXCLUDE_REASONS: { value: ExcludeReason; label: string }[] = [
  { value: "cashback", label: "Cashback" },
  { value: "bank_charge", label: "Bank charge" },
  { value: "reward_fee", label: "Reward / fee" },
  { value: "refund", label: "Refund" },
  { value: "other", label: "Other" },
];

function amountStr(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function ReconciliationSessionScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const alert = useAlert();
  const { colors, accent } = useColorScheme();

  const [session, setSession] = useState<ReconciliationSession | null>(null);
  const [items, setItems] = useState<ReconciliationItem[]>([]);
  const [accounts, setAccounts] = useState<Record<string, FinancialAccount>>({});
  const [arthBalance, setArthBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("matched");
  const [markingDone, setMarkingDone] = useState(false);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const [sess, allItems, accs] = await Promise.all([
        getSession(sessionId),
        getItems(sessionId),
        getActiveAccounts(DEFAULT_USER_ID),
      ]);
      setSession(sess);
      setItems(allItems);
      const map: Record<string, FinancialAccount> = {};
      for (const a of accs) map[a.id] = a;
      setAccounts(map);

      // Compute Arth closing balance for the statement period
      if (sess) {
        try {
          const month = sess.stmt_end_date.slice(0, 7); // YYYY-MM
          const seeded = await isAccountSeeded(sess.account_id);
          if (seeded) {
            const summary = await getMonthBalanceSummary(sess.account_id, month);
            setArthBalance(summary?.closing_balance ?? null);
          } else {
            const unseed = await computeUnseededBalance(sess.account_id, month);
            setArthBalance(unseed?.closing ?? null);
          }
        } catch {
          // balance check non-fatal
        }
      }
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const matched = items.filter((i) => i.status === "matched");
  const missing = items.filter((i) => i.status === "unmatched");
  const added = items.filter((i) => i.status === "added");
  const excluded = items.filter((i) => i.status === "excluded");
  // Extra = items that exist in Arth but not matched (tracked separately — for now shown via unmatched with no stmt data)

  const handleUnlink = useCallback((item: ReconciliationItem) => {
    alert("Unlink match", "Move this back to the Missing tab to re-review?", [
      { text: "Unlink", onPress: async () => {
        await updateItem(item.id, {
          status: "unmatched",
          matched_expense_id: null,
          matched_transfer_id: null,
          match_confidence: null,
        });
        load();
      }},
      { text: "Cancel", style: "cancel" },
    ]);
  }, [alert, load]);

  const handleExclude = useCallback((item: ReconciliationItem) => {
    const buttons: AlertButton[] = [
      ...EXCLUDE_REASONS.map((r) => ({
        text: r.label,
        onPress: async () => {
          await updateItem(item.id, { status: "excluded", exclude_reason: r.value });
          load();
        },
      })),
      { text: "Cancel", style: "cancel" as const },
    ];
    alert("Mark as excluded", "What type of entry is this?", buttons);
  }, [alert, load]);

  const handleUndoExclude = useCallback(async (item: ReconciliationItem) => {
    await updateItem(item.id, { status: "unmatched", exclude_reason: null });
    load();
  }, [load]);

  const handleAddExpense = useCallback((item: ReconciliationItem) => {
    router.push({
      pathname: "/expense/add",
      params: {
        prefill_date: item.stmt_date,
        prefill_amount: String(item.stmt_amount),
        prefill_direction: item.stmt_direction,
        prefill_narration: item.stmt_narration ?? "",
        recon_item_id: item.id,
      },
    });
  }, [router]);

  const handleManualLink = useCallback((item: ReconciliationItem) => {
    router.push({
      pathname: "/settings/reconciliation/manual-link",
      params: {
        item_id: item.id,
        session_id: sessionId,
        direction: item.stmt_direction,
        amount: String(item.stmt_amount),
        date: item.stmt_date,
      },
    });
  }, [router, sessionId]);

  const handleMarkReconciled = useCallback(async () => {
    if (!session) return;
    const unresolvedCount = missing.length;
    if (unresolvedCount > 0) {
      alert(
        "Unresolved items",
        `${unresolvedCount} statement item${unresolvedCount !== 1 ? "s" : ""} are still unmatched. Mark as reconciled anyway?`,
        [
          {
            text: "Mark reconciled",
            onPress: async () => {
              setMarkingDone(true);
              await updateSession(session.id, {
                status: "completed",
                matched_count: matched.length,
                completed_at: new Date().toISOString(),
              });
              router.back();
            },
          },
          { text: "Keep reviewing", style: "cancel" },
        ],
      );
    } else {
      setMarkingDone(true);
      await updateSession(session.id, {
        status: "completed",
        matched_count: matched.length,
        completed_at: new Date().toISOString(),
      });
      router.back();
    }
  }, [session, missing.length, matched.length, alert, router]);

  // ─── Tab content renderers ─────────────────────────────────────────────────

  const renderMatched = ({ item }: { item: ReconciliationItem }) => (
    <View className="py-3 border-b border-border-light dark:border-border-dark">
      <View className="flex-row items-start justify-between">
        <View className="flex-1">
          <View className="flex-row items-center">
            <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary flex-1" numberOfLines={1}>
              {item.stmt_narration || "(no narration)"}
            </Text>
            <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary ml-2">
              {item.stmt_direction === "debit" ? "−" : "+"}{amountStr(item.stmt_amount)}
            </Text>
          </View>
          <View className="flex-row items-center mt-0.5">
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
              {formatDate(item.stmt_date)}
            </Text>
            <View
              className="ml-2 px-2 py-0.5 rounded-full"
              style={{ backgroundColor: accent[500] + "22" }}
            >
              <Text className="text-[10px] font-semibold uppercase" style={{ color: accent[600] }}>
                {item.match_confidence ?? "manual"}
              </Text>
            </View>
            {item.matched_transfer_id && (
              <View className="ml-1 px-2 py-0.5 rounded-full" style={{ backgroundColor: "#8B5CF622" }}>
                <Text className="text-[10px] font-semibold uppercase" style={{ color: "#8B5CF6" }}>Transfer</Text>
              </View>
            )}
          </View>
        </View>
        <Pressable onPress={() => handleUnlink(item)} hitSlop={8} className="ml-3 mt-0.5">
          <Ionicons name="close-circle-outline" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );

  const renderMissing = ({ item }: { item: ReconciliationItem }) => (
    <View className="py-3 border-b border-border-light dark:border-border-dark">
      <View className="flex-row items-start justify-between">
        <View className="flex-1">
          <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary" numberOfLines={1}>
            {item.stmt_narration || "(no narration)"}
          </Text>
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
            {formatDate(item.stmt_date)} · {item.stmt_direction === "debit" ? "−" : "+"}{amountStr(item.stmt_amount)}
          </Text>
        </View>
      </View>
      <View className="flex-row gap-2 mt-2.5">
        <Pressable
          onPress={() => handleAddExpense(item)}
          className="flex-1 flex-row items-center justify-center py-2 rounded-lg border border-border-light dark:border-border-dark"
        >
          <Ionicons name="add" size={14} color={accent[500]} />
          <Text className="text-xs font-semibold ml-1" style={{ color: accent[500] }}>Add</Text>
        </Pressable>
        <Pressable
          onPress={() => handleManualLink(item)}
          className="flex-1 flex-row items-center justify-center py-2 rounded-lg border border-border-light dark:border-border-dark"
        >
          <Ionicons name="link-outline" size={14} color={colors.textSecondary} />
          <Text className="text-xs font-semibold ml-1 text-text-secondary dark:text-text-dark-secondary">Link</Text>
        </Pressable>
        <Pressable
          onPress={() => handleExclude(item)}
          className="flex-1 flex-row items-center justify-center py-2 rounded-lg border border-border-light dark:border-border-dark"
        >
          <Ionicons name="close-outline" size={14} color={colors.textSecondary} />
          <Text className="text-xs font-semibold ml-1 text-text-secondary dark:text-text-dark-secondary">Exclude</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderExcluded = ({ item }: { item: ReconciliationItem }) => (
    <View className="py-3 border-b border-border-light dark:border-border-dark flex-row items-center">
      <View className="flex-1">
        <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary" numberOfLines={1}>
          {item.stmt_narration || "(no narration)"}
        </Text>
        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
          {formatDate(item.stmt_date)} · {item.stmt_direction === "debit" ? "−" : "+"}{amountStr(item.stmt_amount)}
          {item.exclude_reason ? ` · ${item.exclude_reason.replace("_", " ")}` : ""}
        </Text>
      </View>
      <Pressable onPress={() => handleUndoExclude(item)} hitSlop={8} className="ml-3">
        <Text className="text-xs font-semibold" style={{ color: accent[500] }}>Undo</Text>
      </Pressable>
    </View>
  );

  const EmptyTab = ({ label }: { label: string }) => (
    <View className="items-center py-12">
      <Ionicons name="checkmark-circle-outline" size={36} color={colors.textSecondary} />
      <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-2">{label}</Text>
    </View>
  );

  if (loading) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </ScreenContainer>
    );
  }

  if (!session) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary dark:text-text-dark-secondary">Session not found.</Text>
        </View>
      </ScreenContainer>
    );
  }

  const account = accounts[session.account_id];
  const balanceDiff =
    session.stmt_closing_bal != null && arthBalance != null
      ? session.stmt_closing_bal - arthBalance
      : null;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "matched", label: "Matched", count: matched.length },
    { key: "missing", label: "Missing", count: missing.length },
    { key: "excluded", label: "Excluded", count: excluded.length },
  ];

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Summary card */}
        <View className="px-4 pt-4">
          <Card className="mb-4">
            <Text className="text-base font-bold text-text-primary dark:text-text-dark-primary">
              {account ? (account.account_label || account.bank_name) : "Account"}
            </Text>
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
              {session.stmt_start_date} – {session.stmt_end_date}
              {session.import_filename ? ` · ${session.import_filename}` : ""}
            </Text>

            {/* Match progress */}
            <View className="flex-row items-center mt-3">
              <View className="flex-1 h-2 bg-border-light dark:bg-border-dark rounded-full overflow-hidden">
                <View
                  className="h-full rounded-full"
                  style={{
                    width: session.total_stmt_count
                      ? `${Math.min(100, (matched.length / session.total_stmt_count) * 100)}%`
                      : "0%",
                    backgroundColor: accent[500],
                  }}
                />
              </View>
              <Text className="text-xs font-semibold ml-3 text-text-primary dark:text-text-dark-primary">
                {matched.length}/{session.total_stmt_count ?? items.length} matched
              </Text>
            </View>

            {/* Balance comparison */}
            {session.stmt_closing_bal != null && (
              <View className="mt-3 pt-3 border-t border-border-light dark:border-border-dark">
                <View className="flex-row justify-between">
                  <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Statement closing</Text>
                  <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary">
                    {amountStr(session.stmt_closing_bal)}
                  </Text>
                </View>
                {arthBalance != null && (
                  <View className="flex-row justify-between mt-1">
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Arth computed</Text>
                    <Text className="text-xs font-semibold text-text-primary dark:text-text-dark-primary">
                      {amountStr(arthBalance)}
                    </Text>
                  </View>
                )}
                {balanceDiff !== null && (
                  <View className="flex-row justify-between mt-1">
                    <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">Difference</Text>
                    <Text
                      className="text-xs font-bold"
                      style={{ color: Math.abs(balanceDiff) < 1 ? "#22C55E" : "#EF4444" }}
                    >
                      {Math.abs(balanceDiff) < 1 ? "✓ Match" : amountStr(Math.abs(balanceDiff))}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </Card>

          {/* Tabs */}
          <View className="flex-row mb-4 gap-1">
            {tabs.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <Pressable
                  key={tab.key}
                  onPress={() => setActiveTab(tab.key)}
                  className="flex-1 py-2 rounded-xl items-center"
                  style={{
                    backgroundColor: active ? accent[500] : colors.border + "44",
                  }}
                >
                  <Text
                    className="text-xs font-semibold"
                    style={{ color: active ? "#fff" : colors.textSecondary }}
                  >
                    {tab.label}
                  </Text>
                  <Text
                    className="text-base font-bold"
                    style={{ color: active ? "#fff" : colors.text }}
                  >
                    {tab.count}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Tab content */}
          {activeTab === "matched" && (
            matched.length === 0
              ? <EmptyTab label="No matched transactions yet." />
              : matched.map((item) => renderMatched({ item }))
          )}
          {activeTab === "missing" && (
            missing.length === 0
              ? <EmptyTab label="All statement transactions are matched or excluded." />
              : missing.map((item) => renderMissing({ item }))
          )}
          {activeTab === "excluded" && (
            excluded.length === 0
              ? <EmptyTab label="Nothing excluded." />
              : excluded.map((item) => renderExcluded({ item }))
          )}
        </View>
      </ScrollView>

      {/* Mark Reconciled button */}
      {session.status === "in_progress" && (
        <View className="absolute bottom-6 left-4 right-4">
          <Pressable
            onPress={handleMarkReconciled}
            disabled={markingDone}
            className="py-4 rounded-2xl items-center"
            style={{ backgroundColor: missing.length === 0 ? "#22C55E" : accent[500] }}
          >
            {markingDone ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-base font-semibold text-white">
                {missing.length === 0 ? "✓ Mark Reconciled" : `Mark Reconciled (${missing.length} unresolved)`}
              </Text>
            )}
          </Pressable>
        </View>
      )}

      {session.status === "completed" && (
        <View className="absolute bottom-6 left-4 right-4">
          <View className="py-4 rounded-2xl items-center" style={{ backgroundColor: "#22C55E22" }}>
            <Text className="text-base font-semibold" style={{ color: "#22C55E" }}>
              ✓ Reconciled on {session.completed_at ? formatDate(session.completed_at) : ""}
            </Text>
          </View>
        </View>
      )}
    </ScreenContainer>
  );
}
