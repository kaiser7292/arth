import { useState } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount, formatReportShort } from "@/utils/format";
import { daysBetween } from "@/utils/date";
import { todayIso } from "@/utils/local-date";
import type { FdLadder, IdleCash, LadderBucketKey } from "@/services/investments-view";

/**
 * The cards under the Investments chart (docs/INVESTMENTS_VIEW_PROPOSAL.md; screens on the
 * design canvas "Arth: Investments view"): at-a-glance tiles, idle cash, and the FD ladder.
 */

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Day and month, with the year when it isn't this one ("10 Jan 2028"). */
const dayMonth = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  const otherYear = y !== new Date().getFullYear();
  return { day: String(d), month: otherYear ? `${SHORT_MONTHS[m - 1]} ${y}` : SHORT_MONTHS[m - 1], shortMonth: otherYear ? `${SHORT_MONTHS[m - 1]} '${String(y).slice(2)}` : SHORT_MONTHS[m - 1] };
};
const asOf = (iso: string) => {
  const n = daysBetween(iso.slice(0, 10), todayIso());
  return n <= 0 ? "As of today" : n === 1 ? "As of yesterday" : `As of ${n} days ago`;
};

// ── At a glance ─────────────────────────────────────────────────────────────

export interface GlanceTile {
  key: string;
  label: string;
  value: number;
  onPress?: () => void;
}

