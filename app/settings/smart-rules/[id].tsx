import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Switch } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer } from "@/components/ui";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getRule,
  createRule,
  updateRule,
  previewRetroactiveApply,
  runRetroactiveApply,
  type SmartRule,
  type CreateSmartRuleInput,
} from "@/services/smart-rules";
import { getCategories, type Category } from "@/services/category";

/**
 * Smart-rule detail / create form. Route: /settings/smart-rules/[id]
 *   - "new" → create mode
 *   - an actual UUID → edit mode
 *
 * Layout: a Conditions card + an Actions card + Retroactive-apply card
 * (edit mode only) + Save / Cancel footer.
 */
export default function SmartRuleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isCreate = id === "new";
  const router = useRouter();
  const alert = useAlert();
  const { colors, colorScheme, accent } = useColorScheme();
  const accentColor = colorScheme === "dark" ? accent[400] : accent[500];

  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<CreateSmartRuleInput & { is_active: boolean; action_mark_auto: boolean }>({
    name: "",
    priority: 100,
    is_active: true,
    match_merchant_contains: null,
    match_merchant_regex: null,
    match_min_amount: null,
    match_max_amount: null,
    match_account_id: null,
    match_payment_mode: null,
    match_sms_keyword: null,
    action_category_id: null,
    action_payment_mode: null,
    action_tag_ids: null,
    action_is_right_spend: null,
    action_mark_auto: false,
  });

  const [categories, setCategories] = useState<Category[]>([]);

  const [minAmtStr, setMinAmtStr] = useState("");
  const [maxAmtStr, setMaxAmtStr] = useState("");

  useEffect(() => {
    getCategories(DEFAULT_USER_ID).then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (isCreate) return;
    (async () => {
      try {
        const r = await getRule(id);
        if (!r) {
          alert("Rule not found", "It may have been deleted.");
          router.back();
          return;
        }
        hydrateFromRule(r);
      } catch (e) {
        alert("Couldn't load", e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isCreate]);

  const hydrateFromRule = (r: SmartRule) => {
    setForm({
      name: r.name,
      priority: r.priority,
      is_active: r.is_active === 1,
      match_merchant_contains: r.match_merchant_contains,
      match_merchant_regex: r.match_merchant_regex,
      match_min_amount: r.match_min_amount,
      match_max_amount: r.match_max_amount,
      match_account_id: r.match_account_id,
      match_payment_mode: r.match_payment_mode,
      match_sms_keyword: r.match_sms_keyword,
      action_category_id: r.action_category_id,
      action_payment_mode: r.action_payment_mode,
      action_tag_ids: r.action_tag_ids ? (JSON.parse(r.action_tag_ids) as string[]) : null,
      action_is_right_spend: r.action_is_right_spend,
      action_mark_auto: r.action_mark_auto === 1,
    });
    setMinAmtStr(r.match_min_amount !== null ? String(r.match_min_amount) : "");
    setMaxAmtStr(r.match_max_amount !== null ? String(r.match_max_amount) : "");
  };

  const onSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const input: CreateSmartRuleInput = {
        ...form,
        match_min_amount: minAmtStr.trim() ? parseFloat(minAmtStr) : null,
        match_max_amount: maxAmtStr.trim() ? parseFloat(maxAmtStr) : null,
      };
      if (isCreate) {
        await createRule(input);
      } else {
        await updateRule(id, input);
      }
      router.back();
    } catch (e) {
      alert("Couldn't save", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [saving, form, minAmtStr, maxAmtStr, isCreate, id, alert, router]);

  const onRetroactive = useCallback(async () => {
    if (isCreate) return;
    try {
      const preview = await previewRetroactiveApply({
        ruleId: id,
        sinceDaysAgo: 90,
        overwriteExisting: false,
      });
      alert(
        "Apply to past expenses?",
        `${preview.matching} expense${preview.matching === 1 ? "" : "s"} in the last 90 days match this rule. ${preview.wouldOverwrite} will be categorized. ${preview.wouldSkip} already have a category and will be skipped.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Apply",
            onPress: async () => {
              try {
                const applied = await runRetroactiveApply({
                  ruleId: id,
                  sinceDaysAgo: 90,
                  overwriteExisting: false,
                });
                alert("Done", `Applied to ${applied} expense${applied === 1 ? "" : "s"}.`);
              } catch (e) {
                alert("Retroactive apply failed", e instanceof Error ? e.message : String(e));
              }
            },
          },
        ],
      );
    } catch (e) {
      alert("Preview failed", e instanceof Error ? e.message : String(e));
    }
  }, [isCreate, id, alert]);

  const categoryLabel = useMemo(() => {
    if (!form.action_category_id) return "Not set";
    return categories.find((c) => c.id === form.action_category_id)?.name ?? "Unknown";
  }, [form.action_category_id, categories]);

  if (loading) {
    return (
      <ScreenContainer padTop={false}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={accentColor} />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <View className="px-4 py-4">
          <Card className="mb-4">
            <Input
              label="Rule name"
              placeholder="e.g. Swiggy → Food"
              value={form.name}
              onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
              containerClassName="mb-3"
            />
            <Input
              label="Priority (lower = tried first)"
              placeholder="100"
              keyboardType="numeric"
              value={String(form.priority ?? 100)}
              onChangeText={(v) => setForm((f) => ({ ...f, priority: parseInt(v, 10) || 100 }))}
              containerClassName="mb-3"
            />
            <View className="flex-row items-center justify-between py-2">
              <Text className="text-sm text-text-primary dark:text-text-dark-primary">Active</Text>
              <Switch
                value={form.is_active}
                onValueChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
                trackColor={{ false: colors.border, true: accentColor }}
              />
            </View>
          </Card>

          <Card title="WHEN (conditions)" className="mb-4">
            <Input
              label="Merchant contains"
              placeholder="e.g. swiggy"
              value={form.match_merchant_contains ?? ""}
              onChangeText={(v) => setForm((f) => ({ ...f, match_merchant_contains: v || null }))}
              containerClassName="mb-3"
            />
            <Input
              label="Merchant regex (advanced)"
              placeholder="e.g. ^AMZN(\\.in)?"
              value={form.match_merchant_regex ?? ""}
              onChangeText={(v) => setForm((f) => ({ ...f, match_merchant_regex: v || null }))}
              autoCapitalize="none"
              autoCorrect={false}
              containerClassName="mb-3"
            />
            <View className="flex-row mb-3">
              <Input
                label="Min amount"
                placeholder="e.g. 100"
                keyboardType="numeric"
                value={minAmtStr}
                onChangeText={setMinAmtStr}
                containerClassName="flex-1 mr-2"
              />
              <Input
                label="Max amount"
                placeholder="e.g. 2000"
                keyboardType="numeric"
                value={maxAmtStr}
                onChangeText={setMaxAmtStr}
                containerClassName="flex-1 ml-2"
              />
            </View>
            <Input
              label="SMS body contains (when triggered by SMS)"
              placeholder="e.g. UPI"
              value={form.match_sms_keyword ?? ""}
              onChangeText={(v) => setForm((f) => ({ ...f, match_sms_keyword: v || null }))}
            />
            <Text className="text-xs text-text-tertiary mt-3">
              All configured conditions must match. Leave fields blank to skip them.
            </Text>
          </Card>

          <Card title="THEN (actions)" className="mb-4">
            <Pressable
              onPress={() => {
                // Simple category picker inline — show next category in list (demo)
                if (categories.length === 0) return;
                const cur = categories.findIndex((c) => c.id === form.action_category_id);
                const nextIdx = (cur + 1) % (categories.length + 1);
                const next = nextIdx === categories.length ? null : categories[nextIdx].id;
                setForm((f) => ({ ...f, action_category_id: next }));
              }}
              className="flex-row items-center py-3 border-b border-border-light dark:border-border-dark"
            >
              <View className="flex-1">
                <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary mb-1">
                  Set category
                </Text>
                <Text className="text-base text-text-primary dark:text-text-dark-primary">
                  {categoryLabel}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>

            <View className="flex-row items-center justify-between py-3 border-b border-border-light dark:border-border-dark">
              <View className="flex-1">
                <Text className="text-sm text-text-primary dark:text-text-dark-primary">Mark unavoidable</Text>
                <Text className="text-xs text-text-tertiary mt-0.5">
                  {form.action_is_right_spend === 1 ? "Will mark as unavoidable" : form.action_is_right_spend === 0 ? "Will mark as discretionary" : "Not set"}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  const next =
                    form.action_is_right_spend === null ? 1 : form.action_is_right_spend === 1 ? 0 : null;
                  setForm((f) => ({ ...f, action_is_right_spend: next }));
                }}
                className="px-3 py-1 rounded-full border border-border-light dark:border-border-dark"
              >
                <Text className="text-xs text-text-primary dark:text-text-dark-primary">Cycle</Text>
              </Pressable>
            </View>

            <View className="flex-row items-center justify-between py-3">
              <View className="flex-1 mr-3">
                <Text className="text-sm text-text-primary dark:text-text-dark-primary">
                  Auto-approve from review queue
                </Text>
                <Text className="text-xs text-text-tertiary mt-0.5">
                  SMS-detected expenses skip the pending queue (default OFF)
                </Text>
              </View>
              <Switch
                value={form.action_mark_auto}
                onValueChange={(v) => setForm((f) => ({ ...f, action_mark_auto: v }))}
                trackColor={{ false: colors.border, true: accentColor }}
              />
            </View>
          </Card>

          {!isCreate && (
            <Card className="mb-4">
              <Pressable onPress={onRetroactive} className="flex-row items-center py-3">
                <Ionicons name="time-outline" size={20} color={accentColor} />
                <View className="flex-1 ml-3">
                  <Text className="text-base text-text-primary dark:text-text-dark-primary font-semibold">
                    Apply to past expenses
                  </Text>
                  <Text className="text-xs text-text-tertiary mt-0.5">
                    Retroactively categorize matching expenses from the last 90 days
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </Pressable>
            </Card>
          )}

          <Button
            title={saving ? "Saving..." : isCreate ? "Create Rule" : "Save Changes"}
            onPress={onSave}
            disabled={saving}
            loading={saving}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
