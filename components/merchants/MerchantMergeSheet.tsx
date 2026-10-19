import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { FilterChip, Sheet, Text } from "@/components/ui";
import { useAlert } from "@/hooks/use-alert";
import { useTheme } from "@/hooks/use-theme";
import type { MerchantSummary } from "@/services/merchants-overview";

type Filter = "similar" | "all" | "uncategorised";

/** Lower-case words of 3+ letters, minus the filler banks add ("pvt", "ltd", "india"...). */
const FILLER = new Set(["pvt", "ltd", "limited", "private", "india", "the", "and", "com", "www", "upi", "pay", "payment", "payments", "store"]);
function words(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !FILLER.has(w));
}

/** Looks like the same business: a shared word, or one name starts like the other. */
export function looksSimilar(a: string, b: string): boolean {
  const wa = words(a);
  const wb = new Set(words(b));
  if (wa.some((w) => wb.has(w))) return true;
  // Compared without the filler words, so "India Gate" and "Indian Oil" don't pair up.
  const x = wa.join("");
  const y = [...wb].join("");
  const n = Math.min(5, x.length, y.length);
  return n >= 4 && x.slice(0, n) === y.slice(0, n);
}

/**
 * "Merge another merchant into X": a scrolling, searchable list of every other merchant, with the
 * ones that look like X first, and a confirmation before anything changes.
 */
export function MerchantMergeSheet({
  visible,
  target,
  merchants,
  onMerge,
  onClose,
}: {
  visible: boolean;
  /** The merchant the other one is merged into. */
  target: string;
  /** Every other merchant. */
  merchants: MerchantSummary[];
  onMerge: (name: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const alert = useAlert();
  const [query, setQuery] = useState("");
  const similarCount = useMemo(() => merchants.filter((m) => looksSimilar(m.name, target)).length, [merchants, target]);
  const [filter, setFilter] = useState<Filter>("all");

  // Each time it opens: a clean search, and similar names first when there are any.
  useEffect(() => {
    if (!visible) return;
    setQuery("");
    setFilter(similarCount > 0 ? "similar" : "all");
  }, [visible, similarCount]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return merchants
      .filter((m) => {
        if (filter === "similar" && !looksSimilar(m.name, target)) return false;
        if (filter === "uncategorised" && m.category) return false;
        if (!q) return true;
        return m.name.toLowerCase().includes(q) || m.names.some((n) => n.smsName.toLowerCase().includes(q));
      })
      .sort((a, b) => b.txCount - a.txCount || a.name.localeCompare(b.name));
  }, [merchants, filter, query, target]);

  const confirm = (m: MerchantSummary) =>
    alert(
      `Merge ${m.name} into ${target}?`,
      `${m.name}'s ${m.txCount} transaction${m.txCount === 1 ? "" : "s"} and ${m.names.length === 1 ? "its name" : `its ${m.names.length} names`} in messages will show as ${target} from now on. You can undo this straight after.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Merge",
          onPress: () => {
            onClose();
            onMerge(m.name);
          },
        },
      ],
    );

  return (
    <Sheet visible={visible} onClose={onClose} maxHeightPct={88}>
      <View className="flex-row items-center px-5 pb-2">
        <View className="flex-1 mr-3">
          <Text className="text-heading font-bold text-foreground">Merge into {target}</Text>
          <Text className="text-xs text-muted-foreground mt-0.5">Pick the merchant that's really {target}.</Text>
        </View>
        <Pressable onPress={onClose} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={22} color={theme.mutedForeground} />
        </Pressable>
      </View>

      <View className="px-5">
        <View className="flex-row items-center rounded-lg border border-border bg-card px-3" style={{ minHeight: 46 }}>
          <Ionicons name="search-outline" size={17} color={theme.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search merchants or names in messages"
            placeholderTextColor={theme.mutedForeground}
            className="flex-1 text-sm text-foreground py-2 ml-2"
            autoCorrect={false}
            accessibilityLabel="Search merchants"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={theme.mutedForeground} />
            </Pressable>
          )}
        </View>
        <View className="flex-row mt-3 mb-1">
          {similarCount > 0 && <FilterChip label={`Similar ${similarCount}`} active={filter === "similar"} onPress={() => setFilter("similar")} spacing="sm" />}
          <FilterChip label={`All ${merchants.length}`} active={filter === "all"} onPress={() => setFilter("all")} spacing="sm" />
          <FilterChip label="No category" active={filter === "uncategorised"} onPress={() => setFilter("uncategorised")} spacing="sm" />
        </View>
      </View>

      <FlatList
        data={shown}
        keyExtractor={(m) => m.name.toLowerCase()}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingBottom: 16 }}
        ListEmptyComponent={
          <Text className="text-sm text-muted-foreground text-center px-8 py-8">
            {query ? "Nothing matches that search." : filter === "similar" ? "No similar names. Try All." : "Nothing here."}
          </Text>
        }
        renderItem={({ item: m }) => (
          <Pressable
            onPress={() => confirm(m)}
            android_ripple={{ color: theme.alpha("primary", 0.12) }}
            className="flex-row items-center px-5 border-b border-border"
            style={{ minHeight: 60, paddingVertical: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`Merge ${m.name} into ${target}`}
          >
            <View className="flex-1 mr-3">
              <Text className="text-base font-medium text-foreground" numberOfLines={1}>{m.name}</Text>
              <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
                {m.txCount} transaction{m.txCount === 1 ? "" : "s"}
                {m.names.length > 1 ? ` · ${m.names.length} names` : ""}
                {m.category ? ` · ${m.category}` : " · no category"}
              </Text>
            </View>
            <Ionicons name="git-merge-outline" size={18} color={theme.primary} />
          </Pressable>
        )}
      />
    </Sheet>
  );
}
