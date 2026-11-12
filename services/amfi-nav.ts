import { settingsStorage } from "@/services/storage";
import { logger } from "@/utils/logger";

/**
 * Latest mutual fund NAVs from AMFI (Association of Mutual Funds in India), free and public.
 *
 * Brokers can lag a day or more on MF prices (Zerodha's /mf/holdings often carries the day
 * before's NAV), so after a sync each fund with an ISIN is valued at AMFI's NAV when AMFI's is
 * newer. AMFI publishes one file with every scheme's latest NAV, usually by 11pm on the day.
 *
 * Privacy: the whole file is downloaded, never a per-fund lookup, so nothing about what you hold
 * leaves the phone; AMFI sees only that the file was fetched. Only the NAVs of funds you hold are
 * kept (amfi_nav_cache), to use while offline.
 */

const NAV_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";
const CACHE_KEY = "amfi_nav_cache";
/** Don't fetch more often than this: AMFI publishes once a day. */
const REFRESH_MS = 3 * 60 * 60 * 1000;

export interface AmfiNav {
  nav: number;
  /** YYYY-MM-DD */
  date: string;
}

interface Cache {
  fetchedAt: number;
  navs: Record<string, AmfiNav>;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "11-Nov-2026" → "2026-11-11"; null when it isn't one. */
export function parseAmfiDate(text: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(text.trim());
  const month = m ? MONTHS[m[2].toLowerCase()] : undefined;
  return m && month ? `${m[3]}-${month}-${m[1].padStart(2, "0")}` : null;
}

/**
 * Every ISIN → NAV in AMFI's file, for the ISINs asked about. Lines are
 * `code;ISIN payout/growth;ISIN reinvestment;name;…;NAV;date`; the number of columns in the middle
 * has changed before, so NAV and date are read from the end. Headings, blank lines and "N.A." NAVs
 * are skipped.
 */
export function parseAmfiNavFile(text: string, wanted: Set<string>): Record<string, AmfiNav> {
  const out: Record<string, AmfiNav> = {};
  for (const line of text.split(/\r?\n/)) {
    const f = line.split(";");
    if (f.length < 5) continue;
    const isins = [f[1], f[2]].map((s) => s.trim().toUpperCase()).filter((s) => wanted.has(s));
    if (isins.length === 0) continue;
    const nav = parseFloat(f[f.length - 2]);
    const date = parseAmfiDate(f[f.length - 1]);
    if (!Number.isFinite(nav) || nav <= 0 || !date) continue;
    for (const isin of isins) out[isin] = { nav, date };
  }
  return out;
}

function readCache(): Cache | null {
  try {
    const raw = settingsStorage.getString(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cache) : null;
  } catch {
    return null;
  }
}

/**
 * NAVs for these ISINs: from the cache when it's recent and has them all, else from AMFI. Never
 * throws: no network means whatever the cache has (or nothing), and the broker's own prices stand.
 */
export async function getAmfiNavs(isins: string[]): Promise<Record<string, AmfiNav>> {
  const wanted = new Set(isins.map((i) => i.trim().toUpperCase()).filter((i) => /^INF[A-Z0-9]{9}$/.test(i)));
  if (wanted.size === 0) return {};
  const cache = readCache();
  const fresh = cache && Date.now() - cache.fetchedAt < REFRESH_MS && [...wanted].every((i) => cache.navs[i]);
  if (fresh) return cache.navs;
  try {
    const resp = await fetch(NAV_URL);
    if (!resp.ok) throw new Error(`AMFI ${resp.status}`);
    const navs = parseAmfiNavFile(await resp.text(), wanted);
    settingsStorage.set(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), navs } satisfies Cache));
    return navs;
  } catch (e) {
    logger.warn("AMFI NAV fetch failed; keeping the broker's prices", e);
    return cache?.navs ?? {};
  }
}

/**
 * Holdings with AMFI's NAV where it's newer than the broker's. `last_price_date` may carry a time
 * ("2026-11-10 00:00:00") or be missing; only its date part is compared.
 */
export function applyAmfiNavs<T extends { tradingsymbol: string; last_price: number; last_price_date: string; average_price: number; quantity: number; pnl: number }>(
  holdings: T[],
  navs: Record<string, AmfiNav>,
): { holdings: T[]; updated: number; asOf: string | null } {
  let updated = 0;
  let asOf: string | null = null;
  const out = holdings.map((h) => {
    const a = navs[h.tradingsymbol?.trim().toUpperCase()];
    const brokerDate = (h.last_price_date ?? "").slice(0, 10);
    if (!a || (brokerDate && a.date <= brokerDate)) return h;
    updated++;
    if (!asOf || a.date > asOf) asOf = a.date;
    return { ...h, last_price: a.nav, last_price_date: a.date, pnl: (a.nav - h.average_price) * h.quantity };
  });
  return { holdings: out, updated, asOf };
}

/**
 * Exchange-traded funds also have INF… ISINs but trade all day: their market price is the right
 * value, so they're left alone. Angel One names them like NSE symbols ("NIFTYBEES-EQ", "GOLDETF").
 */
export function looksLikeEtf(tradingsymbol: string): boolean {
  return /-(EQ|BE)$/i.test(tradingsymbol) || /ETF|BEES/i.test(tradingsymbol);
}

/**
 * Angel One's holdings mix shares, ETFs and mutual fund units in one list with no price date, so a
 * fund is valued at AMFI's latest NAV whenever there is one. `valueChange` is what that adds to (or
 * takes off) the portfolio total Angel One sent.
 */
export function applyAmfiToAngel<T extends { tradingsymbol: string; isin: string; quantity: number; ltp: number; averageprice: number; profitandloss: number }>(
  holdings: T[],
  navs: Record<string, AmfiNav>,
): { holdings: T[]; updated: number; valueChange: number } {
  let updated = 0;
  let valueChange = 0;
  const out = holdings.map((h) => {
    const isin = (h.isin ?? "").trim().toUpperCase();
    const a = navs[isin];
    if (!a || !isin.startsWith("INF") || looksLikeEtf(h.tradingsymbol ?? "")) return h;
    // Angel One sends some numbers as strings.
    const ltp = Number(h.ltp) || 0;
    const qty = Number(h.quantity) || 0;
    if (Math.abs(a.nav - ltp) < 0.00005) return h;
    updated++;
    valueChange += (a.nav - ltp) * qty;
    return { ...h, ltp: a.nav, profitandloss: (a.nav - (Number(h.averageprice) || 0)) * qty };
  });
  return { holdings: out, updated, valueChange };
}
