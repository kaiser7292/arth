import { useState, useMemo, useCallback, useEffect } from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, LoadingState, ScreenContainer, Text } from "@/components/ui";
import { useDataRefresh } from "@/hooks/use-data-refresh";

import { formatAmount, formatCompact } from "@/utils/format";

import { DEFAULT_USER_ID } from "@/constants/app";
import { getCurrentFY, getFYRange, getFYLabel, formatLocalDate } from "@/utils/fiscal-year";
import { getFYStartMonth } from "@/services/settings";
import { getBalanceSheet, hasDataInRange } from "@/services/balance-sheet";
import type { BalanceSheetColumn, BalanceSheetRow } from "@/services/balance-sheet";
import { consumeBalanceSheetPreload } from "@/services/home-preload";
import { useTheme } from "@/hooks/use-theme";
import { HisaabNetWorthSheet } from "@/components/goals/HisaabNetWorthSheet";
import { NetWorthTrendCard } from "@/components/goals/NetWorthTrendCard";
import { getNetWorthHistory, peekNetWorthHistory, type NetWorthPoint } from "@/services/net-worth-history";
import { getDataVersion } from "@/services/settings";
import { LinkRow } from "@/components/ui/LinkRow";
import { PickerSheet } from "@/components/expense/PickerSheet";

const preloaded = consumeBalanceSheetPreload();

/**
 * The last table this screen computed, kept across visits. Opening the screen again shows it at
 * once, and it's only recomputed when something was written since (data version), the day
 * rolled over, or the columns differ - before this, every visit recomputed everything behind a
 * full-screen loader.
 */
let lastTable: { key: string; columns: BalanceSheetColumn[] } | null = null;

interface ColumnSpec {
  asOfDate: string;
  label: string;
  isLive: boolean;
  fyYear: number | null; // null for Live
  /** FY start date for historic columns. null for Live. Used as the snapshot-window floor. */
  minDate: string | null;
}


