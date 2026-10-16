import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, LoadingState, ScreenContainer, SelectSheet, Text, useToast } from "@/components/ui";
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
import { listMerchants, type MerchantSummary } from "@/services/merchants-overview";

/**
 * One merchant: the name it shows as, every name it has in transaction messages (merge / unmerge), and
 * the category its new transactions go to, with an offer to fix older ones.
 */
export default function MerchantDetailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const alert = useAlert();
  const toast = useToast();
  const params = useLocalSearchParams<{ name: string }>();
  const [name, setName] = useState(params.name ?? "");
  const [all, setAll] = useState<MerchantSummary[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [past, setPast] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [catPicker, setCatPicker] = useState(false);
  const [mergePicker, setMergePicker] = useState(false);

  const merchant = useMemo(() => all?.find((m) => m.name.toLowerCase() === name.toLowerCase()) ?? null, [all, name]);

  const load = useCallback(async () => {
    const [list, cats] = await Promise.all([listMerchants(DEFAULT_USER_ID), getCategories(DEFAULT_USER_ID)]);
    setAll(list);
    setCategories(cats);
    const m = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
    setPast(m?.rule ? await countPastTransactionsForRule(m.rule.keyword, m.rule.categoryName) : 0);
  }, [name]);
  useDataRefresh(load);

  const rename = async () => {
    const next = draft.trim();
    setEditing(false);
    if (!merchant || !next || next === merchant.name) return;
    await renameCanonical(DEFAULT_USER_ID, merchant.name, next);
    // Names with no alias row yet get one, so their future messages show under the new name too.
    for (const n of merchant.names) if (!n.aliasId) await learnMerchantAlias(DEFAULT_USER_ID, n.smsName, next);
    const moved = await propagateMerchantRename(DEFAULT_USER_ID, merchant.name, next);
    setName(next);
    router.setParams({ name: next });
    toast(moved > 0 ? `Renamed on ${moved} transaction${moved === 1 ? "" : "s"}` : "Renamed");
  };

  const mergeIn = async (otherName: string) => {
    if (!merchant) return;
    const other = all?.find((m) => m.name === otherName);
    if (!other) return;
    await renameCanonical(DEFAULT_USER_ID, other.name, merchant.name);
    for (const n of other.names) if (!n.aliasId) await learnMerchantAlias(DEFAULT_USER_ID, n.smsName, merchant.name);
    const moved = await propagateMerchantRename(DEFAULT_USER_ID, other.name, merchant.name);
    toast(`${other.name} now shows as ${merchant.name}${moved > 0 ? ` (${moved} transaction${moved === 1 ? "" : "s"})` : ""}`);
  };

  const unmerge = (aliasId: string, smsName: string) =>
    alert("Separate this name?", `"${smsName}" becomes its own merchant, and its transactions are renamed back.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Separate",
        onPress: async () => {
          await unmergeMerchantAlias(aliasId, DEFAULT_USER_ID);
        },
      },
    ]);

  const setCategory = async (categoryName: string) => {
    if (!merchant) return;
    try {
      await setMerchantRule(merchant.name, categoryName);
      toast(`New ${merchant.name} transactions go to ${categoryName}`);
    } catch (e) {
      alert("Couldn't set the category", e instanceof Error ? e.message : String(e));
    }
  };

  const applyPast = async () => {
    if (!merchant?.rule) return;
    const n = await applyRuleToPastTransactions(merchant.rule.keyword, merchant.rule.categoryName);
    toast(`Moved ${n} transaction${n === 1 ? "" : "s"} to ${merchant.rule.categoryName}`);
  };

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
        <Text className="text-sm text-muted-foreground text-center px-8 mt-10">This merchant no longer exists. It may have been merged into another.</Text>
      </ScreenContainer>
    );
  }

  const others = all.filter((m) => m.name.toLowerCase() !== merchant.name.toLowerCase());
  const rule = merchant.rule;

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen options={{ title: merchant.name }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Card className="mx-4 mt-3">
          <Text className="text-xs text-muted-foreground">Shown as</Text>
          {editing ? (
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              onSubmitEditing={() => void rename()}
              onBlur={() => void rename()}
              returnKeyType="done"
              maxLength={100}
              className="text-lg font-semibold text-foreground py-1 border-b"
              style={{ borderColor: theme.primary }}
              accessibilityLabel="Merchant name"
            />
          ) : (
            <Pressable
              onPress={() => {
                setDraft(merchant.name);
                setEditing(true);
              }}
              className="flex-row items-center"
              accessibilityRole="button"
              accessibilityLabel={`Rename ${merchant.name}`}
            >
              <Text className="text-lg font-semibold text-foreground">{merchant.name}</Text>
              <Ionicons name="pencil-outline" size={14} color={theme.mutedForeground} style={{ marginLeft: 6 }} />
            </Pressable>
          )}
          <Text className="text-xs text-muted-foreground mt-1">
            {merchant.txCount} transaction{merchant.txCount === 1 ? "" : "s"}
          </Text>
        </Card>

        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-5 mt-5 mb-2">Names in transaction messages</Text>
        <Card className="mx-4">
          {merchant.names.map((n, i) => {
            const canSeparate = n.aliasId != null && n.smsName.toLowerCase() !== merchant.name.toLowerCase();
            return (
              <View key={`${n.smsName}-${i}`} className="flex-row items-center py-2.5" style={i > 0 ? { borderTopWidth: 1, borderTopColor: theme.border } : undefined}>
                <Text className="text-sm text-foreground flex-1" numberOfLines={1}>{n.smsName}</Text>
                {canSeparate && (
                  <Pressable onPress={() => unmerge(n.aliasId!, n.smsName)} hitSlop={8} accessibilityRole="button">
                    <Text className="text-xs font-medium" style={{ color: theme.primary }}>Separate</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
          {others.length > 0 && (
            <Pressable onPress={() => setMergePicker(true)} className="flex-row items-center pt-2.5 mt-1" style={{ borderTopWidth: 1, borderTopColor: theme.border }} accessibilityRole="button">
              <Ionicons name="git-merge-outline" size={15} color={theme.primary} />
              <Text className="text-sm ml-1.5" style={{ color: theme.primary }}>Merge another merchant into {merchant.name}</Text>
            </Pressable>
          )}
        </Card>

        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-5 mt-5 mb-2">Category</Text>
        <Card className="mx-4">
          <Pressable onPress={() => setCatPicker(true)} className="flex-row items-center py-1" accessibilityRole="button">
            <View className="flex-1">
              <Text className="text-sm font-medium text-foreground">{merchant.category ?? "Not set"}</Text>
              <Text className="text-xs text-muted-foreground mt-0.5">
                {merchant.categorySource === "rule"
                  ? rule?.source === "builtin"
                    ? "Arth's built-in choice for new transactions"
                    : "Always, for new transactions"
                  : merchant.categorySource === "learned"
                    ? `Learned from ${merchant.learned?.count ?? 0} of your corrections`
                    : "New transactions aren't filed automatically"}
              </Text>
            </View>
            <Text className="text-xs font-medium" style={{ color: theme.primary }}>{merchant.category ? "Change" : "Set"}</Text>
          </Pressable>
          {rule && past > 0 && (
            <Pressable onPress={() => void applyPast()} className="flex-row items-center py-2.5 mt-2" style={{ borderTopWidth: 1, borderTopColor: theme.border }} accessibilityRole="button">
              <View className="flex-1">
                <Text className="text-sm text-foreground">Apply to past transactions</Text>
                <Text className="text-xs text-muted-foreground mt-0.5">{past} older one{past === 1 ? " is" : "s are"} in a different category</Text>
              </View>
              <Text className="text-xs font-medium" style={{ color: theme.primary }}>Apply</Text>
            </Pressable>
          )}
          {rule && rule.source !== "builtin" && (
            <Pressable
              onPress={() => void resetOrRemoveMerchantRule(rule.keyword)}
              className="py-2.5 mt-2"
              style={{ borderTopWidth: 1, borderTopColor: theme.border }}
              accessibilityRole="button"
            >
              <Text className="text-sm" style={{ color: theme.danger }}>
                {rule.builtInCategory ? `Back to Arth's choice (${rule.builtInCategory})` : "Stop filing automatically"}
              </Text>
            </Pressable>
          )}
          {merchant.categorySource === "learned" && merchant.learned && (
            <Pressable
              onPress={() => void forgetLearnedMerchant(merchant.learned!.id)}
              className="py-2.5 mt-2"
              style={{ borderTopWidth: 1, borderTopColor: theme.border }}
              accessibilityRole="button"
            >
              <Text className="text-sm" style={{ color: theme.danger }}>Forget what Arth learned</Text>
            </Pressable>
          )}
        </Card>
      </ScrollView>

      <SelectSheet
        visible={catPicker}
        title={`File ${merchant.name} under`}
        options={categories.map((c) => ({ value: c.name, label: c.name }))}
        value={merchant.category}
        onChange={(v) => void setCategory(v)}
        onClose={() => setCatPicker(false)}
      />
      <SelectSheet
        visible={mergePicker}
        title={`Show as ${merchant.name}`}
        options={others.map((m) => ({ value: m.name, label: m.name }))}
        value={null}
        onChange={(v) => void mergeIn(v)}
        onClose={() => setMergePicker(false)}
      />
    </ScreenContainer>
  );
}
