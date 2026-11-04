import Ionicons from "@expo/vector-icons/Ionicons";
import { Fragment, useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import { Badge, Card, FilterChip, ListSeparator, SectionHeader, Text } from '@/components/ui';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { formatAmount } from '@/utils/format';
import { ListToolbar } from '@/components/ui/ListToolbar';
import {
  SORT_LABELS,
  DEFAULT_SORT,
  filterRows,
  getSortPref,
  nextSort,
  setSortPref,
  sortRows,
  type PortfolioRow,
  type RowTone,
  type SortKey,
  type SortState,
} from '@/services/portfolio-rows';

const TABULAR = { fontVariant: ['tabular-nums' as const] };

function useToneColor() {
  const theme = useTheme();
  return (tone: RowTone) =>
    tone === 'success' ? theme.success
      : tone === 'danger' ? theme.danger
      : tone === 'warning' ? theme.warning
      : theme.mutedForeground;
}

function signed(n: number): string {
  return `${n >= 0 ? '+' : '-'}${formatAmount(Math.abs(n))}`;
}

function pnlText(pnl: { amount: number; pct: number | null }): string {
  const pct = pnl.pct != null ? ` (${pnl.pct >= 0 ? '+' : ''}${pnl.pct.toFixed(2)}%)` : '';
  return `${signed(pnl.amount)}${pct}`;
}

// ─── Search + sort state ─────────────────────────────────────────────────────

/** Per-broker search text and sort order; the sort choice is remembered. */
export function usePortfolioView(broker: string) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(() => getSortPref(broker));
  const changeSort = useCallback((key: SortKey) => {
    setSort((cur) => {
      const next = nextSort(cur, key);
      setSortPref(broker, next);
      return next;
    });
  }, [broker]);
  /** Search always applies; sorting only to lists where order isn't meaningful (not orders). */
  const view = useCallback(
    (rows: PortfolioRow[], sortable = true) => {
      const filtered = filterRows(rows, query);
      return sortable ? sortRows(filtered, sort) : filtered;
    },
    [query, sort],
  );
  const chooseSort = useCallback((next: SortState) => {
    setSort(next);
    setSortPref(broker, next);
  }, [broker]);
  return { query, setQuery, sort, changeSort, chooseSort, view };
}

const DIRECTIONS: Record<SortKey, { desc: string; asc: string }> = {
  value: { desc: 'Value (highest first)', asc: 'Value (lowest first)' },
  pnl: { desc: 'P&L (highest first)', asc: 'P&L (lowest first)' },
  pnlPct: { desc: 'P&L % (highest first)', asc: 'P&L % (lowest first)' },
  name: { asc: 'Name (A–Z)', desc: 'Name (Z–A)' },
};
const SORT_OPTIONS = (Object.keys(DIRECTIONS) as SortKey[]).flatMap((key) =>
  (key === 'name' ? (['asc', 'desc'] as const) : (['desc', 'asc'] as const)).map((dir) => ({
    value: `${key}:${dir}`,
    label: DIRECTIONS[key][dir],
  })),
);

export function PortfolioSearchSort({
  query,
  onQuery,
  sort,
  onSort,
}: {
  query: string;
  onQuery: (q: string) => void;
  sort: SortState;
  onSort: (sort: SortState) => void;
}) {
  return (
    <ListToolbar
      search={{
        value: query,
        onChangeText: onQuery,
        placeholder: 'Search name or >5000',
        input: { autoCorrect: false, autoCapitalize: 'none', maxLength: 60 },
      }}
      sort={{
        value: `${sort.key}:${sort.dir}`,
        defaultValue: `${DEFAULT_SORT.key}:${DEFAULT_SORT.dir}`,
        options: SORT_OPTIONS,
        onChange: (v) => {
          const [key, dir] = v.split(':');
          onSort({ key: key as SortKey, dir: dir as SortState['dir'] });
        },
      }}
    />
  );
}

// ─── Rows ────────────────────────────────────────────────────────────────────

