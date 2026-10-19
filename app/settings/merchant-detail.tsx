import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, LoadingState, ScreenContainer, Text, UndoBar } from "@/components/ui";
import { CategoryPickerSheet } from "@/components/expense/catch-up/CategoryPickerSheet";
import { MerchantMergeSheet } from "@/components/merchants/MerchantMergeSheet";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useAlert } from "@/hooks/use-alert";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { useTheme } from "@/hooks/use-theme";
import { getCategories, type Category } from "@/services/category";
import { learnMerchantAlias, propagateMerchantRename, renameCanonical, unmergeMerchantAlias } from "@/services/merchant-alias";
import {
  applyRuleToPastTransactions,
  countPastTransactionsForRule,
  forgetLearnedMerchant,
  resetOrRemoveMerchantRule,
  setMerchantRule,
} from "@/services/merchant-categories";
import { dismissMerchantUndo, undoMerchantChange, usePendingMerchantUndo, withMerchantUndo } from "@/services/merchant-undo";
import { listMerchants, type MerchantSummary } from "@/services/merchants-overview";

const s = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * One merchant: the name it shows as, every name it has in transaction messages (merge / separate),
 * and the category its new transactions go to, with an offer to fix older ones.
 *
 * Every change can be undone from the bar at the bottom, which stays until it's closed
 * (services/merchant-undo.ts). Buttons are full size and the "reset" actions sit apart from the
 * rest, so a slip of the finger doesn't change anything by accident.
 */
