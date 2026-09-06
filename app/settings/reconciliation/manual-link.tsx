import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from "react-native";
import { ListSeparator, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getDatabase } from "@/database";
import { updateItem } from "@/services/reconciliation/reconciliation-crud";
import { useTheme } from "@/hooks/use-theme";

interface ArthEntry {
  id: string;
  kind: "expense" | "transfer";
  date: string;
  amount: number;
  description: string;
  direction: "debit" | "credit";
  account: string | null;
  category: string | null;
  merchant: string | null;
}

function amountStr(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function scoreEntry(
  entry: { amount: number; date: string; direction: "debit" | "credit"; description: string; merchant: string | null },
  stmtAmount: number,
  stmtDate: string,
  stmtDirection: "debit" | "credit",
  stmtNarration: string,
): number {
  let score = 0;

  // Amount similarity (strongest signal)
  const amtDiff = Math.abs(entry.amount - stmtAmount);
  if (amtDiff === 0) score += 30;
  else if (amtDiff <= 1) score += 20;
  else if (amtDiff <= 10) score += 10;
  else if (amtDiff <= 50) score += 3;

  // Date proximity
  const daysDiff = Math.abs(new Date(entry.date).getTime() - new Date(stmtDate).getTime()) / 86_400_000;
  if (daysDiff < 1) score += 20;
  else if (daysDiff <= 1) score += 15;
  else if (daysDiff <= 3) score += 10;
  else if (daysDiff <= 7) score += 5;
  else if (daysDiff <= 14) score += 2;

  // Direction match
  if (entry.direction === stmtDirection) score += 10;

  // Keyword overlap between narration and description/merchant
  if (stmtNarration) {
    const words = stmtNarration.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const haystack = `${entry.description} ${entry.merchant ?? ""}`.toLowerCase();
    for (const word of words) {
      if (haystack.includes(word)) score += 5;
    }
  }

  return score;
}

export default function ManualLinkScreen() {
  const { item_id, session_id, direction, amount, date, narration } = useLocalSearchParams<{
    item_id: string;
    session_id: string;
    direction: string;
    amount: string;
    date: string;
    narration: string;
  }>();
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();

  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<ArthEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);

  const loadEntries = useCallback(async () => {
    const db = getDatabase();
    const dir = direction as "debit" | "credit";

    // Pool: expenses + transfers, ±30 days from stmt date
    const stmtDate = date ?? new Date().toISOString().slice(0, 10);
    const stmtAmount = parseFloat(amount ?? "0");
    const stmtNarration = narration ?? "";
    const windowStart = new Date(new Date(stmtDate).getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
    const windowEnd = new Date(new Date(stmtDate).getTime() + 30 * 86_400_000).toISOString().slice(0, 10);

    // Show all expense types regardless of direction — manual link is the
    // fallback for when auto-match failed, which is often due to a direction
    // mismatch (e.g. a cashback credit parsed as debit in the PDF).
    const expenses = await db.getAllAsync<{
      id: string; date: string; amount: number;
      split_original_amount: number | null;
      nature: string;
      merchant_name: string | null; description: string | null;
      account_label: string | null; bank_name: string | null; account_identifier: string | null;
      category_name: string | null;
    }>(
      `SELECT e.id, e.date, e.amount, e.split_original_amount, e.nature,
              e.merchant_name, e.description,
              fa.account_label, fa.bank_name, fa.account_identifier,
              c.name AS category_name
       FROM expenses e
       LEFT JOIN financial_accounts fa ON fa.id = e.account_id
       LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.nature IN ('realized', 'credit', 'ledger_adjustment')
         AND e.date BETWEEN ? AND ?
         AND e.deleted_at IS NULL AND e.status != 'rejected'
       LIMIT 150`,
      [windowStart, windowEnd],
    );

    const expEntries: ArthEntry[] = expenses.map((e) => {
      const accountDisplay = e.account_label
        || (e.bank_name && e.account_identifier ? `${e.bank_name} ···${e.account_identifier.slice(-4)}` : null)
        || e.bank_name
        || null;
      return {
        id: e.id,
        kind: "expense",
        date: e.date,
        amount: e.split_original_amount && e.split_original_amount > 0
          ? e.split_original_amount : e.amount,
        description: e.merchant_name || e.description || "(no description)",
        direction: e.nature === "credit" ? "credit" : "debit",
        account: accountDisplay,
        category: e.category_name,
        merchant: e.merchant_name,
      };
    });

    const transfers = await db.getAllAsync<{
      id: string; date: string; amount: number; description: string | null;
      from_label: string | null; from_bank: string | null; from_id: string | null;
      to_label: string | null; to_bank: string | null; to_id: string | null;
    }>(
      `SELECT t.id, t.date, t.amount, t.description,
              fa.account_label AS from_label, fa.bank_name AS from_bank, fa.account_identifier AS from_id,
              ta.account_label AS to_label, ta.bank_name AS to_bank, ta.account_identifier AS to_id
       FROM account_transfers t
       LEFT JOIN financial_accounts fa ON fa.id = t.from_account_id
       LEFT JOIN financial_accounts ta ON ta.id = t.to_account_id
       WHERE t.date BETWEEN ? AND ? AND t.deleted_at IS NULL
       LIMIT 50`,
      [windowStart, windowEnd],
    );

    const trEntries: ArthEntry[] = transfers.map((t) => {
      const fromAcc = t.from_label || (t.from_bank && t.from_id ? `${t.from_bank} ···${t.from_id.slice(-4)}` : t.from_bank) || null;
      const toAcc = t.to_label || (t.to_bank && t.to_id ? `${t.to_bank} ···${t.to_id.slice(-4)}` : t.to_bank) || null;
      const accountDisplay = fromAcc && toAcc ? `${fromAcc} → ${toAcc}` : fromAcc || toAcc || null;
      return {
        id: t.id,
        kind: "transfer",
        date: t.date,
        amount: t.amount,
        description: t.description || "(transfer)",
        direction: dir,
        account: accountDisplay,
        category: null,
        merchant: null,
      };
    });

    const allEntries = [...expEntries, ...trEntries];
    allEntries.sort(
      (a, b) =>
        scoreEntry(b, stmtAmount, stmtDate, dir, stmtNarration) -
        scoreEntry(a, stmtAmount, stmtDate, dir, stmtNarration),
    );
    setEntries(allEntries);
    setLoading(false);
  }, [direction, amount, date, narration]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? entries.filter((e) =>
        e.description.toLowerCase().includes(q) ||
        (e.merchant?.toLowerCase().includes(q) ?? false) ||
        (e.account?.toLowerCase().includes(q) ?? false) ||
        (e.category?.toLowerCase().includes(q) ?? false) ||
        String(e.amount).includes(q),
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
    const meta: string[] = [];
    if (item.account) meta.push(item.account);
    if (item.category) meta.push(item.category);
    if (item.kind === "transfer") meta.push("Transfer");
    return (
      <Pressable
        onPress={() => handleLink(item)}
        className="flex-row items-center py-3.5"
      >
        <View className="flex-1">
          <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
            {item.description}
          </Text>
          <Text className="text-xs text-muted-foreground mt-0.5">
            {formatDate(item.date)} · {amountStr(item.amount)}
            {diff > 0 && diff <= 10 && ` · ₹${diff.toFixed(2)} diff`}
          </Text>
          {meta.length > 0 && (
            <Text className="text-xs text-faint-foreground mt-0.5" numberOfLines={1}>
              {meta.join(" · ")}
            </Text>
          )}
        </View>
        {linking ? (
          <ActivityIndicator size="small" />
        ) : (
          <Ionicons name="link" size={18} color={theme.primary} />
        )}
      </Pressable>
    );
  };

  return (
    <ScreenContainer padTop={false}>
      <View className="px-4 pt-3 pb-2">
        <Text className="text-xs text-muted-foreground mb-3">
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
            className="flex-1 ml-2 text-sm text-foreground"
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
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          data={filtered}
          keyExtractor={(item) => `${item.kind}-${item.id}`}
          ItemSeparatorComponent={ListSeparator}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          ListEmptyComponent={
            <View className="items-center py-12">
              <Text className="text-sm text-muted-foreground">
                {query ? `No results for "${query}"` : "No nearby Arth entries found."}
              </Text>
            </View>
          }
        />
      )}
    </ScreenContainer>
  );
}
