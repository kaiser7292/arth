/**
 * Period Comparison Screen (V4 Phase 2 — V4-2.3)
 *
 * Two date range pickers with preset chips (This vs Last Month, Quarter, YoY, Custom).
 * Full comparison output: total, category, merchant, payment mode breakdowns.
 */

import { useState, useCallback } from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { Button, Card, DateInput, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getDateRangeComparison, getComparisonPresets, getComparisonExpenseIds } from "@/services/comparison-insights";
import type { ComparisonResult, ComparisonPreset, ComparisonDrillFilter } from "@/services/comparison-insights";
import { formatAmount } from "@/utils/expense-validation";
import { formatDisplayDate as formatDateShort } from "@/utils/date";
import { changePctColor } from "@/constants/semantic-colors";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";


function changeArrow(pct: number): keyof typeof Ionicons.glyphMap {
  if (pct > 5) return "arrow-up";
  if (pct < -5) return "arrow-down";
  return "remove-outline";
}

function shortRangeLabel(start: string, end: string): string {
  const s = formatDateShort(start);
  const e = formatDateShort(end);
  return `${s}–${e}`;
}


export default function PeriodComparisonScreen() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [presets] = useState<ComparisonPreset[]>(() => getComparisonPresets());
  const [selectedPreset, setSelectedPreset] = useState<string>("This Month vs Last Month");

  // Date range inputs
  const [r1Start, setR1Start] = useState("");
  const [r1End, setR1End] = useState("");
  const [r2Start, setR2Start] = useState("");
  const [r2End, setR2End] = useState("");

  const [data, setData] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [showAllMerchants, setShowAllMerchants] = useState(false);

  const runComparison = useCallback(async (s1: string, e1: string, s2: string, e2: string) => {
    if (!s1 || !e1 || !s2 || !e2) return;
    setLoading(true);
    try {
      const result = await getDateRangeComparison(DEFAULT_USER_ID, s1, e1, s2, e2);
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handlePresetSelect = useCallback((preset: ComparisonPreset) => {
    setSelectedPreset(preset.label);
    setShowCustom(false);
    setR1Start(preset.range1Start);
    setR1End(preset.range1End);
    setR2Start(preset.range2Start);
    setR2End(preset.range2End);
    runComparison(preset.range1Start, preset.range1End, preset.range2Start, preset.range2End);
  }, [runComparison]);

  const handleCustom = useCallback(() => {
    setSelectedPreset("Custom");
    setShowCustom(true);
    setData(null);
  }, []);

  const handleCompare = useCallback(() => {
    runComparison(r1Start, r1End, r2Start, r2End);
  }, [runComparison, r1Start, r1End, r2Start, r2End]);

  const drillInto = useCallback(async (
    rangeStart: string,
    rangeEnd: string,
    filter: ComparisonDrillFilter,
    title: string,
  ) => {
    const ids = await getComparisonExpenseIds(DEFAULT_USER_ID, rangeStart, rangeEnd, filter);
    if (ids.length === 0) return;
    router.push({
      pathname: "/insights/filtered",
      params: { expenseIds: ids.join(","), title },
    });
  }, [router]);

  // Re-run comparison on every focus (expenses may have changed)
  useFocusEffect(
    useCallback(() => {
      if (r1Start && r1End && r2Start && r2End) {
        runComparison(r1Start, r1End, r2Start, r2End);
      } else if (presets.length > 0) {
        const defaultPreset = presets.find((p) => p.label === "This Month vs Last Month") ?? presets[0];
        handlePresetSelect(defaultPreset);
      }
    }, [r1Start, r1End, r2Start, r2End]),
  );

  const canCompare = r1Start && r1End && r2Start && r2End;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Preset Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}
        >
          {presets.map((p) => (
            <Pressable
              key={p.label}
              onPress={() => handlePresetSelect(p)}
              accessibilityLabel={p.label}
              accessibilityRole="button"
              className={`px-3 py-2 rounded-lg ${
                selectedPreset === p.label ? "" : "bg-card"
              }`}
              style={selectedPreset === p.label ? { backgroundColor: theme.primary } : undefined}
            >
              <Text
                className={`text-xs font-semibold ${
                  selectedPreset === p.label ? "text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {p.label}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={handleCustom}
            accessibilityLabel="Custom date range"
            accessibilityRole="button"
            className={`px-3 py-2 rounded-lg ${
              selectedPreset === "Custom" ? "" : "bg-card"
            }`}
            style={selectedPreset === "Custom" ? { backgroundColor: theme.primary } : undefined}
          >
            <Text
              className={`text-xs font-semibold ${
                selectedPreset === "Custom" ? "text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              Custom
            </Text>
          </Pressable>
        </ScrollView>

        {/* Custom Date Inputs */}
        {showCustom && (
          <Card className="mx-4 mb-3">
            <Text className="text-xs font-semibold text-faint-foreground uppercase tracking-wider mb-3">
              Range 1 (Baseline)
            </Text>
            <View className="flex-row mb-3">
              <DateInput
                label="Start"
                value={r1Start}
                onChange={setR1Start}
                maximumDate={null}
                containerClassName="flex-1 mr-2"
              />
              <DateInput
                label="End"
                value={r1End}
                onChange={setR1End}
                maximumDate={null}
                containerClassName="flex-1"
              />
            </View>

            <Text className="text-xs font-semibold text-faint-foreground uppercase tracking-wider mb-3">
              Range 2 (Compare)
            </Text>
            <View className="flex-row mb-3">
              <DateInput
                label="Start"
                value={r2Start}
                onChange={setR2Start}
                maximumDate={null}
                containerClassName="flex-1 mr-2"
              />
              <DateInput
                label="End"
                value={r2End}
                onChange={setR2End}
                maximumDate={null}
                containerClassName="flex-1"
              />
            </View>

            <Button
              title="Compare"
              onPress={handleCompare}
              disabled={!canCompare}
            />
          </Card>
        )}

        {/* Loading */}
        {loading && (
          <View className="items-center py-8">
            <ActivityIndicator size="small" color={theme.primary} />
          </View>
        )}

        {/* Results */}
        {data && !loading && (
          <>
            {/* Total Comparison Card */}
            <Card className="mx-4 mt-1">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-sm font-semibold text-foreground">
                  Total Spending
                </Text>
                <View className="flex-row items-center">
                  <Ionicons
                    name={changeArrow(data.delta.totalDeltaPct)}
                    size={14}
                    color={changePctColor(data.delta.totalDeltaPct)}
                  />
                  <Text className="text-xs font-bold ml-0.5" style={{ color: changePctColor(data.delta.totalDeltaPct) }}>
                    {data.delta.totalDeltaPct > 0 ? "+" : ""}{data.delta.totalDeltaPct.toFixed(1)}%
                  </Text>
                </View>
              </View>

              <View className="flex-row">
                <Pressable
                  className="flex-1 mr-2"
                  onPress={() => drillInto(data.range1.start, data.range1.end, { type: "total" }, `All · ${formatDateShort(data.range1.start)}–${formatDateShort(data.range1.end)}`)}
                >
                  <Text className="text-xs text-faint-foreground mb-1">
                    {formatDateShort(data.range1.start)} – {formatDateShort(data.range1.end)}
                  </Text>
                  <Text className="text-lg font-bold" style={{ color: theme.primary }}>
                    {formatAmount(data.range1.summary.totalSpent)}
                  </Text>
                  <Text className="text-xs text-faint-foreground mt-0.5">
                    {data.range1.summary.transactionCount} txns · tap to view
                  </Text>
                </Pressable>
                <View className="items-center justify-center px-2">
                  <Ionicons name="arrow-forward" size={16} color={colors.textSecondary} />
                </View>
                <Pressable
                  className="flex-1 ml-2"
                  onPress={() => drillInto(data.range2.start, data.range2.end, { type: "total" }, `All · ${formatDateShort(data.range2.start)}–${formatDateShort(data.range2.end)}`)}
                >
                  <Text className="text-xs text-faint-foreground mb-1">
                    {formatDateShort(data.range2.start)} – {formatDateShort(data.range2.end)}
                  </Text>
                  <Text className="text-lg font-bold" style={{ color: theme.primary }}>
                    {formatAmount(data.range2.summary.totalSpent)}
                  </Text>
                  <Text className="text-xs text-faint-foreground mt-0.5">
                    {data.range2.summary.transactionCount} txns · tap to view
                  </Text>
                </Pressable>
              </View>

              <View className="flex-row items-center justify-center mt-3 pt-3 border-t border-border">
                <Text className="text-xs text-faint-foreground mr-1">Delta:</Text>
                <Text className="text-sm font-bold" style={{ color: changePctColor(data.delta.totalDeltaPct) }}>
                  {data.delta.totalDelta > 0 ? "+" : "-"}{formatAmount(Math.abs(data.delta.totalDelta))}
                </Text>
                <Text className="text-xs text-faint-foreground ml-2">
                  ({data.delta.countDelta > 0 ? "+" : ""}{data.delta.countDelta} txns)
                </Text>
              </View>
              <View className="flex-row items-center justify-center mt-2">
                <Ionicons name="information-circle-outline" size={11} color={colors.textSecondary} />
                <Text className="text-xs text-faint-foreground ml-1">
                  Excludes transfers, investments & loan payments
                </Text>
              </View>
            </Card>

            {/* Category Comparison */}
            {data.byCategory.length > 0 && (
              <>
                <View className="px-4 mt-4">
                  <Text className="text-xs font-semibold text-faint-foreground uppercase tracking-wider mb-3">
                    By Category
                  </Text>
                </View>
                <Card className="mx-4">
                  <View className="flex-row items-center pb-2 border-b border-border mb-1">
                    <Text className="flex-1 text-xs font-semibold text-faint-foreground">Category</Text>
                    <Text className="w-16 ml-2 text-xs font-semibold text-faint-foreground text-right">R1</Text>
                    <Text className="w-16 ml-2 text-xs font-semibold text-faint-foreground text-right">R2</Text>
                    <Text className="w-16 ml-2 text-xs font-semibold text-faint-foreground text-right">Chg</Text>
                  </View>
                  {data.byCategory.map((c) => (
                    <View
                      key={c.categoryId}
                      className="flex-row items-center py-2 border-b border-border"
                    >
                      <Text className="flex-1 text-xs text-foreground" numberOfLines={1}>
                        {c.categoryName}
                      </Text>
                      <Pressable
                        className="w-16 ml-2"
                        onPress={() => drillInto(data.range1.start, data.range1.end, { type: "category", categoryId: c.categoryId }, `${c.categoryName} · ${shortRangeLabel(data.range1.start, data.range1.end)}`)}
                      >
                        <Text className="text-label text-right" style={{ color: theme.primary }}>
                          {formatAmount(c.range1Total)}
                        </Text>
                      </Pressable>
                      <Pressable
                        className="w-16 ml-2"
                        onPress={() => drillInto(data.range2.start, data.range2.end, { type: "category", categoryId: c.categoryId }, `${c.categoryName} · ${shortRangeLabel(data.range2.start, data.range2.end)}`)}
                      >
                        <Text className="text-label font-medium text-right" style={{ color: theme.primary }}>
                          {formatAmount(c.range2Total)}
                        </Text>
                      </Pressable>
                      <View className="w-14 ml-2 flex-row items-center justify-end">
                        <Text className="text-label font-bold" style={{ color: changePctColor(c.deltaPct) }}>
                          {c.deltaPct > 0 ? "+" : ""}{c.deltaPct.toFixed(0)}%
                        </Text>
                      </View>
                    </View>
                  ))}
                </Card>
              </>
            )}

            {/* Merchant Comparison */}
            {data.byMerchant.length > 0 && (
              <>
                <View className="px-4 mt-4">
                  <Text className="text-xs font-semibold text-faint-foreground uppercase tracking-wider mb-3">
                    By Merchant
                  </Text>
                </View>
                <Card className="mx-4">
                  <View className="flex-row items-center pb-2 border-b border-border mb-1">
                    <Text className="flex-1 text-xs font-semibold text-faint-foreground">Merchant</Text>
                    <Text className="w-16 ml-2 text-xs font-semibold text-faint-foreground text-right">R1</Text>
                    <Text className="w-16 ml-2 text-xs font-semibold text-faint-foreground text-right">R2</Text>
                    <Text className="w-16 ml-2 text-xs font-semibold text-faint-foreground text-right">Chg</Text>
                  </View>
                  {(showAllMerchants ? data.byMerchant : data.byMerchant.slice(0, 10)).map((m) => (
                    <View
                      key={m.merchantName}
                      className="flex-row items-center py-2 border-b border-border"
                    >
                      <Text className="flex-1 text-xs text-foreground capitalize" numberOfLines={1}>
                        {m.merchantName}
                      </Text>
                      <Pressable
                        className="w-16 ml-2"
                        onPress={() => drillInto(data.range1.start, data.range1.end, { type: "merchant", merchantName: m.merchantName }, `${m.merchantName} · ${shortRangeLabel(data.range1.start, data.range1.end)}`)}
                      >
                        <Text className="text-label text-right" style={{ color: theme.primary }}>
                          {formatAmount(m.range1Total)}
                        </Text>
                      </Pressable>
                      <Pressable
                        className="w-16 ml-2"
                        onPress={() => drillInto(data.range2.start, data.range2.end, { type: "merchant", merchantName: m.merchantName }, `${m.merchantName} · ${shortRangeLabel(data.range2.start, data.range2.end)}`)}
                      >
                        <Text className="text-label font-medium text-right" style={{ color: theme.primary }}>
                          {formatAmount(m.range2Total)}
                        </Text>
                      </Pressable>
                      <View className="w-14 ml-2 flex-row items-center justify-end">
                        <Text className="text-label font-bold" style={{ color: changePctColor(m.deltaPct) }}>
                          {m.deltaPct > 0 ? "+" : ""}{m.deltaPct.toFixed(0)}%
                        </Text>
                      </View>
                    </View>
                  ))}
                  {data.byMerchant.length > 10 && (
                    <Pressable
                      onPress={() => setShowAllMerchants((prev) => !prev)}
                      className="py-2"
                    >
                      <Text className="text-xs font-medium text-center" style={{ color: theme.primary }}>
                        {showAllMerchants ? "Show fewer" : `+${data.byMerchant.length - 10} more merchants`}
                      </Text>
                    </Pressable>
                  )}
                </Card>
              </>
            )}

            {/* Payment Mode Comparison */}
            {data.byPaymentMode.length > 0 && (
              <>
                <View className="px-4 mt-4">
                  <Text className="text-xs font-semibold text-faint-foreground uppercase tracking-wider mb-3">
                    By Payment Method
                  </Text>
                </View>
                <Card className="mx-4">
                  <View className="flex-row items-center pb-2 border-b border-border mb-1">
                    <Text className="flex-1 text-xs font-semibold text-faint-foreground">Method</Text>
                    <Text className="w-16 ml-2 text-xs font-semibold text-faint-foreground text-right">R1</Text>
                    <Text className="w-16 ml-2 text-xs font-semibold text-faint-foreground text-right">R2</Text>
                    <Text className="w-16 ml-2 text-xs font-semibold text-faint-foreground text-right">Chg</Text>
                  </View>
                  {data.byPaymentMode.map((pm) => (
                    <View
                      key={pm.paymentModeId}
                      className="flex-row items-center py-2 border-b border-border"
                    >
                      <Text className="flex-1 text-xs text-foreground">
                        {pm.paymentModeName}
                      </Text>
                      <Pressable
                        className="w-16 ml-2"
                        onPress={() => drillInto(data.range1.start, data.range1.end, { type: "paymentMode", paymentModeId: pm.paymentModeId }, `${pm.paymentModeName} · ${shortRangeLabel(data.range1.start, data.range1.end)}`)}
                      >
                        <Text className="text-label text-right" style={{ color: theme.primary }}>
                          {formatAmount(pm.range1Total)}
                        </Text>
                      </Pressable>
                      <Pressable
                        className="w-16 ml-2"
                        onPress={() => drillInto(data.range2.start, data.range2.end, { type: "paymentMode", paymentModeId: pm.paymentModeId }, `${pm.paymentModeName} · ${shortRangeLabel(data.range2.start, data.range2.end)}`)}
                      >
                        <Text className="text-label font-medium text-right" style={{ color: theme.primary }}>
                          {formatAmount(pm.range2Total)}
                        </Text>
                      </Pressable>
                      <View className="w-14 ml-2 flex-row items-center justify-end">
                        <Text className="text-label font-bold" style={{ color: changePctColor(pm.deltaPct) }}>
                          {pm.deltaPct > 0 ? "+" : ""}{pm.deltaPct.toFixed(0)}%
                        </Text>
                      </View>
                    </View>
                  ))}
                </Card>
              </>
            )}
          </>
        )}

        {/* Empty state — only if no data and not loading and not showing custom form */}
        {!data && !loading && !showCustom && (
          <View className="items-center py-16 px-8">
            <Ionicons name="git-compare-outline" size={48} color={colors.textSecondary} />
            <Text className="text-lg font-medium text-foreground mt-4">
              Compare Periods
            </Text>
            <Text className="text-sm text-muted-foreground mt-1 text-center">
              Select a preset or enter custom dates to compare spending across two periods.
            </Text>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
