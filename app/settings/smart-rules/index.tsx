import { useCallback, useEffect, useState } from "react";
import { View, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { FAB, LoadingState, ScreenContainer, Text } from "@/components/ui";
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
        router.push(`/settings/smart-rules/${newId}` as never);
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
        text: "Restore All",
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
        text: "Delete Forever",
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
        case "set_description":
          parts.push("set description");
          break;
        case "mark_auto":
          parts.push("auto-approve from review");
          break;
        case "split_with_person":
          parts.push("auto split");
          break;
      }
    }
    if (r.action_link_to_investment_bucket_id) parts.push("link bucket");
    return parts.length > 0 ? parts.join(" · ") : "No actions";
  };

  const deletedSection = deletedRules.length > 0 ? (
    <View className="mt-4">
      <Pressable
        onPress={() => setShowDeleted((v) => !v)}
        className="flex-row items-center justify-between py-2 mb-2"
      >
        <Text className="text-xs font-semibold uppercase" style={{ color: colors.textSecondary, letterSpacing: 0.5 }}>
          Deleted ({deletedRules.length})
        </Text>
        <Ionicons name={showDeleted ? "chevron-up" : "chevron-down"} size={14} color={colors.textSecondary} />
      </Pressable>
      {showDeleted && (
        <>
          <View className="flex-row gap-2 mb-3">
            <Pressable onPress={confirmRestoreAll} className="flex-1 py-2 rounded-lg items-center" style={{ backgroundColor: colors.tint + "20" }}>
              <Text className="text-xs font-semibold" style={{ color: colors.tint }}>Restore All</Text>
            </Pressable>
            <Pressable onPress={confirmPurge} className="flex-1 py-2 rounded-lg items-center" style={{ backgroundColor: theme.danger + "14" }}>
              <Text className="text-xs font-semibold" style={{ color: theme.danger }}>Delete Forever</Text>
            </Pressable>
          </View>
          {deletedRules.map((item) => (
            <View key={item.id} className="mb-2" style={{ opacity: 0.6 }}>
              <Card>
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-medium text-faint-foreground flex-1" numberOfLines={1}>{item.name}</Text>
                  <Pressable onPress={() => handleRestore(item)} hitSlop={8} className="ml-3">
                    <Text className="text-xs font-semibold" style={{ color: colors.tint }}>Restore</Text>
                  </Pressable>
                </View>
                <Text className="text-xs text-faint-foreground mt-0.5" numberOfLines={1}>
                  {summarizeConditions(item)}
                </Text>
              </Card>
            </View>
          ))}
        </>
      )}
    </View>
  ) : null;

  return (
    <ScreenContainer padTop={false}>
      <View className="flex-1">
        <View className="px-4 pt-3 pb-2">
          <Text className="text-xs text-faint-foreground">
            Rules auto-apply when new expenses are added (manually or from SMS). First matching rule wins.
          </Text>
        </View>

        {loading ? (
          <LoadingState />
        ) : rules.length === 0 ? (
          <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 96 }}>
            <View className="flex-1 items-center justify-center py-16 px-8">
              <Ionicons name="sparkles-outline" size={48} color={colors.textSecondary} />
              <Text className="text-lg font-medium text-foreground mt-4">
                No rules yet
              </Text>
              <Text className="text-sm text-faint-foreground text-center mt-2">
                Create a rule to auto-categorize expenses by merchant, amount, or account.
              </Text>
            </View>
            {deletedSection}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96 }}>
            {rules.map((item) => (
              <Card key={item.id} className="mb-3">
                <Pressable onPress={() => router.push(`/settings/smart-rules/${item.id}` as never)}>
                  <View className="flex-row items-center mb-2">
                    <View className="flex-1">
                      <Text className={`text-base font-semibold ${item.is_active ? "text-foreground" : "text-faint-foreground"}`}>
                        {item.name}
                      </Text>
                      <Text className="text-xs text-faint-foreground mt-0.5">
                        Priority {item.priority}
                        {item.applies_to === "credit" && <Text> · Credits</Text>}
                        {item.applies_to === "any" && <Text> · All transactions</Text>}
                        {!item.is_active && <Text> · Paused</Text>}
                      </Text>
                    </View>
                  </View>
                  <Text className="text-sm text-muted-foreground mb-1">
                    WHEN: {summarizeConditions(item)}
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    THEN: {summarizeActions(item)}
                  </Text>
                </Pressable>
                <View className="flex-row mt-3 pt-3 border-t border-border" style={{ gap: 0 }}>
                  <Pressable
                    onPress={() => router.push(`/settings/smart-rules/${item.id}` as never)}
                    hitSlop={4}
                    className="flex-1 items-center py-1"
                  >
                    <Ionicons name="create-outline" size={16} color={accentColor} />
                    <Text className="text-xs mt-0.5" style={{ color: accentColor }}>Edit</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => router.push(`/settings/smart-rules/applications/${item.id}` as never)}
                    hitSlop={4}
                    className="flex-1 items-center py-1"
                  >
                    <Ionicons name="checkmark-circle-outline" size={16} color={item.apply_count > 0 ? accentColor : colors.textSecondary} />
                    <Text className="text-xs mt-0.5" style={{ color: item.apply_count > 0 ? accentColor : colors.textSecondary }}>
                      Applied {item.apply_count}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleDuplicate(item)}
                    hitSlop={4}
                    className="flex-1 items-center py-1"
                  >
                    <Ionicons name="copy-outline" size={16} color={colors.textSecondary} />
                    <Text className="text-xs mt-0.5 text-faint-foreground">Duplicate</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmDelete(item)}
                    hitSlop={4}
                    className="flex-1 items-center py-1"
                  >
                    <Ionicons name="trash-outline" size={16} color={theme.danger} />
                    <Text className="text-xs mt-0.5" style={{ color: theme.danger }}>Delete</Text>
                  </Pressable>
                </View>
              </Card>
            ))}
            {deletedSection}
          </ScrollView>
        )}

        <FAB
          icon="add"
          onPress={() => router.push("/settings/smart-rules/new" as never)}
          accessibilityLabel="Create new smart rule"
        />
      </View>
    </ScreenContainer>
  );
}
