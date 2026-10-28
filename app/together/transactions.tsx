import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, PeriodNavigator, ScreenContainer, Text } from "@/components/ui";
import { Avatar } from "@/components/household/HouseholdBits";
import { StatementList } from "@/components/household/StatementList";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount } from "@/utils/format";
import { getStatement, type Statement } from "@/services/household/statement";

type Kind = "all" | "you_owe" | "owes_you" | "settle";

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "all", label: "All" },
  { kind: "you_owe", label: "You owe" },
  { kind: "owes_you", label: "Owed to you" },
  { kind: "settle", label: "Settle-ups" },
];

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * Together's transactions: the household's shared spending for a month, filtered by person,
 * category, what it means for you, or a search. Opened from a total on Together.
 */
export default function TogetherTransactionsScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ month?: string; member?: string; category?: string }>();
  const [month, setMonth] = useState(params.month ?? thisMonth());
  const [member, setMember] = useState<string | null>(params.member ?? null);
  const [category, setCategory] = useState<string | null>(params.category ?? null);
  const [kind, setKind] = useState<Kind>("all");
  const [query, setQuery] = useState("");
  const [s, setS] = useState<Statement | null>(null);

  useDataRefresh(
    useCallback(async () => {
      setS(await getStatement(month));
    }, [month]),
  );

  const categories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of s?.rows ?? []) if (r.category) totals.set(r.category, (totals.get(r.category) ?? 0) + r.paid);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [s]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (s?.rows ?? []).filter(
      (r) =>
        (!member || r.member.id === member) &&
        (!category || r.category === category) &&
        (kind === "all" || r.relation.kind === kind) &&
        (!q || `${r.merchant ?? ""} ${r.category ?? ""} ${r.member.name}`.toLowerCase().includes(q)),
    );
  }, [s, member, category, kind, query]);

  const total = rows.filter((r) => r.relation.kind !== "settle").reduce((sum, r) => sum + r.paid, 0);

  const Chip = ({ on, label, onPress, avatar }: { on: boolean; label: string; onPress: () => void; avatar?: React.ReactNode }) => (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-3 py-1.5 rounded-full border"
      style={{ borderColor: on ? "transparent" : theme.alpha("foreground", 0.15), backgroundColor: on ? theme.alpha("primary", 0.12) : "transparent" }}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      {avatar}
      <Text className="text-xs" style={{ color: on ? theme.primary : theme.mutedForeground }}>{label}</Text>
    </Pressable>
  );

  return (
    <ScreenContainer padTop={false}>
      <PeriodNavigator mode="month" value={month} onChange={setMonth} />
      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View className="px-4">
          <View className="flex-row items-center rounded-xl border px-3 mb-3" style={{ borderColor: theme.alpha("foreground", 0.15), minHeight: 42 }}>
            <Ionicons name="search" size={16} color={theme.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search merchant, category or person"
              placeholderTextColor={theme.mutedForeground}
              className="flex-1 text-sm text-foreground ml-2 py-2"
              accessibilityLabel="Search"
            />
            {query ? (
              <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={16} color={theme.mutedForeground} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2" contentContainerStyle={{ gap: 6 }}>
            <Chip on={!member} label="Everyone" onPress={() => setMember(null)} />
            {(s?.members ?? []).map((m) => (
              <Chip
                key={m.id}
                on={member === m.id}
                label={m.id === s?.household.my_member_id ? "You" : m.name}
                onPress={() => setMember(member === m.id ? null : m.id)}
                avatar={<View className="mr-1.5"><Avatar member={m} size={16} /></View>}
              />
            ))}
          </ScrollView>
          {categories.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2" contentContainerStyle={{ gap: 6 }}>
              <Chip on={!category} label="All categories" onPress={() => setCategory(null)} />
              {categories.map((c) => (
                <Chip key={c} on={category === c} label={c} onPress={() => setCategory(category === c ? null : c)} />
              ))}
            </ScrollView>
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3" contentContainerStyle={{ gap: 6 }}>
            {KINDS.map((k) => (
              <Chip key={k.kind} on={kind === k.kind} label={k.label} onPress={() => setKind(k.kind)} />
            ))}
          </ScrollView>

          <Card className="mb-2">
            <View className="flex-row justify-between items-center">
              <Text className="text-sm text-muted-foreground">{rows.length} transaction{rows.length === 1 ? "" : "s"}</Text>
              <Text className="text-base font-semibold text-foreground">{formatAmount(total)}</Text>
            </View>
          </Card>

          <StatementList rows={rows} empty="Nothing matches in this month." />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
