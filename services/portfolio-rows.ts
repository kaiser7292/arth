import { formatAmount } from '@/utils/format';
import { formatDate } from '@/utils/date';
import { settingsStorage } from '@/services/storage';
import type { KiteHolding, KiteMFHolding, KiteMFOrder, KiteOrder, KitePosition, KiteSIP } from '@/services/kite-connect';
import type { AngelHolding, AngelOrder, AngelPosition } from '@/services/angel-connect';
import type { ZebpayBalance, ZebpayOrder } from '@/services/zebpay-connect';

// One row shape for every broker list: holdings, funds, crypto, positions, SIPs and orders.

export type RowTone = 'success' | 'danger' | 'warning' | 'neutral';

export interface PortfolioRow {
  key: string;
  title: string;
  badge?: { label: string; tone: RowTone };
  /** Muted lines under the title, e.g. "690 shares · avg ₹30.40", "LTP ₹28.41". */
  details: string[];
  /** Bold right-hand amount: current value for holdings, order/instalment value otherwise. */
  value: number | null;
  /** Green/red line under the value. */
  pnl?: { amount: number; pct: number | null };
  /** Muted/coloured line under the value when there is no P&L (order status, next date). */
  note?: { text: string; tone: RowTone };
}

export type SortKey = 'value' | 'pnl' | 'pnlPct' | 'name';
export interface SortState { key: SortKey; dir: 'asc' | 'desc' }
export const DEFAULT_SORT: SortState = { key: 'value', dir: 'desc' };

export const SORT_LABELS: Record<SortKey, string> = {
  value: 'Value',
  pnl: 'P&L',
  pnlPct: 'P&L %',
  name: 'Name',
};

// ─── Formatting ─────────────────────────────────────────────────────────────

/** Quantity with only the decimals it needs: 690, 132.688, 0.00123. */
export function formatQty(q: number): string {
  return q.toLocaleString('en-IN', { maximumFractionDigits: 8 });
}

function pctOf(amount: number, base: number): number | null {
  return base > 0 ? (amount / base) * 100 : null;
}

function statusTone(status: string): RowTone {
  const s = status.toLowerCase();
  if (s === 'complete' || s === 'confirmed' || s === 'filled') return 'success';
  if (s === 'rejected' || s === 'cancelled' || s === 'canceled') return 'danger';
  if (s === 'open' || s === 'pending' || s === 'trigger pending') return 'warning';
  return 'neutral';
}

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function sideBadge(side: string): PortfolioRow['badge'] {
  const s = side.toLowerCase();
  const isBuy = s === 'buy' || s === 'bid';
  return { label: isBuy ? 'BUY' : 'SELL', tone: isBuy ? 'success' : 'danger' };
}

function holdingRow(
  key: string, title: string, qty: number, unit: string, avg: number | null,
  priceLabel: string, price: number, priceNote: string, pnl: number | null,
  badge?: PortfolioRow['badge'], extra?: string,
): PortfolioRow {
  const invested = avg != null ? Math.abs(qty) * avg : 0;
  const qtyLine = [`${formatQty(Math.abs(qty))} ${unit}`, avg != null && avg > 0 ? `avg ${formatAmount(avg)}` : '', extra ?? '']
    .filter(Boolean).join(' · ');
  const priceLine = [price > 0 ? `${priceLabel} ${formatAmount(price)}` : '', priceNote].filter(Boolean).join(' · ');
  return {
    key,
    title,
    badge,
    details: [qtyLine, priceLine].filter(Boolean),
    value: Math.abs(qty) * price,
    pnl: pnl != null ? { amount: pnl, pct: pctOf(pnl, invested) } : undefined,
  };
}

// ─── Zerodha Kite ───────────────────────────────────────────────────────────

export function kiteHoldingRow(h: KiteHolding): PortfolioRow {
  const qty = h.quantity + (h.t1_quantity ?? 0);
  return holdingRow(
    `kite-eq-${h.isin}`, h.tradingsymbol, qty, 'shares', h.average_price, 'LTP', h.last_price, '', h.pnl,
    undefined, h.t1_quantity > 0 ? `${formatQty(h.t1_quantity)} pending` : undefined,
  );
}

