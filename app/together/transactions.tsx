import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, PeriodNavigator, ScreenContainer, Sheet, Text } from "@/components/ui";
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
 * category, what it means for you, or a search. Opened from a total on Together. The filters live
 * in one sheet behind a Filter button: a row of chips per filter doesn't fit once a household has
 * a few people and a dozen categories.
 */
export default function TogetherTransactionsScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ month?: string; member?: string; category?: string }>();
  const [month, setMonth] = useState(params.month ?? thisMonth());
  const [member, setMember] = useState<string | null>(params.member ?? null);
  const [category, setCategory] = useState<string | null>(params.category ?? null);
  const [kind, setKind] = useState<Kind>("all");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
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

  const nameOf = (id: string) => (id === s?.household.my_member_id ? "You" : (s?.members.find((m) => m.id === id)?.name ?? "Someone"));
  const active = [member ? nameOf(member) : null, category, kind !== "all" ? KINDS.find((k) => k.kind === kind)?.label : null].filter(Boolean) as string[];
  const clearFilters = () => {
    setMember(null);
    setCategory(null);
    setKind("all");
  };

  const Option = ({ on, label, onPress, avatar }: { on: boolean; label: string; onPress: () => void; avatar?: React.ReactNode }) => (
    <Pressable onPress={onPress} className="flex-row items-center px-5 py-3" accessibilityRole="radio" accessibilityState={{ checked: on }}>
      {avatar}
      <Text className="text-sm flex-1" style={{ color: on ? theme.primary : theme.foreground, fontWeight: on ? "600" : "400" }}>{label}</Text>
      {on && <Ionicons name="checkmark" size={18} color={theme.primary} />}
    </Pressable>
  );
  const Heading = ({ children }: { children: string }) => (
    <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-5 pt-4 pb-1">{children}</Text>
  );

  return (
    <ScreenContainer padTop={false}>
      <PeriodNavigator mode="month" value={month} onChange={setMonth} />
      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View className="px-4">
          <View className="flex-row items-center mb-3" style={{ gap: 8 }}>
            <View className="flex-1 flex-row items-center rounded-xl border px-3" style={{ borderColor: theme.alpha("foreground", 0.15), minHeight: 42 }}>
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
            <Pressable
              onPress={() => setFiltersOpen(true)}
              className="flex-row items-center rounded-xl border px-3"
              style={{
                minHeight: 42,
                borderColor: active.length ? theme.primary : theme.alpha("foreground", 0.15),
                backgroundColor: active.length ? theme.alpha("primary", 0.1) : "transparent",
              }}
              accessibilityRole="button"
              accessibilityLabel={active.length ? `Filter, ${active.length} on` : "Filter"}
            >
              <Ionicons name="options-outline" size={16} color={active.length ? theme.primary : theme.mutedForeground} />
              <Text className="text-sm ml-1.5" style={{ color: active.length ? theme.primary : theme.foreground }}>
                {active.length ? `Filter · ${active.length}` : "Filter"}
              </Text>
            </Pressable>
          </View>
          {active.length > 0 && (
            <View className="flex-row items-center mb-3">
              <Text className="text-xs text-muted-foreground flex-1" numberOfLines={1}>{active.join(" · ")}</Text>
              <Pressable onPress={clearFilters} hitSlop={8} accessibilityRole="button">
                <Text className="text-xs font-semibold" style={{ color: theme.primary }}>Clear</Text>
              </Pressable>
            </View>
          )}

          <Card className="mb-2">
            <View className="flex-row justify-between items-center">
              <Text className="text-sm text-muted-foreground">{rows.length} transaction{rows.length === 1 ? "" : "s"}</Text>
              <Text className="text-base font-semibold text-foreground">{formatAmount(total)}</Text>
            </View>
          </Card>

          <StatementList rows={rows} empty="Nothing matches in this month." />
        </View>
      </ScrollView>

      <Sheet visible={filtersOpen} onClose={() => setFiltersOpen(false)}>
        <View className="flex-row items-center justify-between px-5 pb-1">
          <Text className="text-heading font-bold text-foreground">Filter</Text>
          <View className="flex-row items-center" style={{ gap: 16 }}>
            {active.length > 0 && (
              <Pressable onPress={clearFilters} hitSlop={8} accessibilityRole="button">
                <Text className="text-sm" style={{ color: theme.primary }}>Clear</Text>
              </Pressable>
            )}
            <Pressable onPress={() => setFiltersOpen(false)} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={theme.mutedForeground} />
            </Pressable>
          </View>
        </View>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 16 }}>
          <Heading>Paid by</Heading>
          <Option on={!member} label="Everyone" onPress={() => setMember(null)} />
          {(s?.members ?? []).map((m) => (
            <Option
              key={m.id}
              on={member === m.id}
              label={nameOf(m.id)}
              onPress={() => setMember(m.id)}
              avatar={<View className="mr-2.5"><Avatar member={m} size={20} /></View>}
            />
          ))}
          <Heading>Show</Heading>
          {KINDS.map((k) => (
            <Option key={k.kind} on={kind === k.kind} label={k.label} onPress={() => setKind(k.kind)} />
          ))}
          {categories.length > 0 && <Heading>Category</Heading>}
          {categories.length > 0 && <Option on={!category} label="All categories" onPress={() => setCategory(null)} />}
          {categories.map((c) => (
            <Option key={c} on={category === c} label={c} onPress={() => setCategory(c)} />
          ))}
        </ScrollView>
      </Sheet>
    </ScreenContainer>
  );
}
