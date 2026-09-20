import CryptoJS from 'crypto-js';
import { settingsStorage } from '@/services/storage';
import { setIntegrationCred, getAllIntegrationCreds, clearIntegrationCreds } from '@/services/integration-credentials';

// ─── Constants ────────────────────────────────────────────────────────────────

const ZEB_SERVICE = 'zebpay';
const BASE_URL    = 'https://sapi.zebpay.com';

const MMKV_CONNECTED      = 'zebpay_connected';
const MMKV_LAST_SYNCED    = 'zebpay_last_synced';
const MMKV_BALANCES_CACHE = 'zebpay_balances_cache';
const MMKV_ORDERS_CACHE   = 'zebpay_orders_cache';
const MMKV_PORTFOLIO_TOTAL = 'zebpay_portfolio_total';
const MMKV_INR_BALANCE    = 'zebpay_inr_balance';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ZebpayBalance {
  currency: string;
  balance: number;
  inrValue: number;
  currentPrice: number;
}

export interface ZebpayOrder {
  orderId: number;
  symbol: string;
  side: string;
  type: string;
  price: number;
  amount: number;
  filled: number;
  status: string;
  timestamp: number;
}

export interface ZebpaySyncResult {
  balances: ZebpayBalance[];
  orders: ZebpayOrder[];
  totalInr: number;
  inrBalance: number;
}

// ─── Credentials (backed up via integration_credentials) ──────────────────────

export async function storeZebpayCredentials(apiKey: string, secretKey: string): Promise<void> {
  await Promise.all([
    setIntegrationCred(ZEB_SERVICE, 'api_key', apiKey),
    setIntegrationCred(ZEB_SERVICE, 'secret_key', secretKey),
  ]);
}

export async function getZebpayCredentials(): Promise<{ apiKey: string; secretKey: string } | null> {
  try {
    const stored = await getAllIntegrationCreds(ZEB_SERVICE);
    const { api_key, secret_key } = stored;
    if (!api_key || !secret_key) return null;
    return { apiKey: api_key, secretKey: secret_key };
  } catch {
    return null;
  }
}

export async function clearZebpayCredentials(): Promise<void> {
  await clearIntegrationCreds(ZEB_SERVICE).catch(() => {});
  [MMKV_CONNECTED, MMKV_LAST_SYNCED, MMKV_BALANCES_CACHE,
   MMKV_ORDERS_CACHE, MMKV_PORTFOLIO_TOTAL, MMKV_INR_BALANCE]
    .forEach(k => settingsStorage.delete(k));
}

// ─── Connection state ─────────────────────────────────────────────────────────

export function isZebpayConnected(): boolean {
  return settingsStorage.getString(MMKV_CONNECTED) === 'true';
}

export function getZebpayLastSynced(): string | null {
  return settingsStorage.getString(MMKV_LAST_SYNCED) ?? null;
}

export function getZebpayCache(): { balances: ZebpayBalance[]; orders: ZebpayOrder[]; totalInr: number; inrBalance: number } {
  try {
    const balances: ZebpayBalance[] = JSON.parse(settingsStorage.getString(MMKV_BALANCES_CACHE) ?? '[]');
    const orders: ZebpayOrder[]     = JSON.parse(settingsStorage.getString(MMKV_ORDERS_CACHE)   ?? '[]');
    const totalInr   = parseFloat(settingsStorage.getString(MMKV_PORTFOLIO_TOTAL) ?? '0');
    const inrBalance = parseFloat(settingsStorage.getString(MMKV_INR_BALANCE)    ?? '0');
    return { balances, orders, totalInr, inrBalance };
  } catch {
    return { balances: [], orders: [], totalInr: 0, inrBalance: 0 };
  }
}

// ─── Request signing ──────────────────────────────────────────────────────────
// HMAC-SHA256 of the query string (GET) or JSON body string (POST)

function sign(secretKey: string, data: string): string {
  return CryptoJS.HmacSHA256(data, secretKey).toString(CryptoJS.enc.Hex);
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function parseZebPayResponse(res: Response): Promise<{ statusCode?: number; statusDescription?: string; data?: unknown; message?: string }> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Zebpay HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
}

