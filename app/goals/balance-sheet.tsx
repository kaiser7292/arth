import { useState, useMemo, useCallback, useEffect } from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";

import { formatAmount, formatCompact } from "@/utils/format";

import { DEFAULT_USER_ID } from "@/constants/app";
import { getCurrentFY, getFYRange, getFYLabel, formatLocalDate } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";
import { getBalanceSheet, hasDataInRange } from "@/services/balance-sheet";
import type { BalanceSheetColumn, BalanceSheetRow } from "@/services/balance-sheet";
import { consumeBalanceSheetPreload } from "@/services/home-preload";
import { useTheme } from "@/hooks/use-theme";

const preloaded = consumeBalanceSheetPreload();

interface ColumnSpec {
  asOfDate: string;
  label: string;
  isLive: boolean;
  fyYear: number | null; // null for Live
  /** FY start date for historic columns. null for Live. Used as the snapshot-window floor. */
  minDate: string | null;
}

const COL_WIDTH = 120;
const LABEL_COL_WIDTH = 150;

export default function BalanceSheetScreen() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [columns, setColumns] = useState<BalanceSheetColumn[]>(
    preloaded ? [preloaded.liveColumn] : [],
  );
  const [columnSpecs, setColumnSpecs] = useState<ColumnSpec[]>([]);
  const [showAssets, setShowAssets] = useState(true);
  const [showLiabilities, setShowLiabilities] = useState(true);
  // v15.13.0: surface a spinner in the column headers while we recompute, so
  // the user knows old numbers on screen are about to change. Without this,
  // numbers silently swap in on every data-refresh event.
  const [recomputing, setRecomputing] = useState(false);

  // Default: previous FY close + Live. User can add more via the + button.
  const buildDefaultSpecs = useCallback((): ColumnSpec[] => {
    const startMonth = getFYStartMonth();
    const currentFY = getCurrentFY(startMonth);
    const prev = getFYRange(currentFY - 1, startMonth);
    const todayStr = formatLocalDate(new Date());
    return [
      {
        asOfDate: formatLocalDate(prev.end),
        label: getFYLabel(currentFY - 1, startMonth),
        isLive: false,
        fyYear: currentFY - 1,
        minDate: formatLocalDate(prev.start),
      },
      { asOfDate: todayStr, label: "Today", isLive: true, fyYear: null, minDate: null },
    ];
  }, []);

  // Initialise default columns once on mount.
  useEffect(() => {
    setColumnSpecs(buildDefaultSpecs());
  }, [buildDefaultSpecs]);

  useDataRefresh(
    useCallback(async () => {
      if (columnSpecs.length === 0) return;
      setRecomputing(true);
      try {
        const data = await getBalanceSheet(DEFAULT_USER_ID, columnSpecs);
        setColumns(data);
      } finally {
        setRecomputing(false);
      }
    }, [columnSpecs]),
  );

  // "Next addable FY" = the most recent FY with data that isn't already a
  // column. Tracked explicitly (rather than derived from earliest-1) so that
  // removing a column can re-surface it as a candidate.
  const [nextAddableFY, setNextAddableFY] = useState<number | null>(null);

  const addPriorFYColumn = useCallback(async () => {
    if (nextAddableFY == null) return;
    const startMonth = getFYStartMonth();
    const range = getFYRange(nextAddableFY, startMonth);
    const fyStartStr = formatLocalDate(range.start);
    const fyEndStr = formatLocalDate(range.end);
    const newSpec: ColumnSpec = {
      asOfDate: fyEndStr,
      label: getFYLabel(nextAddableFY, startMonth),
      isLive: false,
      fyYear: nextAddableFY,
      minDate: fyStartStr,
    };
    // Insert in FY order so columns stay oldest → newest left-to-right.
    const merged = [...columnSpecs, newSpec].sort((a, b) => {
      const ay = a.fyYear ?? Number.POSITIVE_INFINITY; // live = infinity → rightmost
      const by = b.fyYear ?? Number.POSITIVE_INFINITY;
      return ay - by;
    });
    setColumnSpecs(merged);
  }, [nextAddableFY, columnSpecs]);

  const removeColumn = useCallback(
    (asOfDate: string) => {
      const spec = columnSpecs.find((c) => c.asOfDate === asOfDate);
      if (!spec || spec.isLive) return; // Live is not removable
      setColumnSpecs(columnSpecs.filter((c) => c.asOfDate !== asOfDate));
    },
    [columnSpecs],
  );

  // Find the next FY that (a) has data and (b) isn't already a column.
  // Walk backward from (current FY - 1) a bounded number of years; stop when
  // we find a year with data. If we run out, no candidate.
  useEffect(() => {
    let cancelled = false;
    const MAX_LOOKBACK_YEARS = 25;
    (async () => {
      const startMonth = getFYStartMonth();
      const currentFY = getCurrentFY(startMonth);
      const presentFYs = new Set(
        columnSpecs.map((c) => c.fyYear).filter((y): y is number => y != null),
      );
      for (let fy = currentFY - 1; fy >= currentFY - MAX_LOOKBACK_YEARS; fy--) {
        if (presentFYs.has(fy)) continue;
        const range = getFYRange(fy, startMonth);
        const has = await hasDataInRange(
          DEFAULT_USER_ID,
          formatLocalDate(range.start),
          formatLocalDate(range.end),
        );
        if (has) {
          if (!cancelled) setNextAddableFY(fy);
          return;
        }
      }
      if (!cancelled) setNextAddableFY(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [columnSpecs]);

  const canAddEarlierFY = nextAddableFY != null;

  // Group assets & liabilities by row label across columns so we show a single
  // row-per-line even though different columns may include different accounts.
  const assetRowLabels = useMemo(() => {
    const seen = new Map<string, { group: string; accountId?: string; personId?: string }>();
    for (const col of columns) {
      for (const r of col.assets) {
        if (!seen.has(r.label)) {
          seen.set(r.label, { group: r.group, accountId: r.accountId, personId: r.personId });
        }
      }
    }
    return Array.from(seen.entries()).map(([label, meta]) => ({ label, ...meta }));
  }, [columns]);

  const liabilityRowLabels = useMemo(() => {
    const seen = new Map<string, { group: string; accountId?: string; personId?: string }>();
    for (const col of columns) {
      for (const r of col.liabilities) {
        if (!seen.has(r.label)) {
          seen.set(r.label, { group: r.group, accountId: r.accountId, personId: r.personId });
        }
      }
    }
    return Array.from(seen.entries()).map(([label, meta]) => ({ label, ...meta }));
  }, [columns]);

  const getCellValue = (col: BalanceSheetColumn, rowLabel: string, section: "assets" | "liabilities"): BalanceSheetRow | undefined => {
    const pool = section === "assets" ? col.assets : col.liabilities;
    return pool.find((r) => r.label === rowLabel);
  };

  const handleRowPress = (meta: { group: string; accountId?: string; personId?: string }) => {
    if (meta.group === "hisaab_owed" || meta.group === "hisaab_owes") {
      router.push("/hisaab/persons");
      return;
    }
    if (meta.group === "cc") {
      router.push("/reconciliation/credit-cards");
      return;
    }
    if (meta.group === "savings") {
      router.push("/reconciliation/bank-accounts");
      return;
    }
    if (meta.group === "wallet") {
      router.push("/reconciliation/wallets");
      return;
    }
    if (meta.group === "demat_portfolio" || meta.group === "demat_fund") {
      router.push("/reconciliation/demat-portfolio");
      return;
    }
    if (meta.group === "pension") {
      router.push("/reconciliation/pension-accounts");
      return;
    }
    if (meta.group === "loan" && meta.accountId) {
      router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: meta.accountId } });
    }
  };

  if (columns.length === 0) {
    return (
      <ScreenContainer padTop={false}>
        <LoadingState message="Loading balance sheet..." icon="scale-outline" />
      </ScreenContainer>
    );
  }

  // Net worth delta from the *leftmost* historic column to the last live column (if both exist).
  const liveCol = columns.find((c) => c.isLive);
  const earliestHistoric = columns.find((c) => !c.isLive);
  const liveNetWorth = liveCol?.netWorth ?? 0;
  const historicNetWorth = earliestHistoric?.netWorth ?? 0;
  const deltaAbs = liveNetWorth - historicNetWorth;
  const deltaPct = historicNetWorth !== 0 ? (deltaAbs / Math.abs(historicNetWorth)) * 100 : 0;
  const deltaColor = deltaAbs > 0 ? theme.success : deltaAbs < 0 ? theme.danger : theme.faintForeground;
  const liveNetWorthColor =
    liveNetWorth < 0 ? theme.danger : theme.success;

  return (
    <ScreenContainer padTop={false}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Hero: current net worth + delta */}
        <Card className="mx-4 mt-3 mb-2">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Net Worth · Today
            </Text>
            {recomputing && (
              <View
                className="flex-row items-center px-2 py-0.5 rounded-full"
                style={{ backgroundColor: theme.alpha("primary", 0.1) }}
              >
                <ActivityIndicator size="small" color={theme.primary} />
                <Text className="text-label font-semibold ml-1.5" style={{ color: theme.primary }}>
                  Updating…
                </Text>
              </View>
            )}
          </View>
          <View className="flex-row items-end" style={{ opacity: recomputing ? 0.55 : 1 }}>
            {liveNetWorth < 0 && (
              <Ionicons name="warning-outline" size={20} color={theme.danger} style={{ marginRight: 6 }} />
            )}
            <Text className="text-2xl font-bold" style={{ color: liveNetWorthColor }}>
              {formatAmount(liveNetWorth)}
            </Text>
          </View>
          {earliestHistoric && (
            <View className="flex-row items-center mt-2">
              <Ionicons
                name={deltaAbs >= 0 ? "arrow-up" : "arrow-down"}
                size={12}
                color={deltaColor}
              />
              <Text className="text-xs font-medium ml-1" style={{ color: deltaColor }}>
                {deltaAbs >= 0 ? "+" : ""}{formatCompact(deltaAbs)}
              </Text>
              <Text className="text-xs text-muted-foreground ml-1">
                ({deltaAbs >= 0 ? "+" : ""}{deltaPct.toFixed(1)}%) since {earliestHistoric.label}
              </Text>
            </View>
          )}
        </Card>

        {/* Column headers + body — horizontal scroll so more columns can fit.
            Plain View (not Card) so the scroller can extend to the table edges
            without inherited padding. */}
        <View
          className="mx-4 mb-2 rounded-2xl bg-card overflow-hidden"
          style={{ opacity: recomputing ? 0.55 : 1 }}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
          >
            <View>
              {/* Header row */}
              <View className="flex-row items-center border-b border-border px-3 py-2">
                <View style={{ width: LABEL_COL_WIDTH }} />
                {columns.map((col) => (
                  <View
                    key={col.asOfDate}
                    style={{ width: COL_WIDTH }}
                    className="flex-row items-center justify-end"
                  >
                    <Text
                      className="text-label font-semibold uppercase tracking-wider"
                      style={{ color: col.isLive ? theme.primary : colors.textSecondary }}
                      numberOfLines={1}
                    >
                      {col.label}
                    </Text>
                    {!col.isLive && (
                      <Pressable
                        onPress={() => removeColumn(col.asOfDate)}
                        hitSlop={12}
                        className="ml-1.5 p-0.5"
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${col.label} column`}
                      >
                        <Ionicons name="close-circle" size={14} color={colors.textSecondary} />
                      </Pressable>
                    )}
                  </View>
                ))}
                <Pressable
                  onPress={canAddEarlierFY ? addPriorFYColumn : undefined}
                  hitSlop={12}
                  className="ml-2 pl-2 justify-center"
                  accessibilityRole="button"
                  accessibilityLabel={
                    nextAddableFY != null
                      ? `Add ${getFYLabel(nextAddableFY, getFYStartMonth())} column`
                      : "No earlier fiscal year with data"
                  }
                  accessibilityState={{ disabled: !canAddEarlierFY }}
                  disabled={!canAddEarlierFY}
                  style={{ opacity: canAddEarlierFY ? 1 : 0.35 }}
                >
                  <Ionicons
                    name="add-circle-outline"
                    size={22}
                    color={theme.primary}
                  />
                </Pressable>
              </View>

              {/* Assets section */}
              <Pressable
                onPress={() => setShowAssets(!showAssets)}
                className="flex-row items-center px-3 py-2 border-b border-border"
                style={{ backgroundColor: theme.alpha("primary", 0.04) }}
              >
                <Ionicons
                  name={showAssets ? "chevron-down" : "chevron-forward"}
                  size={12}
                  color={colors.textSecondary}
                />
                <Text className="text-xs font-bold text-foreground ml-1 flex-1">
                  Assets
                </Text>
              </Pressable>

              {showAssets && assetRowLabels.map((row) => (
                <Pressable
                  key={`a-${row.label}`}
                  onPress={() => handleRowPress(row)}
                  className="flex-row items-center px-3 py-2 border-b border-border"
                >
                  <Text
                    className="text-xs text-foreground"
                    numberOfLines={1}
                    style={{ width: LABEL_COL_WIDTH }}
                  >
                    {row.label}
                  </Text>
                  {columns.map((col) => {
                    const cell = getCellValue(col, row.label, "assets");
                    const amount = cell?.amount ?? 0;
                    const isMissing = !cell;
                    return (
                      <View key={col.asOfDate} style={{ width: COL_WIDTH }} className="items-end">
                        <Text
                          className="text-xs"
                          style={{
                            color: isMissing
                              ? theme.faintForeground
                              : cell?.isFallback
                                ? theme.faintForeground
                                : colors.text,
                            fontStyle: cell?.isFallback ? "italic" : "normal",
                          }}
                        >
                          {isMissing ? "-" : formatAmount(amount)}
                        </Text>
                      </View>
                    );
                  })}
                </Pressable>
              ))}

              {/* Total Assets */}
              {showAssets && (
                <View className="flex-row items-center px-3 py-2 border-b border-border">
                  <Text
                    className="text-xs font-bold text-foreground"
                    style={{ width: LABEL_COL_WIDTH }}
                  >
                    Total Assets
                  </Text>
                  {columns.map((col) => (
                    <View key={col.asOfDate} style={{ width: COL_WIDTH }} className="items-end">
                      <Text className="text-xs font-bold" style={{ color: theme.success }}>
                        {formatAmount(col.totalAssets)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Liabilities section */}
              <Pressable
                onPress={() => setShowLiabilities(!showLiabilities)}
                className="flex-row items-center px-3 py-2 border-b border-border"
                style={{ backgroundColor: theme.danger + "0A" }}
              >
                <Ionicons
                  name={showLiabilities ? "chevron-down" : "chevron-forward"}
                  size={12}
                  color={colors.textSecondary}
                />
                <Text className="text-xs font-bold text-foreground ml-1 flex-1">
                  Liabilities
                </Text>
              </Pressable>

              {showLiabilities && liabilityRowLabels.map((row) => (
                <Pressable
                  key={`l-${row.label}`}
                  onPress={() => handleRowPress(row)}
                  className="flex-row items-center px-3 py-2 border-b border-border"
                >
                  <Text
                    className="text-xs text-foreground"
                    numberOfLines={1}
                    style={{ width: LABEL_COL_WIDTH }}
                  >
                    {row.label}
                  </Text>
                  {columns.map((col) => {
                    const cell = getCellValue(col, row.label, "liabilities");
                    const amount = cell?.amount ?? 0;
                    const isMissing = !cell;
                    return (
                      <View key={col.asOfDate} style={{ width: COL_WIDTH }} className="items-end">
                        <Text
                          className="text-xs"
                          style={{
                            color: isMissing
                              ? theme.faintForeground
                              : cell?.isFallback
                                ? theme.faintForeground
                                : colors.text,
                            fontStyle: cell?.isFallback ? "italic" : "normal",
                          }}
                        >
                          {isMissing ? "-" : formatAmount(amount)}
                        </Text>
                      </View>
                    );
                  })}
                </Pressable>
              ))}

              {/* Total Liabilities */}
              {showLiabilities && (
                <View className="flex-row items-center px-3 py-2 border-b border-border">
                  <Text
                    className="text-xs font-bold text-foreground"
                    style={{ width: LABEL_COL_WIDTH }}
                  >
                    Total Liabilities
                  </Text>
                  {columns.map((col) => (
                    <View key={col.asOfDate} style={{ width: COL_WIDTH }} className="items-end">
                      <Text className="text-xs font-bold" style={{ color: theme.danger }}>
                        {formatAmount(col.totalLiabilities)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Net Worth */}
              <View
                className="flex-row items-center px-3 py-3"
                style={{ backgroundColor: theme.alpha("primary", 0.08) }}
              >
                <Text
                  className="text-xs font-bold text-foreground"
                  style={{ width: LABEL_COL_WIDTH }}
                >
                  Net Worth
                </Text>
                {columns.map((col) => (
                  <View key={col.asOfDate} style={{ width: COL_WIDTH }} className="items-end">
                    <Text
                      className="text-sm font-bold"
                      style={{
                        color: col.netWorth < 0 ? theme.danger : colors.text,
                      }}
                    >
                      {formatAmount(col.netWorth)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
        </View>

        {/* Caveats footer */}
        <Card className="mx-4 mb-2">
          <View className="flex-row items-start">
            <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} style={{ marginTop: 2 }} />
            <View className="flex-1 ml-2">
              <Text className="text-label text-muted-foreground leading-4">
                A "-" means no data for that row in that period. For demat, it means no portfolio or fund snapshot was recorded within that fiscal year. Italic values fall back to the last SMS balance when the ledger opening isn't seeded - seed openings to make those authoritative.
              </Text>
            </View>
          </View>
        </Card>
      </ScrollView>
    </ScreenContainer>
  );
}
