import { Card, FilterChip, ScreenContainer } from "@/components/ui";
import { DEFAULT_USER_ID } from "@/constants/app";
import { StatusColors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
    getAuditLog,
    type AuditActionType,
    type AuditLogEntry,
    type AuditObjectType,
    type AuditSourceType,
} from "@/services/audit-log";
import { formatAmount } from "@/utils/format";
import { formatDateTimeInTimezone } from "@/utils/timezone";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SectionList, Text, TextInput, View } from "react-native";

/**
 * Settings → Automation → Audit Log (v15.12.1 new).
 *
 * Read-only list of actions taken on detected / manual records in the last
 * N days, with filter chips for source (SMS / manual / auto-detected),
 * action (approved / rejected / marked as transfer / etc), object type
 * (expense / credit / transfer / hisaab), and a search box.
 *
 * Tapping a navigable row opens the underlying record's detail screen.
 * Non-navigable rows (forecasts closed, transfers deleted) stay un-tappable.
 */

type DateScope = "7d" | "30d" | "90d" | "year" | "all";

const SOURCE_OPTIONS: { key: AuditSourceType; label: string; icon: keyof typeof import("@expo/vector-icons/build/Ionicons").default.glyphMap }[] = [
  { key: "sms", label: "SMS", icon: "chatbubble-outline" },
  { key: "manual", label: "Manual", icon: "create-outline" },
];

const OBJECT_OPTIONS: { key: AuditObjectType; label: string }[] = [
  { key: "expense", label: "Expenses" },
  { key: "credit", label: "Credits" },
  { key: "transfer", label: "Transfers" },
  { key: "hisaab", label: "Hisaab" },
  { key: "forecast", label: "Forecasts" },
];

const ACTION_OPTIONS: { key: AuditActionType; label: string }[] = [
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "created", label: "Created" },
  { key: "edited", label: "Edited" },
  { key: "deleted", label: "Deleted" },
  { key: "marked_as_transfer", label: "Marked as Transfer" },
  { key: "marked_as_cc_bill", label: "Marked as CC Bill" },
  { key: "marked_as_settlement", label: "Marked as Settlement" },
  { key: "linked_to_reminder", label: "Linked to Reminder" },
  { key: "reclassified_by_rule", label: "Reclassified by Rule" },
  { key: "refunded", label: "Refunded" },
];

const DATE_SCOPES: { key: DateScope; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "year", label: "This year" },
  { key: "all", label: "All" },
];

function computeDateRange(scope: DateScope): { from?: string; to?: string } {
  const today = new Date();
  const toDate = today.toISOString().slice(0, 10);
  const d = new Date(today);
  switch (scope) {
    case "7d":
      d.setDate(d.getDate() - 7);
      return { from: d.toISOString().slice(0, 10), to: toDate };
    case "30d":
      d.setDate(d.getDate() - 30);
      return { from: d.toISOString().slice(0, 10), to: toDate };
    case "90d":
      d.setDate(d.getDate() - 90);
      return { from: d.toISOString().slice(0, 10), to: toDate };
    case "year":
      return { from: `${today.getFullYear()}-01-01`, to: toDate };
    case "all":
      return {};
  }
}

function actionLabel(a: AuditActionType): string {
  return ACTION_OPTIONS.find((o) => o.key === a)?.label ?? a;
}

type StatusPalette = (typeof StatusColors)[keyof typeof StatusColors];

function actionColor(a: AuditActionType, sc: StatusPalette): string {
  switch (a) {
    case "approved":
    case "created":
    case "marked_as_cc_bill":
    case "marked_as_settlement":
    case "linked_to_reminder":
      return sc.success;
    case "rejected":
    case "deleted":
      return sc.danger;
    case "edited":
      return "#3B82F6";
    case "marked_as_transfer":
    case "reclassified_by_rule":
    case "refunded":
      return sc.warning;
    default:
      return sc.muted;
  }
}

function actionIcon(a: AuditActionType): keyof typeof import("@expo/vector-icons/build/Ionicons").default.glyphMap {
  switch (a) {
    case "approved":
    case "created":
      return "checkmark-circle-outline";
    case "rejected":
      return "close-circle-outline";
    case "deleted":
      return "trash-outline";
    case "marked_as_transfer":
    case "marked_as_cc_bill":
      return "swap-horizontal-outline";
    case "marked_as_settlement":
      return "people-outline";
    case "linked_to_reminder":
      return "repeat-outline";
    case "reclassified_by_rule":
      return "sparkles-outline";
    case "refunded":
      return "return-down-back-outline";
    case "edited":
      return "pencil-outline";
    default:
      return "ellipse-outline";
  }
}