export function kiteMFRow(h: KiteMFHolding): PortfolioRow {
  // Kite's /mf/holdings returns pnl = 0, so derive it from the average NAV.
  const pnl = h.quantity * (h.last_price - h.average_price);
  const navDate = h.last_price_date ? formatDate(h.last_price_date.slice(0, 10)) : '';
  return holdingRow(
    `kite-mf-${h.tradingsymbol}-${h.folio ?? ''}`, h.fund, h.quantity, 'units', h.average_price, 'NAV', h.last_price, navDate, pnl,
  );
}

export function kitePositionRow(p: KitePosition): PortfolioRow {
  return holdingRow(
    `kite-pos-${p.tradingsymbol}-${p.product}`, p.tradingsymbol, p.quantity, 'shares', p.average_price, 'LTP', p.last_price, '', p.pnl,
    p.quantity < 0 ? { label: 'SHORT', tone: 'danger' } : { label: 'LONG', tone: 'success' }, p.product,
  );
}

export function kiteSipRow(s: KiteSIP): PortfolioRow {
  const schedule = [titleCase(s.frequency), s.instalment_day ? `day ${s.instalment_day}` : '',
    s.instalments_remaining > 0 ? `${s.instalments_remaining} left` : ''].filter(Boolean).join(' · ');
  const next = s.next_instalment ? shortDate(s.next_instalment) : '';
  return {
    key: `kite-sip-${s.sip_id}`,
    title: s.fund,
    details: [schedule],
    value: s.instalment_amount,
    note: next ? { text: `Next ${next}`, tone: 'neutral' } : undefined,
  };
}

export function kiteOrderRow(o: KiteOrder): PortfolioRow {
  const price = o.average_price > 0 ? o.average_price : o.price;
  const filled = o.filled_quantity ?? 0;
  return {
    key: `kite-ord-${o.order_id}`,
    title: o.tradingsymbol,
    badge: sideBadge(o.transaction_type),
    details: [[`${formatQty(filled)}/${formatQty(o.quantity)} shares`, price > 0 ? `@ ${formatAmount(price)}` : '', o.order_type]
      .filter(Boolean).join(' · ')],
    value: price > 0 ? (filled > 0 ? filled : o.quantity) * price : null,
    note: { text: [titleCase(o.status), shortDate(o.order_timestamp)].filter(Boolean).join(' · '), tone: statusTone(o.status) },
  };
}

export function kiteMFOrderRow(o: KiteMFOrder): PortfolioRow {
  return {
    key: `kite-mford-${o.order_id}`,
    title: o.fund,
    badge: sideBadge(o.order_type),
    details: [[o.quantity > 0 ? `${formatQty(o.quantity)} units` : '', o.price > 0 ? `@ ${formatAmount(o.price)}` : '']
      .filter(Boolean).join(' · ')].filter(Boolean),
    value: o.amount > 0 ? o.amount : o.quantity * o.price || null,
    note: { text: [titleCase(o.status), shortDate(o.order_timestamp)].filter(Boolean).join(' · '), tone: statusTone(o.status) },
  };
}

// ─── Angel One ──────────────────────────────────────────────────────────────

export function angelHoldingRow(h: AngelHolding): PortfolioRow {
  const row = holdingRow(
    `angel-eq-${h.isin || h.tradingsymbol}`, h.tradingsymbol, h.quantity, 'shares', h.averageprice, 'LTP', h.ltp, '',
    h.profitandloss, undefined, h.t1quantity > 0 ? `${formatQty(h.t1quantity)} pending` : undefined,
  );
  // Angel reports its own P&L %; prefer it so the number matches the Angel app.
  if (row.pnl && Number.isFinite(h.pnlpercentage)) row.pnl.pct = h.pnlpercentage;
  return row;
}

