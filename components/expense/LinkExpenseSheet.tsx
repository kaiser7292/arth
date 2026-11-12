import { useEffect, useMemo, useState, useCallback } from "react";
import { LoadingState, SearchField, Sheet, Text } from "@/components/ui";
import { View, Pressable, SectionList } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { findReminderLinkCandidates } from "@/services/recurring-rules";
import type { Expense } from "@/services/expense";
import { formatAmount } from "@/utils/format";
import { formatDateForDisplay } from "@/utils/expense-validation";
import { useTheme } from "@/hooks/use-theme";

/**
 * "Link to an existing expense" sheet. Shown when the user taps a pending
 * reminder. Lists spending around the cycle's due date that might pay it:
 * "Best matches" (same payee or an amount within 10%, closest first), then
 * everything else from those days, with a search over name and amount for a
 * bank that named it oddly.
 *
 * Actions:
 *   - Pick one → onPickExisting(expenseId). Parent runs fulfillReminder.
 *   - "Log new expense" → onLogNew(). Parent navigates to add-expense
 *     prefilled via ?fulfillsReminderId=<rule.id>.
 */

interface LinkExpenseSheetProps {
  visible: boolean;
  ruleId: string;
  ruleDescription: string;
  /** Matches already found on Home: listed first. */
  preloadedCandidates?: Expense[];
  onPickExisting: (expenseId: string) => void;
  onLogNew: () => void;
  onClose: () => void;
}

export function LinkExpenseSheet({
  visible,
  ruleId,
  ruleDescription,
  preloadedCandidates,
  onPickExisting,
  onLogNew,
  onClose,
}: LinkExpenseSheetProps) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [best, setBest] = useState<Expense[]>([]);
  const [others, setOthers] = useState<Expense[]>([]);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setQuery("");
    findReminderLinkCandidates(ruleId)
      .then((r) => {
        const pre = preloadedCandidates ?? [];
        const seen = new Set(pre.map((e) => e.id));
        setBest([...pre, ...r.best.filter((e) => !seen.has(e.id))]);
        setOthers(r.others.filter((e) => !seen.has(e.id)));
        setRange({ from: r.from, to: r.to });
      })
      .catch(() => {
        setBest(preloadedCandidates ?? []);
        setOthers([]);
      })
      .finally(() => setLoading(false));
  }, [visible, ruleId, preloadedCandidates]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/[^0-9]/g, "");
    const keep = (e: Expense) =>
      !q ||
      (e.merchant_name ?? "").toLowerCase().includes(q) ||
      (e.description ?? "").toLowerCase().includes(q) ||
      (digits !== "" && String(Math.round(e.amount)).includes(digits));
    return [
      { title: "Best matches", data: best.filter(keep) },
      { title: "Other spending around then", data: others.filter(keep) },
    ].filter((s) => s.data.length > 0);
  }, [best, others, query]);

  const close = useCallback(() => onClose(), [onClose]);

  if (!visible) return null;

  return (
    <Sheet visible={visible} onClose={close}>
      <View className="px-5 pb-3">
        <Text className="text-base font-bold" style={{ color: colors.text }}>
          Link to an expense
        </Text>
        <Text className="text-sm mt-0.5" style={{ color: colors.textSecondary }} numberOfLines={2}>
          {ruleDescription}
        </Text>
      </View>

      {!loading && best.length + others.length > 6 && (
        <View className="px-5 pb-2">
          <SearchField value={query} onChangeText={setQuery} placeholder="Search name or amount" />
        </View>
      )}

      <View className="px-2" style={{ maxHeight: 360 }}>
        {loading ? (
          <LoadingState rows={3} />
        ) : sections.length === 0 ? (
          <View className="px-3 py-6">
            <Text className="text-sm text-center" style={{ color: colors.textSecondary }}>
              {query.trim()
                ? "Nothing matches that."
                : range
                  ? `Nothing spent between ${formatDateForDisplay(range.from)} and ${formatDateForDisplay(range.to)}.`
                  : "Nothing spent around the due date."}
            </Text>
            <Text className="text-xs text-center mt-1" style={{ color: colors.textSecondary }}>
              Log a new expense to fulfill this reminder.
            </Text>
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            stickySectionHeadersEnabled={false}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            renderSectionHeader={({ section }) => (
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 pt-3 pb-1">
                {section.title}
              </Text>
            )}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onPickExisting(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`Link to ${item.merchant_name ?? "expense"} ${formatAmount(item.amount)}`}
                className="flex-row items-center px-3 py-2.5 rounded-lg"
              >
                <View className="flex-1">
                  <Text className="text-sm font-medium" style={{ color: colors.text }} numberOfLines={1}>
                    {item.merchant_name ?? item.description ?? "Expense"}
                  </Text>
                  <Text className="text-xs" style={{ color: colors.textSecondary }} numberOfLines={1}>
                    {formatDateForDisplay(item.date.slice(0, 10))}
                    {item.merchant_name && item.description && item.description !== item.merchant_name
                      ? ` · ${item.description}`
                      : ""}
                  </Text>
                </View>
                <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                  {formatAmount(item.amount)}
                </Text>
              </Pressable>
            )}
          />
        )}
      </View>

      <View className="px-5 pt-3">
        <Pressable
          onPress={onLogNew}
          accessibilityRole="button"
          accessibilityLabel="Log new expense"
          className="py-3 rounded-xl items-center flex-row justify-center"
          style={{ backgroundColor: theme.primary }}
        >
          <Ionicons name="add-outline" size={18} color="#fff" />
          <Text className="text-sm font-semibold text-primary-foreground ml-1">Log new expense</Text>
        </Pressable>
        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          className="py-3 mt-2 rounded-xl items-center"
        >
          <Text className="text-sm font-semibold" style={{ color: colors.textSecondary }}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </Sheet>
  );
}
