import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { ConfirmSheet, FAB, ProgressBar, ScreenContainer } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getSessions, deleteSession, type ReconciliationSession } from "@/services/reconciliation/reconciliation-crud";

function statusLabel(status: string): string {
  if (status === "completed") return "Completed";
  if (status === "in_progress") return "In progress";
  return "Abandoned";
}

function statusColor(status: string, accent: any, colors: any): string {
  if (status === "completed") return "#22C55E";
  if (status === "in_progress") return accent[500];
  return colors.textSecondary;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export default function ReconciliationHubScreen() {
  const router = useRouter();
  const { colors, accent } = useColorScheme();

  const [sessions, setSessions] = useState<ReconciliationSession[]>([]);
  const [accounts, setAccounts] = useState<Record<string, FinancialAccount>>({});
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<ReconciliationSession | null>(null);

  const load = useCallback(async () => {
    try {
      const [sess, accs] = await Promise.all([
        getSessions(),
        getActiveAccounts(DEFAULT_USER_ID),
      ]);
      setSessions(sess);
      const map: Record<string, FinancialAccount> = {};
      for (const a of accs) map[a.id] = a;
      setAccounts(map);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    await deleteSession(deleteTarget.id);
    load();
  }, [deleteTarget, load]);

  const renderItem = ({ item }: { item: ReconciliationSession }) => {
    const account = accounts[item.account_id];
    const color = statusColor(item.status, accent, colors);
    const matchRatio = item.total_stmt_count
      ? (item.matched_count ?? 0) / item.total_stmt_count
      : null;
    const matchLabel = item.total_stmt_count
      ? `${item.matched_count ?? 0} / ${item.total_stmt_count} matched`
      : null;

    return (
      <Pressable
        onPress={() => router.push(`/settings/reconciliation/${item.id}`)}
        onLongPress={() => setDeleteTarget(item)}
        delayLongPress={400}
        className="py-3.5 border-b border-border-light dark:border-border-dark"
      >
        <View className="flex-row items-center">
          <View
            className="w-9 h-9 rounded-full items-center justify-center mr-3"
            style={{ backgroundColor: color + "22" }}
          >
            <Ionicons
              name={item.status === "completed" ? "checkmark-circle-outline" : "ellipse-outline"}
              size={18}
              color={color}
            />
          </View>
          <View className="flex-1 min-w-0">
            <Text className="text-base font-medium text-text-primary dark:text-text-dark-primary" numberOfLines={1}>
              {account ? (account.account_label || account.bank_name) : "Unknown account"}
            </Text>
            <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
              {item.stmt_start_date && item.stmt_end_date
                ? `${formatDate(item.stmt_start_date)} – ${formatDate(item.stmt_end_date)}`
                : formatDate(item.created_at)}
            </Text>
          </View>
          <View className="items-end ml-3 shrink-0">
            <Text className="text-xs font-semibold" style={{ color }}>
              {statusLabel(item.status)}
            </Text>
            {item.import_format && (
              <Text className="text-[10px] text-text-tertiary uppercase mt-0.5">
                {item.import_format}
              </Text>
            )}
          </View>
          <Pressable onPress={() => setDeleteTarget(item)} hitSlop={8} className="ml-3">
            <Ionicons name="trash-outline" size={16} color="#EF444466" />
          </Pressable>
        </View>

        {/* Inline match progress */}
        {matchRatio !== null && (
          <View className="mt-2 ml-12 mr-10">
            <ProgressBar value={matchRatio} height={3} animated={false} />
            <Text className="text-[10px] text-text-tertiary dark:text-text-dark-tertiary mt-1">
              {matchLabel}
            </Text>
          </View>
        )}
      </Pressable>
    );
  };

  const deleteAccount = deleteTarget ? accounts[deleteTarget.account_id] : null;
  const deleteLabel = deleteAccount
    ? (deleteAccount.account_label || deleteAccount.bank_name)
    : undefined;

  return (
    <ScreenContainer padTop={false}>
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : sessions.length === 0 ? (
        <View className="flex-1 items-center justify-center pb-16 px-10">
          <Ionicons name="checkmark-done-outline" size={48} color={colors.textSecondary} />
          <Text className="text-lg font-semibold text-text-primary dark:text-text-dark-primary mt-4 text-center">
            No reconciliations yet
          </Text>
          <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-1 text-center">
            Import a bank statement to match it against your Arth ledger and spot any gaps.
          </Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 80 }}
          ListHeaderComponent={
            <Text className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-dark-secondary mt-5 mb-1">
              {sessions.length} session{sessions.length !== 1 ? "s" : ""}
            </Text>
          }
        />
      )}
      <FAB icon="add" onPress={() => router.push("/settings/reconciliation/new")} />

      <ConfirmSheet
        visible={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete reconciliation?"
        context={deleteLabel}
        message={
          deleteTarget?.stmt_start_date && deleteTarget?.stmt_end_date
            ? `${formatDate(deleteTarget.stmt_start_date)} – ${formatDate(deleteTarget.stmt_end_date)}`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        onConfirm={handleConfirmDelete}
      />
    </ScreenContainer>
  );
}
