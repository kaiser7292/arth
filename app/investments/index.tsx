import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, ScrollView, Pressable, TextInput } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, EmptyState, FAB, ProgressBar, ScreenContainer, Text } from "@/components/ui";
import { AnimatedNumber, Appear, PressableScale, SegmentedControl } from "@/components/motion";
import { StackedAreaChart, type StackedLayer } from "@/components/charts/StackedAreaChart";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { DEFAULT_USER_ID } from "@/constants/app";
import { DATA_HEX } from "@/constants/brand";
import {
  batchInvestmentProducts,
  getUnifiedInvestmentValues,
  getUpcomingFDMaturities,
  isDematLikeAccount,
  isFDIncomplete,
  isPensionLikeAccount,
  INSTRUMENT_LABELS,
  type InvestmentProduct,
  type UpcomingFDMaturity,
  withoutFinishedInvestments,
} from "@/services/investment-accounts";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { formatAmount } from "@/utils/format";
import { formatDate, formatRelativeDateTime } from "@/utils/date";
import { getLastSyncRun, SYNC_BROKER_NAMES, type LastSyncRun } from "@/services/broker-sync";
import { useTheme } from "@/hooks/use-theme";
import { consumeInvestmentsPreload } from "@/services/home-preload";
import { Money } from "@/components/ui/Text";
import { getPeriodTrend, TREND_PERIODS, type PeriodTrend, type TrendPeriod } from "@/services/investment-trend";
import { averageRate, fdLadder, getIdleCash, type IdleCash } from "@/services/investments-view";
import { FdLadderCard, GlanceTiles, IdleCashCard } from "@/components/investments/InvestmentCards";

const preloaded = consumeInvestmentsPreload();

type InvestmentGroup = "fd" | "market" | "pension";

interface InvestmentRow {
  account: FinancialAccount;
  product: InvestmentProduct | null;
  value: number;
  group: InvestmentGroup;
}

function buildRows(
  accounts: FinancialAccount[],
  products: Map<string, InvestmentProduct>,
  values: Map<string, number>,
): InvestmentRow[] {
  return accounts.map((account) => {
    const product = products.get(account.id) ?? null;
    const group: InvestmentGroup = isDematLikeAccount(account, product)
      ? "market"
      : isPensionLikeAccount(account, product)
        ? "pension"
        : "fd";
    return { account, product, value: values.get(account.id) ?? 0, group };
  });
}

const GROUP_META: Record<InvestmentGroup, { label: string; short: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  fd: { label: "Fixed Deposits", short: "FD", icon: "cash-outline", color: DATA_HEX.series[1] },
  market: { label: "Market (Demat)", short: "Market", icon: "trending-up-outline", color: DATA_HEX.series[2] },
  pension: { label: "Pension", short: "Pension", icon: "briefcase-outline", color: DATA_HEX.series[0] },
};
const GROUP_ORDER: InvestmentGroup[] = ["fd", "market", "pension"];

/** "Last synced today, 5:12 pm · 3 of 3 brokers", or what's behind ("Zerodha needs login"). */
function lastSyncText(run: LastSyncRun): { text: string; behind: boolean } {
  const when = `Last synced ${formatRelativeDateTime(run.at)}`;
  if (run.behind.length > 0) {
    const first = run.behind[0];
    const name = SYNC_BROKER_NAMES[first.broker];
    const more = run.behind.length > 1 ? ` +${run.behind.length - 1}` : "";
    return { text: `${when} · ${name} ${first.reason === "needs_login" ? "needs login" : "not updated"}${more}`, behind: true };
  }
  const n = run.brokers.length;
  return { text: `${when} · ${n === 1 ? SYNC_BROKER_NAMES[run.brokers[0]] : `${n} of ${n} brokers`}`, behind: false };
}

