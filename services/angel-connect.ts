import * as SecureStore from 'expo-secure-store';
import { settingsStorage } from '@/services/storage';
import { setIntegrationCred, getAllIntegrationCreds, clearIntegrationCreds } from '@/services/integration-credentials';

// ─── SecureStore Keys ─────────────────────────────────────────────────────────
const ANGEL_API_KEY = 'angel_api_key';
const ANGEL_CLIENT_ID = 'angel_client_id';
const ANGEL_PASSWORD = 'angel_password';
const ANGEL_TOTP_SECRET = 'angel_totp_secret';
const ANGEL_JWT_TOKEN = 'angel_jwt_token';
const ANGEL_REFRESH_TOKEN = 'angel_refresh_token';

// ─── MMKV Cache Keys ──────────────────────────────────────────────────────────
const MMKV_TOKEN_EXPIRY = 'angel_token_expiry';
const MMKV_LAST_SYNCED = 'angel_last_synced';
const MMKV_HOLDINGS_CACHE = 'angel_holdings_cache';
const MMKV_POSITIONS_CACHE = 'angel_positions_cache';
const MMKV_ORDERS_CACHE = 'angel_orders_cache';
const MMKV_FUNDS_CACHE = 'angel_funds_cache';
const MMKV_PORTFOLIO_TOTAL = 'angel_portfolio_total';

const BASE_URL = (process.env.EXPO_PUBLIC_ANGEL_BACKEND_URL ?? 'https://apiconnect.angelone.in').replace(/\/$/, '');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AngelHolding {
  tradingsymbol: string;
  exchange: string;
  isin: string;
  quantity: number;
  t1quantity: number;
  realisedquantity: number;
  averageprice: number;
  ltp: number;
  close: number;
  profitandloss: number;
  pnlpercentage: number;
  product: string;
}

export interface AngelTotalHolding {
  totalholdingvalue: number;
  totalinvvalue: number;
  totalprofitandloss: number;
  totalpnlpercentage: number;
}

export interface AngelPosition {
  tradingsymbol: string;
  exchange: string;
  symbolname: string;
  producttype: string;
  netqty: number;
  ltp: number;
  pnl: number;
  unrealised: number;
  realised: number;
  buyavgprice: number;
  sellavgprice: number;
  avg_price: number;
}

export interface AngelOrder {
  orderid: string;
  tradingsymbol: string;
  exchange: string;
  transactiontype: string;
  ordertype: string;
  producttype: string;
  quantity: number;
  price: number;
  averageprice: number;
  filledshares: number;
  status: string;
  orderstatus: string;
  updatetime: string;
  variety: string;
}

export interface AngelFunds {
  net: string;
  availablecash: string;
  utiliseddebits: string;
  collateral: string;
  totaltradingpower: string;
  totalrealizedpnl: string;
  totalunrealizedpnl: string;
  totalpnl: string;
}

export interface AngelSyncResult {
  holdings: AngelHolding[];
  totalHolding: AngelTotalHolding | null;
  positions: AngelPosition[];
  orders: AngelOrder[];
  funds: AngelFunds | null;
  lastSynced: string;
}

// ─── Pure-JS TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30s) ───────────────────────
// No external dependency — works on Hermes without crypto.subtle

function base32Decode(secret: string): Uint8Array {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const s = secret.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0, cur = 0;
  const bytes: number[] = [];
  for (const ch of s) {
    const idx = ALPHA.indexOf(ch);
    if (idx === -1) continue;
    cur = (cur << 5) | idx;
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((cur >> bits) & 0xff); }
  }
  return new Uint8Array(bytes);
}

