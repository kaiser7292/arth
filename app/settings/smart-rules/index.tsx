import { useCallback, useEffect, useState } from "react";
import { View, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { FAB, GroupHeading, ListToolbar, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { useListTools } from "@/hooks/use-list-tools";
import type { ListField, ListSort } from "@/utils/list-tools";
import { Card } from "@/components/ui/Card";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import {
  listRules, deleteRule, duplicateRule, listDeletedRules, restoreRule, restoreAllRules, purgeDeletedRules,
  FIELD_LABELS, OPERATOR_LABELS, type SmartRule,
} from "@/services/smart-rules";
import { getCategories, type Category } from "@/services/category";
import { getPaymentModes, type PaymentMode } from "@/services/payment-mode";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { DEFAULT_USER_ID } from "@/constants/app";

import { getErrorMessage } from "@/utils/error-message";
import { useTheme } from "@/hooks/use-theme";
import { creditLook } from "@/services/expense-types";
import { tint } from "@/constants/brand";

const APPLIES_LABELS: Record<string, string> = { expense: "Expenses", credit: "Credits", any: "All transactions" };
const RULE_FIELDS: ListField<SmartRule>[] = [
  { id: "applies", label: "Applies to", keyOf: (r) => r.applies_to, labelOf: (k) => APPLIES_LABELS[k] ?? k, filter: true, group: true },
  { id: "status", label: "Status", keyOf: (r) => (r.is_active ? "Active" : "Paused"), filter: true, group: true },
];
const RULE_SORTS: ListSort<SmartRule>[] = [
  { id: "priority", label: "Priority (the order they run)" },
  { id: "name", label: "Name (A–Z)", compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "applied", label: "Most applied", compare: (a, b) => b.apply_count - a.apply_count },
];

export default function SmartRulesListScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const accentColor = theme.primary;

  const [rules, setRules] = useState<SmartRule[]>([]);
  const [deletedRules, setDeletedRules] = useState<SmartRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);
  const [categoryMap, setCategoryMap] = useState<Map<string, Category>>(new Map());
  const [paymentModeMap, setPaymentModeMap] = useState<Map<string, PaymentMode>>(new Map());
  const [accountMap, setAccountMap] = useState<Map<string, FinancialAccount>>(new Map());

  const load = useCallback(async () => {
    try {
      const [active, deleted, cats, pms, accts] = await Promise.all([
        listRules(), listDeletedRules(),
        getCategories(DEFAULT_USER_ID),
        getPaymentModes(DEFAULT_USER_ID),
        getActiveAccounts(DEFAULT_USER_ID),
      ]);
      setRules(active);
      setDeletedRules(deleted);
      setCategoryMap(new Map(cats.map((c) => [c.id, c])));
      setPaymentModeMap(new Map(pms.map((p) => [p.id, p])));
      setAccountMap(new Map(accts.map((a) => [a.id, a])));
    } catch (e) {
      alert("Couldn't load rules", getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [alert]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

  const handleDuplicate = useCallback(
    async (rule: SmartRule) => {
      try {
        const newId = await duplicateRule(rule.id);
        router.push(`/settings/smart-rules/${newId}`);
      } catch (e) {
        alert("Couldn't duplicate", getErrorMessage(e));
      }
    },
    [router, alert],
  );

  const confirmDelete = useCallback(
    (rule: SmartRule) => {
      alert("Delete rule?", `"${rule.name}" will be soft-deleted and can be restored from the deleted section.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteRule(rule.id);
              await load();
            } catch (e) {
              alert("Couldn't delete", getErrorMessage(e));
            }
          },
        },
      ]);
    },
    [alert, load],
  );

  const handleRestore = useCallback(
    async (rule: SmartRule) => {
      try {
        await restoreRule(rule.id);
        await load();
      } catch (e) {
        alert("Couldn't restore", getErrorMessage(e));
      }
    },
    [alert, load],
  );

  const confirmRestoreAll = useCallback(() => {
    alert("Restore all deleted rules?", `${deletedRules.length} deleted rule${deletedRules.length === 1 ? "" : "s"} will be restored.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Restore all",
        onPress: async () => {
          try {
            await restoreAllRules();
            await load();
          } catch (e) {
            alert("Couldn't restore", getErrorMessage(e));
          }
        },
      },
    ]);
  }, [alert, deletedRules.length, load]);

  const confirmPurge = useCallback(() => {
    alert("Permanently delete all?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete forever",
        style: "destructive",
        onPress: async () => {
          try {
            await purgeDeletedRules();
            await load();
          } catch (e) {
            alert("Couldn't purge", getErrorMessage(e));
          }
        },
      },
    ]);
  }, [alert, load]);

  const resolveConditionValue = useCallback((field: string, value: unknown): string => {
    if (field === "nth_weekday_of_month" && Array.isArray(value)) {
      const ordinalLabels: Record<string, string> = { "1": "1st", "2": "2nd", "3": "3rd", "4": "4th", "-1": "Last" };
      const weekdayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const [ordinal, weekday] = value;
      return `${ordinalLabels[String(ordinal)] ?? ordinal} ${weekdayLabels[weekday] ?? weekday}`;
    }
    if (Array.isArray(value)) return `${value[0]}–${value[1]}`;
    const raw = String(value ?? "");
    if (field === "account_id") {
      const a = accountMap.get(raw);
      return a ? (a.account_label || a.bank_name) : raw;
    }
    if (field === "payment_mode") {
      return paymentModeMap.get(raw)?.name ?? raw;
    }
    if (field === "category_id") {
      return categoryMap.get(raw)?.name ?? raw;
    }
    return raw;
  }, [accountMap, paymentModeMap, categoryMap]);

  const summarizeConditions = useCallback((r: SmartRule): string => {
    if (r.conditions.length === 0) return "No conditions";
    const joiner = r.match_mode === "any" ? " OR " : " AND ";
    return r.conditions
      .map((c) => {
        const valueText = c.operator === "is_empty" || c.operator === "is_not_empty"
          ? ""
          : ` "${resolveConditionValue(c.field, c.value)}"`;
        return `${FIELD_LABELS[c.field]} ${OPERATOR_LABELS[c.operator]}${valueText}`;
      })
      .join(joiner);
  }, [resolveConditionValue]);

  const summarizeActions = (r: SmartRule): string => {
    const parts: string[] = [];
    for (const action of r.actions) {
      switch (action.type) {
        case "category":
          parts.push("set category");
          break;
        case "payment_mode":
          parts.push("set payment mode");
          break;
        case "tags":
          if (action.tag_ids && action.tag_ids.length > 0) {
            parts.push(`add ${action.tag_ids.length} tag${action.tag_ids.length === 1 ? "" : "s"}`);
          }
          break;
        case "is_right_spend":
          parts.push(action.is_right_spend ? "mark unavoidable" : "mark discretionary");
          break;
        case "credit_kind":
          if (action.credit_kind) parts.push(`type ${creditLook(action.credit_kind).name}`);
          break;
        case "set_description":
          parts.push("set description");
          break;
        case "mark_auto":
          parts.push("auto-approve from review");
          break;
        case "split_with_person":
          parts.push("auto split");
          break;
        case "mark_loan_repayment":
          parts.push("mark loan repayment");
          break;
      }
    }
    if (r.action_link_to_investment_bucket_id) parts.push("link bucket");
    return parts.length > 0 ? parts.join(" · ") : "No actions";
  };

  const tools = useListTools<SmartRule>({
    screen: "smart_rules",
    noun: { one: "rule", many: "rules" },
    rows: rules,
    fields: RULE_FIELDS,
    sorts: RULE_SORTS,
    searchPlaceholder: "Search rules",
    search: (r) => ({ texts: [r.name, summarizeConditions(r), summarizeActions(r)] }),
  });

  // Deleted rules: one card that says how many, with Restore all and Delete forever; tap to list them.
  const deletedSection = deletedRules.length > 0 ? (
    <View className="mt-1 rounded-card bg-card border border-border overflow-hidden">
      <View className="flex-row items-center px-3.5 py-3" style={{ gap: 8 }}>
        <Pressable
          onPress={() => setShowDeleted((v) => !v)}
          className="flex-1"
          accessibilityRole="button"
          accessibilityState={{ expanded: showDeleted }}
        >
          <Text className="text-body font-semibold text-foreground">Deleted · {deletedRules.length}</Text>
          <Text className="text-meta text-muted-foreground">{showDeleted ? "Tap to hide them" : "Tap to see and restore one"}</Text>
        </Pressable>
        <Pressable
                    onPress={confirmRestoreAll}
                    className="rounded-pill items-center justify-center px-3"
                    style={{ height: 32, backgroundColor: theme.alpha("primary", 0.1), borderWidth: 1, borderColor: theme.primary }}
                    accessibilityRole="button"
                  >
                    <Text className="text-meta font-semibold" style={{ color: theme.primary }}>Restore all</Text>
                  </Pressable>
        <Pressable
                    onPress={confirmPurge}
                    className="rounded-pill items-center justify-center px-3"
                    style={{ height: 32, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.alpha("danger", 0.35) }}
                    accessibilityRole="button"
                  >
                    <Text className="text-meta font-semibold" style={{ color: theme.danger }}>Delete forever</Text>
                  </Pressable>
      </View>
      {showDeleted &&
        deletedRules.map((item) => (
          <View key={item.id} className="flex-row items-center px-3.5 py-2.5 border-t border-border" style={{ gap: 10 }}>
            <View className="flex-1" style={{ opacity: 0.7 }}>
              <Text className="text-body font-medium text-foreground" numberOfLines={1}>{item.name}</Text>
              <Text className="text-label text-muted-foreground" numberOfLines={1}>{summarizeConditions(item)}</Text>
            </View>
            <Pressable onPress={() => handleRestore(item)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Restore ${item.name}`}>
              <Text className="text-meta font-semibold" style={{ color: theme.primary }}>Restore</Text>
            </Pressable>
          </View>
        ))}
    </View>
  ) : null;

  return (
    <ScreenContainer padTop={false}>
      <View className="flex-1">
        <View className="px-4 pt-3 pb-2">
          <Text className="text-label text-faint-foreground">
            Sorted by priority · lower numbers are tried first. Rules apply to new transactions, typed or from messages.
          </Text>
        </View>

        {loading ? (
          <LoadingState />
        ) : rules.length === 0 ? (
          <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 96 }}>
            <View className="flex-1 items-center justify-center py-16 px-8">
              <Ionicons name="sparkles-outline" size={48} color={theme.mutedForeground} />
              <Text className="text-heading font-medium text-foreground mt-4">
                No rules yet
              </Text>
              <Text className="text-meta text-faint-foreground text-center mt-2">
                Create a rule to auto-categorize expenses by merchant, amount, or account.
              </Text>
            </View>
            {deletedSection}
          </ScrollView>
        ) : (
          <>
          <ListToolbar {...tools.toolbar} />
          {tools.filterSheet}
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 96 }} keyboardShouldPersistTaps="handled">
            {tools.rows.length === 0 && <Text className="text-meta text-muted-foreground text-center py-8">Nothing matches.</Text>}
            {tools.grouped.map((row) => {
              if (row.type === "heading") return <GroupHeading key={`group-${row.key}`} label={row.label} count={row.count} total={0} inset={false} open={row.open} onToggle={row.onToggle} noun={row.noun} />;
              const item = row.item;
              return (
              <View key={item.id} className="mb-3 rounded-card bg-card border border-border p-3.5" style={{ gap: 10, opacity: item.is_active ? 1 : 0.75 }}>
                <Pressable onPress={() => router.push(`/settings/smart-rules/${item.id}`)} style={{ gap: 8 }} accessibilityRole="button" accessibilityLabel={`${item.name}, priority ${item.priority}, ${item.is_active ? "active" : "paused"}. Edit`}>
                  <View className="flex-row items-center" style={{ gap: 10 }}>
                    <View className="w-7 h-7 rounded-control items-center justify-center" style={{ backgroundColor: theme.alpha("primary", 0.1) }}>
                      <Text className="text-meta font-bold" style={{ color: theme.primary }}>{item.priority}</Text>
                    </View>
                    <Text className="flex-1 text-body font-bold text-foreground" numberOfLines={1}>{item.name}</Text>
                    <View className="rounded-pill px-2 justify-center" style={{ height: 22, backgroundColor: item.is_active ? theme.alpha("success", 0.1) : theme.alpha("foreground", 0.07) }}>
                      <Text className="text-label font-semibold" style={{ color: item.is_active ? theme.success : theme.mutedForeground }}>
                        {item.is_active ? "Active" : "Paused"}
                      </Text>
                    </View>
                  </View>
                  <Text className="text-meta text-foreground" style={{ lineHeight: 20 }}>
                    <Text className="text-meta font-semibold text-muted-foreground">When </Text>
                    {summarizeConditions(item)}
                    {item.applies_to === "credit" ? " (credits)" : item.applies_to === "any" ? " (all transactions)" : ""}
                    {"\n"}
                    <Text className="text-meta font-semibold text-muted-foreground">Then </Text>
                    {summarizeActions(item)}
                  </Text>
                </Pressable>
                <View className="flex-row items-center pt-2.5 border-t border-border" style={{ gap: 8 }}>
                  <Pressable
                    onPress={() => router.push(`/settings/smart-rules/applications/${item.id}`)}
                    hitSlop={6}
                    className="flex-1"
                    accessibilityRole="button"
                    accessibilityLabel={`Used ${item.apply_count} times. See where`}
                  >
                    <Text className="text-meta font-semibold" style={{ color: item.apply_count > 0 ? accentColor : theme.mutedForeground }}>
                      Used {item.apply_count}×
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleDuplicate(item)}
                    className="rounded-pill items-center justify-center px-3"
                    style={{ height: 32, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }}
                    accessibilityRole="button"
                  >
                    <Text className="text-meta font-semibold" style={{ color: theme.foreground }}>Duplicate</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmDelete(item)}
                    className="rounded-pill items-center justify-center px-3"
                    style={{ height: 32, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.alpha("danger", 0.35) }}
                    accessibilityRole="button"
                  >
                    <Text className="text-meta font-semibold" style={{ color: theme.danger }}>Delete</Text>
                  </Pressable>
                </View>
              </View>
              );
            })}
            {deletedSection}
          </ScrollView>
          </>
        )}

        <FAB
          icon="add"
          label="Rule"
          onPress={() => router.push("/settings/smart-rules/new")}
          accessibilityLabel="Create new smart rule"
        />
      </View>
    </ScreenContainer>
  );
}
