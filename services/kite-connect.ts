import * as SecureStore from 'expo-secure-store';
import { settingsStorage } from '@/services/storage';
import { getDatabase } from '@/database';
import { DEFAULT_USER_ID } from '@/constants/app';

const KITE_API_KEY       = 'kite_api_key';
const KITE_ACCESS_TOKEN  = 'kite_access_token';
const KITE_USER_ID       = 'kite_user_id';
const KITE_PUBLIC_TOKEN  = 'kite_public_token';

const MMKV_LINKED_ACCOUNT   = 'kite_linked_account_id';
const MMKV_TOKEN_EXPIRY     = 'kite_token_expiry';        // Unix ms of next 6 AM
const MMKV_LAST_SYNCED      = 'kite_last_synced';         // ISO string
const MMKV_HOLDINGS_CACHE   = 'kite_holdings_cache';      // JSON — equity
const MMKV_MF_HOLDINGS_CACHE = 'kite_mf_holdings_cache'; // JSON — mutual funds
const MMKV_PORTFOLIO_TOTAL  = 'kite_portfolio_total';     // number string (equity + MF)
const MMKV_FUNDS_TOTAL      = 'kite_funds_total';         // number string

const BACKEND_URL = process.env.EXPO_PUBLIC_KITE_BACKEND_URL ?? '';
const KITE_API   = 'https://api.kite.trade';

// ── Public types ────────────────────────────────────────────────────────────

export interface KiteCredentials {
  apiKey: string;
  accessToken?: string;
  userId?: string;
  publicToken?: string;
}

export interface KiteOAuthResponse {
  access_token: string;
  user_id: string;
  public_token: string;
}

export interface KiteHolding {
  tradingsymbol: string;
  exchange: string;
  isin: string;
  quantity: number;       // Settled (T+0) quantity
  t1_quantity: number;    // Pending settlement (T+1) — recently purchased, not yet in DEMAT
  average_price: number;
  last_price: number;
  close_price: number;
  pnl: number;
  day_change_percentage: number;
}

export interface KiteMFHolding {
  folio: string | null;
  fund: string;          // Full fund name
  tradingsymbol: string; // ISIN
  average_price: number; // Avg NAV
  last_price: number;    // Current NAV
  last_price_date: string;
  quantity: number;      // Units held
  pnl: number;
  pledged_quantity: number;
}

export interface KiteSyncResult {
  holdings: KiteHolding[];       // Equity
  mfHoldings: KiteMFHolding[];   // Mutual funds
  portfolioTotal: number;        // equity market value + MF market value
  equityTotal: number;
  mfTotal: number;
  fundsAvailable: number;        // equity cash margin
  linkedAccountId: string;
  syncedAt: string;
}

// ── Credential helpers (unchanged) ─────────────────────────────────────────

export async function storeKiteApiKey(apiKey: string): Promise<void> {
  await SecureStore.setItemAsync(KITE_API_KEY, apiKey);
}

export async function getKiteApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(KITE_API_KEY);
}

/**
 * Store OAuth credentials and record token expiry (next 6 AM).
 */
export async function storeKiteAccessToken(credentials: KiteOAuthResponse): Promise<void> {
  await SecureStore.setItemAsync(KITE_ACCESS_TOKEN, credentials.access_token);
  await SecureStore.setItemAsync(KITE_USER_ID, credentials.user_id);
  await SecureStore.setItemAsync(KITE_PUBLIC_TOKEN, credentials.public_token);

  // Token expires at 6 AM the next day (Zerodha regulatory requirement).
  const expiry = nextSixAM();
  settingsStorage.set(MMKV_TOKEN_EXPIRY, expiry.toString());
}

export async function getKiteCredentials(): Promise<KiteCredentials | null> {
  const apiKey = await getKiteApiKey();
  if (!apiKey) return null;
  const accessToken  = await SecureStore.getItemAsync(KITE_ACCESS_TOKEN);
  const userId       = await SecureStore.getItemAsync(KITE_USER_ID);
  const publicToken  = await SecureStore.getItemAsync(KITE_PUBLIC_TOKEN);
  return {
    apiKey,
    accessToken:  accessToken  || undefined,
    userId:       userId       || undefined,
    publicToken:  publicToken  || undefined,
  };
}