function formatActionTimestamp(ts: string): string {
  // SQLite datetime('now') returns UTC time in YYYY-MM-DD HH:MM:SS format
  // Convert to ISO format with 'Z' suffix to indicate UTC for proper timezone conversion
  let isoString: string;
  if (ts.includes("T")) {
    // Already has ISO format, ensure it has timezone indicator
    if (ts.endsWith("Z")) {
      isoString = ts;
    } else {
      isoString = ts + "Z";
    }
  } else if (ts.includes(" ")) {
    // SQLite format: YYYY-MM-DD HH:MM:SS -> YYYY-MM-DDTHH:MM:SSZ (UTC)
    isoString = ts.replace(" ", "T") + "Z";
  } else {
    // Date only: YYYY-MM-DD -> YYYY-MM-DDT00:00:00Z (UTC)
    isoString = ts + "T00:00:00Z";
  }
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return ts;
  return formatDateTimeInTimezone(isoString);
}

function objectIcon(o: AuditObjectType): keyof typeof import("@expo/vector-icons/build/Ionicons").default.glyphMap {
  switch (o) {
    case "expense":
      return "arrow-up-outline";
    case "credit":
      return "arrow-down-outline";
    case "transfer":
      return "swap-horizontal-outline";
    case "hisaab":
      return "people-outline";
    case "forecast":
      return "time-outline";
  }
}

type EntrySection = { title: string; data: AuditLogEntry[] };

function groupEntriesByDate(entries: AuditLogEntry[]): EntrySection[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);

  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function sectionTitle(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00");
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) return "Today";
    if (d.getTime() === yesterday.getTime()) return "Yesterday";
    if (d >= weekAgo) return WEEKDAYS[d.getDay()];
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }

  const buckets = new Map<string, AuditLogEntry[]>();
  for (const entry of entries) {
    const ts = entry.actionTimestamp ?? entry.date;
    const dateKey = ts.slice(0, 10);
    const title = sectionTitle(dateKey);
    if (!buckets.has(title)) buckets.set(title, []);
    buckets.get(title)!.push(entry);
  }

  return Array.from(buckets.entries()).map(([title, data]) => ({ title, data }));
}

