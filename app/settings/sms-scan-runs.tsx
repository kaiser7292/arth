import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  BackHandler,
} from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, ScreenContainer } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { StatusColors } from "@/constants/theme";
import { DEFAULT_USER_ID } from "@/constants/app";
import {
  getScanRuns,
  getScanRunDetails,
  type ScanRunRow,
  type ScanDetailRow,
  type ScanDetailCategory,
} from "@/services/sms";
import { listRules } from "@/services/smart-rules";
import { formatAmount } from "@/utils/format";
import { formatDate } from "@/utils/date";

type ViewMode = "list" | "drilldown" | "category";

const CATEGORY_META: Record<
  ScanDetailCategory,
  { label: string; icon: string; colorKey: "success" | "warning" | "danger" | "info" }
> = {
  hardcoded: { label: "Bank Pattern Matches", icon: "shield-checkmark-outline", colorKey: "success" },
  template: { label: "Template Matches", icon: "construct-outline", colorKey: "info" },
  filtered: { label: "Filtered Out", icon: "funnel-outline", colorKey: "warning" },
  unrecognized: { label: "Unrecognized", icon: "help-circle-outline", colorKey: "danger" },
  skipped: { label: "Skipped (OTP, etc.)", icon: "close-circle-outline", colorKey: "danger" },
};

