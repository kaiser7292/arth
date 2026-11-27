import { useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { DrawerCell, EmptyState, GroupHeading, ListToolbar, ScreenContainer, Text } from "@/components/ui";
import { historyLine, localDay, useFixUndo } from "@/components/ai/useFixUndo";
import { useListTools } from "@/hooks/use-list-tools";
import { useTheme } from "@/hooks/use-theme";
import type { FixHistoryEntry } from "@/services/corrections/snapshot";
import { formatAmount } from "@/utils/format";
import type { ListField, ListSort } from "@/utils/list-tools";

const KIND_LABELS: Record<string, string> = { ai: "Fix from your assistant", match: "Bank balance match" };
const STATE_LABELS: Record<string, string> = { undoable: "Can be undone", undone: "Undone", kept: "Kept" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Which state a row is in; the latest undoable one is worked out per render. */
function stateOf(e: FixHistoryEntry, undoableId: string | null): string {
  if (e.undoneAt) return "undone";
  return e.id === undoableId ? "undoable" : "kept";
}

function monthOf(e: FixHistoryEntry): string {
  return localDay(e.at).slice(0, 7);
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

function showMetric(m: { unit: string }, v: number): string {
  if (m.unit === "money") return formatAmount(v);
  if (m.unit === "percent") return `${Math.round(v * 10) / 10}%`;
  return String(Math.round(v));
}

const SORTS: ListSort<FixHistoryEntry>[] = [
  { id: "newest", label: "Newest first", compare: (a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) },
  { id: "oldest", label: "Oldest first", compare: (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) },
  { id: "most", label: "Most changes", compare: (a, b) => b.changes - a.changes || (a.at < b.at ? 1 : -1) },
];

const SEARCH = (e: FixHistoryEntry) => ({ texts: [e.title, ...e.groups.map((g) => g.label), ...e.moved.map((m) => m.label)] });

/**
 * Settings → AI → What AI changed: every applied fix from your assistant and every bank balance
 * match, newest first, with the list toolbar every list has (search, filter, sort, group). The
 * latest AI fix can be undone until the next one is applied (services/corrections/snapshot.ts).
 */
export default function AiHistoryScreen() {
  const theme = useTheme();
  const { history, undoable, undoing, undo } = useFixUndo();
  const [open, setOpen] = useState<string | null>(null);
  const undoableId = undoable?.id ?? null;

  const fields = useMemo<ListField<FixHistoryEntry>[]>(() => [
    { id: "kind", label: "Kind", keyOf: (e) => e.kind, labelOf: (k) => KIND_LABELS[k] ?? k, filter: true, group: true },
    { id: "state", label: "Undo", keyOf: (e) => stateOf(e, undoableId), labelOf: (k) => STATE_LABELS[k] ?? k, filter: true },
    { id: "month", label: "Month", keyOf: monthOf, labelOf: monthLabel, filter: true, group: true, groupOrder: "first" },
  ], [undoableId]);

  const tools = useListTools<FixHistoryEntry>({
    screen: "ai_history",
    noun: { one: "change", many: "changes" },
    rows: history,
    fields,
    sorts: SORTS,
    search: SEARCH,
    searchPlaceholder: "Search what changed",
  });

  if (history.length === 0) {
    return (
      <ScreenContainer padTop={false}>
        <EmptyState
          icon="time-outline"
          title="Nothing changed by AI yet"
          subtitle="When you apply a reply from your AI assistant, it shows here with Undo."
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padTop={false}>
      <ListToolbar {...tools.toolbar} />
      {tools.filterSheet}
      <FlatList
        data={tools.grouped}
        keyExtractor={(row) => (row.type === "heading" ? `heading-${row.key}` : row.item.id)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListHeaderComponent={
          <Text className="text-meta text-muted-foreground px-4 pb-3 leading-5">
            Only the latest fix from your assistant can be undone, until you apply the next one. Undo puts all your data back as it was
            just before it. Bank matches are undone by deleting the adjustment in the account&apos;s ledger.
          </Text>
        }
        ListEmptyComponent={<EmptyState icon="search-outline" title="Nothing matches" subtitle="Try another search or filter." fillScreen={false} />}
        renderItem={({ item: row }) => {
          if (row.type === "heading") {
            return <GroupHeading label={row.label} count={row.count} total={0} open={row.open} onToggle={row.onToggle} noun={row.noun} />;
          }
          const e = row.item;
          const canUndo = e.id === undoableId;
          const isOpen = open === e.id;
          return (
            <DrawerCell row={row}>
              <View className="mx-4 mb-2 rounded-card bg-card border border-border px-4 py-3">
                <Pressable
                  onPress={() => setOpen(isOpen ? null : e.id)}
                  className="flex-row items-center"
                  style={{ minHeight: 44 }}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  accessibilityLabel={`${e.title}, ${historyLine(e, canUndo)}`}
                >
                  <View
                    className="rounded-control items-center justify-center"
                    style={{ width: 32, height: 32, backgroundColor: e.undoneAt ? theme.alpha("foreground", 0.06) : theme.alpha("primary", 0.1) }}
                  >
                    <Ionicons
                      name={e.kind === "match" ? "swap-horizontal-outline" : "sparkles-outline"}
                      size={16}
                      color={e.undoneAt ? theme.mutedForeground : theme.primary}
                    />
                  </View>
                  <View className="flex-1 ml-3 mr-2">
                    <Text
                      className="text-body font-semibold text-foreground"
                      style={e.undoneAt ? { textDecorationLine: "line-through" } : undefined}
                      numberOfLines={1}
                    >
                      {e.title}
                    </Text>
                    <Text className="text-meta text-muted-foreground mt-0.5" numberOfLines={1}>
                      {e.changes} change{e.changes === 1 ? "" : "s"} · {historyLine(e, canUndo)}
                    </Text>
                  </View>
                  {canUndo && (
                    <Pressable onPress={() => void undo()} hitSlop={8} disabled={undoing} accessibilityRole="button" accessibilityLabel={`Undo ${e.title}`} className="ml-1 mr-2">
                      <Text className="text-body font-semibold" style={{ color: theme.primary }}>
                        {undoing ? "Undoing…" : "Undo"}
                      </Text>
                    </Pressable>
                  )}
                  <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={16} color={theme.mutedForeground} />
                </Pressable>
                {isOpen && (
                  <View className="mt-2 pt-2 border-t border-border">
                    {e.groups.map((g) => (
                      <View key={g.label} className="flex-row justify-between mt-1">
                        <Text className="text-meta text-muted-foreground flex-1 mr-2">{g.label}</Text>
                        <Text className="text-meta text-foreground">{g.count}</Text>
                      </View>
                    ))}
                    {e.moved.length > 0 && <Text className="text-meta font-semibold text-foreground mt-2">What moved</Text>}
                    {e.moved.map((m) => (
                      <View key={m.label} className="flex-row justify-between mt-1">
                        <Text className="text-meta text-muted-foreground flex-1 mr-2" numberOfLines={1}>
                          {m.label}
                        </Text>
                        <Text className="text-meta text-foreground">
                          {`${showMetric(m, m.before)} → ${showMetric(m, m.value)}`}
                        </Text>
                      </View>
                    ))}
                    {e.groups.length === 0 && e.moved.length === 0 && <Text className="text-meta text-muted-foreground">No details kept for this one.</Text>}
                    {!canUndo && e.kind === "ai" && !e.undoneAt && (
                      <Text className="text-meta text-muted-foreground mt-2">A later AI fix replaced its undo copy.</Text>
                    )}
                  </View>
                )}
              </View>
            </DrawerCell>
          );
        }}
      />
    </ScreenContainer>
  );
}
