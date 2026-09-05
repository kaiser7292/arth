import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Pressable, ScrollView, ActivityIndicator, Switch, TextInput } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { DateInput, LoadingState, ScreenContainer, Sheet, Text } from "@/components/ui";
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
  type AppliesTo,
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
import { useTheme } from "@/hooks/use-theme";

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
    case "split_with_person": return { type: "split_with_person", split_mode: "equal", paid_by: "me" };
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
  const { id, initialRetro } = useLocalSearchParams<{ id: string; initialRetro?: string }>();
  const isCreate = id === "new";
  const router = useRouter();
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const accentColor = theme.primary;

  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [priority, setPriority] = useState("100");
  const [isActive, setIsActive] = useState(true);
  const [matchMode, setMatchMode] = useState<"all" | "any">("all");
  const [appliesTo, setAppliesTo] = useState<AppliesTo>("expense");
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
  const [retroPreset, setRetroPreset] = useState<number | null>(7);
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
        if (initialRetro === "1") {
          // Opened after rule creation — auto-show the apply-to-past sheet
          setRetroStart(daysAgoIso(7));
          setRetroEnd(todayIso());
          setRetroPreset(7);
          setRetroAccountIds([]);
          setRetroOverwrite(false);
          setRetroPreview(null);
          setShowRetroSheet(true);
        }
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
    setAppliesTo(r.applies_to);
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
        const splitAction: RuleAction = {
          type: "split_with_person",
          person_id: a.person_id,
          split_mode: a.split_mode ?? "equal",
          paid_by: a.paid_by ?? "me",
          ...(a.split_mode === "percentage" && a.split_percentage != null ? { split_percentage: a.split_percentage } : {}),
          ...(a.split_mode === "exact" && a.split_exact_amount != null ? { split_exact_amount: a.split_exact_amount } : {}),
        };
        result.push(splitAction);
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

  const openRetroSheet = useCallback(() => {
    setRetroStart(daysAgoIso(7));
    setRetroEnd(todayIso());
    setRetroPreset(7);
    setRetroAccountIds([]);
    setRetroOverwrite(false);
    setRetroPreview(null);
    setShowRetroSheet(true);
  }, []);

  const onSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const input: CreateSmartRuleInput = {
        name,
        priority: parseInt(priority, 10) || 100,
        is_active: isActive,
        match_mode: matchMode,
        applies_to: appliesTo,
        conditions,
        actions: buildActions(),
        action_link_to_investment_bucket_id: buildLinkBucketId(),
      };
      if (isCreate) {
        const newId = await createRule(input);
        setSaving(false);
        // Navigate to the new rule's page and offer apply-to-past
        router.replace(`/settings/smart-rules/${newId}?initialRetro=1`);
      } else {
        await updateRule(id, input);
        setSaving(false);
        setIsPendingRetroactive(true);
        alert(
          "Rule saved",
          "Apply this rule to past expenses?",
          [
            { text: "Skip", style: "cancel", onPress: () => router.back() },
            { text: "Apply to Past", onPress: openRetroSheet },
          ],
        );
      }
    } catch (e) {
      setSaving(false);
      alert("Couldn't save", getErrorMessage(e));
    }
  }, [saving, name, priority, isActive, matchMode, conditions, buildActions, buildLinkBucketId, isCreate, id, alert, router, openRetroSheet]);

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
        <LoadingState />
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
              <Text className="text-sm text-foreground">Active</Text>
              <Switch
                value={isActive}
                onValueChange={setIsActive}
                trackColor={{ false: colors.border, true: accentColor }}
              />
            </View>
          </Card>

          <Card className="mb-4">
            <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground mb-3">
              Applies to
            </Text>
            <View className="flex-row mb-1">
              {(["expense", "credit", "any"] as AppliesTo[]).map((opt, i) => {
                const label = opt === "expense" ? "Expenses" : opt === "credit" ? "Credits" : "Both";
                const active = appliesTo === opt;
                const isFirst = i === 0;
                const isLast = i === 2;
                return (
                  <Pressable
                    key={opt}
                    onPress={() => setAppliesTo(opt)}
                    className="flex-1 py-2.5 items-center"
                    style={{
                      backgroundColor: active ? accentColor : "transparent",
                      borderWidth: active ? 0 : 1,
                      borderColor: colors.border,
                      borderLeftWidth: isFirst || active ? (active ? 0 : 1) : 0,
                      borderRadius: isFirst ? 8 : isLast ? 8 : 0,
                      borderTopLeftRadius: isFirst ? 8 : 0,
                      borderBottomLeftRadius: isFirst ? 8 : 0,
                      borderTopRightRadius: isLast ? 8 : 0,
                      borderBottomRightRadius: isLast ? 8 : 0,
                    }}
                  >
                    <Text style={{ color: active ? "#fff" : colors.textSecondary }} className="text-sm font-medium">
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text className="text-xs text-faint-foreground mt-1">
              {appliesTo === "expense"
                ? "Rule fires on debits and spending."
                : appliesTo === "credit"
                ? "Rule fires on incoming credits (salary, refunds)."
                : "Rule fires on all transactions."}
            </Text>
          </Card>

          <Card className="mb-4">
            <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground mb-3">
              When (conditions)
            </Text>

            <View className="flex-row mb-4">
              <Pressable
                onPress={() => setMatchMode("all")}
                className="flex-1 py-2.5 rounded-l-lg items-center"
                style={{ backgroundColor: matchMode === "all" ? accentColor : "transparent", borderWidth: matchMode === "all" ? 0 : 1, borderColor: colors.border }}
              >
                <Text className={matchMode === "all" ? "text-primary-foreground font-semibold" : "text-muted-foreground"}>
                  Match ALL
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setMatchMode("any")}
                className="flex-1 py-2.5 rounded-r-lg items-center"
                style={{ backgroundColor: matchMode === "any" ? accentColor : "transparent", borderWidth: matchMode === "any" ? 0 : 1, borderColor: colors.border, borderLeftWidth: 0 }}
              >
                <Text className={matchMode === "any" ? "text-primary-foreground font-semibold" : "text-muted-foreground"}>
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
                  className="mb-3 p-3 rounded-xl border border-border bg-background"
                >
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-xs font-semibold tracking-wider uppercase text-faint-foreground">
                      Condition {index + 1}
                    </Text>
                    {conditions.length > 1 && (
                      <Pressable
                        onPress={() => removeCondition(index)}
                        hitSlop={8}
                        className="w-6 h-6 rounded-full items-center justify-center bg-card"
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
                      <Text className="text-xs text-faint-foreground">Field</Text>
                      <Text className="text-base text-foreground">
                        {fieldLabel(condition.field)}
                      </Text>
                    </View>
                    <Ionicons name={fieldExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                  </Pressable>

                  {fieldExpanded && (
                    <View className="mb-2 rounded-lg border border-border overflow-hidden bg-background">
                      <View className="flex-row items-center px-3 py-2 border-b border-border">
                        <Ionicons name="search" size={14} color={colors.textSecondary} />
                        <TextInput
                          placeholder="Search fields..."
                          placeholderTextColor={colors.tabIconDefault}
                          value={fieldSearch}
                          onChangeText={setFieldSearch}
                          className="flex-1 ml-2 text-sm text-foreground"
                        />
                      </View>
                      {filteredFields.map((f) => {
                        const isSelected = condition.field === f.key;
                        return (
                          <Pressable
                            key={f.key}
                            onPress={() => setConditionField(index, f.key)}
                            className="flex-row items-center justify-between px-3 py-2.5 border-b border-border"
                            style={{ backgroundColor: isSelected ? accentColor + "18" : undefined }}
                          >
                            <Text className="text-sm text-foreground" style={isSelected ? { color: accentColor } : undefined}>
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
                      <Text className="text-xs text-faint-foreground">Operator</Text>
                      <Text className="text-base text-foreground">
                        {OPERATOR_LABELS[condition.operator]}
                      </Text>
                    </View>
                    <Ionicons name={operatorExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                  </Pressable>

                  {operatorExpanded && (
                    <View className="mb-2 rounded-lg border border-border overflow-hidden bg-background">
                      {availableOperators.map((op) => {
                        const isSelected = condition.operator === op;
                        return (
                          <Pressable
                            key={op}
                            onPress={() => setConditionOperator(index, op)}
                            className="flex-row items-center justify-between px-3 py-2.5 border-b border-border"
                            style={{ backgroundColor: isSelected ? accentColor + "18" : undefined }}
                          >
                            <Text className="text-sm text-foreground" style={isSelected ? { color: accentColor } : undefined}>
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
                      <Text className="text-xs text-faint-foreground mb-1.5">Value</Text>
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
                            className="flex-1 mr-2 rounded-lg border border-border px-3 py-2.5 text-sm text-foreground"
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
                            className="flex-1 rounded-lg border border-border px-3 py-2.5 text-sm text-foreground"
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
                              className="flex-row items-center justify-between py-2.5 px-3 rounded-lg border border-border"
                            >
                              <Text className="text-sm flex-1 text-foreground" style={selectedLabel ? undefined : { color: colors.tabIconDefault }}>
                                {selectedLabel ?? placeholder}
                              </Text>
                              <Ionicons name={condValueExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                            </Pressable>
                            {condValueExpanded && (
                              <View className="mt-1 rounded-lg border border-border overflow-hidden bg-background">
                                {condition.field === "account_id"
                                  ? accounts.map((a) => {
                                      const isSel = condition.value === a.id;
                                      return (
                                        <Pressable
                                          key={a.id}
                                          onPress={() => { updateCondition(index, { value: a.id }); setExpandedCondValueRow(null); }}
                                          className="flex-row items-center justify-between px-3 py-2.5 border-b border-border"
                                          style={{ backgroundColor: isSel ? accentColor + "18" : undefined }}
                                        >
                                          <View className="flex-1">
                                            <Text className="text-sm text-foreground" style={isSel ? { color: accentColor } : undefined}>
                                              {a.account_label || a.bank_name}
                                            </Text>
                                            <Text className="text-xs text-faint-foreground mt-0.5">
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
                                          className="flex-row items-center justify-between px-3 py-2.5 border-b border-border"
                                          style={{ backgroundColor: isSel ? accentColor + "18" : undefined }}
                                        >
                                          <Text className="text-sm text-foreground" style={isSel ? { color: accentColor } : undefined}>{m.name}</Text>
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
                                          className="flex-row items-center justify-between px-3 py-2.5 border-b border-border"
                                          style={{ backgroundColor: isSel ? accentColor + "18" : undefined }}
                                        >
                                          <Text className="text-sm text-foreground" style={isSel ? { color: accentColor } : undefined}>{c.name}</Text>
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
                          className="rounded-lg border border-border px-3 py-2.5 text-sm text-foreground"
                        />
                      )}
                    </View>
                  )}
                </View>
              );
            })}

            <Pressable
              onPress={addCondition}
              className="flex-row items-center justify-center py-2.5 rounded-lg border border-dashed border-border"
            >
              <Ionicons name="add" size={16} color={accentColor} />
              <Text className="text-sm font-medium ml-1.5" style={{ color: accentColor }}>
                Add condition
              </Text>
            </Pressable>
          </Card>

          <Card className="mb-4">
            <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground mb-3">
              Then (actions)
            </Text>

            {actions.map((action, index) => {
              const typeExpanded = expandedActionTypeRow === index;
              const valueExpanded = expandedActionValueRow === index;

              return (
                <View
                  key={index}
                  className="mb-3 p-3 rounded-xl border border-border bg-background"
                >
                  {/* Header */}
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-xs font-semibold tracking-wider uppercase text-faint-foreground">
                      Action {index + 1}
                    </Text>
                    <Pressable
                      onPress={() => removeAction(index)}
                      hitSlop={8}
                      className="w-6 h-6 rounded-full items-center justify-center bg-card"
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
                      <Text className="text-xs text-faint-foreground">Action type</Text>
                      <Text className="text-base text-foreground">
                        {ACTION_TYPE_LABELS[action.type]}
                      </Text>
                    </View>
                    <Ionicons name={typeExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                  </Pressable>

                  {typeExpanded && (
                    <View className="mb-2 rounded-lg border border-border overflow-hidden bg-background">
                      {ACTION_TYPE_OPTIONS.map((opt) => {
                        const isSelected = action.type === opt.type;
                        return (
                          <Pressable
                            key={opt.type}
                            onPress={() => setActionType(index, opt.type)}
                            className="flex-row items-center justify-between px-3 py-2.5 border-b border-border"
                            style={{ backgroundColor: isSelected ? accentColor + "18" : undefined }}
                          >
                            <Text className="text-sm text-foreground" style={isSelected ? { color: accentColor } : undefined}>
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
                            <Text className="text-xs text-faint-foreground">Category</Text>
                            <Text className="text-base text-foreground" style={selectedCat ? undefined : { color: colors.tabIconDefault }}>
                              {selectedCat?.name ?? "Select category"}
                            </Text>
                          </View>
                          <Ionicons name={valueExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                        </Pressable>
                        {valueExpanded && (
                          <View className="mb-2 rounded-lg border border-border overflow-hidden bg-background">
                            {categories.map((c) => {
                              const isSel = a.category_id === c.id;
                              return (
                                <Pressable
                                  key={c.id}
                                  onPress={() => { updateAction(index, { category_id: c.id }); setExpandedActionValueRow(null); }}
                                  className="flex-row items-center justify-between px-3 py-2.5 border-b border-border"
                                  style={{ backgroundColor: isSel ? accentColor + "18" : undefined }}
                                >
                                  <Text className="text-sm text-foreground" style={isSel ? { color: accentColor } : undefined}>{c.name}</Text>
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
                            <Text className="text-xs text-faint-foreground">Payment mode</Text>
                            <Text className="text-base text-foreground" style={selectedMode ? undefined : { color: colors.tabIconDefault }}>
                              {selectedMode?.name ?? "Select payment mode"}
                            </Text>
                          </View>
                          <Ionicons name={valueExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                        </Pressable>
                        {valueExpanded && (
                          <View className="mb-2 rounded-lg border border-border overflow-hidden bg-background">
                            {paymentModes.map((m) => {
                              const isSel = a.payment_mode === m.id;
                              return (
                                <Pressable
                                  key={m.id}
                                  onPress={() => { updateAction(index, { payment_mode: m.id }); setExpandedActionValueRow(null); }}
                                  className="flex-row items-center justify-between px-3 py-2.5 border-b border-border"
                                  style={{ backgroundColor: isSel ? accentColor + "18" : undefined }}
                                >
                                  <Text className="text-sm text-foreground" style={isSel ? { color: accentColor } : undefined}>{m.name}</Text>
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
                      <Text className="text-xs text-faint-foreground mb-1.5">Description text</Text>
                      <TextInput
                        placeholder="e.g. Monthly subscription"
                        placeholderTextColor={colors.tabIconDefault}
                        value={(action as RuleAction & { type: "set_description" }).description_template ?? ""}
                        onChangeText={(v) => updateAction(index, { description_template: v })}
                        className="rounded-lg border border-border px-3 py-2 text-sm text-foreground"
                      />
                    </View>
                  )}

                  {action.type === "tags" && (
                    <View className="mt-1">
                      <Text className="text-xs text-faint-foreground mb-1.5">Select tags</Text>
                      {tags.length === 0 ? (
                        <Text className="text-xs text-faint-foreground">No tags created yet</Text>
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
                                <Text className={selected ? "text-primary-foreground text-xs font-medium" : "text-muted-foreground text-xs"}>
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
                            <Text className="text-xs text-faint-foreground">Classification</Text>
                            <Text className="text-base text-foreground" style={selectedLabel ? undefined : { color: colors.tabIconDefault }}>
                              {selectedLabel ?? "Select classification"}
                            </Text>
                          </View>
                          <Ionicons name={valueExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                        </Pressable>
                        {valueExpanded && (
                          <View className="mb-2 rounded-lg border border-border overflow-hidden bg-background">
                            {opts.map((opt) => {
                              const isSel = a.is_right_spend === opt.value;
                              return (
                                <Pressable
                                  key={String(opt.value)}
                                  onPress={() => { updateAction(index, { is_right_spend: opt.value }); setExpandedActionValueRow(null); }}
                                  className="flex-row items-center justify-between px-3 py-2.5 border-b border-border"
                                  style={{ backgroundColor: isSel ? accentColor + "18" : undefined }}
                                >
                                  <Text className="text-sm text-foreground" style={isSel ? { color: accentColor } : undefined}>{opt.label}</Text>
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
                      <Text className="text-xs text-faint-foreground">SMS-detected expenses skip the pending review queue</Text>
                    </View>
                  )}

                  {action.type === "split_with_person" && (() => {
                    const a = action as RuleAction & { type: "split_with_person" };
                    const selectedPerson = persons.find((p) => p.id === a.person_id);
                    const splitMode = a.split_mode ?? "equal";
                    const paidBy = a.paid_by ?? "me";
                    return (
                      <>
                        <Pressable
                          onPress={() => { setExpandedActionTypeRow(null); setExpandedActionValueRow(valueExpanded ? null : index); }}
                          className="flex-row items-center justify-between py-2"
                        >
                          <View>
                            <Text className="text-xs text-faint-foreground">Split with</Text>
                            <Text className="text-base text-foreground" style={selectedPerson ? undefined : { color: colors.tabIconDefault }}>
                              {selectedPerson?.name ?? "Select person"}
                            </Text>
                          </View>
                          <Ionicons name={valueExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                        </Pressable>
                        {valueExpanded && (
                          <View className="mb-2 rounded-lg border border-border overflow-hidden bg-background">
                            {persons.length === 0 ? (
                              <Text className="text-sm text-faint-foreground px-3 py-2.5">No people in Hisaab yet</Text>
                            ) : persons.map((p) => {
                              const isSel = a.person_id === p.id;
                              return (
                                <Pressable
                                  key={p.id}
                                  onPress={() => { updateAction(index, { person_id: p.id }); setExpandedActionValueRow(null); }}
                                  className="flex-row items-center justify-between px-3 py-2.5 border-b border-border"
                                  style={{ backgroundColor: isSel ? accentColor + "18" : undefined }}
                                >
                                  <Text className="text-sm text-foreground" style={isSel ? { color: accentColor } : undefined}>{p.name}</Text>
                                  {isSel && <Ionicons name="checkmark" size={16} color={accentColor} />}
                                </Pressable>
                              );
                            })}
                          </View>
                        )}
                        {selectedPerson && (
                          <View className="mt-1 pb-1">
                            <Text className="text-xs text-faint-foreground mb-1.5">How to split</Text>
                            <View className="flex-row flex-wrap gap-2 mb-2">
                              {([
                                { mode: "equal", label: "Equal" },
                                { mode: "they_owe_full", label: "They owe full" },
                                { mode: "i_owe_full", label: "I owe full" },
                                { mode: "percentage", label: "By %" },
                                { mode: "exact", label: "By amount" },
                              ] as const).map((opt) => {
                                const isSel = splitMode === opt.mode;
                                return (
                                  <Pressable
                                    key={opt.mode}
                                    onPress={() => updateAction(index, { split_mode: opt.mode })}
                                    className="px-3 py-1.5 rounded-lg items-center border border-border"
                                    style={isSel ? { backgroundColor: accentColor + "20", borderColor: accentColor } : undefined}
                                  >
                                    <Text className="text-xs font-semibold" style={{ color: isSel ? accentColor : colors.textSecondary }}>{opt.label}</Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                            {splitMode === "percentage" && (
                              <View className="mb-2">
                                <TextInput
                                  value={String(a.split_percentage ?? "")}
                                  onChangeText={(v) => {
                                    const n = parseFloat(v);
                                    updateAction(index, { split_percentage: isNaN(n) ? undefined : Math.min(100, Math.max(0, n)) });
                                  }}
                                  keyboardType="numeric"
                                  placeholder="Their share % (e.g. 50)"
                                  placeholderTextColor={colors.tabIconDefault}
                                  className="px-3 py-2 rounded-lg border border-border text-sm text-foreground"
                                />
                              </View>
                            )}
                            {splitMode === "exact" && (
                              <View className="mb-2">
                                <TextInput
                                  value={String(a.split_exact_amount ?? "")}
                                  onChangeText={(v) => {
                                    const n = parseFloat(v);
                                    updateAction(index, { split_exact_amount: isNaN(n) ? undefined : n });
                                  }}
                                  keyboardType="numeric"
                                  placeholder="Their share amount (₹)"
                                  placeholderTextColor={colors.tabIconDefault}
                                  className="px-3 py-2 rounded-lg border border-border text-sm text-foreground"
                                />
                              </View>
                            )}
                            <Text className="text-xs text-faint-foreground mb-1.5">Who paid</Text>
                            <View className="flex-row gap-2">
                              {([ { value: "me", label: "I paid" }, { value: "them", label: "They paid" } ] as const).map((opt) => {
                                const isSel = paidBy === opt.value;
                                return (
                                  <Pressable
                                    key={opt.value}
                                    onPress={() => updateAction(index, { paid_by: opt.value })}
                                    className="flex-1 py-1.5 rounded-lg items-center border border-border"
                                    style={isSel ? { backgroundColor: accentColor + "20", borderColor: accentColor } : undefined}
                                  >
                                    <Text className="text-xs font-semibold" style={{ color: isSel ? accentColor : colors.textSecondary }}>{opt.label}</Text>
                                  </Pressable>
                                );
                              })}
                            </View>
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
                            <Text className="text-xs text-faint-foreground">Investment bucket</Text>
                            <Text className="text-base text-foreground" style={selectedBucket ? undefined : { color: colors.tabIconDefault }}>
                              {selectedBucket?.name ?? "Select bucket"}
                            </Text>
                          </View>
                          <Ionicons name={valueExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
                        </Pressable>
                        {valueExpanded && (
                          <View className="mb-2 rounded-lg border border-border overflow-hidden bg-background">
                            {buckets.length === 0 ? (
                              <Text className="text-sm text-faint-foreground px-3 py-2.5">No investment buckets created yet</Text>
                            ) : buckets.map((b) => {
                              const isSel = a.bucket_id === b.id;
                              return (
                                <Pressable
                                  key={b.id}
                                  onPress={() => { updateAction(index, { bucket_id: b.id }); setExpandedActionValueRow(null); }}
                                  className="flex-row items-center justify-between px-3 py-2.5 border-b border-border"
                                  style={{ backgroundColor: isSel ? accentColor + "18" : undefined }}
                                >
                                  <Text className="text-sm text-foreground" style={isSel ? { color: accentColor } : undefined}>{b.name}</Text>
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
              <Text className="text-sm text-faint-foreground text-center py-2 mb-3">No actions yet - add one below</Text>
            )}

            <Pressable
              onPress={addAction}
              className="flex-row items-center justify-center py-2.5 rounded-lg border border-dashed border-border"
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
                  <Text className="text-base font-semibold text-foreground">
                    Apply to past expenses
                  </Text>
                  <Text className="text-xs text-faint-foreground mt-0.5">
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
      <Sheet visible={showRetroSheet} onClose={() => setShowRetroSheet(false)}>
        <View className="px-4 pb-6">
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-lg font-semibold text-foreground">
              Apply to past expenses
            </Text>
            <Pressable onPress={() => setShowRetroSheet(false)}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>

          {/* Quick presets */}
          <Text className="text-xs font-semibold uppercase tracking-wider text-faint-foreground mb-2">
            Date range
          </Text>
          <View className="flex-row flex-wrap mb-3" style={{ gap: 6 }}>
            {[
              { label: "7 days", days: 7 },
              { label: "30 days", days: 30 },
              { label: "90 days", days: 90 },
              { label: "6 months", days: 180 },
              { label: "1 year", days: 365 },
            ].map(({ label, days }) => {
              const active = retroPreset === days;
              return (
                <Pressable
                  key={days}
                  onPress={() => {
                    setRetroPreset(days);
                    setRetroStart(daysAgoIso(days));
                    setRetroEnd(todayIso());
                    setRetroPreview(null);
                  }}
                  className="px-3 py-1.5 rounded-full border"
                  style={{
                    borderColor: active ? accentColor : colors.border,
                    backgroundColor: active ? accentColor + "18" : "transparent",
                  }}
                >
                  <Text className="text-xs font-medium" style={{ color: active ? accentColor : colors.textSecondary }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Date pickers */}
          <View className="flex-row mb-4" style={{ gap: 8 }}>
            <DateInput
              label="From"
              value={retroStart}
              onChange={(v) => { setRetroStart(v); setRetroPreset(null); setRetroPreview(null); }}
              maximumDate={null}
              containerClassName="flex-1"
            />
            <DateInput
              label="To"
              value={retroEnd}
              onChange={(v) => { setRetroEnd(v); setRetroPreset(null); setRetroPreview(null); }}
              maximumDate={null}
              containerClassName="flex-1"
            />
          </View>

          {/* Account filter */}
          {accounts.length > 0 && (
            <>
              <Text className="text-xs font-semibold uppercase tracking-wider text-faint-foreground mb-2">
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
                      className={`flex-row items-center justify-between py-2.5 px-3 rounded-lg mb-1.5 border ${isSel ? "" : "border-border"}`}
                      style={isSel ? { borderColor: accentColor, backgroundColor: accentColor + "18" } : undefined}
                    >
                      <View className="flex-1">
                        <Text className="text-sm font-medium text-foreground" style={isSel ? { color: accentColor } : undefined}>
                          {a.account_label || a.bank_name}
                        </Text>
                        <Text className="text-xs text-faint-foreground mt-0.5">
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
          <View className="flex-row items-center justify-between py-3 border-t border-border mb-4">
            <View className="flex-1 mr-4">
              <Text className="text-sm text-foreground">Override existing values</Text>
              <Text className="text-xs text-faint-foreground mt-0.5">If off, expenses that already have a category are skipped</Text>
            </View>
            <Switch
              value={retroOverwrite}
              onValueChange={(v) => { setRetroOverwrite(v); setRetroPreview(null); }}
              trackColor={{ false: colors.border, true: accentColor }}
            />
          </View>

          {/* Preview result */}
          {retroPreview ? (
            <View className="rounded-lg px-4 py-3 mb-4" style={{ backgroundColor: accentColor + "14" }}>
              <Text className="text-sm font-semibold mb-1" style={{ color: accentColor }}>
                Preview result
              </Text>
              <Text className="text-sm text-foreground">
                {retroPreview.matching} matching expense{retroPreview.matching === 1 ? "" : "s"}
              </Text>
              <Text className="text-xs text-faint-foreground mt-0.5">
                {retroPreview.wouldOverwrite} will be updated · {retroPreview.wouldSkip} skipped (already processed){retroPreview.wouldSkip > 0 && retroPreview.wouldOverwrite === 0 ? " — enable Overwrite to re-apply" : ""}
              </Text>
            </View>
          ) : (
            <Text className="text-xs text-faint-foreground text-center mb-4">
              Run Preview first to see how many expenses will be updated, then Apply.
            </Text>
          )}

          {/* Actions */}
          {!retroPreview ? (
            <Pressable
              onPress={onRetroPreview}
              disabled={retroPreviewing}
              className="py-3 rounded-xl items-center border border-border"
            >
              {retroPreviewing
                ? <ActivityIndicator size="small" color={accentColor} />
                : <Text className="text-sm font-semibold text-foreground">Preview</Text>
              }
            </Pressable>
          ) : (
            <View className="flex-row" style={{ gap: 8 }}>
              <Pressable
                onPress={() => { setRetroPreview(null); }}
                className="flex-1 py-3 rounded-xl items-center border border-border"
              >
                <Text className="text-sm font-semibold text-muted-foreground">Re-Preview</Text>
              </Pressable>
              <Pressable
                onPress={onRetroApply}
                disabled={retroPreview.wouldOverwrite === 0 || retroApplying}
                className="flex-1 py-3 rounded-xl items-center"
                style={{ backgroundColor: retroPreview.wouldOverwrite === 0 ? colors.border : accentColor }}
              >
                {retroApplying
                  ? <ActivityIndicator size="small" color={theme.primaryForeground} />
                  : <Text className="text-sm font-semibold text-primary-foreground">Apply ({retroPreview.wouldOverwrite})</Text>
                }
              </Pressable>
            </View>
          )}
        </View>
      </Sheet>
    </ScreenContainer>
  );
}
