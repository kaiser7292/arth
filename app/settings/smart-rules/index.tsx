import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, FAB } from "@/components/ui";
import { Card } from "@/components/ui/Card";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import {
  listRules, deleteRule, listDeletedRules, restoreRule, restoreAllRules, purgeDeletedRules,
  FIELD_LABELS, OPERATOR_LABELS, type SmartRule,
} from "@/services/smart-rules";
import { StatusColors } from "@/constants/theme";
import { getErrorMessage } from "@/utils/error-message";

export default function SmartRulesListScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors, colorScheme, accent } = useColorScheme();
  const accentColor = colorScheme === "dark" ? accent[400] : accent[500];

  const [rules, setRules] = useState<SmartRule[]>([]);
  const [deletedRules, setDeletedRules] = useState<SmartRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);

  const load = useCallback(async () => {
    try {
      const [active, deleted] = await Promise.all([listRules(), listDeletedRules()]);
      setRules(active);
      setDeletedRules(deleted);
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

  const summarizeConditions = (r: SmartRule): string => {
    if (r.conditions.length === 0) return "No conditions";
    const joiner = r.match_mode === "any" ? " OR " : " AND ";
    return r.conditions
      .map((c) => {
        const value = Array.isArray(c.value) ? `${c.value[0]}–${c.value[1]}` : c.value ?? "";
        const valueText = c.operator === "is_empty" || c.operator === "is_not_empty" ? "" : ` "${value}"`;
        return `${FIELD_LABELS[c.field]} ${OPERATOR_LABELS[c.operator]}${valueText}`;
      })
      .join(joiner);
  };

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

  return (
    <ScreenContainer padTop={false}>
      <View className="flex-1">
        <View className="px-4 pt-3 pb-2 flex-row items-center justify-between">
          <Text className="text-xs text-text-tertiary">
            Rules auto-apply when new expenses are added (manually or from SMS). First matching rule wins.
          </Text>
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={accentColor} />
          </View>
        ) : rules.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <Ionicons name="sparkles-outline" size={48} color={colors.textSecondary} />
            <Text className="text-lg font-medium text-text-primary dark:text-text-dark-primary mt-4">
              No rules yet
            </Text>
            <Text className="text-sm text-text-tertiary text-center mt-2">
              Create a rule to auto-categorize expenses by merchant, amount, or account.
            </Text>
          </View>
        ) : (
          <FlatList
            data={rules}
            keyExtractor={(r) => r.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96 }}
            renderItem={({ item }) => (
              <Card className="mb-3">
                <Pressable onPress={() => router.push(`/settings/smart-rules/${item.id}` as never)}>
                  <View className="flex-row items-center mb-2">
                    <View className="flex-1">
                      <Text className={`text-base font-semibold ${item.is_active ? "text-text-primary dark:text-text-dark-primary" : "text-text-tertiary"}`}>
                        {item.name}
                      </Text>
                      <Text className="text-xs text-text-tertiary mt-0.5">
                        Priority {item.priority} · Applied {item.apply_count} time{item.apply_count === 1 ? "" : "s"}
                      </Text>
                    </View>
                    {!item.is_active && (
                      <View className="px-2 py-0.5 bg-surface-light-alt dark:bg-surface-dark-alt rounded">
                        <Text className="text-xs text-text-tertiary">Paused</Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mb-1">
                    WHEN: {summarizeConditions(item)}
                  </Text>
                  <Text className="text-sm text-text-secondary dark:text-text-dark-secondary">
                    THEN: {summarizeActions(item)}
                  </Text>
                </Pressable>
                <View className="flex-row justify-end mt-3 pt-3 border-t border-border-light dark:border-border-dark">
                  <Pressable onPress={() => confirmDelete(item)} hitSlop={8}>
                    <Text className="text-sm" style={{ color: StatusColors[colorScheme].danger }}>
                      Delete
                    </Text>
                  </Pressable>
                </View>
              </Card>
            )}
            ListFooterComponent={
              deletedRules.length > 0 ? (
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
                        <Pressable onPress={confirmPurge} className="flex-1 py-2 rounded-lg items-center" style={{ backgroundColor: StatusColors[colorScheme].danger + "14" }}>
                          <Text className="text-xs font-semibold" style={{ color: StatusColors[colorScheme].danger }}>Delete Forever</Text>
                        </Pressable>
                      </View>
                      {deletedRules.map((item) => (
                        <View key={item.id} className="mb-2" style={{ opacity: 0.6 }}><Card>
                          <View className="flex-row items-center justify-between">
                            <Text className="text-sm font-medium text-text-tertiary flex-1" numberOfLines={1}>{item.name}</Text>
                            <Pressable onPress={() => handleRestore(item)} hitSlop={8} className="ml-3">
                              <Text className="text-xs font-semibold" style={{ color: colors.tint }}>Restore</Text>
                            </Pressable>
                          </View>
                          <Text className="text-xs text-text-tertiary mt-0.5" numberOfLines={1}>
                            {summarizeConditions(item)}
                          </Text>
                        </Card></View>
                      ))}
                    </>
                  )}
                </View>
              ) : null
            }
          />
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
