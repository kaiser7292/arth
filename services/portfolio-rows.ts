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

// ─── Field readers ──────────────────────────────────────────────────────────
// Broker APIs leave fields out, send null, or send numbers as strings. Every read
// goes through num()/str() so one odd field can't take the whole screen down.

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/** Quantity with only the decimals it needs: 690, 132.688, 0.00123. */
export function formatQty(q: unknown): string {
  return num(q).toLocaleString('en-IN', { maximumFractionDigits: 8 });
}

function pctOf(amount: number, base: number): number | null {
  return base > 0 ? (amount / base) * 100 : null;
}

function statusTone(status: unknown): RowTone {
  const s = str(status).toLowerCase();
  if (s === 'complete' || s === 'confirmed' || s === 'filled') return 'success';
  if (s === 'rejected' || s === 'cancelled' || s === 'canceled' || s === 'failed') return 'danger';
  if (s === 'open' || s === 'pending' || s === 'trigger pending') return 'warning';
  return 'neutral';
}

function titleCase(v: unknown): string {
  const s = str(v);
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
}

function shortDate(v: unknown): string {
  const s = str(v);
  if (!s) return '';
  // Kite sends "2026-09-20 10:00:00", which Hermes won't parse without the T.
  const d = new Date(s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function sideBadge(side: unknown): PortfolioRow['badge'] {
  const s = str(side).toLowerCase();
  if (s === 'buy' || s === 'bid') return { label: 'BUY', tone: 'success' };
  if (s === 'sell' || s === 'ask') return { label: 'SELL', tone: 'danger' };
  return undefined;
}

function statusNote(status: unknown, when: unknown): PortfolioRow['note'] {
  const text = [titleCase(status), shortDate(when)].filter(Boolean).join(' · ');
  return text ? { text, tone: statusTone(status) } : undefined;
}

function holdingRow(
  key: string, title: string, qtyIn: unknown, unit: string, avgIn: unknown,
  priceLabel: string, priceIn: unknown, priceNote: string, pnlIn: unknown,
  badge?: PortfolioRow['badge'], extra?: string,
): PortfolioRow {
  const qty = Math.abs(num(qtyIn));
  const avg = avgIn == null ? null : num(avgIn);
  const price = num(priceIn);
  const invested = avg != null ? qty * avg : 0;
  const qtyLine = [`${formatQty(qty)} ${unit}`.trim(), avg != null && avg > 0 ? `avg ${formatAmount(avg)}` : '', extra ?? '']
    .filter(Boolean).join(' · ');
  const priceLine = [price > 0 ? `${priceLabel} ${formatAmount(price)}` : '', priceNote].filter(Boolean).join(' · ');
  const pnl = pnlIn == null ? null : num(pnlIn);
  return {
    key,
    title: title || '—',
    badge,
    details: [qtyLine, priceLine].filter(Boolean),
    value: qty * price,
    pnl: pnl != null ? { amount: pnl, pct: pctOf(pnl, invested) } : undefined,
  };
}

function orderRow(
  key: string, title: string, side: unknown, filledIn: unknown, qtyIn: unknown, unit: string,
  priceIn: unknown, kind: unknown, status: unknown, when: unknown,
): PortfolioRow {
  const filled = num(filledIn);
  const qty = num(qtyIn);
  const price = num(priceIn);
  const qtyText = qty > 0 ? `${formatQty(filled)}/${formatQty(qty)} ${unit}`.trim() : '';
  return {
    key,
    title: title || '—',
    badge: sideBadge(side),
    details: [[qtyText, price > 0 ? `@ ${formatAmount(price)}` : '', str(kind)].filter(Boolean).join(' · ')].filter(Boolean),
    value: price > 0 && (filled > 0 || qty > 0) ? (filled > 0 ? filled : qty) * price : null,
    note: statusNote(status, when),
  };
}

// ─── Zerodha Kite ───────────────────────────────────────────────────────────

export function kiteHoldingRow(h: KiteHolding): PortfolioRow {
  const t1 = num(h.t1_quantity);
  return holdingRow(
    `kite-eq-${str(h.isin) || str(h.tradingsymbol)}`, str(h.tradingsymbol), num(h.quantity) + t1, 'shares',
    h.average_price, 'LTP', h.last_price, '', h.pnl, undefined, t1 > 0 ? `${formatQty(t1)} pending` : undefined,
  );
}

export function kiteMFRow(h: KiteMFHolding): PortfolioRow {
  // Kite's /mf/holdings returns pnl = 0, so derive it from the average NAV.
  const pnl = num(h.quantity) * (num(h.last_price) - num(h.average_price));
  const navDate = str(h.last_price_date) ? formatDate(str(h.last_price_date).slice(0, 10)) : '';
  return holdingRow(
    `kite-mf-${str(h.tradingsymbol)}-${str(h.folio)}`, str(h.fund) || str(h.tradingsymbol), h.quantity, 'units',
    h.average_price, 'NAV', h.last_price, navDate, pnl,
  );
}

export function kitePositionRow(p: KitePosition): PortfolioRow {
  const q = num(p.quantity);
  return holdingRow(
    `kite-pos-${str(p.tradingsymbol)}-${str(p.product)}`, str(p.tradingsymbol), q, 'shares', p.average_price, 'LTP',
    p.last_price, '', p.pnl, q < 0 ? { label: 'SHORT', tone: 'danger' } : { label: 'LONG', tone: 'success' }, str(p.product),
  );
}

export function kiteSipRow(s: KiteSIP): PortfolioRow {
  const sip = s as KiteSIP & { pending_instalments?: number };
  const left = num(sip.instalments_remaining ?? sip.pending_instalments);
  const day = num(s.instalment_day);
  const schedule = [titleCase(s.frequency), day ? `day ${day}` : '', left > 0 ? `${left} left` : '']
    .filter(Boolean).join(' · ');
  const next = shortDate(s.next_instalment);
  return {
    key: `kite-sip-${str(s.sip_id)}`,
    title: str(s.fund) || str(s.tradingsymbol) || '—',
    details: [schedule].filter(Boolean),
    value: num(s.instalment_amount) || null,
    note: next ? { text: `Next ${next}`, tone: 'neutral' } : undefined,
  };
}

export function kiteOrderRow(o: KiteOrder): PortfolioRow {
  const price = num(o.average_price) > 0 ? o.average_price : o.price;
  return orderRow(
    `kite-ord-${str(o.order_id)}`, str(o.tradingsymbol), o.transaction_type, o.filled_quantity, o.quantity, 'shares',
    price, o.order_type, o.status, o.order_timestamp,
  );
}

export function kiteMFOrderRow(o: KiteMFOrder): PortfolioRow {
  const price = num(o.average_price) > 0 ? num(o.average_price) : num(o.price);
  const units = num(o.quantity);
  return {
    key: `kite-mford-${str(o.order_id)}`,
    title: str(o.fund) || str(o.tradingsymbol) || '—',
    badge: sideBadge(o.transaction_type ?? o.order_type),
    details: [[units > 0 ? `${formatQty(units)} units` : '', price > 0 ? `@ ${formatAmount(price)}` : '']
      .filter(Boolean).join(' · ')].filter(Boolean),
    value: num(o.amount) > 0 ? num(o.amount) : units * price || null,
    note: statusNote(o.status, o.order_timestamp),
  };
}

// ─── Angel One ──────────────────────────────────────────────────────────────

export function angelHoldingRow(h: AngelHolding): PortfolioRow {
  const t1 = num(h.t1quantity);
  const row = holdingRow(
    `angel-eq-${str(h.isin) || str(h.tradingsymbol)}`, str(h.tradingsymbol), h.quantity, 'shares', h.averageprice, 'LTP',
    h.ltp, '', h.profitandloss, undefined, t1 > 0 ? `${formatQty(t1)} pending` : undefined,
  );
  // Angel reports its own P&L %; prefer it so the number matches the Angel app.
  if (row.pnl && h.pnlpercentage != null) row.pnl.pct = num(h.pnlpercentage);
  return row;
}

export function angelPositionRow(p: AngelPosition): PortfolioRow {
  const q = num(p.netqty);
  const avg = num(q > 0 ? p.buyavgprice : p.sellavgprice) || num(p.avg_price);
  return holdingRow(
    `angel-pos-${str(p.tradingsymbol)}-${str(p.producttype)}`, str(p.tradingsymbol), q, 'shares', avg || null, 'LTP',
    p.ltp, '', p.pnl, q < 0 ? { label: 'SHORT', tone: 'danger' } : { label: 'LONG', tone: 'success' }, str(p.producttype),
  );
}

export function angelOrderRow(o: AngelOrder): PortfolioRow {
  const price = num(o.averageprice) > 0 ? o.averageprice : o.price;
  return orderRow(
    `angel-ord-${str(o.orderid)}`, str(o.tradingsymbol), o.transactiontype, o.filledshares, o.quantity, 'shares',
    price, o.producttype, str(o.orderstatus) || o.status, o.updatetime,
  );
}

// ─── Zebpay ─────────────────────────────────────────────────────────────────

export function zebpayBalanceRow(b: ZebpayBalance): PortfolioRow {
  // Zebpay's balance API has no buy price, so there is no average or P&L to show.
  const coin = str(b.currency);
  return {
    ...holdingRow(`zebpay-${coin}`, coin, b.balance, coin, null, 'Price', b.currentPrice, '', null),
    value: num(b.inrValue),
  };
}

export function zebpayOrderRow(o: ZebpayOrder): PortfolioRow {
  const symbol = str(o.symbol);
  const coin = symbol.split(/[-/]/)[0] || symbol;
  const ts = num(o.timestamp);
  const when = ts > 0 ? new Date(ts < 1e12 ? ts * 1000 : ts).toISOString() : '';
  return orderRow(`zebpay-ord-${str(o.orderId)}`, symbol, o.side, o.filled, o.amount, coin, o.price, titleCase(o.type), o.status, when);
}

// ─── Search + sort ──────────────────────────────────────────────────────────

export function filterRows(rows: PortfolioRow[], query: string): PortfolioRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => str(r.title).toLowerCase().includes(q) || r.badge?.label.toLowerCase().includes(q));
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
    if (sort.key === 'name') return sign * str(a.title).localeCompare(str(b.title), 'en', { sensitivity: 'base' });
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
