import * as SecureStore from 'expo-secure-store';
import { settingsStorage } from '@/services/storage';
import { setIntegrationCred, getAllIntegrationCreds, clearIntegrationCreds } from '@/services/integration-credentials';

// ─── SecureStore Keys (ephemeral session tokens) ──────────────────────────────
const ZEB_ACCESS_TOKEN  = 'zebpay_access_token';
const ZEB_REFRESH_TOKEN = 'zebpay_refresh_token';

// ─── MMKV Keys ────────────────────────────────────────────────────────────────
const MMKV_TOKEN_EXPIRY       = 'zebpay_token_expiry';
const MMKV_VERIFICATION_CODE  = 'zebpay_verification_code';
const MMKV_LAST_SYNCED        = 'zebpay_last_synced';
const MMKV_BALANCES_CACHE     = 'zebpay_balances_cache';
const MMKV_ORDERS_CACHE       = 'zebpay_orders_cache';
const MMKV_PORTFOLIO_TOTAL    = 'zebpay_portfolio_total';

const ZEB_SERVICE = 'zebpay';
const BASE_URL = 'https://www.zebapi.com';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ZebpayBalance {
  currency: string;     // 'BTC', 'ETH', etc.
  balance: number;
  inrValue: number;     // balance * current price
  currentPrice: number; // INR
}

export interface ZebpayOrder {
  id: number;
  trade_pair: string;
  side: string;
  size: number;
  price: number;
  status: string;
  type: string;
  created_at: number;
  executed_value?: number;
  filled_size?: number;
}

export interface ZebpaySyncResult {
  balances: ZebpayBalance[];
  orders: ZebpayOrder[];
  totalInr: number;
}

// ─── Credential storage (backed up via integration_credentials) ───────────────

export async function storeZebpayCredentials(
  clientId: string, clientSecret: string, mobile: string, pin: string, countryCode: string,
): Promise<void> {
  await Promise.all([
    setIntegrationCred(ZEB_SERVICE, 'client_id', clientId),
    setIntegrationCred(ZEB_SERVICE, 'client_secret', clientSecret),
    setIntegrationCred(ZEB_SERVICE, 'mobile', mobile),
    setIntegrationCred(ZEB_SERVICE, 'pin', pin),
    setIntegrationCred(ZEB_SERVICE, 'country_code', countryCode),
  ]);
}

export async function getZebpayCredentials(): Promise<{
  clientId: string; clientSecret: string; mobile: string; pin: string; countryCode: string;
} | null> {
  try {
    const stored = await getAllIntegrationCreds(ZEB_SERVICE);
    const { client_id, client_secret, mobile, pin, country_code } = stored;
    if (!client_id || !client_secret || !mobile || !pin) return null;
    return { clientId: client_id, clientSecret: client_secret, mobile, pin, countryCode: country_code ?? '91' };
  } catch {
    return null;
  }
}

export async function clearZebpayCredentials(): Promise<void> {
  await Promise.all([
    clearIntegrationCreds(ZEB_SERVICE).catch(() => {}),
    clearZebpaySession(),
  ]);
}

// ─── Session ──────────────────────────────────────────────────────────────────

export function isZebpayConnected(): boolean {
  return !!settingsStorage.getString(MMKV_TOKEN_EXPIRY);
}

export function isZebpayTokenExpired(): boolean {
  const expiry = settingsStorage.getString(MMKV_TOKEN_EXPIRY);
  if (!expiry) return true;
  return Date.now() > parseInt(expiry, 10);
}

export function getZebpayLastSynced(): string | null {
  return settingsStorage.getString(MMKV_LAST_SYNCED) ?? null;
}