/** Two-by-two tiles; a tile with nothing in it is left out. */
export function GlanceTiles({ tiles }: { tiles: GlanceTile[] }) {
  const shown = tiles.filter((t) => t.value > 0);
  if (shown.length === 0) return null;
  return (
    <View className="mx-4 mt-3 flex-row flex-wrap" style={{ gap: 10 }}>
      {shown.map((t) => (
        <Pressable
          key={t.key}
          onPress={t.onPress}
          disabled={!t.onPress}
          className="rounded-card bg-card border border-border px-3.5 py-3"
          style={{ flexBasis: "47%", flexGrow: 1 }}
          accessibilityRole={t.onPress ? "button" : undefined}
          accessibilityLabel={`${t.label}, ${formatAmount(Math.round(t.value))}`}
        >
          <Text className="text-label text-muted-foreground">{t.label}</Text>
          <Text className="text-heading font-bold text-foreground mt-0.5" numberOfLines={1}>
            {formatReportShort(t.value)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ── Idle cash ───────────────────────────────────────────────────────────────

/** Cash in demat accounts, not invested yet: the figure and how old it is, no flag. */
export function IdleCashCard({
  items,
  nameOf,
  onOpen,
}: {
  items: IdleCash[];
  nameOf: (accountId: string) => string;
  onOpen: (accountId: string) => void;
}) {
  const theme = useTheme();
  if (items.length === 0) return null;
  const total = items.reduce((s, i) => s + i.amount, 0);
  return (
    <Card className="mx-4 mt-3">
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <Ionicons name="wallet-outline" size={18} color={theme.data.series[2]} />
        <Text className="text-body font-semibold text-foreground flex-1">Idle cash</Text>
        <Text className="text-body font-bold text-foreground">{formatAmount(Math.round(total))}</Text>
      </View>
      <Text className="text-label text-muted-foreground mt-1">Cash in your demat accounts, not invested yet</Text>
      {items.map((i, n) => (
        <Pressable
          key={i.accountId}
          onPress={() => onOpen(i.accountId)}
          className="flex-row items-center py-2.5"
          style={n > 0 ? { borderTopWidth: 1, borderTopColor: theme.border } : { marginTop: 6 }}
          accessibilityRole="button"
          accessibilityLabel={`${nameOf(i.accountId)}, ${formatAmount(Math.round(i.amount))} idle, ${asOf(i.asOf).toLowerCase()}`}
        >
          <View className="flex-1">
            <Text className="text-body font-medium text-foreground" numberOfLines={1}>
              {nameOf(i.accountId)}
            </Text>
            <Text className="text-label text-muted-foreground">{asOf(i.asOf)}</Text>
          </View>
          <Text className="text-body font-semibold text-foreground">{formatAmount(Math.round(i.amount))}</Text>
        </Pressable>
      ))}
    </Card>
  );
}

// ── FD ladder ───────────────────────────────────────────────────────────────

/** The FDs as one card: summary, any matured-but-open, buckets that fold, then month by month. */
export function FdLadderCard({
  ladder,
  count,
  total,
  averageRate,
  onOpen,
}: {
  ladder: FdLadder;
  count: number;
  total: number;
  averageRate: number | null;
  onOpen: (accountId: string) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState<LadderBucketKey | null>(null);
  const fd = theme.data.series[1];
  const biggest = Math.max(1, ...ladder.buckets.map((b) => b.amount));
  const monthMax = Math.max(1, ...ladder.months.map((m) => m.amount));
  const heaviest = ladder.months.reduce((a, b) => (b.amount > a.amount ? b : a), ladder.months[0]);
  const next = ladder.nextDate ? dayMonth(ladder.nextDate) : null;
  const summary = [
    `${count} FD${count === 1 ? "" : "s"}`,
    formatReportShort(total),
    averageRate != null ? `${averageRate}% on average` : null,
    next ? `next back ${next.day} ${next.month}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card className="mx-4 mt-3">
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <Ionicons name="bar-chart-outline" size={18} color={fd} />
        <Text className="text-body font-semibold text-foreground flex-1">Fixed deposits</Text>
      </View>
      <Text className="text-label text-muted-foreground mt-1">{summary}</Text>

      {/* Past their date but still open in Arth: renewed or closed? */}
      {ladder.overdue.map((m) => {
        const d = dayMonth(m.maturityDate);
        return (
          <Pressable
            key={`over-${m.financialAccountId}-${m.maturityDate}`}
            onPress={() => onOpen(m.financialAccountId)}
            className="flex-row items-start mt-3 rounded-control px-3 py-2.5"
            style={{ backgroundColor: theme.alpha("warning", 0.08), gap: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`${m.label} matured ${d.day} ${d.month}. Open it to mark it renewed or closed`}
          >
            <Ionicons name="time-outline" size={16} color={theme.warning} style={{ marginTop: 2 }} />
            <View className="flex-1">
              <Text className="text-meta font-semibold text-foreground">
                {m.label} matured {d.day} {d.month}
              </Text>
              <Text className="text-label text-muted-foreground mt-0.5">Still open in Arth. Renewed or closed? Tap to update it.</Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} style={{ marginTop: 2 }} />
          </Pressable>
        );
      })}

      {ladder.buckets.map((b, n) => {
        const isOpen = open === b.key;
        return (
          <View key={b.key} style={n > 0 || ladder.overdue.length > 0 ? { borderTopWidth: 1, borderTopColor: theme.border } : { marginTop: 6 }}>
            <Pressable
              onPress={() => setOpen(isOpen ? null : b.key)}
              className="flex-row items-center py-3"
              style={{ gap: 10 }}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              accessibilityLabel={`${b.label}: ${b.items.length} FD${b.items.length === 1 ? "" : "s"}, ${formatAmount(Math.round(b.amount))} back`}
            >
              <View style={{ minWidth: 104, flexShrink: 0 }}>
                <Text className={`text-body text-foreground ${isOpen ? "font-semibold" : "font-medium"}`}>{b.label}</Text>
                <Text className="text-label text-muted-foreground">
                  {b.items.length} FD{b.items.length === 1 ? "" : "s"}
                </Text>
              </View>
              <View className="flex-1 rounded-pill overflow-hidden" style={{ height: 8, backgroundColor: theme.border }}>
                <View className="rounded-pill" style={{ height: 8, width: `${Math.max(4, Math.round((b.amount / biggest) * 100))}%`, backgroundColor: fd }} />
              </View>
              <Text className="text-body font-semibold text-foreground text-right" style={{ minWidth: 64 }} numberOfLines={1}>
                {formatReportShort(b.amount)}
              </Text>
              <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={14} color={theme.mutedForeground} />
            </Pressable>
            {isOpen && (
              <View className="pb-3" style={{ gap: 8 }}>
                {b.items.map((m) => {
                  const d = dayMonth(m.maturityDate);
                  return (
                    <Pressable
                      key={`${m.financialAccountId}-${m.maturityDate}`}
                      onPress={() => onOpen(m.financialAccountId)}
                      className="flex-row items-center rounded-control px-3 py-2.5 bg-background"
                      style={{ gap: 12 }}
                      accessibilityRole="button"
                      accessibilityLabel={`${m.label}, back ${d.day} ${d.month}, ${formatAmount(Math.round(m.maturityAmount))}`}
                    >
                      <View className="items-center" style={{ minWidth: 40 }}>
                        <Text className="text-body font-bold text-foreground">{d.day}</Text>
                        <Text className="text-label text-muted-foreground">{d.shortMonth}</Text>
                      </View>
                      <View className="flex-1">
                        <Text className="text-body font-medium text-foreground" numberOfLines={1}>
                          {m.label}
                        </Text>
                        {m.ratePa != null && <Text className="text-label text-muted-foreground">{m.ratePa}% a year</Text>}
                      </View>
                      <View className="items-end">
                        <Text className="text-body font-semibold text-foreground">{formatAmount(Math.round(m.maturityAmount))}</Text>
                        {m.interestAmount > 0 && (
                          <Text className="text-label" style={{ color: theme.success }}>
                            +{formatAmount(Math.round(m.interestAmount))}
                          </Text>
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}

      {/* Month by month: how much comes back in each of the next 12 months. */}
      {ladder.months.some((m) => m.amount > 0) && (
        <View className="mt-2 pt-3" style={{ borderTopWidth: 1, borderTopColor: theme.border }}>
          <Text className="text-label font-semibold uppercase tracking-wider text-muted-foreground">Coming back, month by month</Text>
          <View
            className="flex-row items-end mt-3"
            style={{ height: 90, gap: 6 }}
            accessible
            accessibilityLabel={`Amount coming back each month for the next twelve months. Most in ${SHORT_MONTHS[Number(heaviest.month.slice(5)) - 1]}.`}
          >
            {ladder.months.map((m) => (
              <View key={m.month} className="flex-1 items-center justify-end" style={{ height: 90 }}>
                <View
                  className="w-full rounded-control"
                  style={{ height: m.amount > 0 ? Math.max(6, Math.round((m.amount / monthMax) * 84)) : 2, backgroundColor: m.amount > 0 ? fd : theme.border }}
                />
              </View>
            ))}
          </View>
          <View className="flex-row mt-1" style={{ gap: 6 }}>
            {ladder.months.map((m) => (
              <Text key={m.month} className="flex-1 text-center text-label text-muted-foreground" style={m.month === heaviest.month ? { fontWeight: "700", color: theme.foreground } : undefined}>
                {SHORT_MONTHS[Number(m.month.slice(5)) - 1][0]}
              </Text>
            ))}
          </View>
          {heaviest.amount > 0 && (
            <Text className="text-label text-muted-foreground mt-2">
              {SHORT_MONTHS[Number(heaviest.month.slice(5)) - 1]} is the biggest: {formatReportShort(heaviest.amount)} comes back.
            </Text>
          )}
        </View>
      )}
    </Card>
  );
}
