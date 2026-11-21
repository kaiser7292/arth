import { markDrawerOpened } from "@/components/motion/drawer-motion";
import { Button, Chip, DateInput, EmptyState, ListToolbar, RadioRow, ScreenContainer, Sheet, Text, moneyTone } from "@/components/ui";
import { DrawerBody, DrawerEnd, DrawerHeader } from "@/components/expense/MonthDrawer";
import { tint } from "@/constants/brand";

import { DEFAULT_USER_ID } from "@/constants/app";
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
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, SectionList, View } from "react-native";
import { useTheme, type Theme } from "@/hooks/use-theme";
import { FullScreenFilter, applySortGroup, sortGroupSections } from "@/components/expense/FullScreenFilter";
import { isoDate } from "@/utils/local-date";
import { LoadingState } from "@/components/ui";

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

type QuickScope = "7d" | "30d" | "90d";
type DateScope = QuickScope | "custom";

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
  { key: "marked_as_transfer", label: "Marked as transfer" },
  { key: "marked_as_cc_bill", label: "Marked as CC Bill" },
  { key: "marked_as_settlement", label: "Marked as Settlement" },
  { key: "linked_to_reminder", label: "Linked to Reminder" },
  { key: "reclassified_by_rule", label: "Reclassified by Rule" },
  { key: "refunded", label: "Refunded" },
];

