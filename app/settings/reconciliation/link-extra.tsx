import { Ionicons } from "@expo/vector-icons";

import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from "react-native";
import { ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  getItemsEnriched,
  updateItem,
  deleteItem,
  type ReconciliationItemEnriched,
} from "@/services/reconciliation/reconciliation-crud";
import { useTheme } from "@/hooks/use-theme";

// mode="find_missing" — initiated from Extra tab: show unmatched statement rows to pair with
// mode="find_extra"   — initiated from Missing tab: show extra Arth entries to pair with

function amountStr(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function LinkExtraScreen() {
  const { mode, session_id, item_id, date, amount } = useLocalSearchParams<{
    mode: "find_missing" | "find_extra";
    session_id: string;
    item_id: string;
    date: string;
    amount: string;
  }>();
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();

  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ReconciliationItemEnriched[]>([]);
  const [initiating, setInitiating] = useState<ReconciliationItemEnriched | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (!session_id || !item_id) return;
    (async () => {
      const all = await getItemsEnriched(session_id);
      const init = all.find((i) => i.id === item_id) ?? null;
      setInitiating(init);

      const pivotDate = new Date(date ?? new Date().toISOString().slice(0, 10)).getTime();

      if (mode === "find_missing") {
        // Show unmatched statement rows, sorted by date proximity to the Extra item
        const pool = all
          .filter((i) => i.status === "unmatched")
          .sort((a, b) =>
            Math.abs(new Date(a.stmt_date).getTime() - pivotDate) -
            Math.abs(new Date(b.stmt_date).getTime() - pivotDate),
          );
        setCandidates(pool);
      } else {
        // Show extra Arth entries, sorted by date proximity to the Missing item
        const pool = all
          .filter((i) => i.status === "added")
          .sort((a, b) => {
            const da = new Date(a.arth_date ?? a.stmt_date).getTime();
            const db2 = new Date(b.arth_date ?? b.stmt_date).getTime();
            return Math.abs(da - pivotDate) - Math.abs(db2 - pivotDate);
          });
        setCandidates(pool);
      }
      setLoading(false);
    })();
  }, [session_id, item_id, mode, date]);

  const handlePick = useCallback(async (picked: ReconciliationItemEnriched) => {
    if (!initiating || linking) return;
    setLinking(true);
    try {
      // Determine which is Missing and which is Extra regardless of direction
      const missingItem = mode === "find_missing" ? picked : initiating;
      const extraItem  = mode === "find_missing" ? initiating : picked;

      // 1. Wire the Arth IDs from the Extra placeholder onto the Missing statement row
      await updateItem(missingItem.id, {
        matched_expense_id: extraItem.matched_expense_id,
        matched_transfer_id: extraItem.matched_transfer_id,
        match_confidence: "manual",
        status: "matched",
      });

      // 2. Remove the Extra placeholder — it has been resolved
      await deleteItem(extraItem.id);

      router.back();
    } finally {
      setLinking(false);
    }
  }, [initiating, linking, mode, router]);

  const q = query.trim().toLowerCase();

  const filtered = q
    ? candidates.filter((c) => {
        if (mode === "find_missing") {
          return (
            (c.stmt_narration?.toLowerCase().includes(q) ?? false) ||
            String(c.stmt_amount).includes(q)
          );
        } else {
          return (
            (c.arth_description?.toLowerCase().includes(q) ?? false) ||
            (c.arth_account?.toLowerCase().includes(q) ?? false) ||
            (c.arth_category?.toLowerCase().includes(q) ?? false) ||
            String(c.arth_amount ?? c.stmt_amount).includes(q)
          );
        }
      })
    : candidates;

  const renderCandidate = ({ item }: { item: ReconciliationItemEnriched }) => {
    const stmtAmt = parseFloat(amount ?? "0");

    if (mode === "find_missing") {
      // Show the statement row
      const diff = Math.abs(item.stmt_amount - stmtAmt);
      return (
        <Pressable
          onPress={() => handlePick(item)}
          className="flex-row items-center py-3.5 border-b border-border"
        >
          <View className="flex-1">
            <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
              {item.stmt_narration || "(no narration)"}
            </Text>
            <Text className="text-xs text-muted-foreground mt-0.5">
              {formatDate(item.stmt_date)} · {item.stmt_direction === "debit" ? "−" : "+"}{amountStr(item.stmt_amount)}
              {diff > 0 && diff <= 10 && ` · ₹${diff.toFixed(2)} diff`}
            </Text>
          </View>
          {linking ? (
            <ActivityIndicator size="small" />
          ) : (
            <Ionicons name="git-merge-outline" size={18} color={theme.primary} />
          )}
        </Pressable>
      );
    } else {
      // Show the Extra Arth entry
      const arthAmt = item.arth_amount ?? item.stmt_amount;
      const diff = Math.abs(arthAmt - stmtAmt);
      const meta: string[] = [];
      if (item.arth_account) meta.push(item.arth_account);
      if (item.arth_category) meta.push(item.arth_category);
      return (
        <Pressable
          onPress={() => handlePick(item)}
          className="flex-row items-center py-3.5 border-b border-border"
        >
          <View className="flex-1">
            <View className="flex-row items-center">
              <Text className="text-sm font-medium text-foreground flex-1" numberOfLines={1}>
                {item.arth_description || "(no description)"}
              </Text>
              <View className="ml-2 px-2 py-0.5 rounded-full" style={{ backgroundColor: "#F59E0B22" }}>
                <Text className="text-label font-semibold uppercase" style={{ color: theme.warning }}>
                  {item.matched_transfer_id ? "Transfer" : "Expense"}
                </Text>
              </View>
            </View>
            <Text className="text-xs text-muted-foreground mt-0.5">
              {item.arth_date ? formatDate(item.arth_date) : ""} · {amountStr(arthAmt)}
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
            <Ionicons name="git-merge-outline" size={18} color={theme.primary} />
          )}
        </Pressable>
      );
    }
  };

  const headerText = mode === "find_missing"
    ? `Arth entry: ${amount ? (initiating?.stmt_direction === "debit" ? "−" : "+") + amountStr(parseFloat(amount)) : ""} on ${date ? formatDate(date) : ""}. Pick the matching statement row.`
    : `Statement: ${amount ? amountStr(parseFloat(amount)) : ""} on ${date ? formatDate(date) : ""}. Pick the matching Arth entry.`;

  const searchPlaceholder = mode === "find_missing"
    ? "Search by narration or amount…"
    : "Search by description, account, or amount…";

  return (
    <ScreenContainer padTop={false}>
      <View className="px-4 pt-3 pb-2">
        <Text className="text-xs text-muted-foreground mb-3">
          {headerText}
        </Text>
        <View
          className="flex-row items-center rounded-xl px-3 py-2.5"
          style={{ backgroundColor: colors.border + "55" }}
        >
          <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={searchPlaceholder}
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
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderCandidate}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          ListEmptyComponent={
            <View className="items-center py-12">
              <Text className="text-sm text-muted-foreground">
                {query
                  ? `No results for "${query}"`
                  : mode === "find_missing"
                    ? "No unmatched statement rows found."
                    : "No extra Arth entries found."}
              </Text>
            </View>
          }
        />
      )}
    </ScreenContainer>
  );
}
