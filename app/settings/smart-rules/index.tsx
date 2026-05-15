import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, FAB } from "@/components/ui";
import { Card } from "@/components/ui/Card";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAlert } from "@/hooks/use-alert";
import { listRules, deleteRule, type SmartRule } from "@/services/smart-rules";
import { StatusColors } from "@/constants/theme";
import { getErrorMessage } from "@/utils/error-message";

export default function SmartRulesListScreen() {
  const router = useRouter();
  const alert = useAlert();
  const { colors, colorScheme, accent } = useColorScheme();
  const accentColor = colorScheme === "dark" ? accent[400] : accent[500];

  const [rules, setRules] = useState<SmartRule[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const rows = await listRules();
      setRules(rows);
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
      alert("Delete rule?", `This will remove "${rule.name}" but won't undo past categorizations.`, [
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

  const summarizeConditions = (r: SmartRule): string => {
    const parts: string[] = [];
    if (r.match_merchant_contains) parts.push(`merchant contains "${r.match_merchant_contains}"`);
    if (r.match_merchant_regex) parts.push(`merchant matches regex`);
    if (r.match_min_amount !== null && r.match_max_amount !== null) {
      parts.push(`amount ${r.match_min_amount}–${r.match_max_amount}`);
    } else if (r.match_min_amount !== null) {
      parts.push(`amount ≥ ${r.match_min_amount}`);
    } else if (r.match_max_amount !== null) {
      parts.push(`amount ≤ ${r.match_max_amount}`);
    }
    if (r.match_account_id) parts.push(`on specific account`);
    if (r.match_payment_mode) parts.push(`paid via ${r.match_payment_mode}`);
    if (r.match_sms_keyword) parts.push(`SMS contains "${r.match_sms_keyword}"`);
    return parts.length > 0 ? parts.join(" · ") : "No conditions";
  };

  const summarizeActions = (r: SmartRule): string => {
    const parts: string[] = [];
    if (r.action_category_id) parts.push("set category");
    if (r.action_payment_mode) parts.push(`set payment mode to ${r.action_payment_mode}`);
    if (r.action_tag_ids) {
      try {
        const tags = JSON.parse(r.action_tag_ids);
        if (Array.isArray(tags) && tags.length > 0) parts.push(`add ${tags.length} tag${tags.length === 1 ? "" : "s"}`);
      } catch {
        // ignore
      }
    }
    if (r.action_is_right_spend !== null) parts.push(r.action_is_right_spend ? "mark unavoidable" : "mark discretionary");
    if (r.action_mark_auto) parts.push("auto-approve from review");
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
