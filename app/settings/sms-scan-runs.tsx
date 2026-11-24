import { listLayout } from "@/components/motion/motion";
import Animated from "react-native-reanimated";
import { useState, useCallback, useEffect, useMemo } from "react";
import { SendSmsToDeveloperSheet } from "@/components/sms/SendSmsToDeveloperSheet";
import { View, FlatList, Pressable, BackHandler } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, Chip, GroupHeading, ListToolbar, LoadingState, ScreenContainer, Segmented, Text, useToast } from "@/components/ui";
import { ResultRow, type RunRow } from "@/components/ai/LabResultRow";
import { addAiReadToCatchUp } from "@/services/ai/add-ai-read";
import { useListTools } from "@/hooks/use-list-tools";
import type { ListField, ListSort } from "@/utils/list-tools";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getScanRuns,
  getScanRunDetails,
  markScanDetailAdded,
  type ScanRunRow,
  type ScanSource,
  type ScanDetailRow,
  type ScanDetailCategory,
} from "@/services/sms";
import { listRules } from "@/services/smart-rules";
import { formatAmount } from "@/utils/format";
import { formatDate } from "@/utils/date";
import { useTheme } from "@/hooks/use-theme";
import { tint } from "@/constants/brand";

type ViewMode = "list" | "drilldown" | "category";
type SourceFilter = "all" | ScanSource;

const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "sms", label: "SMS" },
  { value: "ai", label: "AI" },
];

const SMS_CATEGORIES: ScanDetailCategory[] = ["hardcoded", "template", "filtered", "unrecognized", "skipped"];
const AI_CATEGORIES: ScanDetailCategory[] = ["ai_transaction", "ai_not_money", "ai_ignored", "ai_rejected", "ai_error"];
const isAiCategory = (c: string) => c.startsWith("ai_");

/** Messages per category. SMS runs keep their counts on the run; AI runs count their details. */
function countsOf(run: ScanRunRow): Record<ScanDetailCategory, number> {
  const c = run.category_counts ?? {};
  return {
    hardcoded: run.hardcoded_match_count,
    template: run.template_match_count,
    filtered: run.filtered_count,
    unrecognized: run.unrecognized_count,
    skipped: run.skipped_count,
    ai_transaction: c.ai_transaction ?? 0,
    ai_not_money: c.ai_not_money ?? 0,
    ai_ignored: c.ai_ignored ?? 0,
    ai_rejected: c.ai_rejected ?? 0,
    ai_error: c.ai_error ?? 0,
  };
}

/** A saved AI reading, in the shape the AI lab's result row draws. */
function aiRowOf(d: ScanDetailRow): RunRow {
  let outcome: RunRow["outcome"];
  try {
    outcome = d.ai_result ? JSON.parse(d.ai_result) : undefined;
  } catch {
    outcome = undefined;
  }
  return {
    id: d.message_ref ?? d.id,
    sender: d.sms_address ?? "",
    body: d.sms_body_preview ?? "",
    date: d.sms_date ?? undefined,
    outcome: outcome ?? undefined,
    ms: d.ai_ms ?? undefined,
    error: d.category === "ai_error" ? (d.filter_reason ?? "No answer") : undefined,
    added: d.added_expense_id || d.added_note ? { expenseId: d.added_expense_id, note: d.added_note } : undefined,
  };
}

const secs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

