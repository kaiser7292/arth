import { useCallback, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, CheckRow, EmptyState, LoadingState, ScreenContainer, SectionTitle, Text, useToast } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { applyOrganiseSuggestions, getOrganiseSuggestions, type OrganiseSuggestion } from "@/services/category-organise";

/**
 * Settings › Categories › Organise: suggestions for fitting the categories you already have into
 * main categories and sub-categories. Everything starts ticked except moves of categories with
 * many transactions; nothing changes until Apply, and each change can be undone from Categories.
 */
export default function OrganiseCategoriesScreen() {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState<OrganiseSuggestion[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      getOrganiseSuggestions(DEFAULT_USER_ID)
        .then((list) => {
          if (!live) return;
          setItems(list);
          setPicked(new Set(list.map((s) => s.key)));
        })
        .catch(() => live && setItems([]));
      return () => {
        live = false;
      };
    }, []),
  );

  const moves = useMemo(() => (items ?? []).filter((s) => s.kind === "move"), [items]);
  const adds = useMemo(() => (items ?? []).filter((s) => s.kind === "add"), [items]);
  const byParent = useMemo(() => {
    const m = new Map<string, OrganiseSuggestion[]>();
    for (const s of adds) m.set(s.parentName, [...(m.get(s.parentName) ?? []), s]);
    return [...m.entries()];
  }, [adds]);

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const apply = async () => {
    if (!items) return;
    setSaving(true);
    try {
      const n = await applyOrganiseSuggestions(DEFAULT_USER_ID, items.filter((s) => picked.has(s.key)));
      toast(`${n} change${n === 1 ? "" : "s"} made. Undo any of them from Categories.`);
      router.back();
    } finally {
      setSaving(false);
    }
  };

  if (!items) return <ScreenContainer padTop={false}><LoadingState message="Looking at your categories…" /></ScreenContainer>;
  if (items.length === 0) {
    return (
      <ScreenContainer padTop={false}>
        <EmptyState icon="checkmark-circle-outline" title="Nothing to organise" subtitle="Your categories already fit the main and sub-category setup." />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        <Text className="text-meta text-muted-foreground mb-4">
          Sub-categories sit under a main category, like Food › Eating out. Their spending counts toward the main category's budget. Untick anything you don't want.
        </Text>

        {moves.length > 0 && (
          <View className="rounded-card bg-card border border-border px-4 pt-4 pb-2 mb-3">
            <SectionTitle icon="git-merge-outline" title="Move under a main category" hint="Keeps its transactions, rules and name" className="mb-1" />
            {moves.map((s) =>
              s.kind === "move" ? (
                <CheckRow
                  key={s.key}
                  label={`${s.parentName} › ${s.name}`}
                  sub={s.transactions > 0 ? `${s.transactions} transaction${s.transactions === 1 ? "" : "s"} go with it` : "No transactions yet"}
                  on={picked.has(s.key)}
                  onPress={() => toggle(s.key)}
                />
              ) : null,
            )}
          </View>
        )}

        {byParent.length > 0 && (
          <View className="rounded-card bg-card border border-border px-4 pt-4 pb-2">
            <SectionTitle icon="add-circle-outline" title="Add sub-categories" hint="Pick them when you categorise; nothing moves on its own" className="mb-1" />
            {byParent.map(([parent, list]) => (
              <View key={parent} className="pt-2">
                <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground">{parent}</Text>
                {list.map((s) => (
                  <CheckRow key={s.key} label={s.name} on={picked.has(s.key)} onPress={() => toggle(s.key)} />
                ))}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
      <View className="absolute left-0 right-0 bottom-0 px-4 pt-3 pb-6 bg-background border-t border-border">
        <Button
          title={picked.size === 0 ? "Nothing ticked" : `Apply ${picked.size} change${picked.size === 1 ? "" : "s"}`}
          onPress={apply}
          disabled={picked.size === 0}
          loading={saving}
        />
      </View>
    </ScreenContainer>
  );
}
