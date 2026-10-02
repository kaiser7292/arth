import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, Switch, View } from "react-native";
import { Button, Card, FAB, FilterChip, Input, LearnMoreChip, ScreenContainer, SelectSheet, Sheet, Text } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useAlert } from "@/hooks/use-alert";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getCategories, type Category } from "@/services/category";
import {
  LEARNED_THRESHOLD,
  forgetLearnedMerchant,
  listLearnedMerchants,
  listMerchantRules,
  resetOrRemoveMerchantRule,
  setMerchantRule,
  setMerchantRuleActive,
  type LearnedMerchant,
  type MerchantRule,
} from "@/services/merchant-categories";
import { getErrorMessage } from "@/utils/error-message";

type Filter = "all" | "mine" | "off" | "attention" | "learned";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "mine", label: "Changed by you" },
  { id: "off", label: "Turned off" },
  { id: "attention", label: "Needs attention" },
  { id: "learned", label: "Learned" },
];

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Settings → Merchant categories: see and change how Arth files merchants. */
export default function MerchantCategoriesScreen() {
  const theme = useTheme();
  const alert = useAlert();
  const params = useLocalSearchParams<{ category?: string }>();
  const [rules, setRules] = useState<MerchantRule[]>([]);
  const [learned, setLearned] = useState<LearnedMerchant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState(params.category ?? "");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<MerchantRule | null>(null);
  const [adding, setAdding] = useState(false);
  const [newMerchant, setNewMerchant] = useState("");
  const [picker, setPicker] = useState<null | "edit" | "add">(null);
  const [addCategory, setAddCategory] = useState<string | null>(null);

  useDataRefresh(
    useCallback(async () => {
      const [r, l, c] = await Promise.all([listMerchantRules(), listLearnedMerchants(), getCategories(DEFAULT_USER_ID)]);
      setRules(r);
      setLearned(l);
      setCategories(c);
    }, []),
  );

  const q = query.trim().toLowerCase();
  const visibleRules = useMemo(
    () =>
      rules.filter((r) => {
        if (filter === "mine" && r.source === "builtin") return false;
        if (filter === "off" && r.isActive) return false;
        if (filter === "attention" && !(r.isActive && r.categoryMissing)) return false;
        return !q || r.keyword.includes(q) || r.categoryName.toLowerCase().includes(q);
      }),
    [rules, filter, q],
  );
  const visibleLearned = useMemo(
    () => learned.filter((l) => !q || l.keyword.includes(q) || (l.categoryName ?? "").toLowerCase().includes(q)),
    [learned, q],
  );
  const attentionCount = rules.filter((r) => r.isActive && r.categoryMissing).length;

  const categoryOptions = categories.map((c) => ({ value: c.name, label: c.name }));

  const run = async (fn: () => Promise<unknown>, what: string) => {
    try {
      await fn();
    } catch (e) {
      alert(`Couldn't ${what}`, getErrorMessage(e, "Please try again."));
    }
  };

  const badge = (r: MerchantRule) => {
    if (!r.isActive) return { text: "Off", color: theme.mutedForeground };
    if (r.categoryMissing) return { text: "Category missing", color: theme.warning };
    if (r.source === "custom") return { text: "Yours", color: theme.primary };
    if (r.source === "edited") return { text: "Edited", color: theme.primary };
    return { text: "Built-in", color: theme.mutedForeground };
  };

  const header = (
    <View className="pt-4">
      <Card className="mb-3">
        <Text className="text-sm text-foreground leading-5">
          Arth files transactions into categories by merchant, using built-in rules for common Indian merchants
          plus anything you add here. Change any rule to suit how you spend. Smart Rules always take priority over
          these.
        </Text>
        <View className="mt-2 self-start">
          <LearnMoreChip contextKey="settings-merchant-categories" />
        </View>
      </Card>
      <Input placeholder="Search merchants or categories" value={query} onChangeText={setQuery} containerClassName="mb-2" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
        {FILTERS.map((f) => (
          <FilterChip
            key={f.id}
            label={f.id === "attention" && attentionCount ? `${f.label} (${attentionCount})` : f.label}
            active={filter === f.id}
            onPress={() => setFilter(f.id)}
          />
        ))}
      </ScrollView>
      {filter === "learned" ? (
        <Text className="text-xs text-muted-foreground mb-2 leading-4">
          When you change a merchant's category {LEARNED_THRESHOLD} times, Arth starts filing it that way. Forget one
          to go back to the rule above it.
        </Text>
      ) : null}
    </View>
  );

  return (
    <ScreenContainer padTop={false}>
      {filter === "learned" ? (
        <FlatList
          data={visibleLearned}
          keyExtractor={(l) => l.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
          ListEmptyComponent={<Text className="text-sm text-muted-foreground text-center py-8">Nothing learned yet</Text>}
          renderItem={({ item }) => (
            <View className="flex-row items-center py-3 border-b border-border">
              <View className="flex-1 mr-2">
                <Text className="text-sm text-foreground">{titleCase(item.keyword)}</Text>
                <Text className="text-xs text-muted-foreground">
                  {item.categoryName ?? "Deleted category"} · changed {item.count}×
                  {item.count < LEARNED_THRESHOLD ? " · not active yet" : ""}
                </Text>
              </View>
              <Pressable
                hitSlop={8}
                onPress={() => run(() => forgetLearnedMerchant(item.id), "forget it")}
                accessibilityLabel={`Forget ${item.keyword}`}
              >
                <Text className="text-xs font-semibold text-primary">Forget</Text>
              </Pressable>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={visibleRules}
          keyExtractor={(r) => r.keyword}
          ListHeaderComponent={header}
          initialNumToRender={30}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
          ListEmptyComponent={<Text className="text-sm text-muted-foreground text-center py-8">No matching merchants</Text>}
          renderItem={({ item }) => {
            const b = badge(item);
            return (
              <Pressable onPress={() => setEditing(item)} className="flex-row items-center py-3 border-b border-border">
                <View className="flex-1 mr-2">
                  <Text className="text-sm text-foreground" style={{ opacity: item.isActive ? 1 : 0.5 }}>
                    {titleCase(item.keyword)}
                  </Text>
                  <Text className="text-xs text-muted-foreground">{item.categoryName}</Text>
                </View>
                <Text className="text-xs font-semibold mr-2" style={{ color: b.color }}>
                  {b.text}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
              </Pressable>
            );
          }}
        />
      )}

      <FAB icon="add" accessibilityLabel="Add merchant" onPress={() => { setNewMerchant(""); setAddCategory(null); setAdding(true); }} />

      {/* Edit a rule */}
      <Sheet visible={editing != null && picker == null} onClose={() => setEditing(null)}>
        {editing ? (
          <View className="px-4 pb-6">
            <Text className="text-lg font-semibold text-foreground mb-1">{titleCase(editing.keyword)}</Text>
            <Text className="text-xs text-muted-foreground mb-4 leading-4">
              Any merchant containing "{editing.keyword}" is filed here.
              {editing.builtInCategory ? ` Built-in category: ${editing.builtInCategory}.` : " You added this rule."}
            </Text>
            <Pressable onPress={() => setPicker("edit")} className="flex-row items-center justify-between py-3 border-b border-border">
              <Text className="text-sm text-muted-foreground">Category</Text>
              <View className="flex-row items-center">
                <Text className="text-sm font-semibold text-foreground mr-1">{editing.categoryName}</Text>
                <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
              </View>
            </Pressable>
            <View className="flex-row items-center justify-between py-3 border-b border-border">
              <Text className="text-sm text-muted-foreground">Use this rule</Text>
              <Switch
                value={editing.isActive}
                onValueChange={(v) =>
                  run(async () => {
                    await setMerchantRuleActive(editing.keyword, v);
                    setEditing({ ...editing, isActive: v });
                  }, "update the rule")
                }
              />
            </View>
            {editing.source !== "builtin" ? (
              <Button
                title={editing.builtInCategory ? `Reset to built-in (${editing.builtInCategory})` : "Remove this rule"}
                variant="outline"
                className="mt-4"
                onPress={() =>
                  run(async () => {
                    await resetOrRemoveMerchantRule(editing.keyword);
                    setEditing(null);
                  }, "reset the rule")
                }
              />
            ) : null}
          </View>
        ) : null}
      </Sheet>

      {/* Add a merchant */}
      <Sheet visible={adding && picker == null} onClose={() => setAdding(false)}>
        <View className="px-4 pb-6">
          <Text className="text-lg font-semibold text-foreground mb-1">Add a merchant</Text>
          <Text className="text-xs text-muted-foreground mb-3 leading-4">
            Type part of the merchant name as it appears in your SMS, e.g. "kaur's kitchen" or "bescom".
          </Text>
          <Input placeholder="Merchant name" value={newMerchant} onChangeText={setNewMerchant} autoCapitalize="none" />
          <Pressable onPress={() => setPicker("add")} className="flex-row items-center justify-between py-3 border-b border-border mt-2">
            <Text className="text-sm text-muted-foreground">Category</Text>
            <View className="flex-row items-center">
              <Text className="text-sm font-semibold text-foreground mr-1">{addCategory ?? "Choose"}</Text>
              <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
            </View>
          </Pressable>
          <Button
            title="Save"
            className="mt-4"
            disabled={!newMerchant.trim() || !addCategory}
            onPress={() =>
              run(async () => {
                await setMerchantRule(newMerchant, addCategory!);
                setAdding(false);
              }, "save the merchant")
            }
          />
        </View>
      </Sheet>

      <SelectSheet
        visible={picker != null}
        title="Choose category"
        options={categoryOptions}
        value={picker === "edit" ? editing?.categoryName ?? null : addCategory}
        onClose={() => setPicker(null)}
        onChange={(name) => {
          if (picker === "add") {
            setAddCategory(name);
            setPicker(null);
            return;
          }
          if (editing) {
            run(async () => {
              await setMerchantRule(editing.keyword, name);
              setEditing({ ...editing, categoryName: name, isActive: true, categoryMissing: false,
                source: editing.builtInCategory === name ? "builtin" : editing.builtInCategory ? "edited" : "custom" });
            }, "change the category");
          }
          setPicker(null);
        }}
      />
    </ScreenContainer>
  );
}
