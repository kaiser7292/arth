import { useCallback, useState } from "react";
import { View, FlatList, ActivityIndicator } from "react-native";
import { Stack, useLocalSearchParams, useFocusEffect, useRouter } from "expo-router";
import { LoadingState, ScreenContainer, Text } from "@/components/ui";
import { ExpenseListRow } from "@/components/expense/ExpenseListRow";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getRule } from "@/services/smart-rules";
import { getExpensesPaginated } from "@/services/expense";
import { getCategories } from "@/services/category";
import { getPaymentModes } from "@/services/payment-mode";
import { getActiveAccounts } from "@/services/financial-account";
import { Ionicons } from "@expo/vector-icons";
import type { Expense } from "@/services/expense";
import type { Category } from "@/services/category";
import type { PaymentMode } from "@/services/payment-mode";
import type { FinancialAccount } from "@/services/financial-account";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";

export default function RuleApplicationsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const router = useRouter();

  const [ruleName, setRuleName] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categoryMap, setCategoryMap] = useState<Map<string, Category>>(new Map());
  const [paymentModeMap, setPaymentModeMap] = useState<Map<string, PaymentMode>>(new Map());
  const [accountMap, setAccountMap] = useState<Map<string, FinancialAccount>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [rule, data, cats, pms, accts] = await Promise.all([
        getRule(id),
        getExpensesPaginated(
          DEFAULT_USER_ID,
          { ruleIds: [id], nature: "all" },
          200,
          0,
        ),
        getCategories(DEFAULT_USER_ID),
        getPaymentModes(DEFAULT_USER_ID),
        getActiveAccounts(DEFAULT_USER_ID),
      ]);
      if (rule) setRuleName(rule.name);
      setExpenses(data);
      setCategoryMap(new Map(cats.map((c) => [c.id, c])));
      setPaymentModeMap(new Map(pms.map((p) => [p.id, p])));
      setAccountMap(new Map(accts.map((a) => [a.id, a])));
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const title = ruleName ? `"${ruleName}"` : "Rule Applications";

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen options={{ title, headerShadowVisible: false }} />

      {loading ? (
        <LoadingState />
      ) : expenses.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="sparkles-outline" size={48} color={colors.textSecondary} />
          <Text className="text-lg font-medium text-foreground mt-4">
            No applications yet
          </Text>
          <Text className="text-sm text-faint-foreground text-center mt-2">
            Transactions matched by this rule will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          data={expenses}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, paddingTop: 8 }}
          ListHeaderComponent={
            <Text className="text-xs text-faint-foreground mb-3">
              {expenses.length} transaction{expenses.length === 1 ? "" : "s"} matched by this rule
            </Text>
          }
          renderItem={({ item }) => (
            <ExpenseListRow
              item={item}
              categoryMap={categoryMap}
              paymentModeMap={paymentModeMap}
              accountMap={accountMap}
              onPress={(expenseId) => router.push(`/expense/${expenseId}`)}
              onLongPress={() => {}}
            />
          )}
        />
      )}
    </ScreenContainer>
  );
}
