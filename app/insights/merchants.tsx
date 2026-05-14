import { useState, useCallback } from "react";
import { View, Text, Pressable, FlatList } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ScreenContainer, Card, ProgressBar } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getMerchantAnalytics, getMerchantDetail } from "@/services/spending-insights";
import { getCategories } from "@/services/category";
import { formatAmount, formatDateForDisplay } from "@/utils/expense-validation";
import type { MerchantInsight } from "@/utils/spending-insights";
import type { Category } from "@/services/category";
import { DEFAULT_USER_ID } from "@/constants/app";

type TimeRange = "1m" | "3m" | "6m";

function getDateRange(range: TimeRange): { startDate: string; endDate: string } {
  const now = new Date();
  const end = now.toISOString().split("T")[0];
  const months = range === "1m" ? 1 : range === "3m" ? 3 : 6;
  const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`;
  return { startDate, endDate: end };
}

const RANGE_LABELS: { key: TimeRange; label: string }[] = [
  { key: "1m", label: "This Month" },
  { key: "3m", label: "3 Months" },
  { key: "6m", label: "6 Months" },
];

export default function MerchantAnalyticsScreen() {
  const router = useRouter();
  const { accent, colors } = useColorScheme();
  const [range, setRange] = useState<TimeRange>("3m");
  const [merchants, setMerchants] = useState<MerchantInsight[]>([]);
  const [categoryMap, setCategoryMap] = useState<Map<string, Category>>(new Map());
  const [selectedMerchant, setSelectedMerchant] = useState<string | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getMerchantDetail>> | null>(null);

  const loadData = useCallback(async () => {
    try {
      const { startDate, endDate } = getDateRange(range);
      const [data, cats] = await Promise.all([
        getMerchantAnalytics(DEFAULT_USER_ID, startDate, endDate, 30),
        getCategories(DEFAULT_USER_ID),
      ]);
      setMerchants(data);
      setCategoryMap(new Map(cats.map((c) => [c.id, c])));
      setSelectedMerchant(null);
      setDetail(null);
    } catch {
      // DB not ready
    }
  }, [range]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const handleSelectMerchant = useCallback(async (merchant: MerchantInsight) => {
    if (selectedMerchant === merchant.merchant) {
      setSelectedMerchant(null);
      setDetail(null);
      return;
    }
    setSelectedMerchant(merchant.merchant);
    try {
      const { startDate, endDate } = getDateRange(range);
      const d = await getMerchantDetail(DEFAULT_USER_ID, merchant.merchant, startDate, endDate);
      setDetail(d);
    } catch {
      setDetail(null);
    }
  }, [selectedMerchant, range]);

  const topTotal = merchants.length > 0 ? merchants[0].totalSpent : 1;
  const grandTotal = merchants.reduce((s, m) => s + m.totalSpent, 0);

  return (
    <ScreenContainer padTop={false}>
      {/* Time Range Selector */}
      <View className="flex-row px-4 py-3">
        {RANGE_LABELS.map((r) => (
          <Pressable
            key={r.key}
            onPress={() => setRange(r.key)}
            accessibilityLabel={`Show ${r.label}`}
            accessibilityRole="button"
            className={`flex-1 py-2 rounded-lg items-center mx-1 ${
              range === r.key ? "" : "bg-surface-light-alt dark:bg-surface-dark-alt"
            }`}
            style={range === r.key ? { backgroundColor: accent[500] } : undefined}
          >
            <Text
              className={`text-xs font-semibold ${
                range === r.key ? "text-white" : "text-text-secondary dark:text-text-dark-secondary"
              }`}
            >
              {r.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Summary */}
      {merchants.length > 0 && (
        <View className="px-4 pb-2">
          <Text className="text-xs text-text-tertiary">
            {merchants.length} merchants · Total {formatAmount(grandTotal)}
          </Text>
        </View>
      )}

      <FlatList
        data={merchants}
        keyExtractor={(item) => item.merchant}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        renderItem={({ item, index }) => {
          const isSelected = selectedMerchant === item.merchant;
          const cat = item.categoryId ? categoryMap.get(item.categoryId) : null;
          const barPct = topTotal > 0 ? item.totalSpent / topTotal : 0;

          return (
            <View>
              <Pressable
                onPress={() => handleSelectMerchant(item)}
                accessibilityLabel={`${item.merchant}, ${formatAmount(item.totalSpent)}`}
                accessibilityRole="button"
                className="py-3 border-b border-border-light dark:border-border-dark"
              >
                <View className="flex-row items-center justify-between mb-1">
                  <View className="flex-row items-center flex-1">
                    <Text className="text-xs font-bold text-text-tertiary w-6">{index + 1}</Text>
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-text-primary dark:text-text-dark-primary capitalize" numberOfLines={1}>
                        {item.merchant}
                      </Text>
                      <Text className="text-xs text-text-tertiary">
                        {item.transactionCount} txn{item.transactionCount !== 1 ? "s" : ""} · avg {formatAmount(item.avgAmount)}
                        {cat ? ` · ${cat.name}` : ""}
                      </Text>
                    </View>
                  </View>
                  <View className="items-end ml-2">
                    <Text className="text-sm font-bold text-text-primary dark:text-text-dark-primary">
                      {formatAmount(item.totalSpent)}
                    </Text>
                    <Text className="text-micro text-text-tertiary">
                      {grandTotal > 0 ? `${((item.totalSpent / grandTotal) * 100).toFixed(1)}%` : ""}
                    </Text>
                  </View>
                </View>
                <ProgressBar
                  value={barPct}
                  color={cat?.color ?? accent[500]}
                  height={4}
                  animated={false}
                />
              </Pressable>

              {/* Merchant Detail (expanded) */}
              {isSelected && detail && (
                <Card className="my-2">
                  {/* Monthly trend */}
                  {detail.monthlyTotals.length > 1 && (
                    <View className="mb-3">
                      <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary mb-2">
                        Monthly Trend
                      </Text>
                      {detail.monthlyTotals.map((mt) => {
                        const maxMonthly = Math.max(...detail.monthlyTotals.map((m) => m.total));
                        return (
                          <View key={mt.month} className="flex-row items-center mb-1">
                            <Text className="text-xs text-text-tertiary w-16">{mt.month}</Text>
                            <View className="flex-1 mr-2">
                              <ProgressBar
                                value={maxMonthly > 0 ? mt.total / maxMonthly : 0}
                                color={accent[500]}
                                height={6}
                                animated={false}
                              />
                            </View>
                            <Text className="text-xs font-medium text-text-primary dark:text-text-dark-primary w-20 text-right">
                              {formatAmount(mt.total)}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* Categories used */}
                  {detail.categories.length > 0 && (
                    <View className="mb-3">
                      <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary mb-1">
                        Categories
                      </Text>
                      <View className="flex-row flex-wrap">
                        {detail.categories.map((c) => {
                          const catInfo = categoryMap.get(c.category_id);
                          return (
                            <View
                              key={c.category_id}
                              className="flex-row items-center mr-3 mb-1"
                            >
                              <View
                                className="w-2.5 h-2.5 rounded-full mr-1"
                                style={{ backgroundColor: catInfo?.color ?? "#6B7280" }}
                              />
                              <Text className="text-xs text-text-secondary dark:text-text-dark-secondary">
                                {catInfo?.name ?? "Unknown"} ({formatAmount(c.total)})
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  )}

                  {/* Recent transactions */}
                  <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary mb-1">
                    Recent Transactions ({detail.transactionCount})
                  </Text>
                  {detail.transactions.slice(0, 5).map((t) => (
                    <Pressable
                      key={t.id}
                      onPress={() => router.push(`/expense/${t.id}`)}
                      accessibilityLabel={`${t.description ?? "Transaction"}, ${formatAmount(t.amount)}`}
                      accessibilityRole="button"
                      className="flex-row items-center py-1.5"
                    >
                      <Text className="text-xs text-text-tertiary w-20">{formatDateForDisplay(t.date)}</Text>
                      <Text className="text-xs text-text-primary dark:text-text-dark-primary flex-1" numberOfLines={1}>
                        {t.description ?? "—"}
                      </Text>
                      <Text className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                        {formatAmount(t.amount)}
                      </Text>
                    </Pressable>
                  ))}
                  {detail.transactionCount > 5 && (
                    <Text className="text-xs mt-1" style={{ color: accent[500] }}>
                      +{detail.transactionCount - 5} more
                    </Text>
                  )}
                </Card>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Ionicons name="storefront-outline" size={48} color={colors.textSecondary} />
            <Text className="text-lg font-medium text-text-primary dark:text-text-dark-primary mt-4">
              No merchant data
            </Text>
            <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-1 text-center px-8">
              Add expenses with descriptions to see merchant analytics.
            </Text>
          </View>
        }
      />
    </ScreenContainer>
  );
}