export default function InvestmentsListScreen() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();
  const [rows, setRows] = useState<InvestmentRow[]>(() =>
    preloaded ? buildRows(preloaded.accounts, preloaded.products, preloaded.values) : [],
  );
  const [maturities, setMaturities] = useState<UpcomingFDMaturity[]>(preloaded?.maturities ?? []);
  const [loaded, setLoaded] = useState(preloaded != null);
  /** null = all categories stacked; a group = that category's accounts stacked. */
  const [focus, setFocus] = useState<InvestmentGroup | null>(null);
  /** How far back the chart looks (days are drawn daily, 6M weekly, years monthly). */
  const [period, setPeriod] = useState<TrendPeriod>("6M");
  const [trend, setTrend] = useState<PeriodTrend | null>(null);
  /** The point under the finger while dragging along the chart; null otherwise. */
  const [scrub, setScrub] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<LastSyncRun | null>(null);
  const [idle, setIdle] = useState<IdleCash[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  /** Counts loads, so an older idle-cash answer can't land over a newer one. */
  const loadSeq = useRef(0);
  /** A tile opens its part of the screen, from the top, where the chart shows it. */
  const showGroup = (g: InvestmentGroup) => {
    setFocus(g);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };
  /** Account groups the person opened or closed (the default depends on how many accounts there are). */
  const [opened, setOpened] = useState<Map<string, boolean>>(new Map());
  const [accountSearch, setAccountSearch] = useState("");
  const [groupBy, setGroupBy] = useState<"type" | "institution">("type");

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const allAccounts = await getActiveAccounts(DEFAULT_USER_ID);
    const investmentLike = allAccounts.filter(
      (a) => a.account_type === "investment" || a.account_type === "demat" || a.account_type === "pension",
    );
    const ids = investmentLike.filter((a) => a.account_type === "investment").map((a) => a.id);
    const products = await batchInvestmentProducts(ids);
    // Matured / closed FDs aren't shown (their money is back in the bank).
    const accounts = withoutFinishedInvestments(investmentLike, products);
    const [values, upcoming] = await Promise.all([
      getUnifiedInvestmentValues(DEFAULT_USER_ID, accounts, products),
      // Every scheduled maturity, for the FD ladder (it was the next 5 when maturities were a list).
      getUpcomingFDMaturities(DEFAULT_USER_ID, 1000),
    ]);

    // Only for the line under the value; never in the way of the screen.
    getLastSyncRun().then(setLastSync).catch(() => setLastSync(null));
    const built = buildRows(accounts, products, values);
    setRows(built);
    setMaturities(upcoming);
    setLoaded(true);
    // Idle cash is only a card: a failure here never blanks the screen.
    getIdleCash(built.filter((r) => r.group === "market").map((r) => r.account.id))
      .then((v) => seq === loadSeq.current && setIdle(v))
      .catch(() => seq === loadSeq.current && setIdle([]));
  }, []);

  useDataRefresh(load);

  const total = rows.reduce((sum, r) => sum + r.value, 0);

  const groupTotals = useMemo(() => {
    const totals: Record<InvestmentGroup, number> = { fd: 0, market: 0, pension: 0 };
    for (const r of rows) totals[r.group] += r.value;
    return totals;
  }, [rows]);

  // The FD ladder: open FDs only (a matured or closed FD's money is back in the bank).
  const ladder = useMemo(() => {
    const openIds = new Set(rows.filter((r) => r.group === "fd").map((r) => r.account.id));
    const rates = new Map(rows.filter((r) => r.product).map((r) => [r.account.id, r.product!.interest_rate_pa]));
    return fdLadder(maturities.filter((m) => openIds.has(m.financialAccountId)), rates);
  }, [maturities, rows]);
  const fdRows = rows.filter((r) => r.group === "fd");
  const fdAverage = averageRate(fdRows.map((r) => ({ principal: r.product?.principal ?? null, rate: r.product?.interest_rate_pa ?? null })));
  const idleTotal = idle.reduce((s, i) => s + i.amount, 0);
  const nameOf = (id: string) => {
    const r = rows.find((x) => x.account.id === id);
    return r ? accountName(r.account) : "Account";
  };

  const activeGroups = GROUP_ORDER.filter((g) => groupTotals[g] > 0);
  // A category that's since emptied out (e.g. its only account closed) drops back to All.
  const view: InvestmentGroup | null = focus && groupTotals[focus] > 0 ? focus : null;
  const viewRows = useMemo(
    () => (view ? rows.filter((r) => r.group === view).sort((x, y) => y.value - x.value) : []),
    [rows, view],
  );
  const viewTotal = view ? groupTotals[view] : total;

  // Every account's history over the chosen period - the slow part, so the list shows first and
  // the chart fills in. Reloads when the period, the accounts or their values change.
  const rowsKey = rows.map((r) => `${r.account.id}:${r.value}`).join("|");
  useEffect(() => {
    let live = true;
    getPeriodTrend(
      rows.map((r) => r.account),
      new Map(rows.filter((r) => r.product).map((r) => [r.account.id, r.product!])),
      new Map(rows.map((r) => [r.account.id, r.value])),
      period,
    )
      .then((t) => live && setTrend(t))
      .catch(() => live && setTrend(null));
    return () => {
      live = false;
    };
    // rows are captured through rowsKey (ids and values), so a re-render with the same rows doesn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, rowsKey]);
  const periodMeta = TREND_PERIODS.find((p) => p.value === period)!;
  /** The chart for the selected period, once loaded for it. */
  const chart = trend?.period === period ? trend : null;

  // Bands, bottom first. All: one per category (its accounts summed). A category: one per
  // account, shaded from the category's colour (biggest account darkest) so it still reads as it.
  const layers = useMemo<StackedLayer[]>(() => {
    if (!chart) return [];
    const zeros = chart.points.map(() => 0);
    const valuesOf = (id: string) => chart.byAccount[id] ?? zeros;
    if (!view) {
      return GROUP_ORDER.map((g) => {
        const values = zeros.map((_, i) => rows.filter((r) => r.group === g).reduce((sum, r) => sum + valuesOf(r.account.id)[i], 0));
        return { key: g, label: GROUP_META[g].label, color: GROUP_META[g].color, values };
      }).filter((l) => l.values.some((v) => v > 0));
    }
    return [...viewRows].reverse().map((r) => ({
      key: r.account.id,
      label: accountName(r.account),
      color: GROUP_META[view].color,
      opacity: shadeFor(viewRows.indexOf(r)),
      values: valuesOf(r.account.id),
    }));
  }, [chart, view, viewRows, rows]);

  const valueAt = (i: number) => layers.reduce((sum, l) => sum + (l.values[i] ?? 0), 0);
  const start = chart && layers.length > 0 ? valueAt(0) : null;
  // While dragging: the value on that date and the change from the period's start to it, like a
  // stock chart. Otherwise today's value and the change over the period.
  const scrubbing = scrub != null && chart != null && scrub < chart.points.length;
  const shownValue = scrubbing ? valueAt(scrub!) : viewTotal;
  const change = start == null ? null : shownValue - start;
  const changePct = start != null && start > 0 && change != null ? (change / start) * 100 : null;
  const pointLabel = (date: string) =>
    chart?.unit === "month" ? new Date(date).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : formatDate(date);
  // "past month", "since 9 Aug" when the history starts inside the period, or the dragged-to date.
  const changePhrase = scrubbing
    ? pointLabel(chart!.points[scrub!])
    : chart && !chart.coversPeriod && period !== "Max"
      ? `since ${formatDate(chart.points[0])}`
      : periodMeta.phrase;

  const pct = (value: number, of: number) => (of > 0 ? Math.round((value / of) * 100) : 0);
  /** A band's value at the dragged-to point, so the breakdown below follows the finger too. */
  const layerAt = (key: string) => (scrubbing ? layers.find((l) => l.key === key)?.values[scrub!] ?? 0 : 0);

  const handlePress = (row: InvestmentRow) => {
    if (row.group === "market") {
      router.push({ pathname: "/demat/snapshots/[id]", params: { id: row.account.id } });
    } else if (row.group === "pension") {
      router.push("/reconciliation/pension-accounts");
    } else {
      // FD — no separate ledger view; tap straight into its editable properties.
      router.push({ pathname: "/settings/account-detail", params: { accountId: row.account.id } });
    }
  };

  return (
    <ScreenContainer padTop={false}>
      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {loaded && rows.length === 0 ? (
          <EmptyState
            icon="trending-up-outline"
            title="No investment accounts yet"
            subtitle="Add a demat, pension, or fixed deposit account to start tracking it here."
          />
        ) : (
          <>
            {/* Value over the chosen period as stacked bands - the top edge is the total, each band's
                thickness its share. Drag along it to read any date; tap a band, chip or legend row
                to see that category's accounts; tap an account to open it. */}
            <Appear index={0}>
            <Card className="mx-4 mt-4">
              <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                {view ? `${GROUP_META[view].label} value` : "Total value"}
              </Text>
              {/* Counts up when the screen opens and glides to a category's value; while dragging along
                  the chart it follows the finger exactly (no glide). */}
              <View className="flex-row items-center">
                <View className="flex-1 mr-2">
                  {scrubbing ? (
                    <Money value={shownValue} className="text-title font-bold text-foreground" />
                  ) : (
                    <AnimatedNumber value={viewTotal} className="text-title font-bold text-foreground" />
                  )}
                </View>
                {rows.some((r) => r.group === "market") && (
                  <Pressable
                    onPress={() => router.push("/investments/sync-review")}
                    hitSlop={8}
                    className="flex-row items-center ml-3"
                    accessibilityRole="button"
                    accessibilityLabel="Sync investments and see how they moved"
                  >
                    <Ionicons name="sync-outline" size={14} color={theme.mutedForeground} />
                    <Text className="text-label text-muted-foreground ml-1">Sync</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => router.push("/investments/projections")}
                  hitSlop={8}
                  className="flex-row items-center ml-3"
                  accessibilityRole="button"
                  accessibilityLabel="See projections"
                >
                  <Ionicons name="analytics-outline" size={14} color={theme.mutedForeground} />
                  <Text className="text-label text-muted-foreground ml-1">Projections</Text>
                </Pressable>
              </View>
              {change != null && (Math.abs(change) >= 1 || scrubbing) ? (
                <Text className="text-label mt-0.5" style={{ color: change >= 0 ? theme.success : theme.danger }}>
                  {change >= 0 ? "+" : "−"}{formatAmount(Math.abs(change))}
                  {changePct != null ? ` (${change >= 0 ? "+" : "−"}${Math.abs(changePct).toFixed(1)}%)` : ""}
                  <Text className="text-label text-muted-foreground"> {changePhrase}</Text>
                </Text>
              ) : null}
              {lastSync && rows.some((r) => r.group === "market") && (() => {
                const line = lastSyncText(lastSync);
                return (
                  <Pressable
                    onPress={() => router.push("/investments/sync-review")}
                    hitSlop={6}
                    className="flex-row items-center mt-1"
                    accessibilityRole="button"
                    accessibilityLabel={`${line.text}. Sync investments`}
                  >
                    <Ionicons name="time-outline" size={12} color={line.behind ? theme.warning : theme.mutedForeground} />
                    <Text
                      className={`text-label ml-1 flex-1 ${line.behind ? "" : "text-faint-foreground"}`}
                      style={line.behind ? { color: theme.warning } : undefined}
                      numberOfLines={1}
                    >
                      {line.text}
                    </Text>
                  </Pressable>
                );
              })()}

              {activeGroups.length > 1 && (
                <SegmentedControl
                  className="mt-3"
                  accessibilityLabel="Show category"
                  options={[{ value: "all", label: "All" }, ...activeGroups.map((g) => ({ value: g, label: GROUP_META[g].short }))]}
                  value={view ?? "all"}
                  onChange={(v) => setFocus(v === "all" ? null : (v as InvestmentGroup))}
                />
              )}

              {/* How far back to look - the same ranges as a stock chart (5D to Max). */}
              <SegmentedControl
                className="mt-2"
                accessibilityLabel="Period"
                options={TREND_PERIODS.map((p) => ({ value: p.value, label: p.label }))}
                value={period}
                onChange={setPeriod}
              />

              <View className="mt-3">
                {chart ? (
                  <StackedAreaChart
                    key={`${view ?? "all"}-${period}`}
                    months={chart.points}
                    dateLabels={chart.unit === "month" ? "month" : "day"}
                    layers={layers}
                    onLayerPress={view ? undefined : (key) => setFocus(key as InvestmentGroup)}
                    onScrub={setScrub}
                  />
                ) : (
                  <View className="items-center justify-center" style={{ height: 150 }}>
                    <Ionicons name="analytics-outline" size={28} color={theme.mutedForeground} />
                    <Text className="text-label text-muted-foreground mt-2">Loading history…</Text>
                  </View>
                )}
              </View>

              <View className="mt-2">
                {view == null
                  ? [...activeGroups].reverse().map((g) => (
                      <LegendRow
                        key={g}
                        color={GROUP_META[g].color}
                        label={GROUP_META[g].label}
                        amount={scrubbing ? layerAt(g) : groupTotals[g]}
                        percent={scrubbing ? pct(layerAt(g), shownValue) : pct(groupTotals[g], total)}
                        onPress={() => setFocus(g)}
                        hint={`Show ${GROUP_META[g].label} accounts`}
                      />
                    ))
                  : viewRows.map((r, i) => (
                      <LegendRow
                        key={r.account.id}
                        color={GROUP_META[view].color}
                        opacity={shadeFor(i)}
                        label={accountName(r.account)}
                        amount={scrubbing ? layerAt(r.account.id) : r.value}
                        percent={scrubbing ? pct(layerAt(r.account.id), shownValue) : pct(r.value, viewTotal)}
                        onPress={() => handlePress(r)}
                        hint={`Open ${accountName(r.account)}`}
                      />
                    ))}
              </View>
              {view == null && activeGroups.length > 1 && (
                <Text className="text-label text-faint-foreground mt-1">Tap a band or category to see its accounts</Text>
              )}
            </Card>
            </Appear>

            {/* Under the chart (docs/INVESTMENTS_VIEW_PROPOSAL.md): a glance, idle cash, the FD ladder.
                Upcoming maturities is part of the ladder now, so FDs don't show twice. */}
            {view == null && (
              <GlanceTiles
                tiles={[
                  { key: "value", label: "Value now", value: total },
                  { key: "idle", label: "Idle cash", value: idleTotal, onPress: groupTotals.market > 0 ? () => showGroup("market") : undefined },
                  { key: "back", label: "Back in 90 days", value: ladder.next90, onPress: groupTotals.fd > 0 ? () => showGroup("fd") : undefined },
                  { key: "interest", label: "FD interest to come", value: ladder.interestToCome, onPress: groupTotals.fd > 0 ? () => showGroup("fd") : undefined },
                ]}
              />
            )}
            {(view == null || view === "market") && (
              <IdleCashCard
                items={idle}
                nameOf={nameOf}
                onOpen={(id) => router.push({ pathname: "/demat/snapshots/[id]", params: { id } })}
              />
            )}
            {(view == null || view === "fd") && fdRows.length > 0 && (ladder.buckets.length > 0 || ladder.overdue.length > 0) && (
              <FdLadderCard
                ladder={ladder}
                count={fdRows.length}
                total={groupTotals.fd}
                averageRate={fdAverage}
                onOpen={(accountId) => router.push({ pathname: "/settings/account-detail", params: { accountId } })}
              />
            )}

            {/* Accounts: groups fold (folded by default past 5 accounts), with their count and total;
                search and Group by once there are 8 or more. */}
            {(() => {
              const many = rows.length >= 8;
              const q = accountSearch.trim().toLowerCase();
              const shownRows = rows
                .filter((r) => !view || r.group === view)
                .filter((r) => !q || accountName(r.account).toLowerCase().includes(q) || (r.account.bank_name ?? "").toLowerCase().includes(q));
              const groups: { key: string; label: string; color: string; icon: keyof typeof Ionicons.glyphMap; rows: InvestmentRow[] }[] =
                groupBy === "institution" && many
                  ? [...new Set(shownRows.map((r) => r.account.bank_name || "Other"))]
                      .map((bank) => ({
                        key: `bank:${bank}`,
                        label: bank,
                        color: theme.mutedForeground,
                        icon: "business-outline" as const,
                        rows: shownRows.filter((r) => (r.account.bank_name || "Other") === bank),
                      }))
                      .sort((a, b) => b.rows.reduce((s2, r) => s2 + r.value, 0) - a.rows.reduce((s2, r) => s2 + r.value, 0))
                  : GROUP_ORDER.map((g) => ({ key: g, label: GROUP_META[g].label, color: GROUP_META[g].color, icon: GROUP_META[g].icon, rows: shownRows.filter((r) => r.group === g) }));
              // A search shows every match; otherwise what you chose, else folded once there are 6+.
              const isOpen = (key: string) => (q ? true : opened.get(key) ?? rows.length <= 5);
              return (
                <>
                  <View className="mx-4 mt-5 mb-2 flex-row items-center" style={{ gap: 8 }}>
                    <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground flex-1">
                      Accounts · {shownRows.length}
                    </Text>
                    {many && (
                      <Pressable
                        onPress={() => setGroupBy((g) => (g === "type" ? "institution" : "type"))}
                        className="rounded-control border border-border bg-card px-3 py-1.5"
                        accessibilityRole="button"
                        accessibilityLabel={`Group by ${groupBy === "type" ? "type" : "institution"}. Tap to change`}
                      >
                        <Text className="text-label font-semibold text-foreground">Group: {groupBy === "type" ? "Type" : "Institution"}</Text>
                      </Pressable>
                    )}
                  </View>
                  {many && (
                    <View className="mx-4 mb-2 flex-row items-center rounded-control border border-border bg-card px-3" style={{ gap: 8 }}>
                      <Ionicons name="search-outline" size={16} color={theme.mutedForeground} />
                      <TextInput
                        value={accountSearch}
                        onChangeText={setAccountSearch}
                        placeholder="Search accounts"
                        placeholderTextColor={theme.mutedForeground}
                        className="flex-1 py-2 text-body text-foreground"
                        accessibilityLabel="Search accounts"
                      />
                    </View>
                  )}
                  {groups.map((grp) => {
                    if (grp.rows.length === 0) return null;
                    const sum = grp.rows.reduce((s2, r) => s2 + r.value, 0);
                    const open = isOpen(grp.key);
                    return (
                      <Card key={grp.key} className="mx-4 mb-2 py-1">
                        <Pressable
                          onPress={() => setOpened((prev) => new Map(prev).set(grp.key, !open))}
                          className="flex-row items-center py-2.5"
                          style={{ gap: 10 }}
                          accessibilityRole="button"
                          accessibilityState={{ expanded: open }}
                          accessibilityLabel={`${grp.label}, ${grp.rows.length} account${grp.rows.length === 1 ? "" : "s"}, ${formatAmount(Math.round(sum))}`}
                        >
                          <View className="w-2.5 h-2.5 rounded-pill" style={{ backgroundColor: grp.color }} />
                          <View className="flex-1">
                            <Text className="text-body font-semibold text-foreground" numberOfLines={1}>{grp.label}</Text>
                            <Text className="text-label text-muted-foreground">
                              {grp.rows.length} account{grp.rows.length === 1 ? "" : "s"}
                              {total > 0 ? ` · ${pct(sum, total)}%` : ""}
                            </Text>
                          </View>
                          <Text className="text-body font-bold text-foreground">{formatAmount(Math.round(sum))}</Text>
                          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color={theme.mutedForeground} />
                        </Pressable>
                        {open &&
                          [...grp.rows].sort((a, b) => b.value - a.value).map((row) => {
                            const { account, product } = row;
                            const name = accountName(account);
                            const sub =
                              row.group === "fd"
                                ? product && isFDIncomplete(product)
                                  ? "Rate & maturity not set"
                                  : product?.maturity_date
                                    ? `Matures ${formatDate(product.maturity_date)}`
                                    : product?.instrument
                                      ? INSTRUMENT_LABELS[product.instrument] ?? product.instrument
                                      : null
                                : null;
                            return (
                              <Pressable
                                key={account.id}
                                onPress={() => handlePress(row)}
                                className="flex-row items-center py-2.5"
                                style={{ borderTopWidth: 1, borderTopColor: theme.border, paddingLeft: 20, gap: 8 }}
                                accessibilityRole="button"
                                accessibilityLabel={`${name}, ${formatAmount(Math.round(row.value))}`}
                              >
                                <View className="flex-1">
                                  <Text className="text-body text-foreground" numberOfLines={1}>{name}</Text>
                                  {sub && <Text className="text-label text-muted-foreground">{sub}</Text>}
                                </View>
                                <Text className="text-body font-semibold text-foreground">{formatAmount(Math.round(row.value))}</Text>
                                <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
                              </Pressable>
                            );
                          })}
                      </Card>
                    );
                  })}
                  {q && shownRows.length === 0 && (
                    <Text className="text-meta text-muted-foreground mx-4 mt-2">No account matches “{accountSearch.trim()}”.</Text>
                  )}
                </>
              );
            })()}
          </>
        )}
      </ScrollView>
      <FAB icon="add" label="Investment" onPress={() => router.push("/investments/add")} accessibilityLabel="Add investment" />
    </ScreenContainer>
  );
}

function accountName(account: FinancialAccount): string {
  return account.account_label ?? `${account.bank_name} ••••${account.account_identifier}`;
}

/** Band opacity for the i-th biggest account in a category: darkest first, never too faint. */
function shadeFor(i: number): number {
  return Math.max(1 - i * 0.22, 0.3);
}

function LegendRow({
  color,
  opacity = 1,
  label,
  amount,
  percent,
  onPress,
  hint,
}: {
  color: string;
  opacity?: number;
  label: string;
  amount: number;
  percent: number;
  onPress: () => void;
  hint: string;
}) {
  const theme = useTheme();
  // Whole rupees, as on Net worth: paise on a legend only made long amounts wrap.
  const value = formatAmount(Math.round(amount));
  // Two lines, the same as Net worth's breakdown, so nothing wraps or gets cut: name and amount
  // (the amount takes the width it needs), then the share bar with its percentage.
  return (
    <PressableScale
      onPress={onPress}
      style={{ minHeight: 44, paddingVertical: 7 }}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}, ${percent} percent`}
      accessibilityHint={hint}
    >
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <View className="w-2.5 h-2.5 rounded-control" style={{ backgroundColor: color, opacity }} />
        <Text className="text-meta text-foreground flex-1" numberOfLines={1}>
          {label}
        </Text>
        <Text className="text-meta font-semibold text-foreground" numberOfLines={1} style={{ fontVariant: ["tabular-nums"] }}>
          {value}
        </Text>
        <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
      </View>
      <View className="flex-row items-center mt-1.5" style={{ gap: 8, paddingLeft: 18, paddingRight: 22 }}>
        {/* Share of the total, filling when the row appears. */}
        <View className="flex-1" style={{ opacity }}>
          <ProgressBar value={Math.min(1, percent / 100)} color={color} height={3} />
        </View>
        <Text className="text-label text-muted-foreground w-9 text-right">{percent}%</Text>
      </View>
    </PressableScale>
  );
}