const SCAN_FIELDS: ListField<ScanDetailRow>[] = [
  { id: "sender", label: "Sender", keyOf: (d) => d.sms_address, noneLabel: "No sender", filter: true, group: true, searchable: true },
  { id: "merchant", label: "Merchant", keyOf: (d) => d.parsed_merchant?.trim(), noneLabel: "No merchant", filter: true, group: true, searchable: true },
  { id: "type", label: "Transaction type", keyOf: (d) => d.parsed_type, noneLabel: "No type", filter: true, group: true },
];
const SCAN_SORTS: ListSort<ScanDetailRow>[] = [
  { id: "logged", label: "As logged" },
  { id: "newest", label: "Newest first", compare: (a, b) => (b.sms_date ?? 0) - (a.sms_date ?? 0) },
  { id: "oldest", label: "Oldest first", compare: (a, b) => (a.sms_date ?? 0) - (b.sms_date ?? 0) },
  { id: "amount", label: "Amount (highest first)", compare: (a, b) => (b.parsed_amount ?? 0) - (a.parsed_amount ?? 0) },
];
const SCAN_SEARCH = (d: ScanDetailRow) => ({
  texts: [d.sms_body_preview, d.sms_address, d.parsed_merchant],
  amounts: d.parsed_amount != null ? [d.parsed_amount] : [],
});
const SCAN_AMOUNT = (d: ScanDetailRow) => d.parsed_amount ?? 0;

const CATEGORY_META: Record<
  ScanDetailCategory,
  { label: string; icon: string; colorKey: "success" | "warning" | "danger" | "info" }
> = {
  hardcoded: { label: "Bank Pattern Matches", icon: "shield-checkmark-outline", colorKey: "success" },
  template: { label: "Template Matches", icon: "construct-outline", colorKey: "info" },
  filtered: { label: "Filtered Out", icon: "funnel-outline", colorKey: "warning" },
  unrecognized: { label: "Unrecognized", icon: "help-circle-outline", colorKey: "danger" },
  skipped: { label: "Skipped (OTP, etc.)", icon: "close-circle-outline", colorKey: "danger" },
  ai_transaction: { label: "Money messages", icon: "checkmark-circle-outline", colorKey: "success" },
  ai_not_money: { label: "Not money", icon: "remove-circle-outline", colorKey: "info" },
  ai_ignored: { label: "On ignored accounts", icon: "eye-off-outline", colorKey: "warning" },
  ai_rejected: { label: "Couldn't use the reading", icon: "alert-circle-outline", colorKey: "warning" },
  ai_error: { label: "No answer", icon: "close-circle-outline", colorKey: "danger" },
};