export default function AuditLogScreen() {
  const router = useRouter();
  const { colors, colorScheme } = useColorScheme();
  const sc = StatusColors[colorScheme];

  const [scope, setScope] = useState<DateScope>("30d");
  const [sources, setSources] = useState<Set<AuditSourceType>>(new Set());
  const [objects, setObjects] = useState<Set<AuditObjectType>>(new Set());
  const [actions, setActions] = useState<Set<AuditActionType>>(new Set());
  const [searchRaw, setSearchRaw] = useState("");
  const search = useDebouncedValue(searchRaw, 300);
  const [expanded, setExpanded] = useState(false);

  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const allSections = groupEntriesByDate(entries);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const toggleSection = useCallback((title: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }, []);

  const sections = allSections.map((s) =>
    collapsedSections.has(s.title) ? { ...s, data: [] } : s,
  );

  const load = useCallback(async () => {
    try {
      const { from, to } = computeDateRange(scope);
      const list = await getAuditLog(DEFAULT_USER_ID, {
        fromDate: from,
        toDate: to,
        sources: sources.size > 0 ? Array.from(sources) : undefined,
        objectTypes: objects.size > 0 ? Array.from(objects) : undefined,
        actionTypes: actions.size > 0 ? Array.from(actions) : undefined,
        search: search || undefined,
        limit: 500,
      });
      setEntries(list);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [scope, sources, objects, actions, search]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const toggle = <T,>(set: Set<T>, setFn: (s: Set<T>) => void, v: T) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setFn(next);
  };

  const clearAll = useCallback(() => {
    setSources(new Set());
    setObjects(new Set());
    setActions(new Set());
    setSearchRaw("");
  }, []);

  const hasFilters = sources.size > 0 || objects.size > 0 || actions.size > 0 || searchRaw.trim().length > 0;

  const handleOpen = useCallback(
    (entry: AuditLogEntry) => {
      if (!entry.navigable) return;
      switch (entry.objectType) {
        case "expense":
        case "credit":
        case "forecast":
          router.push(`/expense/${entry.id}` as never);
          return;
        case "transfer": {
          // Best effort: drill into the transfer's from or to account ledger
          // with the transfer highlighted. For now we can't resolve the
          // account id without re-querying — route to Accounts list instead.
          router.push(`/settings/account-master` as never);
          return;
        }
        case "hisaab":
          // Hisaab settlement — jump to the person's ledger. We'd need the
          // person id here; use the settlement id is not enough. Fallback:
          // just go to the Hisaab people list.
          router.push(`/hisaab/persons` as never);
          return;
      }
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: AuditLogEntry }) => {
      const color = actionColor(item.actionType, sc);
      return (
        <Pressable
          onPress={() => handleOpen(item)}
          disabled={!item.navigable}
          className="flex-row items-center mx-4 py-3 border-b border-border"
          style={{ opacity: item.navigable ? 1 : 0.7 }}
        >
          <View
            className="w-9 h-9 rounded-full items-center justify-center mr-3"
            style={{ backgroundColor: color + "14" }}
          >
            <Ionicons name={actionIcon(item.actionType)} size={18} color={color} />
          </View>
          <View className="flex-1">
            <Text
              className="text-sm font-semibold text-foreground"
              numberOfLines={1}
            >
              {item.description}
            </Text>
            {/* First metadata line: action badge + SMS tag + type icon + transaction date */}
            <View className="flex-row items-center flex-wrap mt-0.5 gap-y-1">
              <View
                className="px-1.5 py-0.5 rounded mr-1.5"
                style={{ backgroundColor: color + "14" }}
              >
                <Text className="text-[9px] font-semibold" style={{ color }}>
                  {actionLabel(item.actionType).toUpperCase()}
                </Text>
              </View>
              {item.sourceType === "sms" && (
                <View className="px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900 mr-1.5">
                  <Text className="text-[8px] font-semibold text-blue-600 dark:text-blue-300">SMS</Text>
                </View>
              )}
              <Ionicons
                name={objectIcon(item.objectType)}
                size={10}
                color={colors.textSecondary}
              />
              <Text className="text-[10px] text-muted-foreground ml-1">
                {item.date}
              </Text>
            </View>
            {/* Second metadata line: account label + action timestamp — own row so they never overflow */}
            {(item.accountLabel || item.actionTimestamp) && (
              <View className="flex-row items-center mt-0.5 flex-wrap gap-y-0.5">
                {item.accountLabel && (
                  <Text
                    className="text-[10px] text-faint-foreground mr-1.5"
                    numberOfLines={1}
                    style={{ flexShrink: 1 }}
                  >
                    {item.accountLabel}
                  </Text>
                )}
                {item.actionTimestamp && (
                  <Text className="text-[10px] text-faint-foreground">
                    {item.accountLabel ? "· " : ""}{formatActionTimestamp(item.actionTimestamp)}
                  </Text>
                )}
              </View>
            )}
            {item.editDetails && (
              <View className="mt-1.5 px-2 py-1.5 rounded bg-card">
                <Text className="text-[10px] text-muted-foreground">
                  {item.editDetails.fieldLabel}: <Text className="line-through">{item.editDetails.oldValue ?? "empty"}</Text> → <Text className="font-medium text-foreground">{item.editDetails.newValue ?? "empty"}</Text>
                </Text>
              </View>
            )}
          </View>
          <View className="items-end ml-2">
            <Text className="text-sm font-bold" style={{ color }}>
              {formatAmount(item.amount)}
            </Text>
          </View>
          {item.navigable && (
            <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} className="ml-1" />
          )}
        </Pressable>
      );
    },
    [colors.textSecondary, handleOpen, sc],
  );

  return (
    <ScreenContainer padTop={false}>
      {/* Header card with filters */}
      <View className="mx-4 mt-3">
        <Card>
          {/* Date scope row */}
          <View className="flex-row flex-wrap gap-2 mb-3">
            {DATE_SCOPES.map((o) => (
              <FilterChip
                key={o.key}
                label={o.label}
                active={scope === o.key}
                onPress={() => setScope(o.key)}
              />
            ))}
          </View>

          {/* Search */}
          <View className="flex-row items-center border border-border rounded-lg px-3 py-2 mb-2">
            <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
            <TextInput
              value={searchRaw}
              onChangeText={setSearchRaw}
              placeholder="Search merchant, description, account…"
              placeholderTextColor={colors.textSecondary}
              className="flex-1 ml-2 text-sm"
              style={{ color: colors.text }}
            />
            {searchRaw ? (
              <Pressable onPress={() => setSearchRaw("")} hitSlop={8} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
              </Pressable>
            ) : null}
          </View>

          {/* Filter toggle */}
          <Pressable
            onPress={() => setExpanded(!expanded)}
            className="flex-row items-center justify-between py-1"
            accessibilityRole="button"
            accessibilityLabel={expanded ? "Hide filters" : "Show filters"}
          >
            <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
              {hasFilters ? `Filters active · ${sources.size + objects.size + actions.size} selected` : "Add filters"}
            </Text>
            <View className="flex-row items-center">
              {hasFilters && (
                <Pressable onPress={clearAll} hitSlop={8} accessibilityLabel="Clear all filters">
                  <Text className="text-xs mr-2" style={{ color: colors.textSecondary }}>
                    Clear
                  </Text>
                </Pressable>
              )}
              <Ionicons
                name={expanded ? "chevron-up" : "chevron-down"}
                size={16}
                color={colors.textSecondary}
              />
            </View>
          </Pressable>

          {expanded && (
            <View className="mt-3">
              <Text
                className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: colors.textSecondary }}
              >
                Source
              </Text>
              <View className="flex-row flex-wrap gap-2 mb-3">
                {SOURCE_OPTIONS.map((o) => (
                  <FilterChip
                    key={o.key}
                    label={o.label}
                    active={sources.has(o.key)}
                    onPress={() => toggle(sources, setSources, o.key)}
                  />
                ))}
              </View>

              <Text
                className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: colors.textSecondary }}
              >
                Type
              </Text>
              <View className="flex-row flex-wrap gap-2 mb-3">
                {OBJECT_OPTIONS.map((o) => (
                  <FilterChip
                    key={o.key}
                    label={o.label}
                    active={objects.has(o.key)}
                    onPress={() => toggle(objects, setObjects, o.key)}
                  />
                ))}
              </View>

              <Text
                className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
                style={{ color: colors.textSecondary }}
              >
                Action
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {ACTION_OPTIONS.map((o) => (
                  <FilterChip
                    key={o.key}
                    label={o.label}
                    active={actions.has(o.key)}
                    onPress={() => toggle(actions, setActions, o.key)}
                  />
                ))}
              </View>
            </View>
          )}
        </Card>
      </View>

      {/* Results */}
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.textSecondary} />
          <Text className="text-sm mt-2" style={{ color: colors.textSecondary }}>
            Loading audit log…
          </Text>
        </View>
      ) : entries.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="list-outline" size={48} color={colors.textSecondary} />
          <Text
            className="text-lg font-medium mt-4"
            style={{ color: colors.text }}
          >
            Nothing here
          </Text>
          <Text
            className="text-sm text-center mt-2"
            style={{ color: colors.textSecondary }}
          >
            {hasFilters
              ? "No records match these filters. Try clearing them or widening the date scope."
              : "No actions recorded in this window."}
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          renderItem={renderItem}
          keyExtractor={(item, idx) => `${item.objectType}:${item.id}:${item.actionType}:${idx}`}
          renderSectionHeader={({ section }) => {
            const isCollapsed = collapsedSections.has(section.title);
            const count = (allSections.find((s) => s.title === section.title)?.data.length) ?? 0;
            return (
              <Pressable
                onPress={() => toggleSection(section.title)}
                className="mx-4 mt-3 mb-1 flex-row items-center py-1.5"
              >
                <Ionicons
                  name={isCollapsed ? "chevron-forward" : "chevron-down"}
                  size={14}
                  color={colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text
                  className="text-[10px] font-semibold uppercase"
                  style={{ color: colors.textSecondary, letterSpacing: 0.5 }}
                  numberOfLines={1}
                >
                  {section.title}
                </Text>
                <Text className="text-[10px] ml-1.5" style={{ color: colors.textSecondary }}>
                  ({count})
                </Text>
                <View className="flex-1 h-px ml-2" style={{ backgroundColor: colors.border }} />
              </Pressable>
            );
          }}
          ListHeaderComponent={
            <View className="mx-4 mt-3 mb-1">
              <Text className="text-xs" style={{ color: colors.textSecondary }}>
                Showing {entries.length} {entries.length === 1 ? "event" : "events"}
                {entries.length >= 500 ? " (capped at 500 - narrow the date range for more)" : ""}
              </Text>
            </View>
          }
          ListFooterComponent={<View style={{ height: 32 }} />}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      )}
    </ScreenContainer>
  );
}
