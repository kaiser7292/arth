import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { ScreenContainer } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getDatabase } from "@/database";
import { updateItem } from "@/services/reconciliation/reconciliation-crud";

interface ArthEntry {
  id: string;
  kind: "expense" | "transfer";
  date: string;
  amount: number;
  description: string;
  direction: "debit" | "credit";
}

function amountStr(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function ManualLinkScreen() {
  const { item_id, session_id, direction, amount, date } = useLocalSearchParams<{
    item_id: string;
    session_id: string;
    direction: string;
    amount: string;
    date: string;
  }>();
  const router = useRouter();
  const { colors, accent } = useColorScheme();

  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<ArthEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);

  const loadEntries = useCallback(async () => {
    const db = getDatabase();
    const dir = direction as "debit" | "credit";

    // Pool: expenses + transfers for this direction, ±30 days from stmt date
    const stmtDate = date ?? new Date().toISOString().slice(0, 10);
    const windowStart = new Date(new Date(stmtDate).getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
    const windowEnd = new Date(new Date(stmtDate).getTime() + 30 * 86_400_000).toISOString().slice(0, 10);

    const nature = dir === "debit" ? "'realized','ledger_adjustment'" : "'credit'";
    const expenses = await db.getAllAsync<{
      id: string; date: string; amount: number;
      split_original_amount: number | null;
      merchant_name: string | null; description: string | null;
    }>(
      `SELECT id, date, amount, split_original_amount, merchant_name, description
       FROM expenses
       WHERE nature IN (${nature})
         AND date BETWEEN ? AND ?
         AND deleted_at IS NULL AND status != 'rejected'
       ORDER BY ABS(JULIANDAY(date) - JULIANDAY(?)) ASC LIMIT 100`,
      [windowStart, windowEnd, stmtDate],
    );

    const expEntries: ArthEntry[] = expenses.map((e) => ({
      id: e.id,
      kind: "expense",
      date: e.date,
      amount: e.split_original_amount && e.split_original_amount > 0
        ? e.split_original_amount : e.amount,
      description: e.merchant_name || e.description || "(no description)",
      direction: dir,
    }));

    const tCol = dir === "debit" ? "from_account_id" : "to_account_id";
    const transfers = await db.getAllAsync<{
      id: string; date: string; amount: number; description: string | null;
    }>(
      `SELECT id, date, amount, description FROM account_transfers
       WHERE date BETWEEN ? AND ? AND deleted_at IS NULL
       ORDER BY ABS(JULIANDAY(date) - JULIANDAY(?)) ASC LIMIT 50`,
      [windowStart, windowEnd, stmtDate],
    );

    const trEntries: ArthEntry[] = transfers.map((t) => ({
      id: t.id,
      kind: "transfer",
      date: t.date,
      amount: t.amount,
      description: t.description || "(transfer)",
      direction: dir,
    }));

    setEntries([...expEntries, ...trEntries]);
    setLoading(false);
  }, [direction, date]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const filtered = query.trim()
    ? entries.filter((e) =>
        e.description.toLowerCase().includes(query.toLowerCase()) ||
        String(e.amount).includes(query),
      )
    : entries;

  const handleLink = useCallback(async (entry: ArthEntry) => {
    if (!item_id || linking) return;
    setLinking(true);
    try {
      await updateItem(item_id, {
        matched_expense_id: entry.kind === "expense" ? entry.id : null,
        matched_transfer_id: entry.kind === "transfer" ? entry.id : null,
        match_confidence: "manual",
        status: "matched",
      });
      router.back();
    } finally {
      setLinking(false);
    }
  }, [item_id, linking, router]);

  const renderItem = ({ item }: { item: ArthEntry }) => {
    const stmtAmt = parseFloat(amount ?? "0");
    const diff = Math.abs(item.amount - stmtAmt);
    return (
      <Pressable
        onPress={() => handleLink(item)}
        className="flex-row items-center py-3.5 border-b border-border-light dark:border-border-dark"
      >
        <View className="flex-1">
          <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary" numberOfLines={1}>
            {item.description}
          </Text>
          <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mt-0.5">
            {formatDate(item.date)} · {amountStr(item.amount)}
            {diff > 0 && diff <= 10 && ` · ₹${diff.toFixed(2)} diff`}
            {item.kind === "transfer" && " · Transfer"}
          </Text>
        </View>
        {linking ? (
          <ActivityIndicator size="small" />
        ) : (
          <Ionicons name="link" size={18} color={accent[500]} />
        )}
      </Pressable>
    );
  };

  return (
    <ScreenContainer padTop={false}>
      <View className="px-4 pt-3 pb-2">
        <Text className="text-xs text-text-secondary dark:text-text-dark-secondary mb-3">
          Statement: {direction === "debit" ? "−" : "+"}{amountStr(parseFloat(amount ?? "0"))} on {formatDate(date ?? "")}. Pick the matching Arth entry.
        </Text>
        <View
          className="flex-row items-center rounded-xl px-3 py-2.5"
          style={{ backgroundColor: colors.border + "55" }}
        >
          <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name or amount…"
            placeholderTextColor={colors.textSecondary}
            className="flex-1 ml-2 text-sm text-text-primary dark:text-text-dark-primary"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => `${item.kind}-${item.id}`}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          ListEmptyComponent={
            <View className="items-center py-12">
              <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
                {query ? `No results for "${query}"` : "No nearby Arth entries found."}
              </Text>
            </View>
          }
        />
      )}
    </ScreenContainer>
  );
}