export function PortfolioRowView({ row }: { row: PortfolioRow }) {
  const tone = useToneColor();
  return (
    <View className="flex-row items-center py-3">
      <View className="flex-1 mr-3">
        <View className="flex-row items-center">
          <Text className="text-sm font-semibold text-foreground flex-shrink" numberOfLines={2}>
            {row.title}
          </Text>
          {row.badge && (
            <Badge
              label={row.badge.label}
              variant={row.badge.tone === 'neutral' ? 'neutral' : row.badge.tone}
              uppercase
              className="ml-2"
            />
          )}
        </View>
        {row.details.map((d, i) => (
          <Text key={i} className="text-xs text-muted-foreground mt-0.5" style={TABULAR}>
            {d}
          </Text>
        ))}
      </View>
      <View className="items-end">
        {row.value != null && (
          <Text className="text-sm font-bold text-foreground" style={TABULAR}>
            {formatAmount(row.value)}
          </Text>
        )}
        {row.pnl ? (
          <Text className="text-xs mt-0.5" style={[TABULAR, { color: tone(row.pnl.amount >= 0 ? 'success' : 'danger') }]}>
            {pnlText(row.pnl)}
          </Text>
        ) : row.note ? (
          <Text className="text-xs mt-0.5" style={{ color: tone(row.note.tone) }}>
            {row.note.text}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** A titled card of rows split by hairlines. Renders nothing when there are no rows. */
export function PortfolioSection({ title, rows, total, top }: { title: string; rows: PortfolioRow[]; total?: number; top?: ReactNode }) {
  if (rows.length === 0) return null;
  const count = total != null && total !== rows.length ? `${rows.length} of ${total}` : `${rows.length}`;
  return (
    <View className="mx-4 mb-3">
      <SectionHeader title={`${title} (${count})`} />
      <Card className="py-1">
        {top}
        {rows.map((r, i) => (
          <Fragment key={r.key}>
            {i > 0 && <ListSeparator />}
            <PortfolioRowView row={r} />
          </Fragment>
        ))}
      </Card>
    </View>
  );
}

export function PortfolioNoMatches({ query }: { query: string }) {
  return (
    <Text className="text-sm text-muted-foreground text-center mx-4 my-6">
      Nothing matches “{query.trim()}”.
    </Text>
  );
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function SummaryLine({ label, value, color, bold, indent }: {
  label: string; value: string; color?: string; bold?: boolean; indent?: boolean;
}) {
  return (
    <View className={`flex-row justify-between items-center py-1.5 ${indent ? 'pl-3' : ''}`}>
      <Text className={`text-sm ${indent ? 'text-xs' : ''} text-muted-foreground`}>{label}</Text>
      <Text
        className={`${indent ? 'text-xs' : 'text-sm'} ${bold ? 'font-bold' : 'font-semibold'} text-foreground`}
        style={[TABULAR, color ? { color } : null]}
      >
        {value}
      </Text>
    </View>
  );
}

/** A holdings list's totals, shown at the top of its card. Invested and P&L only when the buy prices are known. */
export function HoldingsTotals({ current, invested, caption }: { current: number; invested: number | null; caption?: string }) {
  const theme = useTheme();
  const pnl = invested != null && invested > 0 ? current - invested : null;
  return (
    <View className="py-2 border-b border-border">
      <SummaryLine label="Current value" value={formatAmount(current)} bold />
      {pnl != null && <SummaryLine label="Invested" value={formatAmount(invested as number)} />}
      {pnl != null && (
        <SummaryLine
          label="P&L"
          value={pnlText({ amount: pnl, pct: (pnl / (invested as number)) * 100 })}
          color={pnl >= 0 ? theme.success : theme.danger}
        />
      )}
      {caption ? <Text className="text-label text-faint-foreground mt-1">{caption}</Text> : null}
    </View>
  );
}

export interface SummaryExtra { label: string; value: number; signed?: boolean }

/**
 * The same summary on every broker: Current value, Invested, P&L, Available funds.
 * Lines the broker has no data for are left out.
 */
export function PortfolioSummary({
  current,
  breakdown,
  invested,
  funds,
  extras,
  onSaveSnapshot,
  saving,
  saveDisabled,
}: {
  current: number;
  breakdown?: SummaryExtra[];
  invested?: number | null;
  funds?: number | null;
  extras?: SummaryExtra[];
  onSaveSnapshot: () => void;
  saving: boolean;
  saveDisabled?: boolean;
}) {
  const theme = useTheme();
  const pnl = invested != null && invested > 0 ? current - invested : null;
  const pnlColor = pnl != null ? (pnl >= 0 ? theme.success : theme.danger) : undefined;
  return (
    <View className="mx-4 mb-3">
      <SectionHeader title="Portfolio summary" />
      <Card>
        <SummaryLine label="Current value" value={formatAmount(current)} bold />
        {breakdown && breakdown.length > 1 &&
          breakdown.map((b) => <SummaryLine key={b.label} label={b.label} value={formatAmount(b.value)} indent />)}
        {invested != null && invested > 0 && <SummaryLine label="Invested" value={formatAmount(invested)} />}
        {pnl != null && (
          <SummaryLine label="P&L" value={pnlText({ amount: pnl, pct: (pnl / (invested as number)) * 100 })} color={pnlColor} />
        )}
        {funds != null && <SummaryLine label="Available funds" value={formatAmount(funds)} />}
        {extras?.map((e) => (
          <SummaryLine
            key={e.label}
            label={e.label}
            value={e.signed ? signed(e.value) : formatAmount(e.value)}
            color={e.signed ? (e.value >= 0 ? theme.success : theme.danger) : undefined}
          />
        ))}
        <View className="pt-3 mt-2 border-t border-border">
          <Pressable
            onPress={onSaveSnapshot}
            disabled={saving || saveDisabled}
            className="rounded-lg p-3 flex-row items-center justify-center"
            style={{ backgroundColor: theme.alpha('primary', 0.1), opacity: saving || saveDisabled ? 0.5 : 1 }}
          >
            {saving ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : (
              <Ionicons name="save-outline" size={16} color={theme.primary} />
            )}
            <Text className="text-sm font-semibold ml-2" style={{ color: theme.primary }}>
              {saving ? 'Saving…' : 'Update snapshot with these values'}
            </Text>
          </Pressable>
        </View>
      </Card>
    </View>
  );
}
