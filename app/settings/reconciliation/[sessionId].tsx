import { Ionicons } from "@expo/vector-icons";
import { TRANSFER_COLOR } from "@/constants/semantic-colors";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Modal, Pressable, View, ScrollView } from "react-native";
import * as Sharing from "expo-sharing";
import { Card, DateInput, ScreenContainer, Text } from "@/components/ui";
import { useAlert, type AlertButton } from "@/hooks/use-alert";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { getDatabase } from "@/database";
import {
  getOrCreateMonthBalance,
  computeUnseededBalance,
  isAccountSeeded,
  getAccountExpensesTotal,
  getAccountCreditsTotal,
  getAccountAdjustmentNet,
  computeClosing,
} from "@/services/account-balance";
import { getTransfersOutTotal, getTransfersInTotal } from "@/services/account-transfer";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getSession,
  getItemsEnriched,
  bulkMarkPreArth,
  undoPreArthItems,
  updateItem,
  updateSession,
  type ReconciliationSession,
  type ReconciliationItem,
  type ReconciliationItemEnriched,
  type ExcludeReason,
} from "@/services/reconciliation/reconciliation-crud";
import { generateReconciliationPdf } from "@/services/reconciliation/reconciliation-export-pdf";
import { useTheme } from "@/hooks/use-theme";

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
  const { colors } = useColorScheme();
  const theme = useTheme();

  const [session, setSession] = useState<ReconciliationSession | null>(null);
  const [items, setItems] = useState<ReconciliationItemEnriched[]>([]);
  const [accounts, setAccounts] = useState<Record<string, FinancialAccount>>({});
  const [arthBalance, setArthBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("matched");
  const [markingDone, setMarkingDone] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Pre-Arth baseline
  const [showPreArthModal, setShowPreArthModal] = useState(false);
  const [preArthPickerDate, setPreArthPickerDate] = useState("");

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const [sess, allItems, accs] = await Promise.all([
        getSession(sessionId),
        getItemsEnriched(sessionId),
        getActiveAccounts(DEFAULT_USER_ID),
      ]);
      setSession(sess);
      setItems(allItems);
      const map: Record<string, FinancialAccount> = {};
      for (const a of accs) map[a.id] = a;
      setAccounts(map);

      // Compute Arth balance as of stmt_end_date (not month-end, to avoid
      // mid-month statements showing inflated differences)
      if (sess) {
        try {
          const endDate = sess.stmt_end_date;
          const month = endDate.slice(0, 7); // YYYY-MM
          const monthStart = `${month}-01`;
          const db = getDatabase();
          const acct = await db.getFirstAsync<{ account_type: string }>(
            "SELECT account_type FROM financial_accounts WHERE id = ?",
            [sess.account_id],
          );
          const isCC = acct?.account_type === "credit_card";
          const seeded = await isAccountSeeded(sess.account_id);

          if (seeded) {
            const record = await getOrCreateMonthBalance(sess.account_id, month);
            if (record) {
              const [expenses, credits, tOut, tIn, adjNet] = await Promise.all([
                getAccountExpensesTotal(sess.account_id, monthStart, endDate),
                getAccountCreditsTotal(sess.account_id, monthStart, endDate),
                getTransfersOutTotal(sess.account_id, monthStart, endDate),
                getTransfersInTotal(sess.account_id, monthStart, endDate),
                getAccountAdjustmentNet(sess.account_id, monthStart, endDate),
              ]);
              setArthBalance(computeClosing({ opening: record.opening_balance, expenses, credits, transfersOut: tOut, transfersIn: tIn, adjustmentNet: adjNet, isCC }));
            }
          } else {
            const unseed = await computeUnseededBalance(sess.account_id, month);
            // computeUnseededBalance gives the full-month closing; for mid-month
            // statements approximate by recomputing with bounded endDate
            const [expenses, credits, tOut, tIn, adjNet] = await Promise.all([
              getAccountExpensesTotal(sess.account_id, monthStart, endDate),
              getAccountCreditsTotal(sess.account_id, monthStart, endDate),
              getTransfersOutTotal(sess.account_id, monthStart, endDate),
              getTransfersInTotal(sess.account_id, monthStart, endDate),
              getAccountAdjustmentNet(sess.account_id, monthStart, endDate),
            ]);
            setArthBalance(computeClosing({ opening: unseed.opening, expenses, credits, transfersOut: tOut, transfersIn: tIn, adjustmentNet: adjNet, isCC }));
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
  const preArthItems = items.filter((i) => i.status === "excluded" && i.exclude_reason === "pre_arth");
  const excluded = items.filter((i) => i.status === "excluded" && i.exclude_reason !== "pre_arth");

  const handleApplyPreArth = useCallback(async () => {
    if (!preArthPickerDate || !sessionId) return;
    // Store user's picked date, then mark items with stmt_date <= that date
    const cutoffExclusive = new Date(preArthPickerDate);
    cutoffExclusive.setDate(cutoffExclusive.getDate() + 1);
    const cutoffStr = cutoffExclusive.toISOString().slice(0, 10);
    await updateSession(sessionId, { pre_arth_cutoff: preArthPickerDate });
    await undoPreArthItems(sessionId);
    await bulkMarkPreArth(sessionId, cutoffStr);
    setShowPreArthModal(false);
    load();
  }, [preArthPickerDate, sessionId, load]);

  const handleClearPreArth = useCallback(() => {
    alert(
      "Clear pre-Arth baseline",
      "Move all pre-Arth excluded items back to Missing?",
      [
        {
          text: "Clear",
          onPress: async () => {
            await updateSession(sessionId!, { pre_arth_cutoff: null });
            await undoPreArthItems(sessionId!);
            load();
          },
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }, [alert, sessionId, load]);

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
        narration: item.stmt_narration ?? "",
      },
    });
  }, [router, sessionId]);

  // From Extra tab: pick a Missing statement row to pair with this Arth entry
  const handleLinkExtraToMissing = useCallback((item: ReconciliationItemEnriched) => {
    router.push({
      pathname: "/settings/reconciliation/link-extra",
      params: {
        mode: "find_missing",
        session_id: sessionId,
        item_id: item.id,
        date: item.arth_date ?? item.stmt_date,
        amount: String(item.arth_amount ?? item.stmt_amount),
      },
    });
  }, [router, sessionId]);

  // From Missing tab: pick an Extra Arth entry to pair with this statement row
  const handleLinkMissingToExtra = useCallback((item: ReconciliationItem) => {
    router.push({
      pathname: "/settings/reconciliation/link-extra",
      params: {
        mode: "find_extra",
        session_id: sessionId,
        item_id: item.id,
        date: item.stmt_date,
        amount: String(item.stmt_amount),
      },
    });
  }, [router, sessionId]);

  const handleMarkReconciled = useCallback(async () => {
    if (!session) return;
    const unresolvedCount = missing.length; // pre-Arth items are excluded, not missing
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

  const handleExport = useCallback(async () => {
    if (!session) return;
    setExporting(true);
    try {
      const uri = await generateReconciliationPdf(
        session,
        items,
        accounts[session.account_id] ?? null,
        arthBalance,
      );
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: "Reconciliation Report",
        });
      }
    } catch {
      // Non-fatal — share sheet cancelled or generation failed
    } finally {
      setExporting(false);
    }
  }, [session, items, accounts, arthBalance]);

  // ─── Tab content renderers ─────────────────────────────────────────────────

  const renderMatched = ({ item }: { item: ReconciliationItemEnriched }) => {
    const arthMeta: string[] = [];
    if (item.arth_date) arthMeta.push(formatDate(item.arth_date));
    if (item.arth_account) arthMeta.push(item.arth_account);
    if (item.arth_category) arthMeta.push(item.arth_category);
    const hasArthDetail = !!(item.arth_description || item.arth_amount != null || arthMeta.length);
    return (
      <View className="py-3 border-b border-border">
        {/* Statement side */}
        <View className="flex-row items-start justify-between">
          <View className="flex-1">
            <View className="flex-row items-center">
              <Text className="text-sm font-medium text-foreground flex-1" numberOfLines={1}>
                {item.stmt_narration || "(no narration)"}
              </Text>
              <Text className="text-sm font-semibold text-foreground ml-2">
                {item.stmt_direction === "debit" ? "−" : "+"}{amountStr(item.stmt_amount)}
              </Text>
            </View>
            <View className="flex-row items-center mt-0.5">
              <Text className="text-xs text-muted-foreground">
                {formatDate(item.stmt_date)}
              </Text>
              <View
                className="ml-2 px-2 py-0.5 rounded-full"
                style={{ backgroundColor: theme.alpha("primary", 0.13) }}
              >
                <Text className="text-label font-semibold uppercase" style={{ color: theme.primary }}>
                  {item.match_confidence ?? "manual"}
                </Text>
              </View>
              {item.matched_transfer_id && (
                <View className="ml-1 px-2 py-0.5 rounded-full" style={{ backgroundColor: "#8B5CF622" }}>
                  <Text className="text-label font-semibold uppercase" style={{ color: TRANSFER_COLOR }}>Transfer</Text>
                </View>
              )}
            </View>
          </View>
          <Pressable onPress={() => handleUnlink(item)} hitSlop={8} className="ml-3 mt-0.5">
            <Ionicons name="close-circle-outline" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
        {/* Arth side */}
        {hasArthDetail && (
          <View
            className="mt-2 pl-3"
            style={{ borderLeftWidth: 2, borderLeftColor: theme.alpha("primary", 0.33) }}
          >
            <View className="flex-row items-center">
              <Text className="text-xs font-medium text-foreground flex-1" numberOfLines={1}>
                {item.arth_description || "(no description)"}
              </Text>
              {item.arth_amount != null && (
                <Text className="text-xs font-semibold text-foreground ml-2">
                  {amountStr(item.arth_amount)}
                </Text>
              )}
            </View>
            {arthMeta.length > 0 && (
              <Text className="text-label text-muted-foreground mt-0.5" numberOfLines={1}>
                {arthMeta.join(" · ")}
              </Text>
            )}
          </View>
        )}
      </View>
    );
  };

  const renderMissing = ({ item }: { item: ReconciliationItem }) => (
    <View className="py-3 border-b border-border">
      <View className="flex-row items-start justify-between">
        <View className="flex-1">
          <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
            {item.stmt_narration || "(no narration)"}
          </Text>
          <Text className="text-xs text-muted-foreground mt-0.5">
            {formatDate(item.stmt_date)} · {item.stmt_direction === "debit" ? "−" : "+"}{amountStr(item.stmt_amount)}
          </Text>
        </View>
      </View>
      <View className="flex-row gap-2 mt-2.5">
        <Pressable
          onPress={() => handleAddExpense(item)}
          className="flex-1 flex-row items-center justify-center py-2 rounded-lg border border-border"
        >
          <Ionicons name="add" size={14} color={theme.primary} />
          <Text className="text-xs font-semibold ml-1" style={{ color: theme.primary }}>Add</Text>
        </Pressable>
        <Pressable
          onPress={() => handleManualLink(item)}
          className="flex-1 flex-row items-center justify-center py-2 rounded-lg border border-border"
        >
          <Ionicons name="link-outline" size={14} color={colors.textSecondary} />
          <Text className="text-xs font-semibold ml-1 text-muted-foreground">Link</Text>
        </Pressable>
        {added.length > 0 && (
          <Pressable
            onPress={() => handleLinkMissingToExtra(item)}
            className="flex-1 flex-row items-center justify-center py-2 rounded-lg border border-border"
          >
            <Ionicons name="git-merge-outline" size={14} color={theme.primary} />
            <Text className="text-xs font-semibold ml-1" style={{ color: theme.primary }}>Extra</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => handleExclude(item)}
          className="flex-1 flex-row items-center justify-center py-2 rounded-lg border border-border"
        >
          <Ionicons name="close-outline" size={14} color={colors.textSecondary} />
          <Text className="text-xs font-semibold ml-1 text-muted-foreground">Exclude</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderExcluded = ({ item }: { item: ReconciliationItem }) => (
    <View className="py-3 border-b border-border flex-row items-center">
      <View className="flex-1">
        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
          {item.stmt_narration || "(no narration)"}
        </Text>
        <Text className="text-xs text-muted-foreground mt-0.5">
          {formatDate(item.stmt_date)} · {item.stmt_direction === "debit" ? "−" : "+"}{amountStr(item.stmt_amount)}
          {item.exclude_reason ? ` · ${item.exclude_reason.replace("_", " ")}` : ""}
        </Text>
      </View>
      <Pressable onPress={() => handleUndoExclude(item)} hitSlop={8} className="ml-3">
        <Text className="text-xs font-semibold" style={{ color: theme.primary }}>Undo</Text>
      </Pressable>
    </View>
  );

  const EmptyTab = ({ label }: { label: string }) => (
    <View className="items-center py-12">
      <Ionicons name="checkmark-circle-outline" size={36} color={colors.textSecondary} />
      <Text className="text-sm text-muted-foreground mt-2">{label}</Text>
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
          <Text className="text-muted-foreground">Session not found.</Text>
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
    { key: "extra", label: "Extra", count: added.length },
    { key: "excluded", label: "Excluded", count: excluded.length + preArthItems.length },
  ];

  return (
    <ScreenContainer padTop={false}>
      {/* Pre-Arth date picker modal */}
      <Modal
        visible={showPreArthModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPreArthModal(false)}
      >
        <View className="flex-1 justify-center items-center px-8" style={{ backgroundColor: "#00000066" }}>
          <View className="w-full rounded-2xl p-6" style={{ backgroundColor: colors.surface }}>
            <Text className="text-base font-bold text-foreground mb-1">
              Set pre-Arth date
            </Text>
            <Text className="text-sm text-muted-foreground mb-4">
              Transactions on or before this date will be moved to Excluded. Pick the last date before you started logging in Arth.
            </Text>
            <DateInput
              value={preArthPickerDate}
              onChange={setPreArthPickerDate}
              placeholder="Pick date"
              maximumDate={new Date()}
            />
            <View className="flex-row gap-3 mt-4">
              <Pressable
                onPress={() => setShowPreArthModal(false)}
                className="flex-1 py-3 rounded-xl items-center"
                style={{ backgroundColor: colors.border + "55" }}
              >
                <Text className="text-sm font-medium text-foreground">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleApplyPreArth}
                disabled={!preArthPickerDate}
                className="flex-1 py-3 rounded-xl items-center"
                style={{ backgroundColor: preArthPickerDate ? theme.primary : colors.border }}
              >
                <Text className="text-sm font-semibold text-white">Apply</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={{ paddingBottom: session.status === "in_progress" ? 100 : 32 }}>
        {/* Summary card */}
        <View className="px-4 pt-4">
          <Card className="mb-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-foreground flex-1 mr-2">
                {account ? (account.account_label || account.bank_name) : "Account"}
              </Text>
              <Pressable onPress={handleExport} disabled={exporting} hitSlop={8}>
                {exporting
                  ? <ActivityIndicator size="small" color={colors.textSecondary} />
                  : <Ionicons name="share-outline" size={18} color={colors.textSecondary} />
                }
              </Pressable>
            </View>
            <Text className="text-xs text-muted-foreground mt-0.5">
              {session.stmt_start_date} – {session.stmt_end_date}
              {session.import_filename ? ` · ${session.import_filename}` : ""}
            </Text>

            {/* Match progress */}
            <View className="flex-row items-center mt-3">
              <View className="flex-1 h-2 bg-border rounded-full overflow-hidden">
                <View
                  className="h-full rounded-full"
                  style={{
                    width: session.total_stmt_count
                      ? `${Math.min(100, (matched.length / session.total_stmt_count) * 100)}%`
                      : "0%",
                    backgroundColor: session.status === "completed" ? theme.success : theme.primary,
                  }}
                />
              </View>
              <Text className="text-xs font-semibold ml-3 text-foreground">
                {matched.length}/{session.total_stmt_count ?? items.length} matched
              </Text>
            </View>
            {session.status === "completed" && session.completed_at && (
              <View className="flex-row items-center mt-2">
                <Ionicons name="checkmark-circle" size={14} color={theme.success} />
                <Text className="text-xs font-semibold ml-1" style={{ color: theme.success }}>
                  Reconciled on {new Date(session.completed_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </Text>
              </View>
            )}

            {/* Balance comparison */}
            {session.stmt_closing_bal != null && (
              <View className="mt-3 pt-3 border-t border-border">
                <View className="flex-row justify-between">
                  <Text className="text-xs text-muted-foreground">Statement closing</Text>
                  <Text className="text-xs font-semibold text-foreground">
                    {amountStr(session.stmt_closing_bal)}
                  </Text>
                </View>
                {arthBalance != null && (
                  <View className="flex-row justify-between mt-1">
                    <Text className="text-xs text-muted-foreground">Arth computed</Text>
                    <Text className="text-xs font-semibold text-foreground">
                      {amountStr(arthBalance)}
                    </Text>
                  </View>
                )}
                {balanceDiff !== null && (
                  <View className="flex-row justify-between mt-1">
                    <Text className="text-xs text-muted-foreground">Difference</Text>
                    <Text
                      className="text-xs font-bold"
                      style={{ color: Math.abs(balanceDiff) < 1 ? theme.success : theme.danger }}
                    >
                      {Math.abs(balanceDiff) < 1 ? "✓ Match" : amountStr(Math.abs(balanceDiff))}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Pre-Arth baseline row */}
            {session.status === "in_progress" && (
              <View className="mt-3 pt-3 border-t border-border flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="text-xs font-semibold text-muted-foreground">
                    Pre-Arth baseline
                  </Text>
                  {session.pre_arth_cutoff ? (
                    <Text className="text-xs font-medium text-foreground mt-0.5">
                      Up to {new Date(session.pre_arth_cutoff).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · {preArthItems.length} items excluded
                    </Text>
                  ) : (
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      Not set
                    </Text>
                  )}
                </View>
                {session.pre_arth_cutoff ? (
                  <View className="flex-row gap-3 ml-3">
                    <Pressable onPress={() => { setPreArthPickerDate(session.pre_arth_cutoff!); setShowPreArthModal(true); }}>
                      <Text className="text-xs font-semibold" style={{ color: theme.primary }}>Change</Text>
                    </Pressable>
                    <Pressable onPress={handleClearPreArth}>
                      <Text className="text-xs font-semibold text-muted-foreground">Clear</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => {
                      setPreArthPickerDate(session.stmt_start_date);
                      setShowPreArthModal(true);
                    }}
                    className="ml-3"
                  >
                    <Text className="text-xs font-semibold" style={{ color: theme.primary }}>Set date</Text>
                  </Pressable>
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
                    backgroundColor: active ? theme.primary : colors.border + "44",
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
          {activeTab === "extra" && (
            added.length === 0
              ? <EmptyTab label="No extra Arth entries in this period." />
              : added.map((item) => (
                  <View key={item.id} className="py-3 border-b border-border">
                    <View className="flex-row items-start justify-between">
                      <View className="flex-1">
                        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                          {item.arth_description || item.stmt_narration || "(no description)"}
                        </Text>
                        <Text className="text-xs text-muted-foreground mt-0.5">
                          {item.arth_date ? formatDate(item.arth_date) : formatDate(item.stmt_date)}
                          {" · "}{item.stmt_direction === "debit" ? "−" : "+"}{amountStr(item.arth_amount ?? item.stmt_amount)}
                          {item.arth_category ? ` · ${item.arth_category}` : ""}
                        </Text>
                        {item.arth_account && (
                          <Text className="text-xs text-muted-foreground mt-0.5">
                            {item.arth_account}
                          </Text>
                        )}
                      </View>
                      <View className="ml-3 px-2 py-0.5 rounded-full" style={{ backgroundColor: "#F59E0B22" }}>
                        <Text className="text-label font-semibold uppercase" style={{ color: theme.warning }}>
                          {item.matched_transfer_id ? "Transfer" : "Expense"}
                        </Text>
                      </View>
                    </View>
                    {missing.length > 0 && (
                      <Pressable
                        onPress={() => handleLinkExtraToMissing(item)}
                        className="flex-row items-center mt-2.5 py-2 px-3 rounded-lg border border-border self-start"
                      >
                        <Ionicons name="git-merge-outline" size={14} color={theme.primary} />
                        <Text className="text-xs font-semibold ml-1" style={{ color: theme.primary }}>Link to statement row</Text>
                      </Pressable>
                    )}
                  </View>
                ))
          )}
          {activeTab === "excluded" && (
            excluded.length === 0 && preArthItems.length === 0
              ? <EmptyTab label="Nothing excluded." />
              : <>
                  {preArthItems.length > 0 && (
                    <>
                      <View className="flex-row items-center mb-2 mt-1">
                        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Pre-Arth period ({preArthItems.length})
                        </Text>
                        <View className="flex-1 h-px ml-2" style={{ backgroundColor: colors.border }} />
                      </View>
                      {preArthItems.map((item) => (
                        <View key={item.id} className="py-2.5 border-b border-border flex-row items-center opacity-50">
                          <View className="flex-1">
                            <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                              {item.stmt_narration || "(no narration)"}
                            </Text>
                            <Text className="text-xs text-muted-foreground mt-0.5">
                              {formatDate(item.stmt_date)} · {item.stmt_direction === "debit" ? "−" : "+"}{amountStr(item.stmt_amount)}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </>
                  )}
                  {excluded.length > 0 && (
                    <>
                      {preArthItems.length > 0 && (
                        <View className="flex-row items-center mb-2 mt-3">
                          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Manually excluded ({excluded.length})
                          </Text>
                          <View className="flex-1 h-px ml-2" style={{ backgroundColor: colors.border }} />
                        </View>
                      )}
                      {excluded.map((item) => renderExcluded({ item }))}
                    </>
                  )}
                </>
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
            style={{ backgroundColor: missing.length === 0 ? theme.success : theme.primary }}
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

    </ScreenContainer>
  );
}