export default function MerchantDetailScreen() {
  const theme = useTheme();
  const alert = useAlert();
  const params = useLocalSearchParams<{ name: string }>();
  // Kept in state (not the route params) so renaming never touches navigation.
  const [name, setName] = useState(params.name ?? "");
  const [all, setAll] = useState<MerchantSummary[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [past, setPast] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [catPicker, setCatPicker] = useState(false);
  const [mergePicker, setMergePicker] = useState(false);
  const pendingUndo = usePendingMerchantUndo();

  const merchant = useMemo(() => all?.find((m) => m.name.toLowerCase() === name.toLowerCase()) ?? null, [all, name]);

  const load = useCallback(async () => {
    const [list, cats] = await Promise.all([listMerchants(DEFAULT_USER_ID), getCategories(DEFAULT_USER_ID)]);
    setAll(list);
    setCategories(cats);
    const m = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
    setPast(m?.rule ? await countPastTransactionsForRule(m.rule.keyword, m.rule.categoryName) : 0);
  }, [name]);
  useDataRefresh(load);

  const run = async (change: () => Promise<string>) => {
    try {
      await withMerchantUndo(change, (msg) => msg);
    } catch (e) {
      alert("Couldn't make that change", e instanceof Error ? e.message : String(e));
    }
  };

  const rename = () => {
    const next = draft.trim();
    setEditing(false);
    if (!merchant || !next || next === merchant.name) return;
    const from = merchant.name;
    void run(async () => {
      await renameCanonical(DEFAULT_USER_ID, from, next);
      // Names with no alias row yet get one, so their future messages show under the new name too.
      for (const n of merchant.names) if (!n.aliasId) await learnMerchantAlias(DEFAULT_USER_ID, n.smsName, next);
      const moved = await propagateMerchantRename(DEFAULT_USER_ID, from, next);
      setName(next);
      return `Renamed ${from} to ${next}${moved > 0 ? ` on ${s(moved, "transaction")}` : ""}`;
    });
  };

  const mergeIn = (otherName: string) => {
    if (!merchant) return;
    const other = all?.find((m) => m.name === otherName);
    if (!other) return;
    void run(async () => {
      await renameCanonical(DEFAULT_USER_ID, other.name, merchant.name);
      for (const n of other.names) if (!n.aliasId) await learnMerchantAlias(DEFAULT_USER_ID, n.smsName, merchant.name);
      const moved = await propagateMerchantRename(DEFAULT_USER_ID, other.name, merchant.name);
      return `${other.name} now shows as ${merchant.name}${moved > 0 ? ` (${s(moved, "transaction")})` : ""}`;
    });
  };

  const separate = (aliasId: string, smsName: string) =>
    void run(async () => {
      const r = await unmergeMerchantAlias(aliasId, DEFAULT_USER_ID);
      return `"${smsName}" is its own merchant again${r && r.expensesUpdated > 0 ? ` (${s(r.expensesUpdated, "transaction")})` : ""}`;
    });

  const setCategory = (categoryName: string) => {
    if (!merchant) return;
    void run(async () => {
      await setMerchantRule(merchant.name, categoryName);
      return `New ${merchant.name} transactions go to ${categoryName}`;
    });
  };

  const applyPast = () => {
    const rule = merchant?.rule;
    if (!rule) return;
    void run(async () => {
      const n = await applyRuleToPastTransactions(rule.keyword, rule.categoryName);
      return `Moved ${s(n, "transaction")} to ${rule.categoryName}`;
    });
  };

  const resetRule = () => {
    const rule = merchant?.rule;
    if (!rule) return;
    void run(async () => {
      await resetOrRemoveMerchantRule(rule.keyword);
      return rule.builtInCategory ? `Back to Arth's choice (${rule.builtInCategory})` : `${merchant!.name} isn't filed automatically any more`;
    });
  };

  const forget = () => {
    const learned = merchant?.learned;
    if (!learned) return;
    void run(async () => {
      await forgetLearnedMerchant(learned.id);
      return `Arth forgot what it learned about ${merchant!.name}`;
    });
  };

  const undoBar = pendingUndo && (
    <UndoBar message={pendingUndo.message} onUndo={async () => {
      await undoMerchantChange();
    }} onClose={dismissMerchantUndo} />
  );

  if (!all) {
    return (
      <ScreenContainer padTop={false}>
        <Stack.Screen options={{ title: name || "Merchant" }} />
        <LoadingState icon="storefront-outline" message="Loading…" />
      </ScreenContainer>
    );
  }
  if (!merchant) {
    return (
      <ScreenContainer padTop={false}>
        <Stack.Screen options={{ title: name || "Merchant" }} />
        <Text className="text-sm text-muted-foreground text-center px-8 mt-10">
          This merchant no longer exists. It may have been merged into another{pendingUndo ? " - you can undo that below." : "."}
        </Text>
        {undoBar}
      </ScreenContainer>
    );
  }

  const others = all.filter((m) => m.name.toLowerCase() !== merchant.name.toLowerCase());
  const rule = merchant.rule;
  const canReset = rule && rule.source !== "builtin";
  const canForget = merchant.categorySource === "learned" && merchant.learned;

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen options={{ title: merchant.name }} />
      <ScrollView contentContainerStyle={{ paddingBottom: pendingUndo ? 120 : 40 }} keyboardShouldPersistTaps="handled">
        {/* Name */}
        <Card className="mx-4 mt-3">
          <Text className="text-xs text-muted-foreground">Shown as</Text>
          {editing ? (
            <>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                autoFocus
                onSubmitEditing={rename}
                returnKeyType="done"
                maxLength={100}
                className="text-lg font-semibold text-foreground py-2 border-b-2"
                style={{ borderColor: theme.primary }}
                accessibilityLabel="Merchant name"
              />
              <View className="flex-row mt-3" style={{ gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button title="Cancel" variant="outline" onPress={() => setEditing(false)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Save" onPress={rename} />
                </View>
              </View>
            </>
          ) : (
            <View className="flex-row items-center mt-1">
              <View className="flex-1 mr-3">
                <Text className="text-lg font-semibold text-foreground">{merchant.name}</Text>
                <Text className="text-xs text-muted-foreground mt-0.5">{s(merchant.txCount, "transaction")}</Text>
              </View>
              <BigAction
                icon="pencil-outline"
                label="Rename"
                onPress={() => {
                  setDraft(merchant.name);
                  setEditing(true);
                }}
              />
            </View>
          )}
        </Card>

        {/* Names in messages */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-5 mt-6 mb-2">Names in transaction messages</Text>
        <Card className="mx-4">
          {merchant.names.map((n, i) => {
            const canSeparate = n.aliasId != null && n.smsName.toLowerCase() !== merchant.name.toLowerCase();
            return (
              <View
                key={`${n.smsName}-${i}`}
                className="flex-row items-center"
                style={[{ minHeight: 56, paddingVertical: 8 }, i > 0 ? { borderTopWidth: 1, borderTopColor: theme.border } : undefined]}
              >
                <Text className="text-sm text-foreground flex-1 mr-3" numberOfLines={2}>{n.smsName}</Text>
                {canSeparate && <BigAction icon="git-branch-outline" label="Separate" onPress={() => separate(n.aliasId!, n.smsName)} />}
              </View>
            );
          })}
          {others.length > 0 && (
            <View className="pt-3 mt-1" style={{ borderTopWidth: 1, borderTopColor: theme.border }}>
              <Button title={`Merge another merchant into ${merchant.name}`} variant="outline" onPress={() => setMergePicker(true)} />
            </View>
          )}
        </Card>

        {/* Category */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-5 mt-6 mb-2">Category</Text>
        <Card className="mx-4">
          <View className="flex-row items-center" style={{ minHeight: 56 }}>
            <View className="flex-1 mr-3">
              <Text className="text-base font-semibold text-foreground">{merchant.category ?? "Not set"}</Text>
              <Text className="text-xs text-muted-foreground mt-0.5">
                {merchant.categorySource === "rule"
                  ? rule?.source === "builtin"
                    ? "Arth's built-in choice for new transactions"
                    : "Always, for new transactions"
                  : merchant.categorySource === "learned"
                    ? `Learned from ${s(merchant.learned?.count ?? 0, "correction")} you made`
                    : "New transactions aren't filed automatically"}
              </Text>
            </View>
            <BigAction icon="swap-horizontal-outline" label={merchant.category ? "Change" : "Set"} onPress={() => setCatPicker(true)} />
          </View>
          {rule && past > 0 && (
            <View className="pt-3 mt-2" style={{ borderTopWidth: 1, borderTopColor: theme.border }}>
              <Text className="text-xs text-muted-foreground mb-2">
                {past} older transaction{past === 1 ? " is" : "s are"} in a different category.
              </Text>
              <Button title={`Move ${past === 1 ? "it" : `all ${past}`} to ${rule.categoryName}`} variant="secondary" onPress={applyPast} />
            </View>
          )}
        </Card>

        {/* Resets, kept apart from everything else. */}
        {(canReset || canForget) && (
          <>
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-5 mt-8 mb-2">Reset</Text>
            <Card className="mx-4">
              <View style={{ gap: 10 }}>
              {canReset && (
                <DangerButton
                  label={rule!.builtInCategory ? `Back to Arth's choice (${rule!.builtInCategory})` : "Stop filing automatically"}
                  onPress={resetRule}
                />
              )}
              {canForget && <DangerButton label="Forget what Arth learned" onPress={forget} />}
              </View>
            </Card>
          </>
        )}
      </ScrollView>

      <CategoryPickerSheet
        visible={catPicker}
        categories={categories}
        selectedId={categories.find((c) => c.name === merchant.category)?.id ?? null}
        onSelect={(id) => {
          setCatPicker(false);
          const c = categories.find((x) => x.id === id);
          if (c) setCategory(c.name);
        }}
        onClose={() => setCatPicker(false)}
      />
      <MerchantMergeSheet
        visible={mergePicker}
        target={merchant.name}
        merchants={others}
        onMerge={mergeIn}
        onClose={() => setMergePicker(false)}
      />
      {undoBar}
    </ScreenContainer>
  );
}

/** A pill-shaped button big enough to hit without aiming: 44 high, icon and word. */
function BigAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center rounded-full px-4"
      // Plain style objects: a style function on Pressable can be dropped on device.
      android_ripple={{ color: theme.alpha("primary", 0.25), borderless: false }}
      style={{ height: 44, backgroundColor: theme.alpha("primary", 0.1), overflow: "hidden" }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={16} color={theme.primary} />
      <Text className="text-sm font-semibold ml-1.5" style={{ color: theme.primary }}>{label}</Text>
    </Pressable>
  );
}

function DangerButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="items-center justify-center rounded-xl px-4"
      android_ripple={{ color: theme.alpha("danger", 0.15) }}
      style={{ minHeight: 48, borderWidth: 1.5, borderColor: theme.alpha("danger", 0.5), overflow: "hidden" }}
      accessibilityRole="button"
    >
      <Text className="text-sm font-semibold text-center" style={{ color: theme.danger }}>{label}</Text>
    </Pressable>
  );
}