export async function clearKiteCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(KITE_API_KEY);
  await SecureStore.deleteItemAsync(KITE_ACCESS_TOKEN);
  await SecureStore.deleteItemAsync(KITE_USER_ID);
  await SecureStore.deleteItemAsync(KITE_PUBLIC_TOKEN);
  settingsStorage.delete(MMKV_TOKEN_EXPIRY);
  settingsStorage.delete(MMKV_LAST_SYNCED);
  settingsStorage.delete(MMKV_HOLDINGS_CACHE);
  settingsStorage.delete(MMKV_MF_HOLDINGS_CACHE);
  settingsStorage.delete(MMKV_PORTFOLIO_TOTAL);
  settingsStorage.delete(MMKV_FUNDS_TOTAL);
  settingsStorage.delete(MMKV_LINKED_ACCOUNT);
}

export async function exchangeRequestToken(requestToken: string): Promise<KiteOAuthResponse> {
  const response = await fetch(`${BACKEND_URL}/api/kite/exchange-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_token: requestToken }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to exchange token');
  }
  return response.json();
}

export async function isKiteAuthenticated(): Promise<boolean> {
  const creds = await getKiteCredentials();
  return !!(creds?.apiKey && creds?.accessToken);
}

export function getKiteLoginUrl(apiKey: string): string {
  return `https://kite.zerodha.com/connect/login?api_key=${apiKey}&v=3`;
}

// ── Token expiry ────────────────────────────────────────────────────────────

/** Returns true when the stored access_token has expired (past 6 AM today). */
export function isKiteTokenExpired(): boolean {
  const expiry = settingsStorage.getString(MMKV_TOKEN_EXPIRY);
  if (!expiry) return false; // no expiry recorded = just connected, treat as valid
  return Date.now() > parseInt(expiry, 10);
}

function nextSixAM(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(6, 0, 0, 0);
  return d.getTime();
}

// ── Linked account ──────────────────────────────────────────────────────────

export function getLinkedAccountId(): string | null {
  return settingsStorage.getString(MMKV_LINKED_ACCOUNT) ?? null;
}

export function setLinkedAccountId(id: string): void {
  settingsStorage.set(MMKV_LINKED_ACCOUNT, id);
}

/**
 * Auto-match: find a demat account whose account_number or account_identifier
 * contains the Kite user_id (e.g. "ZA1234"). Returns null if no match.
 */
export async function findLinkedAccountByKiteUserId(kiteUserId: string): Promise<string | null> {
  const db = getDatabase();
  const pattern = `%${kiteUserId}%`;
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM financial_accounts
     WHERE user_id = ?
       AND (account_type = 'demat' OR account_type = 'investment')
       AND is_active = 1
       AND (
         LOWER(account_number) LIKE LOWER(?)
         OR LOWER(account_identifier) LIKE LOWER(?)
       )
     LIMIT 1;`,
    DEFAULT_USER_ID,
    pattern,
    pattern,
  );
  return row?.id ?? null;
}

/** All active demat/investment accounts — used for the manual link picker. */
export async function getDematAccountsForPicker(): Promise<{ id: string; label: string }[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    account_label: string | null;
    bank_name: string;
    account_number: string | null;
  }>(
    `SELECT id, account_label, bank_name, account_number
     FROM financial_accounts
     WHERE user_id = ?
       AND (account_type = 'demat' OR account_type = 'investment')
       AND is_active = 1
     ORDER BY bank_name ASC;`,
    DEFAULT_USER_ID,
  );
  return rows.map(r => ({
    id: r.id,
    label: [r.account_label || r.bank_name, r.account_number].filter(Boolean).join(' · '),
  }));
}

// ── Last synced / cache ─────────────────────────────────────────────────────

export function getLastSynced(): string | null {
  return settingsStorage.getString(MMKV_LAST_SYNCED) ?? null;
}

export function getCachedHoldings(): KiteHolding[] {
  const raw = settingsStorage.getString(MMKV_HOLDINGS_CACHE);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export function getCachedMFHoldings(): KiteMFHolding[] {
  const raw = settingsStorage.getString(MMKV_MF_HOLDINGS_CACHE);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export function getCachedTotals(): { portfolio: number; funds: number } {
  return {
    portfolio: parseFloat(settingsStorage.getString(MMKV_PORTFOLIO_TOTAL) ?? '0') || 0,
    funds:     parseFloat(settingsStorage.getString(MMKV_FUNDS_TOTAL)     ?? '0') || 0,
  };
}

// ── Kite API calls ──────────────────────────────────────────────────────────

function kiteHeaders(apiKey: string, accessToken: string): Record<string, string> {
  return {
    'Authorization': `token ${apiKey}:${accessToken}`,
    'X-Kite-Version': '3',
    'Content-Type': 'application/json',
  };
}

async function kiteGet<T>(path: string, apiKey: string, accessToken: string): Promise<T> {
  const res = await fetch(`${KITE_API}${path}`, {
    headers: kiteHeaders(apiKey, accessToken),
  });
  const json = await res.json();
  if (json.status !== 'success') {
    throw new Error(json.message || `Kite API error on ${path}`);
  }
  return json.data as T;
}

/**
 * Fetch holdings + margins from Kite, resolve the linked account,
 * cache results in MMKV, and return the sync result.
 *
 * Does NOT write a snapshot — that is a separate manual step.
 */
export async function syncKiteData(): Promise<KiteSyncResult> {
  const creds = await getKiteCredentials();
  if (!creds?.accessToken || !creds?.apiKey) {
    throw new Error('Not connected to Kite');
  }
  if (isKiteTokenExpired()) {
    throw new Error('TOKEN_EXPIRED');
  }

  const { apiKey, accessToken } = creds;

  // Fetch profile + equity holdings + MF holdings + margins in parallel
  const [profile, holdingsRaw, mfHoldingsRaw, margins] = await Promise.all([
    kiteGet<{ user_id: string }>('/user/profile', apiKey, accessToken),
    kiteGet<KiteHolding[]>('/portfolio/holdings', apiKey, accessToken),
    kiteGet<KiteMFHolding[]>('/mf/holdings', apiKey, accessToken),
    kiteGet<{ equity: { available: { cash: number } } }>('/user/margins', apiKey, accessToken),
  ]);

  // Resolve linked account
  let linkedAccountId = getLinkedAccountId();
  if (!linkedAccountId) {
    linkedAccountId = await findLinkedAccountByKiteUserId(profile.user_id);
    if (linkedAccountId) setLinkedAccountId(linkedAccountId);
  }
  if (!linkedAccountId) {
    throw new Error('NO_ACCOUNT_LINKED');
  }

  // Compute totals
  const equityTotal = holdingsRaw.reduce(
    (sum, h) => sum + (h.quantity + (h.t1_quantity ?? 0)) * h.last_price,
    0,
  );
  const mfTotal = mfHoldingsRaw.reduce(
    (sum, h) => sum + h.quantity * h.last_price,
    0,
  );
  const portfolioTotal = equityTotal + mfTotal;
  const fundsAvailable = margins.equity?.available?.cash ?? 0;
  const syncedAt = new Date().toISOString();

  // Cache in MMKV
  settingsStorage.set(MMKV_HOLDINGS_CACHE,    JSON.stringify(holdingsRaw));
  settingsStorage.set(MMKV_MF_HOLDINGS_CACHE, JSON.stringify(mfHoldingsRaw));
  settingsStorage.set(MMKV_PORTFOLIO_TOTAL,   portfolioTotal.toString());
  settingsStorage.set(MMKV_FUNDS_TOTAL,       fundsAvailable.toString());
  settingsStorage.set(MMKV_LAST_SYNCED,       syncedAt);

  return {
    holdings:        holdingsRaw,
    mfHoldings:      mfHoldingsRaw,
    portfolioTotal,
    equityTotal,
    mfTotal,
    fundsAvailable,
    linkedAccountId,
    syncedAt,
  };
}
