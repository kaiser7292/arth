import { useState, useEffect, useCallback, useMemo } from "react";

import { Sheet, Text } from "@/components/ui";
import { View, TextInput, Pressable,  FlatList, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { formatAmount } from "@/utils/format";
import { todayIso, addDays } from "@/utils/date";
import { CalendarModal } from "@/components/ui/CalendarModal";
import type { SimulationEntry } from "@/services/simulator";
import { getDatabase } from "@/database";
import { useTheme, type Theme } from "@/hooks/use-theme";

interface Candidate {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  merchant: string | null;
  nature: string;
  account_label: string | null;
  bank_name: string | null;
  account_identifier: string | null;
}

interface Props {
  visible: boolean;
  entry: SimulationEntry | null;
  userId: string;
  onReschedule: (entryId: string, newDate: string) => void | Promise<void>;
  onLinkFulfillment: (entryId: string, expenseIds: string[]) => void | Promise<void>;
  onRemove: (entryId: string) => void | Promise<void>;
  onClose: () => void;
}

function prettyDate(ymd: string): string {
  if (!ymd) return "";
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return ymd;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Takes the theme as an argument. This is a plain helper, not a component, so it must not
 *  call a hook: it is invoked conditionally, and a hook that runs on some renders and not
 *  others changes the hook count between renders, which React throws on. */
function natureBadge(nature: string, theme: Theme): { label: string; color: string } {
  switch (nature) {
    case "credit": return { label: "Credit", color: theme.success };
    case "ledger_adjustment": return { label: "Adjustment", color: theme.warning };
    default: return { label: "Expense", color: theme.mutedForeground };
  }
}

function candidateAccountStr(c: Candidate): string {
  if (c.bank_name && c.account_identifier) {
    const last4 = c.account_identifier.replace(/\s/g, "").slice(-4);
    return `${c.bank_name} ···${last4}`;
  }
  if (c.account_label) return c.account_label;
  if (c.bank_name) return c.bank_name;
  return "";
}

export function StaleEntryResolveSheet({
  visible,
  entry,
  userId,
  onLinkFulfillment,
  onReschedule,
  onRemove,
  onClose,
}: Props) {
  const { colors } = useColorScheme();
  const theme = useTheme();

  const [mode, setMode] = useState<"root" | "reschedule" | "link">("root");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [reschedulePickerVisible, setReschedulePickerVisible] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!visible) return;
    setMode("root");
    setSelectedIds(new Set());
    setSearchQuery("");

  }, [visible]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const loadCandidates = useCallback(async () => {
    if (!entry) return;
    setLoadingCandidates(true);
    try {
      const windowStart = addDays(entry.date, -30);
      const windowEnd = todayIso();
      const db = getDatabase();
      const rows = await db.getAllAsync<Candidate>(
        `SELECT e.id, e.date, e.amount, e.description, e.merchant_name as merchant, e.nature,
                fa.account_label, fa.bank_name, fa.account_identifier
         FROM expenses e
         LEFT JOIN financial_accounts fa ON fa.id = e.account_id
         WHERE e.user_id = ?
           AND e.nature IN ('realized', 'credit', 'ledger_adjustment')
           AND e.status = 'approved'
           AND e.deleted_at IS NULL
           AND e.date >= ?
           AND e.date <= ?
           AND e.id NOT IN (
             SELECT sef.expense_id FROM simulation_entry_fulfillments sef
           )
           AND e.id NOT IN (
             SELECT se.fulfilled_expense_id FROM simulation_entries se
             WHERE se.fulfilled_expense_id IS NOT NULL
           )
         ORDER BY e.date DESC;`,
        userId,
        windowStart,
        windowEnd,
      );
      setCandidates(rows);
    } finally {
      setLoadingCandidates(false);
    }
  }, [entry, userId]);

  useEffect(() => {
    if (mode === "link") void loadCandidates();
  }, [mode, loadCandidates]);



  const query = searchQuery.toLowerCase().trim();
  const filteredCandidates = useMemo(() => {
    if (!query) return candidates;
    return candidates.filter(
      (c) =>
        (c.merchant ?? "").toLowerCase().includes(query) ||
        (c.description ?? "").toLowerCase().includes(query) ||
        String(c.amount).includes(query),
    );
  }, [candidates, query]);

  if (!visible || !entry) return null;

  const headerLabel =
    entry.description || entry.merchant_name || (entry.direction === "out" ? "Outgoing" : "Incoming");

  const selectedTotal = candidates
    .filter((c) => selectedIds.has(c.id))
    .reduce((s, c) => s + c.amount, 0);
  const variance = selectedTotal - entry.amount;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderCandidate = ({ item: c }: { item: Candidate }) => {
    const isSelected = selectedIds.has(c.id);
    const badge = natureBadge(c.nature, theme);
    const acctStr = candidateAccountStr(c);
    const showDescription = !!(c.description && c.merchant && c.description !== c.merchant);
    const metaParts: string[] = [prettyDate(c.date)];
    if (acctStr) metaParts.push(acctStr);
    return (
      <Pressable
        onPress={() => toggleSelect(c.id)}
        className="flex-row items-center py-2.5 px-3 rounded-lg mb-1.5"
        style={{
          backgroundColor: isSelected ? theme.alpha("primary", 0.1) : colors.surface,
          borderWidth: 1,
          borderColor: isSelected ? theme.alpha("primary", 0.33) : colors.border,
        }}
      >
        <Ionicons
          name={isSelected ? "checkbox" : "square-outline"}
          size={20}
          color={isSelected ? theme.primary : colors.textSecondary}
        />
        <View className="flex-1 ml-2">
          <View className="flex-row items-center">
            <Text className="text-sm font-semibold flex-1" style={{ color: colors.text }} numberOfLines={1}>
              {c.merchant || c.description || "Transaction"}
            </Text>
            <View className="rounded-full px-1.5 py-0.5 ml-1" style={{ backgroundColor: badge.color + "18" }}>
              <Text className="text-label font-semibold" style={{ color: badge.color }}>
                {badge.label}
              </Text>
            </View>
          </View>
          {showDescription && (
            <Text className="text-xs mt-0.5" numberOfLines={1} style={{ color: colors.textSecondary }}>
              {c.description}
            </Text>
          )}
          <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
            {metaParts.join(" · ")}
          </Text>
        </View>
        <Text className="text-sm font-bold ml-2" style={{ color: colors.text }}>
          {formatAmount(c.amount)}
        </Text>
      </Pressable>
    );
  };

  return (
    <Sheet visible={visible} onClose={handleClose}>
      <View className="px-5 pb-3">
        <Text className="text-base font-bold" style={{ color: colors.text }}>
          {headerLabel}
        </Text>
        <Text className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>
          {formatAmount(entry.amount)} planned for {prettyDate(entry.date)}
          {entry.date < todayIso() ? " · that date has passed" : ""}
        </Text>
      </View>

      {mode === "root" && (
        <View className="px-5 pb-4">
          <Pressable
            onPress={() => setMode("link")}
            className="flex-row items-center py-3 px-4 rounded-xl mb-2"
            style={{ backgroundColor: theme.alpha("primary", 0.1), borderWidth: 1, borderColor: theme.alpha("primary", 0.33) }}
            accessibilityRole="button"
          >
            <Ionicons name="checkmark-circle-outline" size={20} color={theme.primary} />
            <View className="flex-1 ml-3">
              <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                It happened - link to transactions
              </Text>
              <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                Select one or more matching transactions from your ledger.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </Pressable>

          <Pressable
            onPress={() => setReschedulePickerVisible(true)}
            className="flex-row items-center py-3 px-4 rounded-xl mb-2"
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
            accessibilityRole="button"
          >
            <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
            <View className="flex-1 ml-3">
              <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                Reschedule
              </Text>
              <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                It'll happen later than planned. Pick a new date.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </Pressable>

          <Pressable
            onPress={async () => {
              await onRemove(entry.id);
              handleClose();
            }}
            className="flex-row items-center py-3 px-4 rounded-xl"
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
            accessibilityRole="button"
          >
            <Ionicons name="trash-outline" size={20} color={theme.danger} />
            <View className="flex-1 ml-3">
              <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                Remove
              </Text>
              <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                It didn't happen and it won't.
              </Text>
            </View>
          </Pressable>
        </View>
      )}

      {mode === "link" && (
        <View className="px-5 pb-4 flex-1">
          {/* Search */}
          <View className="flex-row items-center mb-2 border rounded-lg px-3 py-2" style={{ borderColor: colors.border }}>
            <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by merchant, description, amount..."
              placeholderTextColor={colors.textSecondary}
              className="flex-1 ml-2 text-sm text-foreground"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
              </Pressable>
            )}
          </View>

          <Text className="text-label mb-1.5" style={{ color: colors.textSecondary }}>
            Showing transactions from last 30 days ({filteredCandidates.length}{query ? ` of ${candidates.length}` : ""})
          </Text>

          {loadingCandidates ? (
            <View className="items-center py-6">
              <ActivityIndicator color={colors.textSecondary} />
            </View>
          ) : filteredCandidates.length === 0 ? (
            <Text className="text-sm py-4" style={{ color: colors.textSecondary }}>
              {query ? "No transactions match your search." : "No recent transactions to pick from. Try Reschedule or Remove."}
            </Text>
          ) : (
            <FlatList
              initialNumToRender={12}
              maxToRenderPerBatch={10}
              windowSize={7}
              data={filteredCandidates}
              keyExtractor={(item) => item.id}
              renderItem={renderCandidate}
              style={{ maxHeight: 280 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            />
          )}

          {/* Running total + variance */}
          {selectedIds.size > 0 && (
            <View
              className="mt-3 px-3 py-2.5 rounded-xl"
              style={{ backgroundColor: theme.alpha("primary", 0.1), borderWidth: 1, borderColor: theme.alpha("primary", 0.2) }}
            >
              <View className="flex-row justify-between items-center">
                <Text className="text-xs" style={{ color: colors.textSecondary }}>
                  Selected: {formatAmount(selectedTotal)} ({selectedIds.size})
                </Text>
                <Text className="text-xs" style={{ color: colors.textSecondary }}>
                  Planned: {formatAmount(entry.amount)}
                </Text>
              </View>
              <View className="flex-row items-center mt-1">
                <Ionicons
                  name={variance > 0 ? "trending-up" : variance < 0 ? "trending-down" : "checkmark-circle"}
                  size={12}
                  color={variance > 0 ? theme.danger : variance < 0 ? theme.success : colors.textSecondary}
                />
                <Text
                  className="text-xs font-semibold ml-1"
                  style={{ color: variance > 0 ? theme.danger : variance < 0 ? theme.success : colors.textSecondary }}
                >
                  {variance === 0 ? "Exact match" : variance > 0 ? `${formatAmount(variance)} over` : `${formatAmount(Math.abs(variance))} under`}
                </Text>
              </View>
            </View>
          )}

          {/* Link Selected button */}
          {selectedIds.size > 0 && (
            <Pressable
              onPress={async () => {
                await onLinkFulfillment(entry.id, Array.from(selectedIds));
                handleClose();
              }}
              className="mt-3 py-3 rounded-xl items-center"
              style={{ backgroundColor: theme.primary }}
              accessibilityRole="button"
            >
              <Text className="text-sm font-bold text-primary-foreground">
                Link Selected ({selectedIds.size})
              </Text>
            </Pressable>
          )}

          <Pressable
            onPress={() => { setMode("root"); setSelectedIds(new Set()); setSearchQuery(""); }}
            className="mt-2 py-2.5 rounded-lg items-center"
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
            accessibilityRole="button"
          >
            <Text className="text-sm" style={{ color: colors.textSecondary }}>
              Back
            </Text>
          </Pressable>
        </View>
      )}
    </Sheet>
  );
}