const DATE_SCOPES: { key: QuickScope; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

/** Days back from today for each scope. */
const SCOPE_DAYS: Record<QuickScope, number> = { "7d": 7, "30d": 30, "90d": 90 };

function computeDateRange(scope: QuickScope): { from?: string; to?: string } {
  const today = new Date();
  const toDate = isoDate(today);
  const d = new Date(today);
  d.setDate(d.getDate() - SCOPE_DAYS[scope]);
  return { from: isoDate(d), to: toDate };
}

function AuditDatesSheet({ visible, scope, from, to, onChoose, onClose }: {
  visible: boolean;
  scope: DateScope;
  from: string;
  to: string;
  onChoose: (scope: DateScope, from: string, to: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [customOpen, setCustomOpen] = useState(scope === "custom");
  const [fromDate, setFromDate] = useState(from);
  const [toDate, setToDate] = useState(to);
  useEffect(() => {
    if (!visible) return;
    setCustomOpen(scope === "custom");
    setFromDate(from);
    setToDate(to);
  }, [visible, scope, from, to]);
  const wrongWay = !!fromDate && !!toDate && fromDate > toDate;

  const option = (label: string, selected: boolean, onPress: () => void) => (
    <RadioRow key={label} label={label} on={selected} onPress={onPress} />
  );

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="px-4 pb-4">
        <Text className="text-heading font-bold text-foreground mb-2">Dates</Text>
        {DATE_SCOPES.map((o) => option(`Last ${o.label}`, scope === o.key && !customOpen, () => onChoose(o.key, from, to)))}
        {option("Custom range", customOpen, () => setCustomOpen(true))}
        {customOpen && (
          <View className="mt-2">
            <DateInput label="From" value={fromDate} onChange={setFromDate} />
            <DateInput label="To" value={toDate} onChange={setToDate} />
            {wrongWay && <Text className="text-meta text-danger mb-2">&apos;From&apos; must be before &apos;To&apos;</Text>}
            <Button
              title="Apply"
              disabled={!fromDate || !toDate || wrongWay}
              onPress={() => onChoose("custom", fromDate, toDate)}
            />
          </View>
        )}
      </View>
    </Sheet>
  );
}

function actionLabel(a: AuditActionType): string {
  return ACTION_OPTIONS.find((o) => o.key === a)?.label ?? a;
}

/** Takes the theme as an argument: this is a plain helper, not a component, so it must not
 *  call a hook. It is invoked from inside map callbacks, where a conditional hook call would
 *  break hook order. */
function actionColor(a: AuditActionType, theme: Theme): string {
  switch (a) {
    case "approved":
    case "created":
    case "marked_as_cc_bill":
    case "marked_as_settlement":
    case "linked_to_reminder":
      return theme.success;
    case "rejected":
    case "deleted":
      return theme.danger;
    case "edited":
      return theme.primary;
    case "marked_as_transfer":
    case "reclassified_by_rule":
    case "refunded":
      return theme.warning;
    default:
      return theme.faintForeground;
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

/** The section title groupEntriesByDate gives the current day. Shared so the
 *  "open this drawer by default" test can never drift from the label itself. */
const TODAY_SECTION_TITLE = "Today";

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
    if (d.getTime() === today.getTime()) return TODAY_SECTION_TITLE;
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
  const theme = useTheme();

  const [scope, setScope] = useState<DateScope>("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [datesOpen, setDatesOpen] = useState(false);
  const [sources, setSources] = useState<Set<AuditSourceType>>(new Set());
  const [objects, setObjects] = useState<Set<AuditObjectType>>(new Set());
  const [actions, setActions] = useState<Set<AuditActionType>>(new Set());
  const [searchRaw, setSearchRaw] = useState("");
  const search = useDebouncedValue(searchRaw, 300);
  const [showFilters, setShowFilters] = useState(false);

  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const allSections = groupEntriesByDate(order === "oldest" ? [...entries].reverse() : entries);
  // Only today's drawer is open to begin with; every older day starts closed.
  // Tracking which sections the user TOGGLED (rather than which are collapsed)
  // means a tap flips that day away from its default and stays flipped across
  // reloads -- filtering or searching no longer slams open drawers shut again.
  const [toggledSections, setToggledSections] = useState<Set<string>>(new Set());

  const isSectionCollapsed = useCallback(
    (title: string) => {
      const collapsedByDefault = title !== TODAY_SECTION_TITLE;
      return toggledSections.has(title) ? !collapsedByDefault : collapsedByDefault;
    },
    [toggledSections],
  );

  const toggleSection = useCallback((title: string) => {
    if (isSectionCollapsed(title)) markDrawerOpened(title);
    setToggledSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }, [isSectionCollapsed]);

  const sections = allSections.map((s) =>
    isSectionCollapsed(s.title) ? { ...s, data: [] } : s,
  );

  const load = useCallback(async () => {
    try {
      const { from, to } = scope === "custom" ? { from: customFrom, to: customTo } : computeDateRange(scope);
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
  }, [scope, customFrom, customTo, sources, objects, actions, search]);

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

  // The funnel and the inline chip row describe only what lives BEHIND the funnel.
  // Search has its own always-visible box, so it must not light the funnel up.
  const hasChipFilters = sources.size > 0 || objects.size > 0 || actions.size > 0;
  const hasFilters = hasChipFilters || searchRaw.trim().length > 0;

  const handleOpen = useCallback(
    (entry: AuditLogEntry) => {
      if (!entry.navigable) return;
      switch (entry.objectType) {
        case "expense":
        case "credit":
        case "forecast":
          router.push(`/expense/${entry.id}`);
          return;
        case "transfer": {
          // Best effort: drill into the transfer's from or to account ledger
          // with the transfer highlighted. For now we can't resolve the
          // account id without re-querying — route to Accounts list instead.
          router.push(`/settings/account-master`);
          return;
        }
        case "hisaab":
          // Hisaab settlement — jump to the person's ledger. We'd need the
          // person id here; use the settlement id is not enough. Fallback:
          // just go to the Hisaab people list.
          router.push(`/hisaab/persons`);
          return;
      }
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item, section }: { item: AuditLogEntry; section?: { title: string } }) => {
      const color = actionColor(item.actionType, theme);
      const amountTone = moneyTone(theme, item.objectType === "credit" ? "in" : item.objectType === "transfer" ? "moved" : "out");
      const meta = [OBJECT_OPTIONS.find((o) => o.key === item.objectType)?.label.replace(/s$/, ""), item.date, item.accountLabel]
        .filter(Boolean)
        .join(" · ");
      return (
        <DrawerBody group={section?.title}>
          <Pressable
            onPress={() => handleOpen(item)}
            disabled={!item.navigable}
            className="flex-row items-start px-4 py-3 border-b border-border"
            accessibilityRole={item.navigable ? "button" : undefined}
          >
            <View className="w-10 h-10 rounded-control items-center justify-center mr-3" style={{ backgroundColor: tint(color, 0.12) }}>
              <Ionicons name={actionIcon(item.actionType)} size={20} color={color} />
            </View>
            <View className="flex-1" style={{ minWidth: 0 }}>
              <View className="flex-row items-start">
                <Text className="flex-1 text-body font-semibold text-foreground mr-3" numberOfLines={1}>
                  {item.description}
                </Text>
                <Text className="text-body font-bold" style={{ color: amountTone.fg }}>
                  {formatAmount(item.amount)}
                </Text>
              </View>
              {/* What happened, where it came from, what it was */}
              <View className="flex-row flex-wrap items-center mt-1" style={{ gap: 6 }}>
                <Chip variant="category" label={actionLabel(item.actionType)} color={color} />
                {item.sourceType === "sms" && <Chip variant="status" tone="primary" label="SMS" />}
                <Ionicons name={objectIcon(item.objectType)} size={12} color={theme.mutedForeground} />
                <Text className="text-meta text-muted-foreground shrink" numberOfLines={1}>{meta}</Text>
              </View>
              {item.actionTimestamp && (
                <Text className="text-label text-faint-foreground mt-1">{formatActionTimestamp(item.actionTimestamp)}</Text>
              )}
              {item.editDetails && (
                <View className="mt-2 px-3 py-2 rounded-control" style={{ backgroundColor: theme.alpha("foreground", 0.04) }}>
                  <Text className="text-meta text-muted-foreground">
                    {item.editDetails.fieldLabel}: <Text className="line-through">{item.editDetails.oldValue ?? "empty"}</Text> → <Text className="font-semibold text-foreground">{item.editDetails.newValue ?? "empty"}</Text>
                  </Text>
                </View>
              )}
            </View>
            {item.navigable && (
              <Ionicons name="chevron-forward" size={16} color={theme.faintForeground} style={{ marginLeft: 6, marginTop: 2 }} />
            )}
          </Pressable>
        </DrawerBody>
      );
    },
    [handleOpen, theme],
  );

  // Sort lives in the filter sheet with the filters, as on every list.
  const orderChoice = {
    value: order,
    defaultValue: "newest",
    options: [{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }],
    onChange: (v: string) => setOrder(v as "newest" | "oldest"),
  };

  return (
    <ScreenContainer padTop={false}>
      <ListToolbar
        search={{ value: searchRaw, onChangeText: setSearchRaw, placeholder: "Search merchant, account…" }}
        dates={{ onPress: () => setDatesOpen(true), active: scope !== "7d" }}
        filter={{ onPress: () => setShowFilters(true), activeCount: sources.size + objects.size + actions.size }}
        sort={{ ...orderChoice, inSheet: true }}
        chips={[
          ...(scope !== "7d"
            ? [{
                key: "dates",
                label: scope === "custom" ? `${customFrom} → ${customTo}` : (DATE_SCOPES.find((o) => o.key === scope)?.label ?? scope),
                onRemove: () => setScope("7d"),
              }]
            : []),
          ...Array.from(sources).map((k) => ({ key: `src-${k}`, label: SOURCE_OPTIONS.find((o) => o.key === k)?.label ?? k, onRemove: () => toggle(sources, setSources, k) })),
          ...Array.from(objects).map((k) => ({ key: `obj-${k}`, label: OBJECT_OPTIONS.find((o) => o.key === k)?.label ?? k, onRemove: () => toggle(objects, setObjects, k) })),
          ...Array.from(actions).map((k) => ({ key: `act-${k}`, label: actionLabel(k), onRemove: () => toggle(actions, setActions, k) })),
        ]}
        onClearAll={() => {
          clearAll();
          setScope("7d");
        }}
      />

      <AuditDatesSheet
        visible={datesOpen}
        scope={scope}
        from={customFrom}
        to={customTo}
        onChoose={(next, from, to) => {
          setCustomFrom(from);
          setCustomTo(to);
          setScope(next);
          setDatesOpen(false);
        }}
        onClose={() => setDatesOpen(false)}
      />

      <FullScreenFilter
        noun={{ one: "change", many: "changes" }}
        visible={showFilters}
        sections={[
          ...sortGroupSections(orderChoice),
          { key: "source", label: "Source", icon: "chatbubble-outline", type: "multi", options: SOURCE_OPTIONS.map((o) => ({ id: o.key, label: o.label })), selectedIds: Array.from(sources) },
          { key: "object", label: "Type", icon: "shapes-outline", type: "multi", options: OBJECT_OPTIONS.map((o) => ({ id: o.key, label: o.label })), selectedIds: Array.from(objects) },
          { key: "action", label: "Action", icon: "pulse-outline", type: "multi", options: ACTION_OPTIONS.map((o) => ({ id: o.key, label: o.label })), selectedIds: Array.from(actions), searchable: true },
        ]}
        onApply={(selections) => {
          applySortGroup(selections, orderChoice);
          setSources(new Set((selections.source ?? []) as AuditSourceType[]));
          setObjects(new Set((selections.object ?? []) as AuditObjectType[]));
          setActions(new Set((selections.action ?? []) as AuditActionType[]));
        }}
        onReset={() => {
          clearAll();
          setOrder("newest");
        }}
        onClose={() => setShowFilters(false)}
      />

      {/* Results */}
      {loading ? (
        <LoadingState message="Loading audit log…" />
      ) : entries.length === 0 ? (
        <EmptyState
          icon="list-outline"
          title="Nothing here"
          subtitle={
            hasFilters
              ? "No records match these filters. Try clearing them or widening the date scope."
              : "No actions recorded in this window."
          }
        />
      ) : (
        <SectionList
          sections={sections}
          renderItem={renderItem}
          keyExtractor={(item, idx) => `${item.objectType}:${item.id}:${item.actionType}:${idx}`}
          renderSectionHeader={({ section }) => {
            const open = !isSectionCollapsed(section.title);
            const count = (allSections.find((s) => s.title === section.title)?.data.length) ?? 0;
            return (
              <DrawerHeader
                title={section.title}
                subtitle={`${count} ${count === 1 ? "change" : "changes"}`}
                open={open}
                onToggle={() => toggleSection(section.title)}
              />
            );
          }}
          renderSectionFooter={({ section }) => (isSectionCollapsed(section.title) ? null : <DrawerEnd />)}
          ListHeaderComponent={
            <View className="mx-4 mt-3 mb-1">
              <Text className="text-meta text-muted-foreground">
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