export default function SmsScanRunsScreen() {
  const router = useRouter();
  const { accent, colorScheme, colors } = useColorScheme();

  const [loading, setLoading] = useState(true);
  const [runs, setRuns] = useState<ScanRunRow[]>([]);

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedRun, setSelectedRun] = useState<ScanRunRow | null>(null);
  const [details, setDetails] = useState<ScanDetailRow[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<ScanDetailCategory | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [ruleNameMap, setRuleNameMap] = useState<Record<string, string>>({});

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

  function handleBack() {
    if (viewMode === "category") {
      setViewMode("drilldown");
      setSelectedCategory(null);
      setSearchQuery("");
    } else if (viewMode === "drilldown") {
      setViewMode("list");
      setSelectedRun(null);
      setDetails([]);
      setSearchQuery("");
    } else {
      router.back();
    }
  }

  // ─── List View ───

  function renderRunCard({ item }: { item: ScanRunRow }) {
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
                style={{ backgroundColor: accent[500] + "18" }}
              >
                <Ionicons
                  name={item.is_manual ? "scan-outline" : "time-outline"}
                  size={14}
                  color={accent[500]}
                />
              </View>
              <Text className="text-sm font-semibold text-foreground">
                {item.is_manual ? "Manual Scan" : "Auto Scan"}
              </Text>
            </View>
            <Text className="text-xs text-muted-foreground">
              {dateStr} · {timeStr}
            </Text>
          </View>

          <View className="flex-row items-center mb-2">
            <Text className="text-xs text-faint-foreground">
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
            <Text className="text-xs text-danger mt-1">{item.error}</Text>
          )}
        </Card>
      </Pressable>
    );
  }

  // ─── Drilldown View ───

  function renderDrilldown() {
    if (!selectedRun) return null;

    const categories: ScanDetailCategory[] = [
      "hardcoded",
      "template",
      "filtered",
      "unrecognized",
      "skipped",
    ];

    const counts: Record<ScanDetailCategory, number> = {
      hardcoded: selectedRun.hardcoded_match_count,
      template: selectedRun.template_match_count,
      filtered: selectedRun.filtered_count,
      unrecognized: selectedRun.unrecognized_count,
      skipped: selectedRun.skipped_count,
    };

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
          <Text className="text-xs font-semibold text-faint-foreground uppercase tracking-wider mb-2">
            Pipeline Summary
          </Text>
          <View className="flex-row items-center flex-wrap">
            <Text className="text-2xl font-bold text-foreground mr-2">
              {selectedRun.sms_read_count}
            </Text>
            <Text className="text-sm text-muted-foreground">
              SMS read
            </Text>
          </View>
          <View className="mt-2 flex-row flex-wrap">
            <MiniStat
              label="Parsed"
              value={selectedRun.hardcoded_match_count + selectedRun.template_match_count}
              color={StatusColors[colorScheme].success}
            />
            <MiniStat
              label="Filtered"
              value={selectedRun.filtered_count}
              color={StatusColors[colorScheme].warning}
            />
            <MiniStat
              label="Created"
              value={selectedRun.expense_created_count + selectedRun.credit_created_count}
              color={accent[500]}
            />
          </View>
          {selectedRun.duration_ms != null && (
            <Text className="text-xs text-faint-foreground mt-2">
              Completed in {selectedRun.duration_ms}ms
            </Text>
          )}
        </Card>

        {/* Category cards */}
        {detailsLoading ? (
          <ActivityIndicator size="small" color={accent[500]} className="mt-4" />
        ) : (
          <FlatList
            data={categories.filter((c) => counts[c] > 0)}
            keyExtractor={(item) => item}
            renderItem={({ item: cat }) => {
              const meta = CATEGORY_META[cat];
              const count = counts[cat];
              const catColor =
                meta.colorKey === "info"
                  ? accent[500]
                  : StatusColors[colorScheme][meta.colorKey];

              return (
                <Pressable
                  onPress={() => openCategory(cat)}
                  className="mb-2"
                >
                  <Card>
                    <View className="flex-row items-center">
                      <View
                        className="w-8 h-8 rounded-full items-center justify-center mr-3"
                        style={{ backgroundColor: catColor + "18" }}
                      >
                        <Ionicons name={meta.icon as any} size={16} color={catColor} />
                      </View>
                      <View className="flex-1">
                        <Text className="text-sm font-semibold text-foreground">
                          {meta.label} ({count})
                        </Text>
                        {cat === "filtered" && Object.keys(filterReasons).length > 0 && (
                          <View className="mt-1">
                            {Object.entries(filterReasons).map(([reason, cnt]) => (
                              <Text
                                key={reason}
                                className="text-xs text-faint-foreground"
                              >
                                • {cnt} - {formatFilterReason(reason)}
                              </Text>
                            ))}
                          </View>
                        )}
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                    </View>
                  </Card>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View className="items-center py-8">
                <Text className="text-sm text-muted-foreground">
                  No SMS in this scan
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
    const categoryDetails = details.filter((d) => d.category === selectedCategory);
    const query = searchQuery.toLowerCase().trim();
    const filtered = query
      ? categoryDetails.filter(
          (d) =>
            (d.sms_body_preview ?? "").toLowerCase().includes(query) ||
            (d.sms_address ?? "").toLowerCase().includes(query) ||
            (d.parsed_merchant ?? "").toLowerCase().includes(query),
        )
      : categoryDetails;

    return (
      <View className="flex-1 px-4">
        <View className="flex-row items-center mb-2">
          <View
            className="w-8 h-8 rounded-full items-center justify-center mr-2"
            style={{
              backgroundColor:
                (meta.colorKey === "info"
                  ? accent[500]
                  : StatusColors[colorScheme][meta.colorKey]) + "18",
            }}
          >
            <Ionicons
              name={meta.icon as any}
              size={16}
              color={
                meta.colorKey === "info"
                  ? accent[500]
                  : StatusColors[colorScheme][meta.colorKey]
              }
            />
          </View>
          <Text className="text-base font-bold text-foreground">
            {meta.label} ({filtered.length}{query ? ` of ${categoryDetails.length}` : ""})
          </Text>
        </View>

        {/* Search */}
        <View className="flex-row items-center mb-3 border rounded-lg px-3 py-2" style={{ borderColor: colors.border }}>
          <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search SMS body, sender, merchant..."
            placeholderTextColor={colors.textSecondary}
            className="flex-1 ml-2 text-sm text-foreground"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item: detail }) => <SmsDetailCard detail={detail} ruleNameMap={ruleNameMap} />}
          ListEmptyComponent={
            <View className="items-center py-8">
              <Text className="text-sm text-muted-foreground">
                {query ? "No SMS matching your search" : "No details recorded for this category"}
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
                <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {detail.sms_address}
                </Text>
              )}
              {dateStr && (
                <Text className="text-xs text-faint-foreground">
                  {dateStr}
                </Text>
              )}
            </View>
          )}

          {/* Full raw SMS body */}
          <View className="bg-card dark:bg-surface-dark rounded-lg p-2.5 mb-2">
            <Text className="text-xs text-foreground leading-[18px]" selectable>
              {detail.sms_body_preview ?? "No SMS body available"}
            </Text>
          </View>

          {/* Parsed fields table */}
          {hasParsedData && (
            <View className="border-t border-border pt-2">
              <Text className="text-[10px] font-semibold text-faint-foreground uppercase tracking-wider mb-1.5">
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
                <Text className="text-[10px] font-semibold text-faint-foreground uppercase tracking-wider mb-1.5">
                  Rules Applied
                </Text>
                {ruleIds.map((id) => (
                  <View key={id} className="flex-row items-center py-0.5">
                    <Ionicons name="sparkles" size={10} color={accent[500]} style={{ marginRight: 4 }} />
                    <Text className="text-xs font-medium" style={{ color: accent[500] }}>
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
                } as never);
              }}
              className="flex-row items-center mt-2 pt-2 border-t border-border"
            >
              <Ionicons name="add-circle-outline" size={14} color={accent[500]} />
              <Text className="text-xs font-medium ml-1" style={{ color: accent[500] }}>
                Teach Arth this SMS
              </Text>
            </Pressable>
          )}
        </Card>
      </View>
    );
  }

  function ParsedRow({ label, value, isWarning, isAccent }: { label: string; value: string; isWarning?: boolean; isAccent?: boolean }) {
    const valueColor = isWarning
      ? StatusColors[colorScheme].warning
      : isAccent
        ? accent[500]
        : undefined;
    return (
      <View className="flex-row items-center justify-between py-0.5">
        <Text className="text-xs text-faint-foreground">{label}</Text>
        <Text
          className="text-xs font-medium text-foreground"
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
    const pillColor = colorKey
      ? StatusColors[colorScheme][colorKey]
      : colors.textSecondary;

    return (
      <View
        className="rounded-full px-2 py-0.5"
        style={{ backgroundColor: pillColor + "18" }}
      >
        <Text className="text-[10px] font-medium" style={{ color: pillColor }}>
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
        color={colors.textSecondary}
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
        <Text className="text-lg font-bold" style={{ color }}>
          {value}
        </Text>
        <Text className="text-xs text-faint-foreground">
          {label}
        </Text>
      </View>
    );
  }

  // ─── Main Render ───

  const showBackButton = viewMode !== "list";
  const title =
    viewMode === "list"
      ? "SMS Scan Runs"
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
                  <Ionicons name="chevron-back" size={24} color={accent[500]} />
                </Pressable>
              )
            : undefined,
        }}
      />

      {viewMode === "list" && (
        <>
          {loading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={accent[500]} />
            </View>
          ) : runs.length === 0 ? (
            <View className="flex-1 items-center justify-center">
              <Ionicons name="scan-outline" size={48} color={colors.textSecondary} />
              <Text className="text-lg font-medium text-foreground mt-3">
                No scan history
              </Text>
              <Text className="text-sm text-muted-foreground text-center mt-1 px-8">
                Run an SMS scan from Settings to see results here.
              </Text>
            </View>
          ) : (
            <FlatList
              data={runs}
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