export async function clearZebpaySession(): Promise<void> {
  settingsStorage.delete(MMKV_TOKEN_EXPIRY);
  settingsStorage.delete(MMKV_VERIFICATION_CODE);
  settingsStorage.delete(MMKV_LAST_SYNCED);
  settingsStorage.delete(MMKV_BALANCES_CACHE);
  settingsStorage.delete(MMKV_ORDERS_CACHE);
  settingsStorage.delete(MMKV_PORTFOLIO_TOTAL);
  await Promise.all([
    SecureStore.deleteItemAsync(ZEB_ACCESS_TOKEN).catch(() => {}),
    SecureStore.deleteItemAsync(ZEB_REFRESH_TOKEN).catch(() => {}),
  ]);
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

function zebHeaders(clientId: string, jwt?: string): Record<string, string> {
  return {
    'client_id': clientId,
    'timestamp': String(Date.now()),
    'Content-Type': 'application/json',
    'RequestId': Math.random().toString(36).slice(2) + Date.now().toString(36),
    ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
  };
}

async function parseZebResponse(res: Response): Promise<{ statusCode?: number; statusDescription?: string; data?: unknown; message?: string }> {
  const text = await res.text();
  try {
    return JSON.parse(text) as { statusCode?: number; statusDescription?: string; data?: unknown; message?: string };
  } catch {
    throw new Error(`Zebpay HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function zebPost(path: string, body: Record<string, unknown>, clientId: string, jwt?: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: zebHeaders(clientId, jwt),
    body: JSON.stringify(body),
  });
  const json = await parseZebResponse(res);
  const code = json.statusCode;
  if (code !== undefined && code !== 200 && code !== 0) {
    throw new Error(json.statusDescription ?? json.message ?? `Zebpay error ${code}`);
  }
  if (!res.ok && (code === undefined)) {
    throw new Error(`Zebpay HTTP ${res.status}`);
  }
  return json.data ?? json;
}

async function zebGet(path: string, clientId: string, jwt: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    headers: zebHeaders(clientId, jwt),
  });
  const json = await parseZebResponse(res);
  const code = json.statusCode;
  if (code !== undefined && code !== 200 && code !== 0) {
    throw new Error(json.statusDescription ?? json.message ?? `Zebpay error ${code}`);
  }
  if (!res.ok && (code === undefined)) {
    throw new Error(`Zebpay HTTP ${res.status}`);
  }
  return json.data ?? json;
}

// ─── Auth Flow ────────────────────────────────────────────────────────────────

/**
 * Step 1: Send OTP to user's phone. Stores the verification_code in MMKV.
 * Returns the verification_code (needed for Step 2).
 */
export async function sendZebpayOTP(
  clientId: string, clientSecret: string, mobile: string, countryCode = '91',
): Promise<string> {
  const data = await zebPost('/user/login', {
    country_code: countryCode,
    mobile_number: mobile,
    client_id: clientId,
    client_secret: clientSecret,
  }, clientId) as { verification_code?: string };

  const code = data?.verification_code ?? '';
  settingsStorage.set(MMKV_VERIFICATION_CODE, code);
  return code;
}

/**
 * Step 2: Verify OTP. Returns the updated verification_code for Step 3.
 */
export async function verifyZebpayOTP(otp: string, clientId: string, clientSecret: string): Promise<string> {
  const verificationCode = settingsStorage.getString(MMKV_VERIFICATION_CODE) ?? '';
  const data = await zebPost('/user/verifyotp', {
    otp,
    verification_code: verificationCode,
    client_id: clientId,
    client_secret: clientSecret,
  }, clientId) as { verification_code?: string };

  const newCode = data?.verification_code ?? verificationCode;
  settingsStorage.set(MMKV_VERIFICATION_CODE, newCode);
  return newCode;
}

/**
 * Step 3: Verify PIN and get access token.
 */
export async function verifyZebpayPIN(
  pin: string, clientId: string, clientSecret: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: string }> {
  const verificationCode = settingsStorage.getString(MMKV_VERIFICATION_CODE) ?? '';
  const data = await zebPost('/user/verifypin', {
    grant_type: 'user_credentials',
    pin,
    daily_trade_limit: '',
    daily_withdraw_limit: '',
    total_trade_limit: '',
    total_withdraw_limit: '',
    verification_code: verificationCode,
    scope: '',
    client_id: clientId,
    client_secret: clientSecret,
  }, clientId) as { access_token?: string; refresh_token?: string; expires_in?: string };

  const accessToken  = data?.access_token  ?? '';
  const refreshToken = data?.refresh_token ?? '';
  const expiresIn    = data?.expires_in    ?? '86400';

  if (!accessToken) throw new Error('No access token received from Zebpay');

  await SecureStore.setItemAsync(ZEB_ACCESS_TOKEN,  accessToken);
  await SecureStore.setItemAsync(ZEB_REFRESH_TOKEN, refreshToken);

  // Parse expires_in (seconds) into absolute expiry timestamp
  const expiryMs = Date.now() + (parseInt(expiresIn, 10) || 86400) * 1000;
  settingsStorage.set(MMKV_TOKEN_EXPIRY, String(expiryMs));
  settingsStorage.delete(MMKV_VERIFICATION_CODE);

  return { accessToken, refreshToken, expiresIn };
}

/**
 * Full connect flow — Step 1 only (triggers OTP SMS).
 * Call verifyZebpayOTP + verifyZebpayPIN after user enters the OTP.
 */
export async function startZebpayConnect(
  clientId: string, clientSecret: string, mobile: string, pin: string, countryCode: string,
): Promise<void> {
  await storeZebpayCredentials(clientId, clientSecret, mobile, pin, countryCode);
  await sendZebpayOTP(clientId, clientSecret, mobile, countryCode);
}

/**
 * Complete the connect flow after OTP is entered.
 */
export async function completeZebpayConnect(otp: string): Promise<void> {
  const creds = await getZebpayCredentials();
  if (!creds) throw new Error('Credentials not found. Please start again.');
  await verifyZebpayOTP(otp, creds.clientId, creds.clientSecret);
  await verifyZebpayPIN(creds.pin, creds.clientId, creds.clientSecret);
}

// ─── Data Sync ────────────────────────────────────────────────────────────────

export async function syncZebpayData(): Promise<ZebpaySyncResult> {
  const creds = await getZebpayCredentials();
  if (!creds) throw new Error('Not connected to Zebpay');

  const accessToken = await SecureStore.getItemAsync(ZEB_ACCESS_TOKEN);
  if (!accessToken || isZebpayTokenExpired()) {
    throw new Error('Session expired — please reconnect');
  }

  // Fetch all available trade pairs to find balances
  let pairs: Array<{ virtual_currency: string; currency: string; pair: string }> = [];
  try {
    const pairsData = await zebGet(`/tradepairs/IN`, creds.clientId, accessToken);
    pairs = (Array.isArray(pairsData) ? pairsData : []) as typeof pairs;
  } catch { /* proceed with empty pairs */ }

  // Fetch balance for each pair and current price in parallel (cap at 20 pairs)
  const inrPairs = pairs.filter(p => p.currency === 'INR').slice(0, 20);
  const balances: ZebpayBalance[] = [];

  await Promise.allSettled(
    inrPairs.map(async (p) => {
      try {
        const [balData, tickerData] = await Promise.all([
          zebGet(`/wallet/balance?trade_pair=${p.pair}`, creds.clientId, accessToken),
          fetch(`${BASE_URL}/api/v1/market/${p.pair}/ticker?group=singapore`)
            .then(r => r.json())
            .catch(() => null),
        ]);

        const bal = (balData as { balance?: number })?.balance ?? 0;
        if (bal <= 0) return;

        const price = Number((tickerData as { market?: string })?.market ?? 0);
        balances.push({
          currency: p.virtual_currency,
          balance: bal,
          currentPrice: price,
          inrValue: bal * price,
        });
      } catch { /* skip pair */ }
    }),
  );

  // Fetch recent orders (all, paginated at 100)
  let orders: ZebpayOrder[] = [];
  try {
    const firstPair = inrPairs[0]?.pair ?? 'BTC-INR';
    const ordData = await zebGet(
      `/orders?trade_pair=${firstPair}&status=all&orderid=0&page=1&limit=100`,
      creds.clientId, accessToken,
    );
    orders = Array.isArray(ordData) ? (ordData as ZebpayOrder[]) : [];
  } catch { /* skip */ }

  const totalInr = balances.reduce((s, b) => s + b.inrValue, 0);

  // Cache results
  settingsStorage.set(MMKV_BALANCES_CACHE, JSON.stringify(balances));
  settingsStorage.set(MMKV_ORDERS_CACHE, JSON.stringify(orders));
  settingsStorage.set(MMKV_PORTFOLIO_TOTAL, String(totalInr));
  settingsStorage.set(MMKV_LAST_SYNCED, new Date().toISOString());

  return { balances, orders, totalInr };
}

export function getZebpayCache(): {
  balances: ZebpayBalance[];
  orders: ZebpayOrder[];
  totalInr: number;
} {
  try {
    const balances: ZebpayBalance[] = JSON.parse(settingsStorage.getString(MMKV_BALANCES_CACHE) ?? '[]');
    const orders: ZebpayOrder[]     = JSON.parse(settingsStorage.getString(MMKV_ORDERS_CACHE)   ?? '[]');
    const totalInr                   = parseFloat(settingsStorage.getString(MMKV_PORTFOLIO_TOTAL) ?? '0');
    return { balances, orders, totalInr };
  } catch {
    return { balances: [], orders: [], totalInr: 0 };
  }
}