function sha1(data: Uint8Array): Uint8Array {
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const len = data.length;
  const paddedLen = Math.ceil((len + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  const bitLen = len * 8;
  dv.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000) >>> 0, false);
  dv.setUint32(paddedLen - 4, bitLen >>> 0, false);
  const w = new Uint32Array(80);
  for (let i = 0; i < paddedLen; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false);
    for (let j = 16; j < 80; j++) {
      const x = w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16];
      w[j] = (x << 1) | (x >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      let f: number, k: number;
      if      (j < 20) { f = (b & c) | (~b & d);           k = 0x5a827999; }
      else if (j < 40) { f = b ^ c ^ d;                    k = 0x6ed9eba1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else             { f = b ^ c ^ d;                    k = 0xca62c1d6; }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) >>> 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const result = new Uint8Array(20);
  const rv = new DataView(result.buffer);
  rv.setUint32(0, h0, false); rv.setUint32(4, h1, false); rv.setUint32(8, h2, false);
  rv.setUint32(12, h3, false); rv.setUint32(16, h4, false);
  return result;
}

function hmacSha1(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const BLOCK = 64;
  const k = key.length > BLOCK ? sha1(key) : key;
  const kPad = new Uint8Array(BLOCK);
  kPad.set(k);
  const iPad = kPad.map(b => b ^ 0x36);
  const oPad = kPad.map(b => b ^ 0x5c);
  const inner = new Uint8Array(BLOCK + msg.length);
  inner.set(iPad); inner.set(msg, BLOCK);
  const outer = new Uint8Array(BLOCK + 20);
  outer.set(oPad); outer.set(sha1(inner), BLOCK);
  return sha1(outer);
}

export function generateTOTP(secret: string): string {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const msg = new Uint8Array(8);
  const cv = new DataView(msg.buffer);
  cv.setUint32(0, Math.floor(counter / 0x100000000) >>> 0, false);
  cv.setUint32(4, counter >>> 0, false);
  const hash = hmacSha1(key, msg);
  const offset = hash[19] & 0x0f;
  const dv = new DataView(hash.buffer, offset, 4);
  const code = (dv.getUint32(0, false) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

// ─── Credential Storage ───────────────────────────────────────────────────────

const ANGEL_SERVICE = 'angel_one';

export async function storeAngelCredentials(
  apiKey: string, clientId: string, password: string, totpSecret: string,
): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ANGEL_API_KEY, apiKey),
    SecureStore.setItemAsync(ANGEL_CLIENT_ID, clientId),
    SecureStore.setItemAsync(ANGEL_PASSWORD, password),
    SecureStore.setItemAsync(ANGEL_TOTP_SECRET, totpSecret),
    // Also persist to SQLite so credentials survive backup/restore
    setIntegrationCred(ANGEL_SERVICE, 'api_key', apiKey),
    setIntegrationCred(ANGEL_SERVICE, 'client_id', clientId),
    setIntegrationCred(ANGEL_SERVICE, 'password', password),
    setIntegrationCred(ANGEL_SERVICE, 'totp_secret', totpSecret),
  ]);
}

export async function getAngelCredentials(): Promise<{
  apiKey: string; clientId: string; password: string; totpSecret: string;
} | null> {
  let [apiKey, clientId, password, totpSecret] = await Promise.all([
    SecureStore.getItemAsync(ANGEL_API_KEY),
    SecureStore.getItemAsync(ANGEL_CLIENT_ID),
    SecureStore.getItemAsync(ANGEL_PASSWORD),
    SecureStore.getItemAsync(ANGEL_TOTP_SECRET),
  ]);
  // Fallback to SQLite backup (e.g. after restore on a new device)
  if (!apiKey || !clientId || !password || !totpSecret) {
    try {
      const stored = await getAllIntegrationCreds(ANGEL_SERVICE);
      apiKey = stored.api_key ?? apiKey;
      clientId = stored.client_id ?? clientId;
      password = stored.password ?? password;
      totpSecret = stored.totp_secret ?? totpSecret;
      // Re-populate SecureStore if recovered from backup
      if (apiKey && clientId && password && totpSecret) {
        await Promise.all([
          SecureStore.setItemAsync(ANGEL_API_KEY, apiKey),
          SecureStore.setItemAsync(ANGEL_CLIENT_ID, clientId),
          SecureStore.setItemAsync(ANGEL_PASSWORD, password),
          SecureStore.setItemAsync(ANGEL_TOTP_SECRET, totpSecret),
        ]);
      }
    } catch { /* if DB not ready, skip */ }
  }
  if (!apiKey || !clientId || !password || !totpSecret) return null;
  return { apiKey, clientId, password, totpSecret };
}

export async function getAngelClientId(): Promise<string | null> {
  return SecureStore.getItemAsync(ANGEL_CLIENT_ID);
}

export function isAngelConnected(): boolean {
  return !!settingsStorage.getString(MMKV_TOKEN_EXPIRY);
}

export function isAngelTokenExpired(): boolean {
  const expiry = settingsStorage.getString(MMKV_TOKEN_EXPIRY);
  if (!expiry) return true;
  return Date.now() > parseInt(expiry, 10);
}

