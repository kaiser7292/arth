import { useState, useEffect, useCallback, useRef } from "react";
import { Sheet, Text } from "@/components/ui";
import { View, Pressable,  ScrollView, TextInput, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { formatAmount } from "@/utils/format";
import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";

interface ExpenseRow {
  id: string;
  description: string | null;
  merchant_name: string | null;
  amount: number;
  date: string;
  category_name: string | null;
}

async function searchExpensesForPicker(query: string): Promise<ExpenseRow[]> {
  const db = getDatabase();
  const like = `%${query.trim()}%`;
  const hasQuery = query.trim().length > 0;
  return db.getAllAsync<ExpenseRow>(
    `SELECT e.id, e.description, e.merchant_name, e.amount, e.date,
            c.name as category_name
     FROM expenses e
     LEFT JOIN categories c ON c.id = e.category_id
     WHERE e.user_id = ? AND e.nature = 'realized' AND e.status = 'approved'
       AND e.deleted_at IS NULL
       AND (e.reclassified_as_transfer IS NULL OR e.reclassified_as_transfer = 0)
       ${hasQuery ? "AND (e.merchant_name LIKE ? OR e.description LIKE ?)" : ""}
     ORDER BY e.date DESC, e.created_at DESC
     LIMIT 60;`,
    ...(hasQuery ? [DEFAULT_USER_ID, like, like] : [DEFAULT_USER_ID]),
  );
}

interface Props {
  visible: boolean;
  creditAmount: number;
  onPick: (expenseId: string, expenseSummary: string) => void;
  onClose: () => void;
}

/**
 * Expense picker for "Tag this credit as a refund for an expense."
 * Shows recent realized expenses with search, single-select.
 */
export function RefundExpensePickerSheet({ visible, creditAmount, onPick, onClose }: Props) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      return;
    }

    setLoading(true);
    searchExpensesForPicker("").then((rows) => {
      setExpenses(rows);
      setLoading(false);
    }).catch(() => {
      setExpenses([]);
      setLoading(false);
    });
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await searchExpensesForPicker(query);
        setExpenses(rows);
      } catch {
        setExpenses([]);
      }
      setLoading(false);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, visible]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handlePick = useCallback(
    (expense: ExpenseRow) => {
      const summary = expense.merchant_name || expense.description || expense.date;
      onPick(expense.id, summary);
    },
    [onPick],
  );


  const tint = theme.primary;

  if (!visible) return null;

  return (
    <Sheet visible={visible} onClose={handleClose}>
      {/* Drag handle */}
      <View className="items-center pt-3 pb-1">
        <View className="w-10 h-1 rounded-full bg-border" />
      </View>

      {/* Header */}
      <View className="px-5 pb-2">
        <Text className="text-base font-bold" style={{ color: colors.text }}>
          Which expense was refunded?
        </Text>
        <Text className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>
          This {formatAmount(creditAmount)} credit will reduce that expense's effective spend.
        </Text>
      </View>

      {/* Search */}
      <View
        className="mx-5 mb-3 flex-row items-center rounded-xl px-3 bg-card"
        style={{ borderWidth: 1, borderColor: colors.border }}
      >
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} style={{ marginRight: 8 }} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by merchant or description…"
          placeholderTextColor={colors.textSecondary}
          style={{ flex: 1, paddingVertical: 10, fontSize: 14, color: colors.text }}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery("")} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {/* List */}
      {loading ? (
        <View className="flex-1 items-center justify-center py-10">
          <ActivityIndicator color={tint} />
        </View>
      ) : expenses.length === 0 ? (
        <View className="flex-1 items-center justify-center py-10 px-5">
          <Ionicons name="receipt-outline" size={40} color={colors.textSecondary} />
          <Text className="text-sm mt-3 text-center" style={{ color: colors.textSecondary }}>
            {query.length > 0 ? "No expenses match your search." : "No expenses found."}
          </Text>
        </View>
      ) : (
        <ScrollView
          className="px-5"
          contentContainerStyle={{ paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {expenses.map((exp) => {
            const label = exp.merchant_name || exp.description || "Unnamed";
            const sub = exp.category_name ?? exp.date;
            return (
              <Pressable
                key={exp.id}
                onPress={() => handlePick(exp)}
                accessibilityRole="button"
                accessibilityLabel={`Link refund to ${label}, ${formatAmount(exp.amount)}`}
                className="flex-row items-center py-3 px-4 rounded-xl mb-2"
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <View
                  className="w-9 h-9 rounded-full items-center justify-center mr-3"
                  style={{ backgroundColor: theme.alpha("primary", 0.1) }}
                >
                  <Ionicons name="receipt-outline" size={17} color={tint} />
                </View>
                <View className="flex-1 mr-2">
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: colors.text }}
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                  <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }} numberOfLines={1}>
                    {sub}  ·  {exp.date}
                  </Text>
                </View>
                <Text className="text-sm font-semibold" style={{ color: colors.text }}>
                  {formatAmount(exp.amount)}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} style={{ marginLeft: 4 }} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* Cancel */}
      <View className="px-5 pt-3">
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          className="py-3 rounded-xl items-center"
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
        >
          <Text className="text-sm font-semibold" style={{ color: colors.textSecondary }}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </Sheet>
  );
}