export function angelPositionRow(p: AngelPosition): PortfolioRow {
  const avg = p.netqty > 0 ? p.buyavgprice : p.sellavgprice;
  return holdingRow(
    `angel-pos-${p.tradingsymbol}-${p.producttype}`, p.tradingsymbol, p.netqty, 'shares', avg || p.avg_price || null, 'LTP',
    p.ltp, '', p.pnl, p.netqty < 0 ? { label: 'SHORT', tone: 'danger' } : { label: 'LONG', tone: 'success' }, p.producttype,
  );
}

export function angelOrderRow(o: AngelOrder): PortfolioRow {
  const price = o.averageprice > 0 ? o.averageprice : o.price;
  const filled = o.filledshares ?? 0;
  return {
    key: `angel-ord-${o.orderid}`,
    title: o.tradingsymbol,
    badge: sideBadge(o.transactiontype),
    details: [[`${formatQty(filled)}/${formatQty(o.quantity)} shares`, price > 0 ? `@ ${formatAmount(price)}` : '', o.producttype]
      .filter(Boolean).join(' · ')],
    value: price > 0 ? (filled > 0 ? filled : o.quantity) * price : null,
    note: { text: [titleCase(o.orderstatus || o.status), o.updatetime ? shortDate(o.updatetime) : ''].filter(Boolean).join(' · '), tone: statusTone(o.orderstatus || o.status) },
  };
}

// ─── Zebpay ─────────────────────────────────────────────────────────────────

export function zebpayBalanceRow(b: ZebpayBalance): PortfolioRow {
  // Zebpay's balance API has no buy price, so there is no average or P&L to show.
  return {
    ...holdingRow(`zebpay-${b.currency}`, b.currency, b.balance, b.currency, null, 'Price', b.currentPrice, '', null),
    value: b.inrValue,
  };
}

export function zebpayOrderRow(o: ZebpayOrder): PortfolioRow {
  const coin = o.symbol.split(/[-/]/)[0] || o.symbol;
  return {
    key: `zebpay-ord-${o.orderId}`,
    title: o.symbol,
    badge: sideBadge(o.side),
    details: [[`${formatQty(o.filled ?? 0)}/${formatQty(o.amount)} ${coin}`, o.price > 0 ? `@ ${formatAmount(o.price)}` : '', titleCase(o.type)]
      .filter(Boolean).join(' · ')],
    value: o.price > 0 ? o.amount * o.price : null,
    note: { text: [titleCase(o.status), o.timestamp ? shortDate(new Date(o.timestamp < 1e12 ? o.timestamp * 1000 : o.timestamp).toISOString()) : ''].filter(Boolean).join(' · '), tone: statusTone(o.status) },
  };
}

// ─── Search + sort ──────────────────────────────────────────────────────────

export function filterRows(rows: PortfolioRow[], query: string): PortfolioRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.title.toLowerCase().includes(q) || r.badge?.label.toLowerCase().includes(q));
}

function metric(r: PortfolioRow, key: SortKey): number | null {
  if (key === 'value') return r.value;
  if (key === 'pnl') return r.pnl?.amount ?? null;
  if (key === 'pnlPct') return r.pnl?.pct ?? null;
  return null;
}

/** Rows missing the sorted-on number always go last, whichever direction. */
export function sortRows(rows: PortfolioRow[], sort: SortState): PortfolioRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === 'name') return sign * a.title.localeCompare(b.title, 'en', { sensitivity: 'base' });
    const x = metric(a, sort.key);
    const y = metric(b, sort.key);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return sign * (x - y);
  });
}

export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'name' ? 'asc' : 'desc' };
}

const SORT_PREF = (broker: string) => `portfolio_sort:${broker}`;

export function getSortPref(broker: string): SortState {
  try {
    const raw = settingsStorage.getString(SORT_PREF(broker));
    const p = raw ? (JSON.parse(raw) as SortState) : null;
    return p && p.key in SORT_LABELS && (p.dir === 'asc' || p.dir === 'desc') ? p : DEFAULT_SORT;
  } catch {
    return DEFAULT_SORT;
  }
}

export function setSortPref(broker: string, sort: SortState): void {
  settingsStorage.set(SORT_PREF(broker), JSON.stringify(sort));
}