export function getAngelLastSynced(): string | null {
  return settingsStorage.getString(MMKV_LAST_SYNCED) ?? null;
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

function angelHeaders(apiKey: string, jwt?: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-ClientLocalIP': '127.0.0.1',
    'X-ClientPublicIP': '1.1.1.1',
    'X-MACAddress': 'AA:BB:CC:DD:EE:FF',
    'X-PrivateKey': apiKey,
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
  };
  if (jwt) h['Authorization'] = `Bearer ${jwt}`;
  return h;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function loginToAngel(
  apiKey: string, clientId: string, password: string, totpSecret: string,
): Promise<void> {
  const totp = generateTOTP(totpSecret);
  const resp = await fetch(`${BASE_URL}/rest/auth/angelbroking/user/v1/loginByPassword`, {
    method: 'POST',
    headers: angelHeaders(apiKey),
    body: JSON.stringify({ clientcode: clientId, password, totp }),
  });
  const json = await resp.json();
  if (!json.status || !json.data?.jwtToken) {
    throw new Error(json.message || 'Angel One login failed');
  }
  await Promise.all([
    SecureStore.setItemAsync(ANGEL_JWT_TOKEN, json.data.jwtToken),
    SecureStore.setItemAsync(ANGEL_REFRESH_TOKEN, json.data.refreshToken ?? ''),
  ]);
  // JWT expires in 24 hours
  settingsStorage.set(MMKV_TOKEN_EXPIRY, (Date.now() + 24 * 60 * 60 * 1000).toString());
}

async function refreshAngelToken(
  apiKey: string, jwtToken: string, refreshToken: string,
): Promise<string> {
  const resp = await fetch(`${BASE_URL}/rest/auth/angelbroking/jwt/v1/generateTokens`, {
    method: 'POST',
    headers: angelHeaders(apiKey, jwtToken),
    body: JSON.stringify({ refreshToken }),
  });
  const json = await resp.json();
  if (!json.status || !json.data?.jwtToken) throw new Error('Token refresh failed');
  await Promise.all([
    SecureStore.setItemAsync(ANGEL_JWT_TOKEN, json.data.jwtToken),
    SecureStore.setItemAsync(ANGEL_REFRESH_TOKEN, json.data.refreshToken ?? refreshToken),
  ]);
  settingsStorage.set(MMKV_TOKEN_EXPIRY, (Date.now() + 24 * 60 * 60 * 1000).toString());
  return json.data.jwtToken;
}

async function ensureValidToken(): Promise<{ apiKey: string; jwt: string }> {
  const creds = await getAngelCredentials();
  if (!creds) throw new Error('Angel One credentials not found. Please connect your account.');

  const [storedJwt, storedRefresh] = await Promise.all([
    SecureStore.getItemAsync(ANGEL_JWT_TOKEN),
    SecureStore.getItemAsync(ANGEL_REFRESH_TOKEN),
  ]);

  if (!isAngelTokenExpired() && storedJwt) {
    return { apiKey: creds.apiKey, jwt: storedJwt };
  }

  // Try refresh first — avoids needing to generate a new TOTP
  if (storedJwt && storedRefresh) {
    try {
      const newJwt = await refreshAngelToken(creds.apiKey, storedJwt, storedRefresh);
      return { apiKey: creds.apiKey, jwt: newJwt };
    } catch { /* fall through to full re-login */ }
  }

  // Full re-login — TOTP is auto-generated from stored secret
  await loginToAngel(creds.apiKey, creds.clientId, creds.password, creds.totpSecret);
  const jwt = await SecureStore.getItemAsync(ANGEL_JWT_TOKEN);
  if (!jwt) throw new Error('Login succeeded but JWT not stored');
  return { apiKey: creds.apiKey, jwt };
}

// ─── Connect ──────────────────────────────────────────────────────────────────

export async function connectAngel(
  apiKey: string, clientId: string, password: string, totpSecret: string,
): Promise<void> {
  await storeAngelCredentials(apiKey, clientId, password, totpSecret);
  try {
    await loginToAngel(apiKey, clientId, password, totpSecret);
  } catch (e) {
    // Clean up on failure so the user isn't left in a half-connected state
    await clearAngelCredentials();
    throw e;
  }
}

// ─── Data Sync ────────────────────────────────────────────────────────────────

export async function syncAngelData(): Promise<AngelSyncResult> {
  const { apiKey, jwt } = await ensureValidToken();
  const headers = angelHeaders(apiKey, jwt);

  const [holdingsRes, positionsRes, ordersRes, fundsRes] = await Promise.allSettled([
    fetch(`${BASE_URL}/rest/secure/angelbroking/portfolio/v1/getAllHolding`, { headers }),
    fetch(`${BASE_URL}/rest/secure/angelbroking/order/v1/getPosition`, { headers }),
    fetch(`${BASE_URL}/rest/secure/angelbroking/order/v1/getOrderBook`, { headers }),
    fetch(`${BASE_URL}/rest/secure/angelbroking/user/v1/getRMS`, { headers }),
  ]);

  let holdings: AngelHolding[] = [];
  let totalHolding: AngelTotalHolding | null = null;
  let positions: AngelPosition[] = [];
  let orders: AngelOrder[] = [];
  let funds: AngelFunds | null = null;

  if (holdingsRes.status === 'fulfilled') {
    try {
      const j = await holdingsRes.value.json();
      if (j.status && j.data) { holdings = j.data.holdings ?? []; totalHolding = j.data.totalholding ?? null; }
    } catch { /* skip partial failure */ }
  }
  if (positionsRes.status === 'fulfilled') {
    try {
      const j = await positionsRes.value.json();
      if (j.status && Array.isArray(j.data)) positions = j.data;
    } catch { /* skip */ }
  }
  if (ordersRes.status === 'fulfilled') {
    try {
      const j = await ordersRes.value.json();
      if (j.status && Array.isArray(j.data)) orders = j.data;
    } catch { /* skip */ }
  }
  if (fundsRes.status === 'fulfilled') {
    try {
      const j = await fundsRes.value.json();
      if (j.status && j.data) funds = j.data;
    } catch { /* skip */ }
  }

  const lastSynced = new Date().toISOString();
  settingsStorage.set(MMKV_HOLDINGS_CACHE, JSON.stringify(holdings));
  settingsStorage.set(MMKV_POSITIONS_CACHE, JSON.stringify(positions));
  settingsStorage.set(MMKV_ORDERS_CACHE, JSON.stringify(orders));
  settingsStorage.set(MMKV_FUNDS_CACHE, JSON.stringify(funds));
  settingsStorage.set(MMKV_LAST_SYNCED, lastSynced);
  if (totalHolding) settingsStorage.set(MMKV_PORTFOLIO_TOTAL, JSON.stringify(totalHolding));

  return { holdings, totalHolding, positions, orders, funds, lastSynced };
}

// ─── Cached Getters ───────────────────────────────────────────────────────────

export function getCachedAngelHoldings(): AngelHolding[] {
  try { const s = settingsStorage.getString(MMKV_HOLDINGS_CACHE); return s ? JSON.parse(s) : []; }
  catch { return []; }
}

export function getCachedAngelPositions(): AngelPosition[] {
  try { const s = settingsStorage.getString(MMKV_POSITIONS_CACHE); return s ? JSON.parse(s) : []; }
  catch { return []; }
}

export function getCachedAngelOrders(): AngelOrder[] {
  try { const s = settingsStorage.getString(MMKV_ORDERS_CACHE); return s ? JSON.parse(s) : []; }
  catch { return []; }
}

export function getCachedAngelFunds(): AngelFunds | null {
  try { const s = settingsStorage.getString(MMKV_FUNDS_CACHE); return s ? JSON.parse(s) : null; }
  catch { return null; }
}

export function getCachedAngelTotalHolding(): AngelTotalHolding | null {
  try { const s = settingsStorage.getString(MMKV_PORTFOLIO_TOTAL); return s ? JSON.parse(s) : null; }
  catch { return null; }
}

// ─── Disconnect ───────────────────────────────────────────────────────────────

export async function clearAngelSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ANGEL_JWT_TOKEN),
    SecureStore.deleteItemAsync(ANGEL_REFRESH_TOKEN),
  ]);
  [MMKV_TOKEN_EXPIRY, MMKV_LAST_SYNCED, MMKV_HOLDINGS_CACHE,
   MMKV_POSITIONS_CACHE, MMKV_ORDERS_CACHE, MMKV_FUNDS_CACHE,
   MMKV_PORTFOLIO_TOTAL].forEach(k => settingsStorage.delete(k));
}

export async function clearAngelCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ANGEL_API_KEY),
    SecureStore.deleteItemAsync(ANGEL_CLIENT_ID),
    SecureStore.deleteItemAsync(ANGEL_PASSWORD),
    SecureStore.deleteItemAsync(ANGEL_TOTP_SECRET),
    clearIntegrationCreds(ANGEL_SERVICE).catch(() => {}),
  ]);
  await clearAngelSession();
}
