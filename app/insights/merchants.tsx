import { useState, useCallback, useMemo, useRef } from "react";

import { View, Pressable, FlatList } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Card, EmptyState, ScreenContainer, Text } from "@/components/ui";
import { getMerchantAnalytics, getMerchantDetail } from "@/services/spending-insights";
import { getCategories } from "@/services/category";
import { formatAmount } from "@/utils/expense-validation";
import type { MerchantInsight } from "@/utils/spending-insights";
import type { Category } from "@/services/category";
import { DEFAULT_USER_ID } from "@/constants/app";
import { useTheme } from "@/hooks/use-theme";
import { useDataRefresh } from "@/hooks/use-data-refresh";
import { isoDate } from "@/utils/local-date";
import { LoadFailedBanner } from "@/components/ui/ListToolbar";

type TimeRange = "1m" | "3m" | "6m";
/** All merchants, only the ones new this period, or the ones paid before but not now. */
type View_ = "all" | "new" | "quiet";

const MONTHS: Record<TimeRange, number> = { "1m": 1, "3m": 3, "6m": 6 };
const SHOWN = 30;
const pad = (n: number) => String(n).padStart(2, "0");

/** This period (ending today) and the same length just before it. */
function getRanges(range: TimeRange) {
  const now = new Date();
  const months = MONTHS[range];
  const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 2 * months + 1, 1);
  const prevEnd = new Date(start.getFullYear(), start.getMonth(), 0);
  return {
    startDate: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-01`,
    endDate: isoDate(now),
    prevStart: `${prevStart.getFullYear()}-${pad(prevStart.getMonth() + 1)}-01`,
    prevEnd: isoDate(prevEnd),
    label: months === 1
      ? start.toLocaleDateString("en-IN", { month: "long" })
      : `${start.toLocaleDateString("en-IN", { month: "short" })} to ${now.toLocaleDateString("en-IN", { month: "short" })}`,
  };
}

type Row = MerchantInsight & { prev: number };

/**
 * Merchants (Nov 2026 redesign, "Arth Insights"): how much of your spending your top five took, what's
 * new and what's gone quiet, then every merchant ranked with its change on the period before. A
 * merchant opens in place, down to its payments, each of which opens its details.
 */
export default function MerchantAnalyticsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [range, setRange] = useState<TimeRange>("3m");
  const [rows, setRows] = useState<Row[]>([]);
  const [quiet, setQuiet] = useState<MerchantInsight[]>([]);
  const [view, setView] = useState<View_>("all");
  const [hasHistory, setHasHistory] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [categoryMap, setCategoryMap] = useState<Map<string, Category>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getMerchantDetail>> | null>(null);
  const listRef = useRef<FlatList<Row | MerchantInsight>>(null);
  const ranges = useMemo(() => getRanges(range), [range]);

  const [loadFailed, setLoadFailed] = useState(false);
  const loadData = useCallback(async () => {
    try {
      const [now, before, cats] = await Promise.all([
        getMerchantAnalytics(DEFAULT_USER_ID, ranges.startDate, ranges.endDate, 1000),
        getMerchantAnalytics(DEFAULT_USER_ID, ranges.prevStart, ranges.prevEnd, 1000),
        getCategories(DEFAULT_USER_ID),
      ]);
      const prevBy = new Map(before.map((m) => [m.merchant, m.totalSpent]));
      const nowNames = new Set(now.map((m) => m.merchant));
      setHasHistory(before.length > 0);
      setRows(now.map((m) => ({ ...m, prev: prevBy.get(m.merchant) ?? 0 })));
      setQuiet(before.filter((m) => !nowNames.has(m.merchant)));
      setCategoryMap(new Map(cats.map((c) => [c.id, c])));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [ranges]);

  useDataRefresh(loadData);

  const openMerchant = useCallback(
    async (name: string) => {
      if (selected === name) {
        setSelected(null);
        setDetail(null);
        return;
      }
      setSelected(name);
      setDetail(null);
      try {
        const inPeriod = rows.some((r) => r.merchant === name);
        setDetail(await getMerchantDetail(DEFAULT_USER_ID, name, inPeriod ? ranges.startDate : ranges.prevStart, inPeriod ? ranges.endDate : ranges.prevEnd));
      } catch {
        setDetail(null);
      }
    },
    [selected, ranges, rows],
  );

  const total = rows.reduce((s, m) => s + m.totalSpent, 0);
  const top = rows.slice(0, 5);
  const topTotal = top.reduce((s, m) => s + m.totalSpent, 0);
  const fresh = hasHistory ? rows.filter((r) => r.prev === 0) : [];
  const freshTotal = fresh.reduce((s, m) => s + m.totalSpent, 0);
  const list: (Row | MerchantInsight)[] = view === "new" ? fresh : view === "quiet" ? quiet : showAll ? rows : rows.slice(0, SHOWN);

  const pickTop = (name: string, index: number) => {
    setView("all");
    listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true });
    void openMerchant(name);
  };

  const header = (
    <View style={{ gap: 12 }} className="pb-3">
      <View className="flex-row" style={{ gap: 8 }}>
        {([
          { value: "1m", label: "This month" },
          { value: "3m", label: "3 months" },
          { value: "6m", label: "6 months" },
        ] as { value: TimeRange; label: string }[]).map((o) => {
          const on = range === o.value;
          return (
            <Pressable
              key={o.value}
              onPress={() => {
                setRange(o.value);
                setSelected(null);
                setDetail(null);
                setView("all");
                setShowAll(false);
              }}
              className="px-4 rounded-pill border justify-center"
              style={{ height: 36, backgroundColor: on ? theme.primary : "transparent", borderColor: on ? theme.primary : theme.border }}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
            >
              <Text className="text-meta font-semibold" style={{ color: on ? theme.primaryForeground : theme.mutedForeground }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {rows.length > 0 && (
        <Card>
          <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground">
            {ranges.label} · {rows.length} {rows.length === 1 ? "merchant" : "merchants"}
          </Text>
          <Text className="text-title font-bold text-foreground mt-1.5">
            {top.length < 5 ? `Your top ${top.length} took` : "Your top 5 took"} {total > 0 ? Math.round((topTotal / total) * 100) : 0}% of spending
          </Text>
          <Text className="text-meta text-muted-foreground mt-1">
            {formatAmount(Math.round(topTotal))} of {formatAmount(Math.round(total))} went to {top.length} {top.length === 1 ? "place" : "places"}.
          </Text>
          {/* Each of the top five is a part of the bar; tapping one opens it in the list. */}
          <View className="flex-row rounded-pill overflow-hidden mt-3" style={{ height: 12, gap: 2, backgroundColor: theme.border }}>
            {top.map((m, i) => (
              <Pressable
                key={m.merchant}
                onPress={() => pickTop(m.merchant, i)}
                style={{ flex: m.totalSpent, backgroundColor: theme.alpha("primary", 1 - i * 0.17) }}
                accessibilityRole="button"
                accessibilityLabel={`${m.merchant}, ${formatAmount(m.totalSpent)}`}
              />
            ))}
            {total > topTotal && <View style={{ flex: total - topTotal }} />}
          </View>
          {hasHistory && (
          <View className="flex-row mt-3" style={{ gap: 8 }}>
            <FilterTile
              label="New this period"
              value={fresh.length > 0 ? `${fresh.length} · ${formatAmount(Math.round(freshTotal))}` : "None"}
              on={view === "new"}
              onPress={() => setView((v) => (v === "new" ? "all" : "new"))}
            />
            <FilterTile
              label="Gone quiet"
              value={quiet.length > 0 ? `${quiet.length} you used to pay` : "None"}
              on={view === "quiet"}
              onPress={() => setView((v) => (v === "quiet" ? "all" : "quiet"))}
            />
          </View>
          )}
        </Card>
      )}
      {rows.length > 0 && (
        <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground px-1 mt-1">
          {view === "new" ? "New this period" : view === "quiet" ? "Paid before, not this period" : "Most spent"}
        </Text>
      )}
    </View>
  );

  return (
    <ScreenContainer padTop={false}>
      {loadFailed && <LoadFailedBanner onRetry={loadData} />}
      <FlatList
        ref={listRef}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        data={list}
        keyExtractor={(item) => item.merchant}
        ListHeaderComponent={header}
        onScrollToIndexFailed={() => {}}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}
        renderItem={({ item, index }) => {
          const isOpen = selected === item.merchant;
          const cat = item.categoryId ? categoryMap.get(item.categoryId) : null;
          const prev = "prev" in item ? item.prev : null;
          const change = view === "quiet" ? null : prev == null || prev === 0 ? null : (item.totalSpent - prev) / prev;
          const first = index === 0;
          const last = index === list.length - 1;
          return (
            <View
              className={`bg-card border-border ${first ? "rounded-t-card border-t" : ""} ${last ? "rounded-b-card border-b" : ""}`}
              style={{ borderLeftWidth: 1, borderRightWidth: 1, overflow: "hidden" }}
            >
              <Pressable
                onPress={() => openMerchant(item.merchant)}
                accessibilityLabel={`${item.merchant}, ${formatAmount(item.totalSpent)}`}
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
                className={`flex-row items-center px-4 py-3${first ? "" : " border-t border-border"}`}
                style={[{ gap: 12 }, isOpen ? { backgroundColor: theme.alpha("primary", 0.04) } : null]}
              >
                <Text className="text-meta font-bold text-muted-foreground" style={{ width: 24 }}>{index + 1}</Text>
                <View className="flex-1" style={{ minWidth: 0 }}>
                  <Text className="text-body font-semibold text-foreground capitalize" numberOfLines={1}>{item.merchant}</Text>
                  <Text className="text-label text-muted-foreground" numberOfLines={1}>
                    {cat ? `${cat.name} · ` : ""}{item.transactionCount} {item.transactionCount === 1 ? "payment" : "payments"}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className="text-body font-bold text-foreground">{formatAmount(Math.round(item.totalSpent))}</Text>
                  <Text
                    className="text-label font-semibold"
                    style={{ color: change == null ? theme.mutedForeground : change > 0.02 ? theme.danger : change < -0.02 ? theme.success : theme.mutedForeground }}
                  >
                    {view === "quiet"
                      ? `last ${shortDay(item.lastDate)}`
                      : change == null
                        ? hasHistory ? "new" : ""
                        : Math.abs(change) <= 0.02
                          ? "no change"
                          : `${change > 0 ? "↑" : "↓"} ${Math.round(Math.abs(change) * 100)}%`}
                  </Text>
                </View>
                <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={16} color={theme.mutedForeground} />
              </Pressable>

              {isOpen && detail && (
                <View className="px-4 pb-4" style={{ gap: 12, paddingLeft: 52, backgroundColor: theme.alpha("primary", 0.04) }}>
                  <View className="flex-row" style={{ gap: 8 }}>
                    <Stat label="Per payment" value={formatAmount(Math.round(detail.avgAmount))} />
                    <Stat label="Last paid" value={detail.transactions[0] ? shortDay(detail.transactions[0].date) : "—"} />
                    <Stat label="Share" value={view === "quiet" || total <= 0 ? "—" : `${Math.round((item.totalSpent / total) * 100)}%`} />
                  </View>

                  {/* Month by month; a month opens its payments. */}
                  {detail.monthlyTotals.length > 1 && (
                    <View>
                      {(() => {
                        const max = Math.max(...detail.monthlyTotals.map((mt) => mt.total));
                        return (
                          <View className="flex-row items-end" style={{ height: 64, gap: 6 }}>
                            {detail.monthlyTotals.map((mt) => (
                              <Pressable
                                key={mt.month}
                                onPress={() => {
                                  const ids = detail.transactions.filter((t) => t.date.startsWith(mt.month)).map((t) => t.id);
                                  if (ids.length > 0) router.push({ pathname: "/insights/filtered", params: { expenseIds: ids.join(","), title: `${item.merchant} · ${monthShort(mt.month)}` } });
                                }}
                                className="flex-1 justify-end"
                                style={{ height: "100%" }}
                                accessibilityRole="button"
                                accessibilityLabel={`${monthShort(mt.month)}, ${formatAmount(mt.total)}, see payments`}
                              >
                                <View style={{ height: `${Math.max(4, (mt.total / (max || 1)) * 100)}%`, backgroundColor: theme.primary, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
                              </Pressable>
                            ))}
                          </View>
                        );
                      })()}
                      <View className="flex-row mt-1" style={{ gap: 6 }}>
                        {detail.monthlyTotals.map((mt) => (
                          <Text key={mt.month} className="flex-1 text-label text-muted-foreground text-center">{monthShort(mt.month)}</Text>
                        ))}
                      </View>
                    </View>
                  )}

                  <View>
                    {detail.transactions.slice(0, 3).map((t) => (
                      <Pressable
                        key={t.id}
                        onPress={() => router.push(`/expense/${t.id}`)}
                        className="flex-row items-center"
                        style={{ minHeight: 40, gap: 8 }}
                        accessibilityLabel={`${t.description ?? "Payment"}, ${formatAmount(t.amount)}`}
                        accessibilityRole="button"
                      >
                        <Text className="text-label text-muted-foreground" style={{ width: 52 }} numberOfLines={1}>{shortDay(t.date)}</Text>
                        <Text className="text-meta text-foreground flex-1" numberOfLines={1}>{t.description && t.description.trim() !== "-" ? t.description : item.merchant}</Text>
                        <Text className="text-meta font-semibold text-foreground">{formatAmount(t.amount)}</Text>
                        <Ionicons name="chevron-forward" size={13} color={theme.mutedForeground} />
                      </Pressable>
                    ))}
                  </View>

                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                    <PillButton
                      label={`See ${detail.transactionCount === 1 ? "the payment" : `all ${detail.transactionCount} payments`}`}
                      onPress={() =>
                        router.push({ pathname: "/insights/filtered", params: { expenseIds: detail.transactions.map((t) => t.id).join(","), title: item.merchant } })
                      }
                    />
                    <PillButton label="Rename or recategorise" onPress={() => router.push({ pathname: "/settings/merchant-detail", params: { name: item.merchant } })} />
                  </View>
                </View>
              )}
            </View>
          );
        }}
        ListFooterComponent={
          view === "all" && rows.length > SHOWN ? (
            <Pressable onPress={() => setShowAll((v) => !v)} className="items-center py-3" accessibilityRole="button">
              <Text className="text-meta font-semibold" style={{ color: theme.primary }}>{showAll ? "Show fewer" : `Show all ${rows.length}`}</Text>
            </Pressable>
          ) : rows.length > 0 ? (
            <Text className="text-label text-muted-foreground px-1 pt-3">
              Changes compare with the {MONTHS[range] === 1 ? "month" : `${MONTHS[range]} months`} before. Renaming a merchant renames it everywhere.
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="storefront-outline"
            title={view === "all" ? "No merchant data" : "Nothing here"}
            subtitle={view === "all" ? "Add expenses with descriptions to see merchant analytics." : "Try another period."}
          />
        }
      />
    </ScreenContainer>
  );
}

/** "15 Nov" (with the year when it isn't this year). */
function shortDay(date: string): string {
  const d = new Date(date.slice(0, 10) + "T00:00:00");
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-IN", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "2-digit" });
}

function monthShort(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString("en-IN", { month: "short" });
}

function FilterTile({ label, value, on, onPress }: { label: string; value: string; on: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 rounded-control px-3 py-2.5"
      style={{ backgroundColor: on ? theme.alpha("primary", 0.1) : theme.background, borderWidth: 1, borderColor: on ? theme.primary : "transparent", minWidth: 0 }}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text className="text-label text-muted-foreground">{label}</Text>
      <Text className="text-body font-bold text-foreground" numberOfLines={1}>{value}</Text>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1" style={{ minWidth: 0 }}>
      <Text className="text-label text-muted-foreground">{label}</Text>
      <Text className="text-meta font-semibold text-foreground" numberOfLines={1}>{value}</Text>
    </View>
  );
}

function PillButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="rounded-pill border border-border bg-card px-3 justify-center" style={{ height: 36 }} accessibilityRole="button">
      <Text className="text-meta font-semibold text-foreground">{label}</Text>
    </Pressable>
  );
}