async function zebGet(apiKey: string, secretKey: string, path: string, params: Record<string, string> = {}): Promise<unknown> {
  const timestamp   = String(Date.now());
  const queryParams = new URLSearchParams({ ...params, timestamp });
  const queryString = queryParams.toString();
  const signature   = sign(secretKey, queryString);

  const res = await fetch(`${BASE_URL}${path}?${queryString}`, {
    headers: {
      'X-AUTH-APIKEY':     apiKey,
      'X-AUTH-SIGNATURE':  signature,
    },
  });
  const json = await parseZebPayResponse(res);
  if (json.statusCode && json.statusCode !== 200) {
    throw new Error(json.statusDescription ?? json.message ?? `Zebpay error ${json.statusCode}`);
  }
  if (!res.ok) {
    throw new Error(json.message ?? `HTTP ${res.status}`);
  }
  return json.data ?? json;
}

// ─── Connect ──────────────────────────────────────────────────────────────────

/** Verifies credentials by fetching balance, then persists them. */
export async function connectZebpay(apiKey: string, secretKey: string): Promise<void> {
  // Will throw if credentials are wrong
  await zebGet(apiKey, secretKey, '/api/v2/account/balance');
  await storeZebpayCredentials(apiKey, secretKey);
  settingsStorage.set(MMKV_CONNECTED, 'true');
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

export async function syncZebpayData(): Promise<ZebpaySyncResult> {
  const creds = await getZebpayCredentials();
  if (!creds) throw new Error('Not connected to Zebpay');
  const { apiKey, secretKey } = creds;

  // 1. Fetch all balances
  const rawBalances = await zebGet(apiKey, secretKey, '/api/v2/account/balance') as Array<{
    currency: string; total: string; free: string; isFiat: boolean;
  }>;
  const balancesArr = Array.isArray(rawBalances) ? rawBalances : [];

  const inrEntry   = balancesArr.find(b => b.currency === 'INR');
  const inrBalance = parseFloat(inrEntry?.free ?? '0');

  const cryptoHoldings = balancesArr.filter(b => !b.isFiat && parseFloat(b.total) > 0);

  // 2. Fetch all tickers (public endpoint, no auth needed)
  const priceMap = new Map<string, number>();
  try {
    const tickerRes  = await fetch(`${BASE_URL}/api/v2/market/allTickers`);
    const tickerJson = await tickerRes.json() as { data?: Array<{ symbol: string; last: string }> };
    for (const t of (tickerJson.data ?? [])) {
      const [base, quote] = t.symbol.split('-');
      if (quote === 'INR') priceMap.set(base, parseFloat(t.last) || 0);
    }
  } catch { /* non-fatal — prices will be 0 */ }

  // 3. Build portfolio
  const balances: ZebpayBalance[] = cryptoHoldings.map(b => {
    const amount = parseFloat(b.total);
    const price  = priceMap.get(b.currency) ?? 0;
    return { currency: b.currency, balance: amount, currentPrice: price, inrValue: amount * price };
  });

  const totalInr = balances.reduce((s, b) => s + b.inrValue, 0);

  // 4. Fetch open orders for most valuable holding (or BTC-INR fallback)
  let orders: ZebpayOrder[] = [];
  try {
    const topSymbol = balances.length > 0
      ? `${[...balances].sort((a, b) => b.inrValue - a.inrValue)[0].currency}-INR`
      : 'BTC-INR';
    const ordersRaw = await zebGet(apiKey, secretKey, '/api/v2/ex/orders', {
      symbol: topSymbol, status: 'ACTIVE', pageSize: '50',
    }) as { items?: any[] } | any[];

    const rawItems = Array.isArray(ordersRaw) ? ordersRaw : (ordersRaw as any).items ?? [];
    orders = rawItems.map((o: any) => ({
      orderId:   o.orderId,
      symbol:    o.symbol,
      side:      o.side,
      type:      o.type,
      price:     parseFloat(o.price)  || 0,
      amount:    parseFloat(o.amount) || 0,
      filled:    parseFloat(o.filled) || 0,
      status:    o.status,
      timestamp: o.timestamp,
    }));
  } catch { /* non-fatal */ }

  // 5. Cache
  settingsStorage.set(MMKV_BALANCES_CACHE,  JSON.stringify(balances));
  settingsStorage.set(MMKV_ORDERS_CACHE,    JSON.stringify(orders));
  settingsStorage.set(MMKV_PORTFOLIO_TOTAL, String(totalInr));
  settingsStorage.set(MMKV_INR_BALANCE,     String(inrBalance));
  settingsStorage.set(MMKV_LAST_SYNCED,     new Date().toISOString());

  return { balances, orders, totalInr, inrBalance };
}
