import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Switch, TextInput } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
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
  type ActionType,
  type ConditionField,
  type ConditionOperator,
  type RetroactivePreview,
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

function accountTypeLabel(type: string): string {
  switch (type) {
    case "credit_card": return "Credit Card";
    case "savings": case "bank": return "Savings";
    case "wallet": return "Wallet";
    case "loan": return "Loan";
    case "pension": return "Pension";
    case "demat": return "Demat";
    default: return type;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const FIELD_OPTIONS: { key: ConditionField; label: string }[] = (
  Object.keys(FIELD_LABELS) as ConditionField[]
).map((key) => ({ key, label: FIELD_LABELS[key] }));

// ─── THEN action types ─────────────────────────────────────────────────────

type UIActionType = ActionType | "link_investment_bucket";

type UIRuleAction =
  | RuleAction
  | { type: "link_investment_bucket"; bucket_id: string | null };

const ACTION_TYPE_LABELS: Record<UIActionType, string> = {
  category: "Set category",
  payment_mode: "Set payment mode",
  set_description: "Set description",
  tags: "Add tags",
  is_right_spend: "Mark unavoidable / discretionary",
  mark_auto: "Auto-approve from review",
  split_with_person: "Auto split with person",
  link_investment_bucket: "Link investment bucket",
};

const ACTION_TYPE_OPTIONS: { type: UIActionType; label: string }[] = (
  Object.keys(ACTION_TYPE_LABELS) as UIActionType[]
).map((type) => ({ type, label: ACTION_TYPE_LABELS[type] }));

function defaultActionFor(type: UIActionType): UIRuleAction {
  switch (type) {
    case "category": return { type: "category" };
    case "payment_mode": return { type: "payment_mode" };
    case "set_description": return { type: "set_description", description_template: "" };
    case "tags": return { type: "tags", tag_ids: [] };
    case "is_right_spend": return { type: "is_right_spend" };
    case "mark_auto": return { type: "mark_auto" };
    case "split_with_person": return { type: "split_with_person" };
    case "link_investment_bucket": return { type: "link_investment_bucket", bucket_id: null };
    default: return { type: "category" };
  }
}

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

  const [actions, setActions] = useState<UIRuleAction[]>([]);
  const [expandedActionTypeRow, setExpandedActionTypeRow] = useState<number | null>(null);
  const [expandedActionValueRow, setExpandedActionValueRow] = useState<number | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [persons, setPersons] = useState<HisaabPersonWithBalance[]>([]);
  const [buckets, setBuckets] = useState<InvestmentBucket[]>([]);

  // Index of the condition row whose Field/Operator/Value picker is expanded.
  const [expandedFieldRow, setExpandedFieldRow] = useState<number | null>(null);
  const [expandedOperatorRow, setExpandedOperatorRow] = useState<number | null>(null);
  const [expandedCondValueRow, setExpandedCondValueRow] = useState<number | null>(null);
  const [fieldSearch, setFieldSearch] = useState("");

  const [isPendingRetroactive, setIsPendingRetroactive] = useState(true);

  // Retroactive apply sheet
  const [showRetroSheet, setShowRetroSheet] = useState(false);
  const [retroStart, setRetroStart] = useState("");
  const [retroEnd, setRetroEnd] = useState("");
  const [retroAccountIds, setRetroAccountIds] = useState<string[]>([]);
  const [retroOverwrite, setRetroOverwrite] = useState(false);
  const [retroPreview, setRetroPreview] = useState<RetroactivePreview | null>(null);
  const [retroPreviewing, setRetroPreviewing] = useState(false);
  const [retroApplying, setRetroApplying] = useState(false);

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
    setIsPendingRetroactive(r.pending_retroactive === 1);
    setConditions(r.conditions.length > 0 ? r.conditions : [defaultConditionFor("merchant")]);

    const uiActions: UIRuleAction[] = [...r.actions];
    if (r.action_link_to_investment_bucket_id) {
      uiActions.push({ type: "link_investment_bucket", bucket_id: r.action_link_to_investment_bucket_id });
    }
    setActions(uiActions);
  };

  const updateCondition = useCallback((index: number, patch: Partial<RuleCondition>) => {
    setConditions((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }, []);

  const setConditionField = useCallback((index: number, field: ConditionField) => {
    setConditions((prev) => prev.map((c, i) => (i === index ? defaultConditionFor(field) : c)));
    setExpandedFieldRow(null);
    setExpandedCondValueRow(null);
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

  const updateAction = useCallback((index: number, patch: Partial<UIRuleAction>) => {
    setActions((prev) => prev.map((a, i) => (i === index ? ({ ...a, ...patch } as UIRuleAction) : a)));
  }, []);

  const setActionType = useCallback((index: number, type: UIActionType) => {
    setActions((prev) => prev.map((a, i) => (i === index ? defaultActionFor(type) : a)));
    setExpandedActionTypeRow(null);
  }, []);

  const addAction = useCallback(() => {
    setActions((prev) => {
      const usedTypes = new Set(prev.map((a) => a.type));
      const nextType = ACTION_TYPE_OPTIONS.find((opt) => !usedTypes.has(opt.type))?.type ?? "category";
      return [...prev, defaultActionFor(nextType)];
    });
  }, []);

  const removeAction = useCallback((index: number) => {
    setActions((prev) => prev.filter((_, i) => i !== index));
    setExpandedActionTypeRow(null);
  }, []);

  const buildActions = useCallback((): RuleAction[] => {
    const result: RuleAction[] = [];
    for (const action of actions) {
      if (action.type === "link_investment_bucket") continue;
      const a = action as RuleAction;
      if (a.type === "category" && !a.category_id) continue;
      if (a.type === "payment_mode" && !a.payment_mode) continue;
      if (a.type === "set_description" && !a.description_template?.trim()) continue;
      if (a.type === "tags" && (!a.tag_ids || a.tag_ids.length === 0)) continue;
      if (a.type === "split_with_person") {
        if (!a.person_id) continue;
        result.push({ type: "split_with_person", person_id: a.person_id, split_mode: "equal", paid_by: "me" });
        continue;
      }
      result.push(a);
    }
    return result;
  }, [actions]);

  const buildLinkBucketId = useCallback((): string | null => {
    const a = actions.find((x) => x.type === "link_investment_bucket") as
      | { type: "link_investment_bucket"; bucket_id: string | null }
      | undefined;
    return a?.bucket_id ?? null;
  }, [actions]);

  const onSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const input: CreateSmartRuleInput = {
        name,
        priority: parseInt(priority, 10) || 100,
        is_active: isActive,
        action_link_to_investment_bucket_id: buildLinkBucketId(),
        match_mode: matchMode,
        conditions,
        actions: buildActions(),
      };
      if (isCreate) {
        await createRule(input);
      } else {
        await updateRule(id, input);
        setIsPendingRetroactive(true);
      }
      router.back();
    } catch (e) {
      alert("Couldn't save", getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [saving, name, priority, isActive, matchMode, conditions, buildActions, buildLinkBucketId, isCreate, id, alert, router]);

  const openRetroSheet = useCallback(() => {
    setRetroStart(daysAgoIso(90));
    setRetroEnd(todayIso());
    setRetroAccountIds([]);
    setRetroOverwrite(false);
    setRetroPreview(null);
    setShowRetroSheet(true);
  }, []);

  const onRetroPreview = useCallback(async () => {
    setRetroPreviewing(true);
    setRetroPreview(null);
    try {
      const preview = await previewRetroactiveApply({
        ruleId: id,
        startDate: retroStart || null,
        endDate: retroEnd || null,
        accountIds: retroAccountIds.length > 0 ? retroAccountIds : null,
        overwriteExisting: retroOverwrite,
      });
      setRetroPreview(preview);
    } catch (e) {
      alert("Couldn't preview", getErrorMessage(e));
    } finally {
      setRetroPreviewing(false);
    }
  }, [id, retroStart, retroEnd, retroAccountIds, retroOverwrite, alert]);

  const onRetroApply = useCallback(async () => {
    if (!retroPreview || retroApplying) return;
    setRetroApplying(true);
    try {
      const applied = await runRetroactiveApply({
        ruleId: id,
        startDate: retroStart || null,
        endDate: retroEnd || null,
        accountIds: retroAccountIds.length > 0 ? retroAccountIds : null,
        overwriteExisting: retroOverwrite,
      });
      setShowRetroSheet(false);
      setIsPendingRetroactive(false);
      alert("Done", `Applied to ${applied} expense${applied === 1 ? "" : "s"}.`);
    } catch (e) {
      alert("Couldn't apply", getErrorMessage(e));
    } finally {
      setRetroApplying(false);
    }
  }, [id, retroStart, retroEnd, retroAccountIds, retroOverwrite, retroPreview, retroApplying, alert]);

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
                  className="mb-3 p-3 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark"
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
                      setExpandedCondValueRow(null);
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
                    <View className="mb-2 rounded-lg border border-border-light dark:border-border-dark overflow-hidden bg-surface-light dark:bg-surface-dark">
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
                      {filteredFields.map((f) => {
                        const isSelected = condition.field === f.key;
                        return (
                          <Pressable
                            key={f.key}
                            onPress={() => setConditionField(index, f.key)}
                            className="flex-row items-center justify-between px-3 py-2.5 border-b border-border-light dark:border-border-dark"
                            style={{ backgroundColor: isSelected ? accentColor + "18" : undefined }}
                          >
                            <Text className="text-sm text-text-primary dark:text-text-dark-primary" style={{ color: isSelected ? accentColor : colors.text }}>
                              {f.label}
                            </Text>
                            {isSelected && <Ionicons name="checkmark" size={16} color={accentColor} />}
                          </Pressable>
                        );
                      })}
                    </View>
                  )}

                  {/* Operator */}
                  <Pressable
                    onPress={() => {
                      setExpandedOperatorRow(operatorExpanded ? null : index);
                      setExpandedFieldRow(null);
                      setExpandedCondValueRow(null);
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
                    <View className="mb-2 rounded-lg border border-border-light dark:border-border-dark overflow-hidden bg-surface-light dark:bg-surface-dark">
                      {availableOperators.map((op) => {
                        const isSelected = condition.operator === op;
                        return (
                          <Pressable
                            key={op}
                            onPress={() => setConditionOperator(index, op)}
                            className="flex-row items-center justify-between px-3 py-2.5 border-b border-border-light dark:border-border-dark"
                            style={{ backgroundColor: isSelected ? accentColor + "18" : undefined }}
                          >
                            <Text className="text-sm text-text-primary dark:text-text-dark-primary" style={{ color: isSelected ? accentColor : colors.text }}>
                              {OPERATOR_LABELS[op]}
                            </Text>
                            {isSelected && <Ionicons name="checkmark" size={16} color={accentColor} />}
                          </Pressable>
                        );
                      })}
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
                      ) : isPicker ? (() => {
                        const condValueExpanded = expandedCondValueRow === index;
                        const selectedLabel = condition.field === "account_id"
                          ? (() => { const a = accounts.find((x) => x.id === condition.value); return a ? (a.account_label || a.bank_name) : null; })()
                          : condition.field === "payment_mode"
                          ? paymentModes.find((m) => m.id === condition.value)?.name ?? null
                          : categories.find((c) => c.id === condition.value)?.name ?? null;
                        const placeholder = condition.field === "account_id" ? "Select account"
                          : condition.field === "payment_mode" ? "Select payment mode"
                          : "Select category";
                        return (
                          <>
                            <Pressable
                              onPress={() => {
                                setExpandedCondValueRow(condValueExpanded ? null : index);
                                setExpandedFieldRow(null);
                                setExpandedOperatorRow(null);
                              }}
                              className="flex-row items-center justify-between py-2.5 px-3 rounded-lg border border-border-light dark:border-border-dark"
                            >
                              <Text className="text-sm flex-1" style={{ color: selectedLabel ? colors.text : colors.tabIconDefault }}>
                                {selectedLabel ?? placeholder}
                              </Text>
                              <Ionicons name={condValueExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                            </Pressable>
                            {condValueExpanded && (
                              <View className="mt-1 rounded-lg border border-border-light dark:border-border-dark overflow-hidden bg-surface-light dark:bg-surface-dark">
                                {condition.field === "account_id"
                                  ? accounts.map((a) => {
                                      const isSel = condition.value === a.id;
                                      return (
                                        <Pressable
                                          key={a.id}
                                          onPress={() => { updateCondition(index, { value: a.id }); setExpandedCondValueRow(null); }}
                                          className="flex-row items-center justify-between px-3 py-2.5 border-b border-border-light dark:border-border-dark"
                                          style={{ backgroundColor: isSel ? accentColor + "18" : undefined }}
                                        >
                                          <View className="flex-1">
                                            <Text className="text-sm text-text-primary dark:text-text-dark-primary" style={{ color: isSel ? accentColor : colors.text }}>
                                              {a.account_label || a.bank_name}
                                            </Text>
                                            <Text className="text-xs text-text-tertiary mt-0.5">
                                              {accountTypeLabel(a.account_type)} · ••••{a.account_identifier}
                                            </Text>
                                          </View>
                                          {isSel && <Ionicons name="checkmark" size={16} color={accentColor} />}
                                        </Pressable>
                                      );
                                    })
                                  : condition.field === "payment_mode"
                                  ? paymentModes.map((m) => {
                                      const isSel = condition.value === m.id;
                                      return (
                                        <Pressable
                                          key={m.id}
                                          onPress={() => { updateCondition(index, { value: m.id }); setExpandedCondValueRow(null); }}
                                          className="flex-row items-center justify-between px-3 py-2.5 border-b border-border-light dark:border-border-dark"
                                          style={{ backgroundColor: isSel ? accentColor + "18" : undefined }}
                                        >
                                          <Text className="text-sm text-text-primary dark:text-text-dark-primary" style={{ color: isSel ? accentColor : colors.text }}>{m.name}</Text>
                                          {isSel && <Ionicons name="checkmark" size={16} color={accentColor} />}
                                        </Pressable>
                                      );
                                    })
                                  : categories.map((c) => {
                                      const isSel = condition.value === c.id;
                                      return (
                                        <Pressable
                                          key={c.id}
                                          onPress={() => { updateCondition(index, { value: c.id }); setExpandedCondValueRow(null); }}
                                          className="flex-row items-center justify-between px-3 py-2.5 border-b border-border-light dark:border-border-dark"
                                          style={{ backgroundColor: isSel ? accentColor + "18" : undefined }}
                                        >
                                          <Text className="text-sm text-text-primary dark:text-text-dark-primary" style={{ color: isSel ? accentColor : colors.text }}>{c.name}</Text>
                                          {isSel && <Ionicons name="checkmark" size={16} color={accentColor} />}
                                        </Pressable>
                                      );
                                    })
                                }
                              </View>
                            )}
                          </>
                        );
                      })() : (
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

          <Card className="mb-4">
            <Text className="text-xs font-semibold tracking-wider uppercase text-text-secondary dark:text-text-dark-secondary mb-3">
              Then (actions)
            </Text>

            {actions.map((action, index) => {
              const typeExpanded = expandedActionTypeRow === index;
              const valueExpanded = expandedActionValueRow === index;

              return (
                <View
                  key={index}
                  className="mb-3 p-3 rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark"
                >
                  {/* Header */}
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-xs font-semibold tracking-wider uppercase text-text-tertiary">
                      Action {index + 1}
                    </Text>
                    <Pressable
                      onPress={() => removeAction(index)}
                      hitSlop={8}
                      className="w-6 h-6 rounded-full items-center justify-center bg-surface-light-alt dark:bg-surface-dark-alt"
                    >
                      <Ionicons name="close" size={14} color={colors.textSecondary} />
                    </Pressable>
                  </View>

                  {/* Type picker */}
                  <Pressable
                    onPress={() => {
                      setExpandedActionValueRow(null);
                      setExpandedActionTypeRow(typeExpanded ? null : index);
                    }}
                    className="flex-row items-center justify-between py-2"
                  >
                    <View>
                      <Text className="text-xs text-text-tertiary">Action type</Text>
                      <Text className="text-base text-text-primary dark:text-text-dark-primary">
                        {ACTION_TYPE_LABELS[action.type]}
                      </Text>
                    </View>
                    <Ionicons name={typeExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                  </Pressable>

                  {typeExpanded && (
                    <View className="mb-2 rounded-lg border border-border-light dark:border-border-dark overflow-hidden bg-surface-light dark:bg-surface-dark">
                      {ACTION_TYPE_OPTIONS.map((opt) => {
                        const isSelected = action.type === opt.type;
                        return (
                          <Pressable
                            key={opt.type}
                            onPress={() => setActionType(index, opt.type)}
                            className="flex-row items-center justify-between px-3 py-2.5 border-b border-border-light dark:border-border-dark"
                            style={{ backgroundColor: isSelected ? accentColor + "18" : undefined }}
                          >
                            <Text className="text-sm text-text-primary dark:text-text-dark-primary" style={{ color: isSelected ? accentColor : colors.text }}>
                              {opt.label}
                            </Text>
                            {isSelected && <Ionicons name="checkmark" size={16} color={accentColor} />}
                          </Pressable>
                        );
                      })}
                    </View>
                  )}

                  {/* Value input per type */}
                  {action.type === "category" && (() => {
                    const a = action as RuleAction & { type: "category" };
                    const selectedCat = categories.find((c) => c.id === a.category_id);
                    return (
                      <>
                        <Pressable
                          onPress={() => { setExpandedActionTypeRow(null); setExpandedActionValueRow(valueExpanded ? null : index); }}
                          className="flex-row items-center justify-between py-2"
                        >
                          <View>
                            <Text className="text-xs text-text-tertiary">Category</Text>
                            <Text className="text-base" style={{ color: selectedCat ? colors.text : colors.tabIconDefault }}>
                              {selectedCat?.name ?? "Select category"}
                            </Text>
                          </View>
                          <Ionicons name={valueExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                        </Pressable>
                        {valueExpanded && (
                          <View className="mb-2 rounded-lg border border-border-light dark:border-border-dark overflow-hidden bg-surface-light dark:bg-surface-dark">
                            {categories.map((c) => {
                              const isSel = a.category_id === c.id;
                              return (
                                <Pressable
                                  key={c.id}
                                  onPress={() => { updateAction(index, { category_id: c.id }); setExpandedActionValueRow(null); }}
                                  className="flex-row items-center justify-between px-3 py-2.5 border-b border-border-light dark:border-border-dark"
                                  style={{ backgroundColor: isSel ? accentColor + "18" : undefined }}
                                >
                                  <Text className="text-sm text-text-primary dark:text-text-dark-primary" style={{ color: isSel ? accentColor : colors.text }}>{c.name}</Text>
                                  {isSel && <Ionicons name="checkmark" size={16} color={accentColor} />}
                                </Pressable>
                              );
                            })}
                          </View>
                        )}
                      </>
                    );
                  })()}

                  {action.type === "payment_mode" && (() => {
                    const a = action as RuleAction & { type: "payment_mode" };
                    const selectedMode = paymentModes.find((m) => m.id === a.payment_mode);
                    return (
                      <>
                        <Pressable
                          onPress={() => { setExpandedActionTypeRow(null); setExpandedActionValueRow(valueExpanded ? null : index); }}
                          className="flex-row items-center justify-between py-2"
                        >
                          <View>
                            <Text className="text-xs text-text-tertiary">Payment mode</Text>
                            <Text className="text-base" style={{ color: selectedMode ? colors.text : colors.tabIconDefault }}>
                              {selectedMode?.name ?? "Select payment mode"}
                            </Text>
                          </View>
                          <Ionicons name={valueExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                        </Pressable>
                        {valueExpanded && (
                          <View className="mb-2 rounded-lg border border-border-light dark:border-border-dark overflow-hidden bg-surface-light dark:bg-surface-dark">
                            {paymentModes.map((m) => {
                              const isSel = a.payment_mode === m.id;
                              return (
                                <Pressable
                                  key={m.id}
                                  onPress={() => { updateAction(index, { payment_mode: m.id }); setExpandedActionValueRow(null); }}
                                  className="flex-row items-center justify-between px-3 py-2.5 border-b border-border-light dark:border-border-dark"
                                  style={{ backgroundColor: isSel ? accentColor + "18" : undefined }}
                                >
                                  <Text className="text-sm text-text-primary dark:text-text-dark-primary" style={{ color: isSel ? accentColor : colors.text }}>{m.name}</Text>
                                  {isSel && <Ionicons name="checkmark" size={16} color={accentColor} />}
                                </Pressable>
                              );
                            })}
                          </View>
                        )}
                      </>
                    );
                  })()}

                  {action.type === "set_description" && (
                    <View className="mt-1">
                      <Text className="text-xs text-text-tertiary mb-1.5">Description text</Text>
                      <TextInput
                        placeholder="e.g. Monthly subscription"
                        placeholderTextColor={colors.tabIconDefault}
                        value={(action as RuleAction & { type: "set_description" }).description_template ?? ""}
                        onChangeText={(v) => updateAction(index, { description_template: v })}
                        className="rounded-lg border border-border-light dark:border-border-dark px-3 py-2 text-sm text-text-primary dark:text-text-dark-primary"
                      />
                    </View>
                  )}

                  {action.type === "tags" && (
                    <View className="mt-1">
                      <Text className="text-xs text-text-tertiary mb-1.5">Select tags</Text>
                      {tags.length === 0 ? (
                        <Text className="text-xs text-text-tertiary">No tags created yet</Text>
                      ) : (
                        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                          {tags.map((t) => {
                            const selectedIds = (action as RuleAction & { type: "tags" }).tag_ids ?? [];
                            const selected = selectedIds.includes(t.id);
                            return (
                              <Pressable
                                key={t.id}
                                onPress={() =>
                                  updateAction(index, {
                                    tag_ids: selected
                                      ? selectedIds.filter((id) => id !== t.id)
                                      : [...selectedIds, t.id],
                                  })
                                }
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
                  )}

                  {action.type === "is_right_spend" && (() => {
                    const a = action as RuleAction & { type: "is_right_spend" };
                    const opts = [
                      { value: true as boolean | undefined, label: "Unavoidable" },
                      { value: false as boolean | undefined, label: "Discretionary" },
                    ];
                    const selectedLabel = a.is_right_spend === true ? "Unavoidable" : a.is_right_spend === false ? "Discretionary" : null;
                    return (
                      <>
                        <Pressable
                          onPress={() => { setExpandedActionTypeRow(null); setExpandedActionValueRow(valueExpanded ? null : index); }}
                          className="flex-row items-center justify-between py-2"
                        >
                          <View>
                            <Text className="text-xs text-text-tertiary">Classification</Text>
                            <Text className="text-base text-text-primary dark:text-text-dark-primary" style={{ color: selectedLabel ? undefined : colors.tabIconDefault }}>
                              {selectedLabel ?? "Select classification"}
                            </Text>
                          </View>
                          <Ionicons name={valueExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                        </Pressable>
                        {valueExpanded && (
                          <View className="mb-2 rounded-lg border border-border-light dark:border-border-dark overflow-hidden bg-surface-light dark:bg-surface-dark">
                            {opts.map((opt) => {
                              const isSel = a.is_right_spend === opt.value;
                              return (
                                <Pressable
                                  key={String(opt.value)}
                                  onPress={() => { updateAction(index, { is_right_spend: opt.value }); setExpandedActionValueRow(null); }}
                                  className="flex-row items-center justify-between px-3 py-2.5 border-b border-border-light dark:border-border-dark"
                                  style={{ backgroundColor: isSel ? accentColor + "18" : undefined }}
                                >
                                  <Text className="text-sm text-text-primary dark:text-text-dark-primary" style={{ color: isSel ? accentColor : colors.text }}>{opt.label}</Text>
                                  {isSel && <Ionicons name="checkmark" size={16} color={accentColor} />}
                                </Pressable>
                              );
                            })}
                          </View>
                        )}
                      </>
                    );
                  })()}

                  {action.type === "mark_auto" && (
                    <View className="py-2">
                      <Text className="text-xs text-text-tertiary">SMS-detected expenses skip the pending review queue</Text>
                    </View>
                  )}

                  {action.type === "split_with_person" && (() => {
                    const a = action as RuleAction & { type: "split_with_person" };
                    const selectedPerson = persons.find((p) => p.id === a.person_id);
                    return (
                      <>
                        <Pressable
                          onPress={() => { setExpandedActionTypeRow(null); setExpandedActionValueRow(valueExpanded ? null : index); }}
                          className="flex-row items-center justify-between py-2"
                        >
                          <View>
                            <Text className="text-xs text-text-tertiary">Split with</Text>
                            <Text className="text-base text-text-primary dark:text-text-dark-primary" style={{ color: selectedPerson ? undefined : colors.tabIconDefault }}>
                              {selectedPerson?.name ?? "Select person"}
                            </Text>
                          </View>
                          <Ionicons name={valueExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                        </Pressable>
                        {valueExpanded && (
                          <View className="mb-2 rounded-lg border border-border-light dark:border-border-dark overflow-hidden bg-surface-light dark:bg-surface-dark">
                            {persons.length === 0 ? (
                              <Text className="text-sm text-text-tertiary px-3 py-2.5">No people in Hisaab yet</Text>
                            ) : persons.map((p) => {
                              const isSel = a.person_id === p.id;
                              return (
                                <Pressable
                                  key={p.id}
                                  onPress={() => { updateAction(index, { person_id: p.id }); setExpandedActionValueRow(null); }}
                                  className="flex-row items-center justify-between px-3 py-2.5 border-b border-border-light dark:border-border-dark"
                                  style={{ backgroundColor: isSel ? accentColor + "18" : undefined }}
                                >
                                  <Text className="text-sm text-text-primary dark:text-text-dark-primary" style={{ color: isSel ? accentColor : colors.text }}>{p.name}</Text>
                                  {isSel && <Ionicons name="checkmark" size={16} color={accentColor} />}
                                </Pressable>
                              );
                            })}
                          </View>
                        )}
                      </>
                    );
                  })()}

                  {action.type === "link_investment_bucket" && (() => {
                    const a = action as { type: "link_investment_bucket"; bucket_id: string | null };
                    const selectedBucket = buckets.find((b) => b.id === a.bucket_id);
                    return (
                      <>
                        <Pressable
                          onPress={() => { setExpandedActionTypeRow(null); setExpandedActionValueRow(valueExpanded ? null : index); }}
                          className="flex-row items-center justify-between py-2"
                        >
                          <View>
                            <Text className="text-xs text-text-tertiary">Investment bucket</Text>
                            <Text className="text-base text-text-primary dark:text-text-dark-primary" style={{ color: selectedBucket ? undefined : colors.tabIconDefault }}>
                              {selectedBucket?.name ?? "Select bucket"}
                            </Text>
                          </View>
                          <Ionicons name={valueExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                        </Pressable>
                        {valueExpanded && (
                          <View className="mb-2 rounded-lg border border-border-light dark:border-border-dark overflow-hidden bg-surface-light dark:bg-surface-dark">
                            {buckets.length === 0 ? (
                              <Text className="text-sm text-text-tertiary px-3 py-2.5">No investment buckets created yet</Text>
                            ) : buckets.map((b) => {
                              const isSel = a.bucket_id === b.id;
                              return (
                                <Pressable
                                  key={b.id}
                                  onPress={() => { updateAction(index, { bucket_id: b.id }); setExpandedActionValueRow(null); }}
                                  className="flex-row items-center justify-between px-3 py-2.5 border-b border-border-light dark:border-border-dark"
                                  style={{ backgroundColor: isSel ? accentColor + "18" : undefined }}
                                >
                                  <Text className="text-sm text-text-primary dark:text-text-dark-primary" style={{ color: isSel ? accentColor : colors.text }}>{b.name}</Text>
                                  {isSel && <Ionicons name="checkmark" size={16} color={accentColor} />}
                                </Pressable>
                              );
                            })}
                          </View>
                        )}
                      </>
                    );
                  })()}
                </View>
              );
            })}

            {actions.length === 0 && (
              <Text className="text-sm text-text-tertiary text-center py-2 mb-3">No actions yet - add one below</Text>
            )}

            <Pressable
              onPress={addAction}
              className="flex-row items-center justify-center py-2.5 rounded-lg border border-dashed border-border-light dark:border-border-dark"
            >
              <Ionicons name="add" size={16} color={accentColor} />
              <Text className="text-sm font-medium ml-1.5" style={{ color: accentColor }}>
                Add action
              </Text>
            </Pressable>
          </Card>

          {!isCreate && (
            <View className="mb-4" style={{ opacity: isPendingRetroactive ? 1 : 0.5 }}>
            <Card>
              <Pressable
                onPress={isPendingRetroactive ? openRetroSheet : undefined}
                className="flex-row items-center py-3"
              >
                <Ionicons name="time-outline" size={20} color={isPendingRetroactive ? accentColor : colors.textSecondary} />
                <View className="flex-1 ml-3">
                  <Text className="text-base font-semibold text-text-primary dark:text-text-dark-primary">
                    Apply to past expenses
                  </Text>
                  <Text className="text-xs text-text-tertiary mt-0.5">
                    {isPendingRetroactive
                      ? "Retroactively apply this rule to matching past expenses"
                      : "Already applied — edit the rule to enable again"}
                  </Text>
                </View>
                {isPendingRetroactive && (
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                )}
              </Pressable>
            </Card>
            </View>
          )}

          <Button
            title={saving ? "Saving..." : isCreate ? "Create Rule" : "Save Changes"}
            onPress={onSave}
            disabled={saving}
            loading={saving}
          />
        </View>
      </ScrollView>
      {/* Retroactive apply sheet */}
      <BottomSheet visible={showRetroSheet} onClose={() => setShowRetroSheet(false)}>
        <View className="px-4 pb-6">
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-lg font-semibold text-text-primary dark:text-text-dark-primary">
              Apply to past expenses
            </Text>
            <Pressable onPress={() => setShowRetroSheet(false)}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>

          {/* Date range */}
          <Text className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-2">
            Date range
          </Text>
          <View className="flex-row mb-4" style={{ gap: 8 }}>
            <View className="flex-1">
              <Text className="text-xs text-text-tertiary mb-1">From</Text>
              <TextInput
                value={retroStart}
                onChangeText={(v) => { setRetroStart(v); setRetroPreview(null); }}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.tabIconDefault}
                className="rounded-lg border border-border-light dark:border-border-dark px-3 py-2.5 text-sm text-text-primary dark:text-text-dark-primary"
              />
            </View>
            <View className="flex-1">
              <Text className="text-xs text-text-tertiary mb-1">To</Text>
              <TextInput
                value={retroEnd}
                onChangeText={(v) => { setRetroEnd(v); setRetroPreview(null); }}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.tabIconDefault}
                className="rounded-lg border border-border-light dark:border-border-dark px-3 py-2.5 text-sm text-text-primary dark:text-text-dark-primary"
              />
            </View>
          </View>

          {/* Quick presets */}
          <View className="flex-row flex-wrap mb-4" style={{ gap: 6 }}>
            {[
              { label: "Last 30 days", days: 30 },
              { label: "Last 90 days", days: 90 },
              { label: "Last 6 months", days: 180 },
              { label: "Last year", days: 365 },
            ].map(({ label, days }) => (
              <Pressable
                key={days}
                onPress={() => { setRetroStart(daysAgoIso(days)); setRetroEnd(todayIso()); setRetroPreview(null); }}
                className="px-3 py-1.5 rounded-full border"
                style={{ borderColor: colors.border }}
              >
                <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">{label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Account filter */}
          {accounts.length > 0 && (
            <>
              <Text className="text-xs font-semibold uppercase tracking-wider text-text-tertiary mb-2">
                Filter by account (optional)
              </Text>
              <ScrollView className="max-h-36 mb-4" showsVerticalScrollIndicator={false}>
                {accounts.map((a) => {
                  const isSel = retroAccountIds.includes(a.id);
                  return (
                    <Pressable
                      key={a.id}
                      onPress={() => {
                        setRetroAccountIds((prev) =>
                          isSel ? prev.filter((x) => x !== a.id) : [...prev, a.id],
                        );
                        setRetroPreview(null);
                      }}
                      className={`flex-row items-center justify-between py-2.5 px-3 rounded-lg mb-1.5 border ${isSel ? "" : "border-border-light dark:border-border-dark"}`}
                      style={isSel ? { borderColor: accentColor, backgroundColor: accentColor + "18" } : undefined}
                    >
                      <View className="flex-1">
                        <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary" style={{ color: isSel ? accentColor : colors.text }}>
                          {a.account_label || a.bank_name}
                        </Text>
                        <Text className="text-xs text-text-tertiary mt-0.5">
                          {accountTypeLabel(a.account_type)} · ••••{a.account_identifier}
                        </Text>
                      </View>
                      <Ionicons name={isSel ? "checkbox" : "square-outline"} size={20} color={isSel ? accentColor : colors.textSecondary} />
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}

          {/* Overwrite toggle */}
          <View className="flex-row items-center justify-between py-3 border-t border-border-light dark:border-border-dark mb-4">
            <View className="flex-1 mr-4">
              <Text className="text-sm text-text-primary dark:text-text-dark-primary">Override existing values</Text>
              <Text className="text-xs text-text-tertiary mt-0.5">If off, expenses that already have a category are skipped</Text>
            </View>
            <Switch
              value={retroOverwrite}
              onValueChange={(v) => { setRetroOverwrite(v); setRetroPreview(null); }}
              trackColor={{ false: colors.border, true: accentColor }}
            />
          </View>

          {/* Preview result */}
          {retroPreview && (
            <View className="rounded-lg px-4 py-3 mb-4" style={{ backgroundColor: accentColor + "14" }}>
              <Text className="text-sm font-semibold mb-1" style={{ color: accentColor }}>
                Preview
              </Text>
              <Text className="text-sm text-text-primary dark:text-text-dark-primary">
                {retroPreview.matching} matching expense{retroPreview.matching === 1 ? "" : "s"}
              </Text>
              <Text className="text-xs text-text-tertiary mt-0.5">
                {retroPreview.wouldOverwrite} will be updated · {retroPreview.wouldSkip} skipped (already categorized)
              </Text>
            </View>
          )}

          {/* Actions */}
          <View className="flex-row" style={{ gap: 8 }}>
            <Pressable
              onPress={onRetroPreview}
              disabled={retroPreviewing}
              className="flex-1 py-3 rounded-xl items-center border border-border-light dark:border-border-dark"
            >
              {retroPreviewing
                ? <ActivityIndicator size="small" color={accentColor} />
                : <Text className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">Preview</Text>
              }
            </Pressable>
            <Pressable
              onPress={onRetroApply}
              disabled={!retroPreview || retroPreview.wouldOverwrite === 0 || retroApplying}
              className="flex-1 py-3 rounded-xl items-center"
              style={{ backgroundColor: (!retroPreview || retroPreview.wouldOverwrite === 0) ? colors.border : accentColor }}
            >
              {retroApplying
                ? <ActivityIndicator size="small" color="white" />
                : <Text className="text-sm font-semibold text-white">Apply</Text>
              }
            </Pressable>
          </View>
        </View>
      </BottomSheet>
    </ScreenContainer>
  );
}
