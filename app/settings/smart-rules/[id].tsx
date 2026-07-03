import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Switch, TextInput } from "react-native";
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
  OPERATORS_BY_FIELD,
  FIELD_LABELS,
  OPERATOR_LABELS,
  type SmartRule,
  type CreateSmartRuleInput,
  type RuleCondition,
  type RuleAction,
  type ConditionField,
  type ConditionOperator,
} from "@/services/smart-rules";
import { getCategories, type Category } from "@/services/category";
import { getPaymentModes, type PaymentMode } from "@/services/payment-mode";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { getTags, type Tag } from "@/services/tags";
import { getPersonsWithBalances, type HisaabPersonWithBalance } from "@/services/hisaab";
import { getAllActiveBuckets, type InvestmentBucket } from "@/services/yearly-plan";
import { getErrorMessage } from "@/utils/error-message";

/**
 * Smart-rule detail / create form. Route: /settings/smart-rules/[id]
 *   - "new" → create mode
 *   - an actual UUID → edit mode
 *
 * Rebuilt on the migration-053 conditions model: Match ALL/ANY + a
 * dynamic list of (field, operator, value) conditions, replacing the
 * old fixed 7-field form.
 */

const FIELD_OPTIONS: { key: ConditionField; label: string }[] = (
  Object.keys(FIELD_LABELS) as ConditionField[]
).map((key) => ({ key, label: FIELD_LABELS[key] }));

function fieldLabel(field: ConditionField): string {
  return FIELD_LABELS[field] ?? field;
}

function defaultOperatorFor(field: ConditionField): ConditionOperator {
  return OPERATORS_BY_FIELD[field][0];
}

function defaultConditionFor(field: ConditionField): RuleCondition {
  const operator = defaultOperatorFor(field);
  return { field, operator, value: operator === "is_empty" || operator === "is_not_empty" ? null : "" };
}