export default function BalanceSheetScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [columns, setColumns] = useState<BalanceSheetColumn[]>(
    preloaded ? [preloaded.liveColumn] : lastTable?.columns ?? [],
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [columnSpecs, setColumnSpecs] = useState<ColumnSpec[]>([]);
  const [showAssets, setShowAssets] = useState(true);
  const [showLiabilities, setShowLiabilities] = useState(true);
  // Sections within Assets/Liabilities (Liquid Cash, Investments, Receivables /
  // Credit, Debt, Payables) — collapsed sections tracked by name, all expanded
  // by default. Independent from the top-level showAssets/showLiabilities toggle.
  // Sections start folded, so the sheet reads as one line per kind (as on the board); a tap opens the accounts.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(["Liquid Cash", "Investments", "Receivables", "Credit", "Debt", "Payables"]),
  );
  // Rows with nested children (currently: a savings account with a linked
  // fixed deposit) start collapsed — expand on tap to reveal the FD sub-line.
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  // v15.13.0: surface a spinner in the column headers while we recompute, so
  // the user knows old numbers on screen are about to change. Without this,
  // numbers silently swap in on every data-refresh event.
  const [recomputing, setRecomputing] = useState(false);
  const [hisaabSheetOpen, setHisaabSheetOpen] = useState(false);
  const [history, setHistory] = useState<NetWorthPoint[]>(() => peekNetWorthHistory()?.points ?? []);
  const [historyLoading, setHistoryLoading] = useState(() => peekNetWorthHistory() == null);

  // Default: Today only (owner's board, Nov 2026). + adds the end of the previous FY, then the one before.
  const buildDefaultSpecs = useCallback((): ColumnSpec[] => {
    const todayStr = formatLocalDate(new Date());
    return [{ asOfDate: todayStr, label: "Today", isLive: true, fyYear: null, minDate: null }];
  }, []);

  // Initialise default columns once on mount.
  useEffect(() => {
    setColumnSpecs(buildDefaultSpecs());
  }, [buildDefaultSpecs]);

  // Net worth over time - loaded after the table so the two don't compete for the database, and
  // its own try so a slow or failed history never holds up the table.
  const loadHistory = useCallback(async () => {
    try {
      const h = await getNetWorthHistory(DEFAULT_USER_ID);
      setHistory(h.points);
    } catch (e) {
      console.warn("[balance-sheet] net worth history failed", e);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadTable = useCallback(async () => {
    if (columnSpecs.length === 0) return;
    const key = `${getDataVersion()}|${formatLocalDate(new Date())}|${columnSpecs.map((c) => c.asOfDate).join(",")}`;
    if (lastTable?.key === key) {
      // Nothing has changed since the last time this was worked out.
      setColumns(lastTable.columns);
      setLoadFailed(false);
    } else {
      setRecomputing(true);
      try {
        const data = await getBalanceSheet(DEFAULT_USER_ID, columnSpecs);
        lastTable = { key, columns: data };
        setColumns(data);
        setLoadFailed(false);
      } catch (e) {
        console.warn("[balance-sheet] load failed", e);
        setLoadFailed(true);
      } finally {
        setRecomputing(false);
      }
    }
    await loadHistory();
  }, [columnSpecs, loadHistory]);
  useDataRefresh(loadTable);

  const fyStartMonthKey = useMemo(() => {
    const startMonth = getFYStartMonth();
    const start = getFYRange(getCurrentFY(startMonth), startMonth).start;
    return formatLocalDate(start).slice(0, 7);
  }, []);

  // Every earlier financial year that has data (newest first), worked out once. + lists the ones
  // not shown yet and asks which to add (owner, Nov 2026).
  const [yearsWithData, setYearsWithData] = useState<number[]>([]);
  const [yearSheetOpen, setYearSheetOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const MAX_LOOKBACK_YEARS = 25;
    (async () => {
      const startMonth = getFYStartMonth();
      const currentFY = getCurrentFY(startMonth);
      const found: number[] = [];
      for (let fy = currentFY - 1; fy >= currentFY - MAX_LOOKBACK_YEARS; fy--) {
        const range = getFYRange(fy, startMonth);
        try {
          if (await hasDataInRange(DEFAULT_USER_ID, formatLocalDate(range.start), formatLocalDate(range.end))) found.push(fy);
        } catch (e) {
          console.warn("[balance-sheet] year check failed", e);
        }
      }
      if (!cancelled) setYearsWithData(found);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const addableYears = useMemo(() => {
    const shown = new Set(columnSpecs.map((c) => c.fyYear).filter((y): y is number => y != null));
    return yearsWithData.filter((fy) => !shown.has(fy));
  }, [yearsWithData, columnSpecs]);

  const addFYColumn = useCallback(
    (fy: number) => {
      const startMonth = getFYStartMonth();
      const range = getFYRange(fy, startMonth);
      const newSpec: ColumnSpec = {
        asOfDate: formatLocalDate(range.end),
        label: getFYLabel(fy, startMonth),
        isLive: false,
        fyYear: fy,
        minDate: formatLocalDate(range.start),
      };
      // In date order: a year that ended before today sits to the left of Today, one after it to the right.
      setColumnSpecs([...columnSpecs, newSpec].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate)));
    },
    [columnSpecs],
  );

  const removeColumn = useCallback(
    (asOfDate: string) => {
      const spec = columnSpecs.find((c) => c.asOfDate === asOfDate);
      if (!spec || spec.isLive) return; // Live is not removable
      setColumnSpecs(columnSpecs.filter((c) => c.asOfDate !== asOfDate));
    },
    [columnSpecs],
  );

  const canAddEarlierFY = addableYears.length > 0;

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

  // Nested FD rows keyed by their parent savings row's label — see
  // BalanceSheetRow.children. Only assets ever carry children today.
  const childRowsByParent = useMemo(() => {
    const map = new Map<string, { label: string; group: string; accountId?: string }[]>();
    for (const col of columns) {
      for (const r of col.assets) {
        if (!r.children || r.children.length === 0) continue;
        const existing = map.get(r.label) ?? [];
        for (const c of r.children) {
          if (!existing.some((e) => e.label === c.label)) {
            existing.push({ label: c.label, group: c.group, accountId: c.accountId });
          }
        }
        map.set(r.label, existing);
      }
    }
    return map;
  }, [columns]);

  const toggleParent = (label: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

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

  // Sections within Assets/Liabilities — a presentational grouping over the
  // existing `group` values, no new data needed. An FD's "investment" group
  // only ever appears top-level as a fallback (see getBalanceSheetColumn —
  // normally it nests under its savings parent, already in Liquid Cash), so
  // Investments here in practice means Demat + Pension.
  const ASSET_SECTIONS = ["Liquid Cash", "Investments", "Receivables"] as const;
  const LIABILITY_SECTIONS = ["Credit", "Debt", "Payables"] as const;

  const assetSectionForGroup = (group: string): (typeof ASSET_SECTIONS)[number] => {
    switch (group) {
      case "savings":
      case "wallet":
        return "Liquid Cash";
      case "demat_portfolio":
      case "demat_fund":
      case "pension":
      case "investment":
        return "Investments";
      default:
        return "Receivables"; // hisaab_owed
    }
  };
  const liabilitySectionForGroup = (group: string): (typeof LIABILITY_SECTIONS)[number] => {
    switch (group) {
      case "cc":
        return "Credit";
      case "loan":
        return "Debt";
      default:
        return "Payables"; // hisaab_owes
    }
  };

  type RowMeta = { label: string; group: string; accountId?: string; personId?: string };

  const groupRows = <S extends string>(rows: RowMeta[], sections: readonly S[], sectionOf: (group: string) => S) => {
    const map = new Map<S, RowMeta[]>();
    for (const s of sections) map.set(s, []);
    for (const row of rows) map.get(sectionOf(row.group))!.push(row);
    return map;
  };

  const assetsBySection = useMemo(
    () => groupRows(assetRowLabels, ASSET_SECTIONS, assetSectionForGroup),
    [assetRowLabels],
  );
  const liabilitiesBySection = useMemo(
    () => groupRows(liabilityRowLabels, LIABILITY_SECTIONS, liabilitySectionForGroup),
    [liabilityRowLabels],
  );

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  /** Section subtotal for one column — includes nested children (an FD under its savings parent). */
  const getSectionTotal = (col: BalanceSheetColumn, section: "assets" | "liabilities", rows: RowMeta[]): number => {
    const pool = section === "assets" ? col.assets : col.liabilities;
    let total = 0;
    for (const row of rows) {
      const cell = pool.find((r) => r.label === row.label);
      if (!cell) continue;
      total += cell.amount + (cell.children?.reduce((s, c) => s + c.amount, 0) ?? 0);
    }
    return total;
  };

  const getCellValue = (col: BalanceSheetColumn, rowLabel: string, section: "assets" | "liabilities"): BalanceSheetRow | undefined => {
    const pool = section === "assets" ? col.assets : col.liabilities;
    return pool.find((r) => r.label === rowLabel);
  };

  const getChildCellValue = (col: BalanceSheetColumn, parentLabel: string, childLabel: string): BalanceSheetRow | undefined =>
    col.assets.find((r) => r.label === parentLabel)?.children?.find((c) => c.label === childLabel);

  /** Sum of a savings row's nested FD children for one column — "Deposits" shown inline under the row's own balance. */
  const getChildrenTotal = (col: BalanceSheetColumn, parentLabel: string): number =>
    col.assets.find((r) => r.label === parentLabel)?.children?.reduce((s, c) => s + c.amount, 0) ?? 0;

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
      return;
    }
    if (meta.group === "investment" && meta.accountId) {
      // No dedicated investment detail screen yet — the account ledger
      // already shows the maturity transfer/interest credit once materialised.
      router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: meta.accountId } });
    }
  };

  if (columns.length === 0) {
    return (
      <ScreenContainer padTop={false}>
        {loadFailed ? (
          <View className="flex-1 items-center justify-center px-8">
            <Ionicons name="alert-circle-outline" size={32} color={theme.danger} />
            <Text className="text-body font-semibold text-foreground mt-3 text-center">Couldn&apos;t work out your net worth</Text>
            <Text className="text-meta text-muted-foreground mt-1 text-center">Something went wrong reading your accounts. Try again.</Text>
            <View className="mt-4 w-40">
              <Button title="Try again" onPress={() => void loadTable()} />
            </View>
          </View>
        ) : (
          <LoadingState message="Loading net worth..." icon="scale-outline" />
        )}
      </ScreenContainer>
    );
  }

  const liveCol = columns.find((c) => c.isLive);
  const liveNetWorth = liveCol?.netWorth ?? 0;
  const hasTrend = history.length >= 2 || historyLoading;

  // With earlier years beside Today, amounts switch to the short lakh form so every column stays on one line.
  const multi = columns.length > 1;
  const money = (n: number) => (multi ? `${n < 0 ? "−" : ""}₹${formatCompact(Math.abs(n))}` : formatAmount(Math.round(n)));
  const colWidth = multi ? 84 : 124;
  const labelWidth = multi ? 132 : 172;
  const colLabel = (col: BalanceSheetColumn) => {
    if (col.isLive) return "Today";
    const [y, m, d] = col.asOfDate.split("-").map(Number);
    return `${d} ${SHORT_MONTHS[m - 1]} ${String(y).slice(2)}`;
  };

  const sectionHead = (title: string, open: boolean, onPress: () => void, totals: number[], tone: "own" | "owe") => (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-3 py-3 border-t border-border"
      style={{ backgroundColor: tone === "own" ? theme.alpha("primary", 0.04) : theme.alpha("foreground", 0.03) }}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
    >
      <View className="flex-row items-center" style={{ width: labelWidth }}>
        <Ionicons name={open ? "chevron-down" : "chevron-forward"} size={13} color={theme.mutedForeground} />
        <Text className="text-body font-bold text-foreground ml-1" numberOfLines={1}>
          {title}
        </Text>
      </View>
      {totals.map((t, i) => (
        <View key={i} style={{ width: colWidth }} className="items-end">
          <Text className="text-meta font-bold text-foreground" numberOfLines={1} style={{ fontVariant: ["tabular-nums"] }}>
            {money(t)}
          </Text>
        </View>
      ))}
      <View style={{ width: 28 }} />
    </Pressable>
  );

  const valueCell = (key: string, cell: BalanceSheetRow | undefined, sign: 1 | -1, small = false) => (
    <View key={key} style={{ width: colWidth }} className="items-end">
      <Text
        className={small ? "text-label" : "text-meta"}
        numberOfLines={1}
        style={{
          color: !cell || cell.isFallback ? theme.faintForeground : small ? theme.mutedForeground : theme.foreground,
          fontStyle: cell?.isFallback ? "italic" : "normal",
          fontVariant: ["tabular-nums"],
        }}
      >
        {!cell ? "-" : money(sign * cell.amount)}
      </Text>
    </View>
  );

  const table = (
    <View>
      {/* Header: Today, earlier years with ✕, and + for one more */}
      <View className="flex-row items-center px-3 py-2.5">
        <Text className="text-body font-bold text-foreground" style={{ width: labelWidth }} numberOfLines={1}>
          By account
        </Text>
        {columns.map((col) => (
          <View key={col.asOfDate} style={{ width: colWidth }} className="flex-row items-center justify-end">
            <Text
              className="text-label font-semibold uppercase tracking-wider"
              style={{ color: col.isLive ? theme.primary : theme.mutedForeground }}
              numberOfLines={1}
            >
              {colLabel(col)}
            </Text>
            {!col.isLive && (
              <Pressable
                onPress={() => removeColumn(col.asOfDate)}
                hitSlop={12}
                className="ml-1"
                accessibilityRole="button"
                accessibilityLabel={`Hide ${colLabel(col)}`}
              >
                <Ionicons name="close" size={14} color={theme.mutedForeground} />
              </Pressable>
            )}
          </View>
        ))}
        <Pressable
          onPress={canAddEarlierFY ? () => setYearSheetOpen(true) : undefined}
          hitSlop={10}
          className="ml-1 w-7 h-7 rounded-control border items-center justify-center"
          style={{ borderColor: canAddEarlierFY ? theme.primary : theme.border }}
          accessibilityRole="button"
          accessibilityLabel={
            canAddEarlierFY ? "Add a financial year" : "No earlier financial year with data"
          }
          accessibilityState={{ disabled: !canAddEarlierFY }}
          disabled={!canAddEarlierFY}
        >
          <Ionicons name="add" size={16} color={canAddEarlierFY ? theme.primary : theme.faintForeground} />
        </Pressable>
      </View>

      {/* What you own */}
      {sectionHead("What you own", showAssets, () => setShowAssets(!showAssets), columns.map((c) => c.totalAssets), "own")}
      {showAssets &&
        ASSET_SECTIONS.map((section) => {
          const rows = assetsBySection.get(section) ?? [];
          if (rows.length === 0) return null;
          const open = !collapsedSections.has(section);
          return (
            <View key={`sec-a-${section}`}>
              <Pressable
                onPress={() => toggleSection(section)}
                className="flex-row items-center px-3 border-t border-border"
                style={{ minHeight: 52 }}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${SECTION_NAME[section]}, ${rows.length} accounts`}
              >
                <View style={{ width: labelWidth }}>
                  <Text className="text-body font-semibold text-foreground" numberOfLines={1}>
                    {SECTION_NAME[section]}
                  </Text>
                  {!multi && (
                    <Text className="text-label text-muted-foreground" numberOfLines={1}>
                      {SECTION_HINT[section]}
                    </Text>
                  )}
                </View>
                {columns.map((col) => (
                  <View key={col.asOfDate} style={{ width: colWidth }} className="items-end">
                    <Text className="text-meta font-semibold text-foreground" numberOfLines={1} style={{ fontVariant: ["tabular-nums"] }}>
                      {money(getSectionTotal(col, "assets", rows))}
                    </Text>
                  </View>
                ))}
                <View style={{ width: 28 }} className="items-end">
                  <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color={theme.faintForeground} />
                </View>
              </Pressable>
              {open &&
                rows.map((row) => {
                  const children = childRowsByParent.get(row.label) ?? [];
                  const hasChildren = children.length > 0;
                  const expanded = expandedParents.has(row.label);
                  return (
                    <View key={`a-${row.label}`}>
                      <Pressable
                        onPress={() => (hasChildren ? toggleParent(row.label) : handleRowPress(row))}
                        className="flex-row items-center px-3 py-2.5"
                        style={{ backgroundColor: theme.alpha("foreground", 0.02) }}
                        accessibilityRole="button"
                        accessibilityState={hasChildren ? { expanded } : undefined}
                        accessibilityLabel={hasChildren ? `${row.label}, with fixed deposits` : `${row.label}, open accounts`}
                      >
                        <Text className="text-meta text-foreground" numberOfLines={1} style={{ width: labelWidth, paddingLeft: 12 }}>
                          {row.label}
                        </Text>
                        {columns.map((col) => {
                          const cell = getCellValue(col, row.label, "assets");
                          const deposits = hasChildren ? getChildrenTotal(col, row.label) : 0;
                          // One figure, as on any account: the balance and its deposits together.
                          const shown = cell ? cell.amount + deposits : deposits > 0 ? deposits : null;
                          return (
                            <View key={col.asOfDate} style={{ width: colWidth }} className="items-end">
                              <Text
                                className="text-meta"
                                numberOfLines={1}
                                style={{
                                  color: shown == null || cell?.isFallback ? theme.faintForeground : theme.foreground,
                                  fontStyle: cell?.isFallback ? "italic" : "normal",
                                  fontVariant: ["tabular-nums"],
                                }}
                              >
                                {shown == null ? "-" : money(shown)}
                              </Text>
                            </View>
                          );
                        })}
                        <View style={{ width: 28 }} className="items-end">
                          <Ionicons
                            name={hasChildren ? (expanded ? "chevron-up" : "chevron-down") : "chevron-forward"}
                            size={13}
                            color={theme.faintForeground}
                          />
                        </View>
                      </Pressable>
                      {hasChildren && expanded && (
                        <Pressable
                          onPress={() =>
                            row.accountId
                              ? router.push({ pathname: "/reconciliation/account-ledger", params: { accountId: row.accountId } })
                              : handleRowPress(row)
                          }
                          className="flex-row items-center px-3 py-2"
                          style={{ backgroundColor: theme.alpha("foreground", 0.03) }}
                          accessibilityRole="button"
                          accessibilityLabel={`${row.label} balance, open ledger`}
                        >
                          <Text className="text-label text-muted-foreground" numberOfLines={1} style={{ width: labelWidth, paddingLeft: 24 }}>
                            Account balance
                          </Text>
                          {columns.map((col) => valueCell(col.asOfDate, getCellValue(col, row.label, "assets"), 1, true))}
                          <View style={{ width: 28 }} className="items-end">
                            <Ionicons name="chevron-forward" size={13} color={theme.faintForeground} />
                          </View>
                        </Pressable>
                      )}
                      {hasChildren &&
                        expanded &&
                        children.map((child) => (
                          <Pressable
                            key={`a-${row.label}-${child.label}`}
                            onPress={() => handleRowPress(child)}
                            className="flex-row items-center px-3 py-2"
                            style={{ backgroundColor: theme.alpha("foreground", 0.03) }}
                            accessibilityRole="button"
                            accessibilityLabel={`${child.label}, open ledger`}
                          >
                            <Text className="text-label text-muted-foreground" numberOfLines={1} style={{ width: labelWidth, paddingLeft: 24 }}>
                              {child.label}
                            </Text>
                            {columns.map((col) => valueCell(col.asOfDate, getChildCellValue(col, row.label, child.label), 1, true))}
                            <View style={{ width: 28 }} className="items-end">
                              <Ionicons name="chevron-forward" size={13} color={theme.faintForeground} />
                            </View>
                          </Pressable>
                        ))}
                    </View>
                  );
                })}
            </View>
          );
        })}

      {/* What you owe: shown as minus amounts */}
      {sectionHead("What you owe", showLiabilities, () => setShowLiabilities(!showLiabilities), columns.map((c) => -c.totalLiabilities), "owe")}
      {showLiabilities &&
        LIABILITY_SECTIONS.map((section) => {
          const rows = liabilitiesBySection.get(section) ?? [];
          if (rows.length === 0) return null;
          const open = !collapsedSections.has(section);
          return (
            <View key={`sec-l-${section}`}>
              <Pressable
                onPress={() => toggleSection(section)}
                className="flex-row items-center px-3 border-t border-border"
                style={{ minHeight: 52 }}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${SECTION_NAME[section]}, ${rows.length} accounts`}
              >
                <View style={{ width: labelWidth }}>
                  <Text className="text-body font-semibold text-foreground" numberOfLines={1}>
                    {SECTION_NAME[section]}
                  </Text>
                  {!multi && (
                    <Text className="text-label text-muted-foreground" numberOfLines={1}>
                      {SECTION_HINT[section]}
                    </Text>
                  )}
                </View>
                {columns.map((col) => (
                  <View key={col.asOfDate} style={{ width: colWidth }} className="items-end">
                    <Text className="text-meta font-semibold text-foreground" numberOfLines={1} style={{ fontVariant: ["tabular-nums"] }}>
                      {money(-getSectionTotal(col, "liabilities", rows))}
                    </Text>
                  </View>
                ))}
                <View style={{ width: 28 }} className="items-end">
                  <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color={theme.faintForeground} />
                </View>
              </Pressable>
              {open &&
                rows.map((row) => (
                  <Pressable
                    key={`l-${row.label}`}
                    onPress={() => handleRowPress(row)}
                    className="flex-row items-center px-3 py-2.5"
                    style={{ backgroundColor: theme.alpha("foreground", 0.02) }}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.label}, open accounts`}
                  >
                    <Text className="text-meta text-foreground" numberOfLines={1} style={{ width: labelWidth, paddingLeft: 12 }}>
                      {row.label}
                    </Text>
                    {columns.map((col) => valueCell(col.asOfDate, getCellValue(col, row.label, "liabilities"), -1))}
                    <View style={{ width: 28 }} className="items-end">
                      <Ionicons name="chevron-forward" size={13} color={theme.faintForeground} />
                    </View>
                  </Pressable>
                ))}
            </View>
          );
        })}

      {/* Net worth = what you own − what you owe */}
      <View className="flex-row items-center px-3 py-3.5 border-t border-border" style={{ backgroundColor: theme.alpha("primary", 0.06) }}>
        <View style={{ width: labelWidth }}>
          <Text className="text-body font-bold text-foreground">Net worth</Text>
          {!multi && <Text className="text-label text-muted-foreground">What you own minus what you owe</Text>}
        </View>
        {columns.map((col) => (
          <View key={col.asOfDate} style={{ width: colWidth }} className="items-end">
            <Text
              className="text-body font-bold"
              numberOfLines={1}
              style={{ color: col.netWorth < 0 ? theme.danger : theme.foreground, fontVariant: ["tabular-nums"] }}
            >
              {money(col.netWorth)}
            </Text>
          </View>
        ))}
        <View style={{ width: 28 }} />
      </View>
    </View>
  );

  return (
    <ScreenContainer padTop={false}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, paddingTop: 12 }}>
        {/* Net worth today: the trend card carries it; this stands in when there's no history yet. */}
        {!hasTrend && (
          <Card className="mx-4 mb-2">
            <Text className="text-meta text-muted-foreground">Net worth today</Text>
            <View className="flex-row items-center" style={{ opacity: recomputing ? 0.55 : 1 }}>
              {liveNetWorth < 0 && <Ionicons name="warning-outline" size={20} color={theme.danger} style={{ marginRight: 6 }} />}
              <Text className="text-hero font-bold" style={{ color: liveNetWorth < 0 ? theme.danger : theme.foreground }}>
                {formatAmount(Math.round(liveNetWorth))}
              </Text>
            </View>
          </Card>
        )}

        <NetWorthTrendCard points={history} fyStartMonth={fyStartMonthKey} loading={historyLoading} />

        <View className="mx-4 mb-2 rounded-card bg-card border border-border overflow-hidden" style={{ opacity: recomputing ? 0.55 : 1 }}>
          {recomputing && (
            <View className="flex-row items-center px-3 pt-2.5" style={{ gap: 6 }}>
              <ActivityIndicator size="small" color={theme.primary} />
              <Text className="text-label font-semibold" style={{ color: theme.primary }}>
                Updating…
              </Text>
            </View>
          )}
          {columns.length > 2 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator>
              {table}
            </ScrollView>
          ) : (
            table
          )}
          <Text className="text-label text-muted-foreground px-3 pb-3 pt-1">
            {!multi
              ? "Tap + to add a financial year: it shows how things stood at that year's end. Tap a row to open those accounts."
              : canAddEarlierFY
                ? "Tap + for another year, ✕ to hide one."
                : "No earlier financial year with data. Tap ✕ to hide a year."}
          </Text>
        </View>

        {/* Which Hisaab people count towards net worth */}
        <View className="mx-4 mb-2 rounded-card bg-card border border-border overflow-hidden">
          <LinkRow
            divider={false}
            icon="people-outline"
            color={theme.primary}
            title="Hisaab in net worth"
            sub="Choose whose balances count"
            onPress={() => setHisaabSheetOpen(true)}
          />
        </View>

        {/* Caveats footer */}
        <View className="mx-4 mb-2 flex-row items-start px-1" style={{ gap: 8 }}>
          <Ionicons name="information-circle-outline" size={14} color={theme.mutedForeground} style={{ marginTop: 1 }} />
          <Text className="flex-1 text-label text-muted-foreground">
            A &quot;-&quot; means no data for that row in that period. For demat, it means no portfolio or fund snapshot was recorded within
            that financial year. Grey italic values fall back to the last bank-message balance when the ledger opening isn&apos;t set:
            set the openings to make them exact.
          </Text>
        </View>
      </ScrollView>
      <HisaabNetWorthSheet visible={hisaabSheetOpen} onClose={() => setHisaabSheetOpen(false)} />
      <PickerSheet
        visible={yearSheetOpen}
        onClose={() => setYearSheetOpen(false)}
        title="Add a financial year"
        sections={[
          {
            key: "years",
            items: addableYears.map((fy) => {
              const startMonth = getFYStartMonth();
              const end = getFYRange(fy, startMonth).end;
              return {
                id: String(fy),
                label: getFYLabel(fy, startMonth),
                sub: `As on ${end.getDate()} ${SHORT_MONTHS[end.getMonth()]} ${end.getFullYear()}`,
                icon: "calendar-outline" as const,
                color: theme.primary,
              };
            }),
          },
        ]}
        selectedId={null}
        onSelect={(id) => {
          setYearSheetOpen(false);
          if (id) addFYColumn(Number(id));
        }}
        searchPlaceholder="Search years"
        noun={{ one: "year", many: "years" }}
      />
    </ScreenContainer>
  );
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SECTION_NAME: Record<string, string> = {
  "Liquid Cash": "Cash",
  Investments: "Investments",
  Receivables: "Owed to you",
  Credit: "Card dues",
  Debt: "Loans",
  Payables: "You owe people",
};
const SECTION_HINT: Record<string, string> = {
  "Liquid Cash": "Banks, wallets and their FDs",
  Investments: "Demat, funds, pension",
  Receivables: "People owe you",
  Credit: "Credit cards",
  Debt: "Left to repay",
  Payables: "You owe people",
};