export default function SmsScanRunsScreen() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();

  const [loading, setLoading] = useState(true);
  const [runs, setRuns] = useState<ScanRunRow[]>([]);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const shownRuns = useMemo(() => (sourceFilter === "all" ? runs : runs.filter((r) => r.source === sourceFilter)), [runs, sourceFilter]);
  const hasAiRuns = runs.some((r) => r.source === "ai");
  const toast = useToast();
  const [openAiId, setOpenAiId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedRun, setSelectedRun] = useState<ScanRunRow | null>(null);
  const [details, setDetails] = useState<ScanDetailRow[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<ScanDetailCategory | null>(null);
  const [reportSms, setReportSms] = useState<{ body: string; address: string } | null>(null);
  const [ruleNameMap, setRuleNameMap] = useState<Record<string, string>>({});
  const categoryDetails = useMemo(() => details.filter((d) => d.category === selectedCategory), [details, selectedCategory]);
  const tools = useListTools<ScanDetailRow>({
    screen: "sms_scan_details",
    noun: { one: "message", many: "messages" },
    rows: categoryDetails,
    fields: SCAN_FIELDS,
    sorts: SCAN_SORTS,
    searchPlaceholder: "Search SMS, sender, merchant",
    search: SCAN_SEARCH,
    amountOf: SCAN_AMOUNT,
  });

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (viewMode !== "list") {
        handleBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [viewMode]);

  useFocusEffect(
    useCallback(() => {
      loadRuns();
    }, []),
  );

  async function loadRuns() {
    setLoading(true);
    const rows = await getScanRuns(DEFAULT_USER_ID);
    setRuns(rows);
    setLoading(false);
  }

  async function openDrilldown(run: ScanRunRow) {
    setSelectedRun(run);
    setViewMode("drilldown");
    setDetailsLoading(true);
    const [d, rules] = await Promise.all([getScanRunDetails(run.id), listRules()]);
    setDetails(d);
    const nameMap: Record<string, string> = {};
    for (const r of rules) nameMap[r.id] = r.name;
    setRuleNameMap(nameMap);
    setDetailsLoading(false);
  }

  function openCategory(cat: ScanDetailCategory) {
    setSelectedCategory(cat);
    setViewMode("category");
  }

  // "Add to Catch Up" on an AI reading, from the history: the same path the AI lab takes.
  async function addAiDetail(d: ScanDetailRow) {
    const row = aiRowOf(d);
    if (row.outcome?.kind !== "transaction" || row.date == null || !selectedRun) return;
    setAddingId(d.id);
    let added: { expenseId: string | null; note: string | null };
    try {
      const res = await addAiReadToCatchUp(row.id, row.outcome.result, row.body, row.sender, row.date);
      added = {
        expenseId: res.expenseId,
        note: res.expenseId
          ? null
          : res.error
            ? `Couldn't add it: ${res.error}`
            : "Arth didn't add it: it already has this transaction, or the account is ignored or before your start date",
      };
    } catch (e) {
      added = { expenseId: null, note: `Couldn't add it: ${e instanceof Error ? e.message : String(e)}` };
    }
    await markScanDetailAdded(selectedRun.id, row.id, added).catch(() => {});
    setDetails((all) => all.map((x) => (x.id === d.id ? { ...x, added_expense_id: added.expenseId, added_note: added.note } : x)));
    setAddingId(null);
    toast(added.expenseId ? "Added to Catch Up" : "Not added", added.expenseId ? { actionLabel: "Open", onAction: () => router.push("/expense/catch-up") } : undefined);
  }

  function handleBack() {
    if (viewMode === "category") {
      setViewMode("drilldown");
      setSelectedCategory(null);
      tools.reset();
    } else if (viewMode === "drilldown") {
      setViewMode("list");
      setSelectedRun(null);
      setDetails([]);
      tools.reset();
    } else {
      router.back();
    }
  }

  // ─── List View ───

  function renderRunCard({ item }: { item: ScanRunRow }) {
    if (item.source === "ai") return renderAiRunCard(item);
    const accountLabel = item.account_ids
      ? `${JSON.parse(item.account_ids).length} account${JSON.parse(item.account_ids).length > 1 ? "s" : ""}`
      : "All accounts";
    const dateLabel = item.start_date
      ? `${formatDate(item.start_date)} → ${item.end_date ? formatDate(item.end_date) : "Today"}`
      : "Since last check";
    const createdAt = new Date(item.created_at + "Z");
    const timeStr = createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const dateStr = formatDate(item.created_at.slice(0, 10));

    const totalExpenses = item.expense_created_count + item.credit_created_count;

    return (
      <Pressable onPress={() => openDrilldown(item)} className="mb-3">
        <Card>
          <View className="flex-row items-center justify-between mb-2">
            <View className="flex-row items-center">
              <View
                className="w-7 h-7 rounded-full items-center justify-center mr-2"
                style={{ backgroundColor: theme.alpha("primary", 0.09) }}
              >
                <Ionicons
                  name={item.is_manual ? "scan-outline" : "time-outline"}
                  size={14}
                  color={theme.primary}
                />
              </View>
              <Text className="text-body font-semibold text-foreground">
                {item.is_manual ? "Manual scan" : "Auto scan"}
              </Text>
              {hasAiRuns && <Chip variant="status" tone="neutral" label="SMS" className="ml-1.5" />}
              <Text className="text-meta text-muted-foreground ml-1.5">
                {dateStr} · {timeStr}
              </Text>
            </View>
            {/* What came of it, at a glance (board "Scan history") */}
            {totalExpenses > 0 ? (
              <View className="rounded-pill px-2 justify-center" style={{ height: 22, backgroundColor: theme.alpha("success", 0.1) }}>
                <Text className="text-label font-semibold" style={{ color: theme.success }}>{totalExpenses} new</Text>
              </View>
            ) : (
              <Text className="text-label text-muted-foreground">Nothing new</Text>
            )}
          </View>

          <View className="flex-row items-center mb-2">
            <Text className="text-label text-faint-foreground">
              {dateLabel} · {accountLabel}
            </Text>
          </View>

          {/* Funnel summary */}
          <View className="flex-row flex-wrap items-center">
            <FunnelPill label={`${item.sms_read_count} read`} />
            <FunnelArrow />
            <FunnelPill
              label={`${item.hardcoded_match_count + item.template_match_count} parsed`}
              colorKey="success"
            />
            {item.filtered_count > 0 && (
              <>
                <FunnelArrow />
                <FunnelPill label={`${item.filtered_count} filtered`} colorKey="warning" />
              </>
            )}
            <FunnelArrow />
            <FunnelPill
              label={`${totalExpenses} created`}
              colorKey={totalExpenses > 0 ? "success" : undefined}
            />
          </View>

          {item.error && (
            <Text className="text-label text-danger mt-1">{item.error}</Text>
          )}
        </Card>
      </Pressable>
    );
  }

  function renderAiRunCard(item: ScanRunRow) {
    const counts = countsOf(item);
    const createdAt = new Date(item.created_at + "Z");
    const timeStr = createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const dateStr = formatDate(item.created_at.slice(0, 10));
    return (
      <Pressable onPress={() => openDrilldown(item)} className="mb-3" accessibilityRole="button">
        <Card>
          <View className="flex-row items-center justify-between mb-2">
            <View className="flex-row items-center flex-1">
              <View className="w-7 h-7 rounded-full items-center justify-center mr-2" style={{ backgroundColor: theme.alpha("primary", 0.09) }}>
                <Ionicons name="sparkles-outline" size={14} color={theme.primary} />
              </View>
              <Text className="text-body font-semibold text-foreground">AI scan</Text>
              <Chip variant="status" tone="primary" label="AI" className="ml-1.5" />
              <Text className="text-meta text-muted-foreground ml-1.5 shrink" numberOfLines={1}>
                {dateStr} · {timeStr}
              </Text>
            </View>
            {item.added_count > 0 ? (
              <View className="rounded-pill px-2 justify-center" style={{ height: 22, backgroundColor: theme.alpha("success", 0.1) }}>
                <Text className="text-label font-semibold" style={{ color: theme.success }}>{item.added_count} added</Text>
              </View>
            ) : null}
          </View>
          {item.label ? <Text className="text-label text-faint-foreground mb-2">On-device AI · {item.label}</Text> : null}
          <View className="flex-row flex-wrap items-center">
            <FunnelPill label={`${item.sms_read_count} read`} />
            <FunnelArrow />
            <FunnelPill label={`${counts.ai_transaction} money`} colorKey={counts.ai_transaction > 0 ? "success" : undefined} />
            <FunnelArrow />
            <FunnelPill label={`${item.added_count} added`} colorKey={item.added_count > 0 ? "success" : undefined} />
            {counts.ai_error > 0 && (
              <>
                <Text className="text-label text-faint-foreground mx-1">·</Text>
                <FunnelPill label={`${counts.ai_error} no answer`} colorKey="danger" />
              </>
            )}
          </View>
          {item.error && <Text className="text-label text-warning mt-1">{item.error}</Text>}
        </Card>
      </Pressable>
    );
  }

  // ─── Drilldown View ───

  function renderDrilldown() {
    if (!selectedRun) return null;

    const ai = selectedRun.source === "ai";
    const categories = ai ? AI_CATEGORIES : SMS_CATEGORIES;
    const counts = countsOf(selectedRun);

    const filterReasons = details
      .filter((d) => d.category === "filtered")
      .reduce<Record<string, number>>((acc, d) => {
        const reason = d.filter_reason ?? "unknown";
        acc[reason] = (acc[reason] ?? 0) + 1;
        return acc;
      }, {});

    return (
      <View className="flex-1 px-4">
        {/* Header summary */}
        <Card className="mb-3">
          <Text className="text-label font-semibold text-faint-foreground uppercase tracking-wider mb-2">
            Pipeline Summary
          </Text>
          <View className="flex-row items-center flex-wrap">
            <Text className="text-title font-bold text-foreground mr-2">
              {selectedRun.sms_read_count}
            </Text>
            <Text className="text-meta text-muted-foreground">
              {ai ? "messages read by on-device AI" : "SMS read"}
            </Text>
          </View>
          {ai && selectedRun.label ? <Text className="text-label text-faint-foreground mt-0.5">{selectedRun.label}</Text> : null}
          {ai ? (
            <View className="mt-2 flex-row flex-wrap">
              <MiniStat label="Money" value={counts.ai_transaction} color={theme.success} />
              <MiniStat label="Not money" value={counts.ai_not_money} color={theme.mutedForeground} />
              <MiniStat label="Added" value={details.filter((d) => d.added_expense_id).length} color={theme.primary} />
            </View>
          ) : (
          <View className="mt-2 flex-row flex-wrap">
            <MiniStat
              label="Parsed"
              value={selectedRun.hardcoded_match_count + selectedRun.template_match_count}
              color={theme.success}
            />
            <MiniStat
              label="Filtered"
              value={selectedRun.filtered_count}
              color={theme.warning}
            />
            <MiniStat
              label="Created"
              value={selectedRun.expense_created_count + selectedRun.credit_created_count}
              color={theme.primary}
            />
          </View>
          )}
          {selectedRun.duration_ms != null && (
            <Text className="text-label text-faint-foreground mt-2">
              Completed in {secs(selectedRun.duration_ms)}
            </Text>
          )}
          {ai && selectedRun.error ? <Text className="text-label text-warning mt-1">{selectedRun.error}</Text> : null}
        </Card>

        {/* Category cards */}
        {detailsLoading ? (
          <LoadingState rows={3} />
        ) : (
          <FlatList
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={7}
            data={categories.filter((c) => counts[c] > 0)}
            keyExtractor={(item) => item}
            renderItem={({ item: cat }) => {
              const meta = CATEGORY_META[cat];
              const count = counts[cat];
              const catColor =
                meta.colorKey === "info" ? theme.primary : theme[meta.colorKey];

              return (
                <Pressable
                  onPress={() => openCategory(cat)}
                  className="mb-2"
                >
                  <Card>
                    <View className="flex-row items-center">
                      <View
                        className="w-8 h-8 rounded-full items-center justify-center mr-3"
                        style={{ backgroundColor: tint(catColor, 0.09) }}
                      >
                        <Ionicons name={meta.icon as any} size={16} color={catColor} />
                      </View>
                      <View className="flex-1">
                        <Text className="text-body font-semibold text-foreground">
                          {meta.label} ({count})
                        </Text>
                        {cat === "filtered" && Object.keys(filterReasons).length > 0 && (
                          <View className="mt-1">
                            {Object.entries(filterReasons).map(([reason, cnt]) => (
                              <Text
                                key={reason}
                                className="text-label text-faint-foreground"
                              >
                                • {cnt} - {formatFilterReason(reason)}
                              </Text>
                            ))}
                          </View>
                        )}
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
                    </View>
                  </Card>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View className="items-center py-8">
                <Text className="text-meta text-muted-foreground">
                  {ai ? "No messages were read in this run" : "No SMS in this scan"}
                </Text>
              </View>
            }
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 32 }}
          />
        )}
      </View>
    );
  }

  // ─── Category Detail View ───

  function renderCategoryDetail() {
    if (!selectedCategory) return null;

    const meta = CATEGORY_META[selectedCategory];
    const filtered = tools.rows;
    const narrowed = tools.narrowed;

    return (
      <View className="flex-1 px-4">
        <View className="flex-row items-center mb-2">
          <View
            className="w-8 h-8 rounded-full items-center justify-center mr-2"
            style={{
              backgroundColor: theme.alpha(
                meta.colorKey === "info" ? "primary" : meta.colorKey,
                0.09,
              ),
            }}
          >
            <Ionicons
              name={meta.icon as any}
              size={16}
              color={
                meta.colorKey === "info" ? theme.primary : theme[meta.colorKey]
              }
            />
          </View>
          <Text className="text-body font-bold text-foreground">
            {meta.label} ({filtered.length}{narrowed ? ` of ${categoryDetails.length}` : ""})
          </Text>
        </View>

        <ListToolbar {...tools.toolbar} inset={false} />
        {tools.filterSheet}

        <Animated.FlatList
        itemLayoutAnimation={listLayout()}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          data={tools.grouped}
          keyExtractor={(row) => (row.type === "heading" ? `heading-${row.key}` : row.item.id)}
          renderItem={({ item: row }) =>
            row.type === "heading" ? (
              <GroupHeading label={row.label} count={row.count} total={row.total} signed={false} inset={false} open={row.open} onToggle={row.onToggle} noun={row.noun} />
            ) : isAiCategory(row.item.category) ? (
              <AiDetailCard detail={row.item} />
            ) : (
              <SmsDetailCard detail={row.item} ruleNameMap={ruleNameMap} />
            )
          }
          ListEmptyComponent={
            <View className="items-center py-8">
              <Text className="text-meta text-muted-foreground">
                {narrowed ? "No SMS matching your search" : "No details recorded for this category"}
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        />
      </View>
    );
  }

  function SmsDetailCard({ detail, ruleNameMap }: { detail: ScanDetailRow; ruleNameMap: Record<string, string> }) {
    const dateStr = detail.sms_date
      ? new Date(detail.sms_date).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

    const hasParsedData = detail.parsed_amount != null || detail.parsed_merchant || detail.parsed_type;

    return (
      <View className="mb-2">
        <Card>
          {/* Sender + date header */}
          {(detail.sms_address || dateStr) && (
            <View className="flex-row items-center justify-between mb-1.5">
              {detail.sms_address && (
                <Text className="text-label font-semibold text-muted-foreground uppercase tracking-wider">
                  {detail.sms_address}
                </Text>
              )}
              {dateStr && (
                <Text className="text-label text-faint-foreground">
                  {dateStr}
                </Text>
              )}
            </View>
          )}

          {/* Full raw SMS body */}
          <View className="bg-background rounded-control p-2.5 mb-2">
            <Text className="text-label text-foreground leading-[18px]" selectable>
              {detail.sms_body_preview ?? "No SMS body available"}
            </Text>
          </View>

          {/* Parsed fields table */}
          {hasParsedData && (
            <View className="border-t border-border pt-2">
              <Text className="text-label font-semibold text-faint-foreground uppercase tracking-wider mb-1.5">
                Parsed Values
              </Text>
              {detail.parsed_amount != null && (
                <ParsedRow label="Amount" value={formatAmount(detail.parsed_amount)} />
              )}
              {detail.parsed_merchant && (
                <ParsedRow label="Merchant" value={detail.parsed_merchant} />
              )}
              {detail.parsed_type && (
                <ParsedRow label="Type" value={detail.parsed_type} />
              )}
              {detail.matched_template_id && (
                <ParsedRow label="Matched By" value="User Template" isAccent />
              )}
              {detail.filter_reason && (
                <ParsedRow label="Filter" value={formatFilterReason(detail.filter_reason)} isWarning />
              )}
            </View>
          )}

          {/* Rules applied */}
          {detail.applied_rule_ids && (() => {
            let ruleIds: string[] = [];
            try { ruleIds = JSON.parse(detail.applied_rule_ids); } catch {}
            if (ruleIds.length === 0) return null;
            return (
              <View className="border-t border-border pt-2 mt-1">
                <Text className="text-label font-semibold text-faint-foreground uppercase tracking-wider mb-1.5">
                  Rules Applied
                </Text>
                {ruleIds.map((id) => (
                  <View key={id} className="flex-row items-center py-0.5">
                    <Ionicons name="sparkles" size={10} color={theme.primary} style={{ marginRight: 4 }} />
                    <Text className="text-label font-medium" style={{ color: theme.primary }}>
                      {ruleNameMap[id] ?? id}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })()}

          {/* Teach action for unrecognized */}
          {detail.category === "unrecognized" && detail.sms_body_preview && (
            <Pressable
              onPress={() => {
                router.push({
                  pathname: "/settings/sms-templates/new",
                  params: {
                    prefilledBody: detail.sms_body_preview!,
                    senderAddress: detail.sms_address ?? undefined,
                  },
                });
              }}
              className="flex-row items-center mt-2 pt-2 border-t border-border"
            >
              <Ionicons name="add-circle-outline" size={14} color={theme.primary} />
              <Text className="text-label font-medium ml-1" style={{ color: theme.primary }}>
                Teach this format
              </Text>
            </Pressable>
          )}
          {detail.category === "unrecognized" && detail.sms_body_preview && (
            <Pressable
              onPress={() => setReportSms({ body: detail.sms_body_preview!, address: detail.sms_address ?? "" })}
              className="flex-row items-center mt-2"
              accessibilityRole="button"
            >
              <Ionicons name="mail-outline" size={14} color={theme.mutedForeground} />
              <Text className="text-label font-medium ml-1 text-muted-foreground">Send to developer</Text>
            </Pressable>
          )}
        </Card>
      </View>
    );
  }

  // An AI reading: the AI lab's own result row, so the two screens read the same.
  function AiDetailCard({ detail }: { detail: ScanDetailRow }) {
    const row = aiRowOf(detail);
    const open = openAiId === detail.id;
    const canTeach = detail.category === "ai_transaction" && !!detail.sms_body_preview;
    return (
      <View className="mb-2">
        <Card className="py-0">
          <ResultRow
            row={row}
            open={open}
            onToggle={() => setOpenAiId(open ? null : detail.id)}
            last
            onAdd={row.date != null ? () => void addAiDetail(detail) : undefined}
            adding={addingId === detail.id}
            onOpenCatchUp={() => router.push("/expense/catch-up")}
          />
          {canTeach && open ? (
            // Only the AI understood this one: a template makes every scan read it.
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/settings/sms-templates/new",
                  params: { prefilledBody: detail.sms_body_preview!, senderAddress: detail.sms_address ?? undefined },
                })
              }
              className="flex-row items-center py-3 border-t border-border"
              accessibilityRole="button"
            >
              <Ionicons name="add-circle-outline" size={14} color={theme.primary} />
              <Text className="text-label font-medium ml-1" style={{ color: theme.primary }}>
                Teach this format, so every scan reads it
              </Text>
            </Pressable>
          ) : null}
        </Card>
      </View>
    );
  }

  function ParsedRow({ label, value, isWarning, isAccent }: { label: string; value: string; isWarning?: boolean; isAccent?: boolean }) {
    const valueColor = isWarning
      ? theme.warning
      : isAccent
        ? theme.primary
        : undefined;
    return (
      <View className="flex-row items-center justify-between py-0.5">
        <Text className="text-label text-faint-foreground">{label}</Text>
        <Text
          className="text-label font-medium text-foreground"
          style={valueColor ? { color: valueColor } : undefined}
        >
          {value}
        </Text>
      </View>
    );
  }

  // ─── Shared Components ───

  function FunnelPill({
    label,
    colorKey,
  }: {
    label: string;
    colorKey?: "success" | "warning" | "danger";
  }) {
    const pillColor = colorKey ? theme[colorKey] : theme.mutedForeground;

    return (
      <View
        className="rounded-full px-2 py-0.5"
        style={{ backgroundColor: tint(pillColor, 0.09) }}
      >
        <Text className="text-label font-medium" style={{ color: pillColor }}>
          {label}
        </Text>
      </View>
    );
  }

  function FunnelArrow() {
    return (
      <Ionicons
        name="arrow-forward"
        size={10}
        color={theme.mutedForeground}
        style={{ marginHorizontal: 3 }}
      />
    );
  }

  function MiniStat({
    label,
    value,
    color,
  }: {
    label: string;
    value: number;
    color: string;
  }) {
    return (
      <View className="mr-4 mb-1">
        <Text className="text-heading font-bold" style={{ color }}>
          {value}
        </Text>
        <Text className="text-label text-faint-foreground">
          {label}
        </Text>
      </View>
    );
  }

  // ─── Main Render ───

  const showBackButton = viewMode !== "list";
  const title =
    viewMode === "list"
      ? "Scan history"
      : viewMode === "drilldown" && selectedRun
        ? `Scan · ${formatDate(selectedRun.created_at.slice(0, 10))}`
        : selectedCategory
          ? CATEGORY_META[selectedCategory].label
          : "Details";

  return (
    <ScreenContainer padTop={false}>
      <Stack.Screen
        options={{
          title,
          headerLeft: showBackButton
            ? () => (
                <Pressable onPress={handleBack} hitSlop={8}>
                  <Ionicons name="chevron-back" size={24} color={theme.primary} />
                </Pressable>
              )
            : undefined,
        }}
      />

      {viewMode === "list" && (
        <>
          {loading ? (
            <LoadingState />
          ) : runs.length === 0 ? (
            <View className="flex-1 items-center justify-center">
              <Ionicons name="scan-outline" size={48} color={theme.mutedForeground} />
              <Text className="text-heading font-medium text-foreground mt-3">
                No scan history
              </Text>
              <Text className="text-meta text-muted-foreground text-center mt-1 px-8">
                Run an SMS scan, or test the on-device AI in the AI lab, to see results here.
              </Text>
            </View>
          ) : (
            <FlatList
              initialNumToRender={12}
              maxToRenderPerBatch={10}
              windowSize={7}
              data={shownRuns}
              ListHeaderComponent={
                hasAiRuns ? (
                  <View className="mb-3">
                    <Segmented options={SOURCE_OPTIONS} value={sourceFilter} onChange={setSourceFilter} />
                  </View>
                ) : null
              }
              ListEmptyComponent={
                <View className="items-center py-8">
                  <Text className="text-meta text-muted-foreground">
                    {sourceFilter === "ai" ? "No AI scans yet" : "No SMS scans yet"}
                  </Text>
                </View>
              }
              keyExtractor={(item) => item.id}
              renderItem={renderRunCard}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
            />
          )}
        </>
      )}

      {viewMode === "drilldown" && renderDrilldown()}
      {viewMode === "category" && renderCategoryDetail()}
      <SendSmsToDeveloperSheet
        visible={reportSms != null}
        onClose={() => setReportSms(null)}
        body={reportSms?.body ?? ""}
        sender={reportSms?.address ?? ""}
      />
    </ScreenContainer>
  );
}

function formatFilterReason(reason: string): string {
  if (reason.startsWith("account_mismatch:")) {
    const card = reason.split(":")[1];
    return `Account ••••${card} not in selection`;
  }
  switch (reason) {
    case "account_mismatch":
      return "Account not in selection";
    case "no_card_identifier":
      return "No card/account number found";
    default:
      return reason;
  }
}