export default function SmartRuleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isCreate = id === "new";
  const router = useRouter();
  const alert = useAlert();
  const { colors, colorScheme, accent } = useColorScheme();
  const accentColor = colorScheme === "dark" ? accent[400] : accent[500];

  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [priority, setPriority] = useState("100");
  const [isActive, setIsActive] = useState(true);
  const [matchMode, setMatchMode] = useState<"all" | "any">("all");
  const [conditions, setConditions] = useState<RuleCondition[]>([defaultConditionFor("merchant")]);

  const [actionCategoryId, setActionCategoryId] = useState<string | null>(null);
  const [actionPaymentModeId, setActionPaymentModeId] = useState<string | null>(null);
  const [actionDescription, setActionDescription] = useState<string>("");
  const [actionTagIds, setActionTagIds] = useState<string[]>([]);
  const [actionIsRightSpend, setActionIsRightSpend] = useState<number | null>(null);
  const [actionMarkAuto, setActionMarkAuto] = useState(false);
  const [actionSplitPersonId, setActionSplitPersonId] = useState<string | null>(null);
  const [actionLinkBucketId, setActionLinkBucketId] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [persons, setPersons] = useState<HisaabPersonWithBalance[]>([]);
  const [buckets, setBuckets] = useState<InvestmentBucket[]>([]);

  // Index of the condition row whose Field/Operator picker is expanded, and a search query for it.
  const [expandedFieldRow, setExpandedFieldRow] = useState<number | null>(null);
  const [expandedOperatorRow, setExpandedOperatorRow] = useState<number | null>(null);
  const [fieldSearch, setFieldSearch] = useState("");

  useEffect(() => {
    getCategories(DEFAULT_USER_ID).then(setCategories).catch(() => setCategories([]));
    getPaymentModes(DEFAULT_USER_ID).then(setPaymentModes).catch(() => setPaymentModes([]));
    getActiveAccounts(DEFAULT_USER_ID).then(setAccounts).catch(() => setAccounts([]));
    getTags(DEFAULT_USER_ID).then(setTags).catch(() => setTags([]));
    getPersonsWithBalances(DEFAULT_USER_ID).then(setPersons).catch(() => setPersons([]));
    getAllActiveBuckets(DEFAULT_USER_ID).then(setBuckets).catch(() => setBuckets([]));
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
        alert("Couldn't load", getErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isCreate]);

  const hydrateFromRule = (r: SmartRule) => {
    setName(r.name);
    setPriority(String(r.priority));
    setIsActive(r.is_active === 1);
    setMatchMode(r.match_mode);
    setConditions(r.conditions.length > 0 ? r.conditions : [defaultConditionFor("merchant")]);

    for (const action of r.actions) {
      if (action.type === "category" && action.category_id) setActionCategoryId(action.category_id);
      if (action.type === "payment_mode" && action.payment_mode) setActionPaymentModeId(action.payment_mode);
      if (action.type === "set_description" && action.description_template) setActionDescription(action.description_template);
      if (action.type === "tags" && action.tag_ids) setActionTagIds(action.tag_ids);
      if (action.type === "is_right_spend" && action.is_right_spend !== undefined) {
        setActionIsRightSpend(action.is_right_spend ? 1 : 0);
      }
      if (action.type === "mark_auto") setActionMarkAuto(true);
      if (action.type === "split_with_person" && action.person_id) setActionSplitPersonId(action.person_id);
    }
    if (r.action_link_to_investment_bucket_id) setActionLinkBucketId(r.action_link_to_investment_bucket_id);
  };

  const updateCondition = useCallback((index: number, patch: Partial<RuleCondition>) => {
    setConditions((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }, []);

  const setConditionField = useCallback((index: number, field: ConditionField) => {
    setConditions((prev) => prev.map((c, i) => (i === index ? defaultConditionFor(field) : c)));
    setExpandedFieldRow(null);
    setFieldSearch("");
  }, []);

  const setConditionOperator = useCallback((index: number, operator: ConditionOperator) => {
    setConditions((prev) =>
      prev.map((c, i) =>
        i === index
          ? { ...c, operator, value: operator === "is_empty" || operator === "is_not_empty" ? null : operator === "between" ? [0, 0] : "" }
          : c,
      ),
    );
    setExpandedOperatorRow(null);
  }, []);

  const addCondition = useCallback(() => {
    setConditions((prev) => [...prev, defaultConditionFor("merchant")]);
  }, []);

  const removeCondition = useCallback((index: number) => {
    setConditions((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }, []);

  const buildActions = useCallback((): RuleAction[] => {
    const actions: RuleAction[] = [];
    if (actionCategoryId) actions.push({ type: "category", category_id: actionCategoryId });
    if (actionPaymentModeId) actions.push({ type: "payment_mode", payment_mode: actionPaymentModeId });
    if (actionDescription.trim()) actions.push({ type: "set_description", description_template: actionDescription.trim() });
    if (actionTagIds.length > 0) actions.push({ type: "tags", tag_ids: actionTagIds });
    if (actionIsRightSpend !== null) actions.push({ type: "is_right_spend", is_right_spend: actionIsRightSpend === 1 });
    if (actionMarkAuto) actions.push({ type: "mark_auto" });
    if (actionSplitPersonId) actions.push({ type: "split_with_person", person_id: actionSplitPersonId, split_mode: "equal", paid_by: "me" });
    return actions;
  }, [actionCategoryId, actionPaymentModeId, actionDescription, actionTagIds, actionIsRightSpend, actionMarkAuto, actionSplitPersonId]);

  const onSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const input: CreateSmartRuleInput = {
        name,
        priority: parseInt(priority, 10) || 100,
        is_active: isActive,
        action_link_to_investment_bucket_id: actionLinkBucketId,
        match_mode: matchMode,
        conditions,
        actions: buildActions(),
      };
      if (isCreate) {
        await createRule(input);
      } else {
        await updateRule(id, input);
      }
      router.back();
    } catch (e) {
      alert("Couldn't save", getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [saving, name, priority, isActive, matchMode, conditions, buildActions, isCreate, id, alert, router]);

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
                alert("Couldn't apply", getErrorMessage(e));
              }
            },
          },
        ],
      );
    } catch (e) {
      alert("Couldn't preview", getErrorMessage(e));
    }
  }, [isCreate, id, alert]);

  const categoryLabel = useMemo(() => {
    if (!actionCategoryId) return "Not set";
    return categories.find((c) => c.id === actionCategoryId)?.name ?? "Unknown";
  }, [actionCategoryId, categories]);

  const filteredFields = useMemo(() => {
    const q = fieldSearch.trim().toLowerCase();
    if (!q) return FIELD_OPTIONS;
    return FIELD_OPTIONS.filter((f) => f.label.toLowerCase().includes(q));
  }, [fieldSearch]);

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
              value={name}
              onChangeText={setName}
              containerClassName="mb-3"
            />
            <Input
              label="Priority (lower = tried first)"
              placeholder="100"
              keyboardType="numeric"
              value={priority}
              onChangeText={setPriority}
              containerClassName="mb-3"
            />
            <View className="flex-row items-center justify-between py-2">
              <Text className="text-sm text-text-primary dark:text-text-dark-primary">Active</Text>
              <Switch
                value={isActive}
                onValueChange={setIsActive}
                trackColor={{ false: colors.border, true: accentColor }}
              />
            </View>
          </Card>

          <Card className="mb-4">
            <Text className="text-xs font-semibold tracking-wider uppercase text-text-secondary dark:text-text-dark-secondary mb-3">
              When (conditions)
            </Text>

            <View className="flex-row mb-4">
              <Pressable
                onPress={() => setMatchMode("all")}
                className="flex-1 py-2.5 rounded-l-lg items-center"
                style={{ backgroundColor: matchMode === "all" ? accentColor : "transparent", borderWidth: matchMode === "all" ? 0 : 1, borderColor: colors.border }}
              >
                <Text className={matchMode === "all" ? "text-white font-semibold" : "text-text-secondary dark:text-text-dark-secondary"}>
                  Match ALL
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setMatchMode("any")}
                className="flex-1 py-2.5 rounded-r-lg items-center"
                style={{ backgroundColor: matchMode === "any" ? accentColor : "transparent", borderWidth: matchMode === "any" ? 0 : 1, borderColor: colors.border, borderLeftWidth: 0 }}
              >
                <Text className={matchMode === "any" ? "text-white font-semibold" : "text-text-secondary dark:text-text-dark-secondary"}>
                  Match ANY
                </Text>
              </Pressable>
            </View>

            {conditions.map((condition, index) => {
              const availableOperators = OPERATORS_BY_FIELD[condition.field];
              const fieldExpanded = expandedFieldRow === index;
              const operatorExpanded = expandedOperatorRow === index;
              const needsValue = condition.operator !== "is_empty" && condition.operator !== "is_not_empty";
              const isPicker = condition.field === "account_id" || condition.field === "payment_mode" || condition.field === "category_id";

              return (
                <View
                  key={index}
                  className="mb-3 p-3 rounded-xl border border-border-light dark:border-border-dark"
                >
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-xs font-semibold tracking-wider uppercase text-text-tertiary">
                      Condition {index + 1}
                    </Text>
                    {conditions.length > 1 && (
                      <Pressable
                        onPress={() => removeCondition(index)}
                        hitSlop={8}
                        className="w-6 h-6 rounded-full items-center justify-center bg-surface-light-alt dark:bg-surface-dark-alt"
                      >
                        <Ionicons name="close" size={14} color={colors.textSecondary} />
                      </Pressable>
                    )}
                  </View>

                  {/* Field */}
                  <Pressable
                    onPress={() => {
                      setExpandedFieldRow(fieldExpanded ? null : index);
                      setExpandedOperatorRow(null);
                      setFieldSearch("");
                    }}
                    className="flex-row items-center justify-between py-2"
                  >
                    <View>
                      <Text className="text-xs text-text-tertiary">Field</Text>
                      <Text className="text-base text-text-primary dark:text-text-dark-primary">
                        {fieldLabel(condition.field)}
                      </Text>
                    </View>
                    <Ionicons name={fieldExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                  </Pressable>

                  {fieldExpanded && (
                    <View className="mb-2 rounded-lg border border-border-light dark:border-border-dark overflow-hidden">
                      <View className="flex-row items-center px-3 py-2 border-b border-border-light dark:border-border-dark">
                        <Ionicons name="search" size={14} color={colors.textSecondary} />
                        <TextInput
                          placeholder="Search fields..."
                          placeholderTextColor={colors.tabIconDefault}
                          value={fieldSearch}
                          onChangeText={setFieldSearch}
                          className="flex-1 ml-2 text-sm text-text-primary dark:text-text-dark-primary"
                        />
                      </View>
                      {filteredFields.map((f) => (
                        <Pressable
                          key={f.key}
                          onPress={() => setConditionField(index, f.key)}
                          className="px-3 py-2.5 border-b border-border-light dark:border-border-dark"
                        >
                          <Text className="text-sm text-text-primary dark:text-text-dark-primary">{f.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}

                  {/* Operator */}
                  <Pressable
                    onPress={() => {
                      setExpandedOperatorRow(operatorExpanded ? null : index);
                      setExpandedFieldRow(null);
                    }}
                    className="flex-row items-center justify-between py-2"
                  >
                    <View>
                      <Text className="text-xs text-text-tertiary">Operator</Text>
                      <Text className="text-base text-text-primary dark:text-text-dark-primary">
                        {OPERATOR_LABELS[condition.operator]}
                      </Text>
                    </View>
                    <Ionicons name={operatorExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                  </Pressable>

                  {operatorExpanded && (
                    <View className="mb-2 rounded-lg border border-border-light dark:border-border-dark overflow-hidden">
                      {availableOperators.map((op) => (
                        <Pressable
                          key={op}
                          onPress={() => setConditionOperator(index, op)}
                          className="px-3 py-2.5 border-b border-border-light dark:border-border-dark"
                        >
                          <Text className="text-sm text-text-primary dark:text-text-dark-primary">{OPERATOR_LABELS[op]}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}

                  {/* Value */}
                  {needsValue && (
                    <View className="mt-1">
                      <Text className="text-xs text-text-tertiary mb-1.5">Value</Text>
                      {condition.operator === "between" ? (
                        <View className="flex-row">
                          <TextInput
                            placeholder="Min"
                            placeholderTextColor={colors.tabIconDefault}
                            keyboardType="numeric"
                            value={Array.isArray(condition.value) ? String(condition.value[0]) : ""}
                            onChangeText={(v) => {
                              const max = Array.isArray(condition.value) ? condition.value[1] : 0;
                              updateCondition(index, { value: [parseFloat(v) || 0, max] });
                            }}
                            className="flex-1 mr-2 rounded-lg border border-border-light dark:border-border-dark px-3 py-2.5 text-sm text-text-primary dark:text-text-dark-primary"
                          />
                          <TextInput
                            placeholder="Max"
                            placeholderTextColor={colors.tabIconDefault}
                            keyboardType="numeric"
                            value={Array.isArray(condition.value) ? String(condition.value[1]) : ""}
                            onChangeText={(v) => {
                              const min = Array.isArray(condition.value) ? condition.value[0] : 0;
                              updateCondition(index, { value: [min, parseFloat(v) || 0] });
                            }}
                            className="flex-1 rounded-lg border border-border-light dark:border-border-dark px-3 py-2.5 text-sm text-text-primary dark:text-text-dark-primary"
                          />
                        </View>
                      ) : isPicker ? (
                        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                          {(condition.field === "account_id" ? accounts.map((a) => ({ id: a.id, name: a.account_label || a.bank_name }))
                            : condition.field === "payment_mode" ? paymentModes.map((m) => ({ id: m.id, name: m.name }))
                            : categories.map((c) => ({ id: c.id, name: c.name }))
                          ).map((opt) => (
                            <Pressable
                              key={opt.id}
                              onPress={() => updateCondition(index, { value: opt.id })}
                              className="px-3 py-1.5 rounded-full border"
                              style={{
                                backgroundColor: condition.value === opt.id ? accentColor : "transparent",
                                borderColor: condition.value === opt.id ? accentColor : colors.border,
                              }}
                            >
                              <Text className={condition.value === opt.id ? "text-white text-xs font-medium" : "text-text-secondary dark:text-text-dark-secondary text-xs"}>
                                {opt.name}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : (
                        <TextInput
                          placeholder={condition.field === "amount" ? "e.g. 500" : "e.g. swiggy"}
                          placeholderTextColor={colors.tabIconDefault}
                          keyboardType={condition.field === "amount" ? "numeric" : "default"}
                          autoCapitalize="none"
                          value={String(condition.value ?? "")}
                          onChangeText={(v) =>
                            updateCondition(index, { value: condition.field === "amount" ? parseFloat(v) || 0 : v })
                          }
                          className="rounded-lg border border-border-light dark:border-border-dark px-3 py-2.5 text-sm text-text-primary dark:text-text-dark-primary"
                        />
                      )}
                    </View>
                  )}
                </View>
              );
            })}

            <Pressable
              onPress={addCondition}
              className="flex-row items-center justify-center py-2.5 rounded-lg border border-dashed border-border-light dark:border-border-dark"
            >
              <Ionicons name="add" size={16} color={accentColor} />
              <Text className="text-sm font-medium ml-1.5" style={{ color: accentColor }}>
                Add condition
              </Text>
            </Pressable>
          </Card>

          <Card title="THEN (actions)" className="mb-4">
            {/* Set Category */}
            <Pressable
              onPress={() => {
                if (categories.length === 0) return;
                const cur = categories.findIndex((c) => c.id === actionCategoryId);
                const nextIdx = (cur + 1) % (categories.length + 1);
                setActionCategoryId(nextIdx === categories.length ? null : categories[nextIdx].id);
              }}
              className="flex-row items-center py-3 border-b border-border-light dark:border-border-dark"
            >
              <View className="flex-1">
                <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary mb-1">Set category</Text>
                <Text className="text-base text-text-primary dark:text-text-dark-primary">
                  {actionCategoryId ? (categories.find((c) => c.id === actionCategoryId)?.name ?? "Unknown") : "Not set"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>

            {/* Set Payment Mode */}
            <Pressable
              onPress={() => {
                if (paymentModes.length === 0) return;
                const cur = paymentModes.findIndex((m) => m.id === actionPaymentModeId);
                const nextIdx = (cur + 1) % (paymentModes.length + 1);
                setActionPaymentModeId(nextIdx === paymentModes.length ? null : paymentModes[nextIdx].id);
              }}
              className="flex-row items-center py-3 border-b border-border-light dark:border-border-dark"
            >
              <View className="flex-1">
                <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary mb-1">Set payment mode</Text>
                <Text className="text-base text-text-primary dark:text-text-dark-primary">
                  {actionPaymentModeId ? (paymentModes.find((m) => m.id === actionPaymentModeId)?.name ?? "Unknown") : "Not set"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>

            {/* Set Description */}
            <View className="py-3 border-b border-border-light dark:border-border-dark">
              <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary mb-2">Set description</Text>
              <TextInput
                placeholder="Leave blank to skip"
                placeholderTextColor={colors.tabIconDefault}
                value={actionDescription}
                onChangeText={setActionDescription}
                className="rounded-lg border border-border-light dark:border-border-dark px-3 py-2 text-sm text-text-primary dark:text-text-dark-primary"
              />
            </View>

            {/* Add Tags */}
            <View className="py-3 border-b border-border-light dark:border-border-dark">
              <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary mb-2">Add tags</Text>
              {tags.length === 0 ? (
                <Text className="text-xs text-text-tertiary">No tags created yet</Text>
              ) : (
                <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                  {tags.map((t) => {
                    const selected = actionTagIds.includes(t.id);
                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => setActionTagIds((prev) => selected ? prev.filter((id) => id !== t.id) : [...prev, t.id])}
                        className="px-3 py-1.5 rounded-full border"
                        style={{ backgroundColor: selected ? accentColor : "transparent", borderColor: selected ? accentColor : colors.border }}
                      >
                        <Text className={selected ? "text-white text-xs font-medium" : "text-text-secondary dark:text-text-dark-secondary text-xs"}>
                          {t.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Mark Unavoidable */}
            <View className="flex-row items-center justify-between py-3 border-b border-border-light dark:border-border-dark">
              <View className="flex-1">
                <Text className="text-sm text-text-primary dark:text-text-dark-primary">Mark unavoidable</Text>
                <Text className="text-xs text-text-tertiary mt-0.5">
                  {actionIsRightSpend === 1 ? "Will mark as unavoidable" : actionIsRightSpend === 0 ? "Will mark as discretionary" : "Not set"}
                </Text>
              </View>
              <Pressable
                onPress={() => setActionIsRightSpend(actionIsRightSpend === null ? 1 : actionIsRightSpend === 1 ? 0 : null)}
                className="px-3 py-1 rounded-full border border-border-light dark:border-border-dark"
              >
                <Text className="text-xs text-text-primary dark:text-text-dark-primary">
                  {actionIsRightSpend === null ? "Off" : actionIsRightSpend === 1 ? "Unavoidable" : "Discretionary"}
                </Text>
              </Pressable>
            </View>

            {/* Auto-approve */}
            <View className="flex-row items-center justify-between py-3 border-b border-border-light dark:border-border-dark">
              <View className="flex-1 mr-3">
                <Text className="text-sm text-text-primary dark:text-text-dark-primary">Auto-approve from review queue</Text>
                <Text className="text-xs text-text-tertiary mt-0.5">SMS-detected expenses skip the pending queue</Text>
              </View>
              <Switch
                value={actionMarkAuto}
                onValueChange={setActionMarkAuto}
                trackColor={{ false: colors.border, true: accentColor }}
              />
            </View>

            {/* Link Investment Bucket */}
            <Pressable
              onPress={() => {
                if (buckets.length === 0) return;
                const cur = buckets.findIndex((b) => b.id === actionLinkBucketId);
                const nextIdx = (cur + 1) % (buckets.length + 1);
                setActionLinkBucketId(nextIdx === buckets.length ? null : buckets[nextIdx].id);
              }}
              className="flex-row items-center py-3 border-b border-border-light dark:border-border-dark"
            >
              <View className="flex-1">
                <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary mb-1">Link investment bucket</Text>
                <Text className="text-base text-text-primary dark:text-text-dark-primary">
                  {actionLinkBucketId ? (buckets.find((b) => b.id === actionLinkBucketId)?.name ?? "Unknown") : "Not set"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>

            {/* Auto Split */}
            <Pressable
              onPress={() => {
                if (persons.length === 0) return;
                const cur = persons.findIndex((p) => p.id === actionSplitPersonId);
                const nextIdx = (cur + 1) % (persons.length + 1);
                setActionSplitPersonId(nextIdx === persons.length ? null : persons[nextIdx].id);
              }}
              className="flex-row items-center py-3"
            >
              <View className="flex-1">
                <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary mb-1">Auto split with</Text>
                <Text className="text-base text-text-primary dark:text-text-dark-primary">
                  {actionSplitPersonId ? (persons.find((p) => p.id === actionSplitPersonId)?.name ?? "Unknown") : "Not set"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
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
