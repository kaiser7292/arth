/**
 * The Investments screen under its chart (docs/INVESTMENTS_VIEW_PROPOSAL.md): idle cash in demat
 * accounts, and the FD ladder (when the money comes back). `fdLadder` is pure and tested;
 * `getIdleCash` reads the database.
 */
import { getDatabase } from "@/database";
import type { UpcomingFDMaturity } from "@/services/investment-accounts";

export type LadderBucketKey = "month" | "next3" | "year" | "later";

export interface LadderItem extends UpcomingFDMaturity {
  /** Interest rate a year, when known. */
  ratePa: number | null;
}

export interface LadderBucket {
  key: LadderBucketKey;
  label: string;
  items: LadderItem[];
  amount: number;
}

export interface FdLadder {
  /** Past their maturity but still open in Arth: renewed or closed? */
  overdue: LadderItem[];
  buckets: LadderBucket[];
  /** Amount coming back in each of the next 12 months, this month first. */
  months: { month: string; amount: number }[];
  /** Coming back in the next 90 days. */
  next90: number;
  /** Interest still to come on every open FD. */
  interestToCome: number;
  /** The next date money comes back, if any. */
  nextDate: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ym = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

const LABELS: Record<LadderBucketKey, string> = {
  month: "This month",
  next3: "Next 3 months",
  year: "3–12 months",
  later: "Later",
};

/**
 * Group FD maturities by when the money comes back. "This month" is the rest of the current
 * month; "Next 3 months" the three months after it; "3–12 months" up to a year out; "Later" the
 * rest. Empty buckets are left out. `rates` maps an account id to its rate a year.
 */
export function fdLadder(maturities: UpcomingFDMaturity[], rates: Map<string, number | null>, now: Date = new Date()): FdLadder {
  const today = ymd(now);
  const endOfMonth = ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const endNext3 = ymd(new Date(now.getFullYear(), now.getMonth() + 4, 0));
  const endYear = ymd(new Date(now.getFullYear(), now.getMonth() + 12, 0));
  const in90 = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 90));

  const items: LadderItem[] = [...maturities]
    .sort((a, b) => a.maturityDate.localeCompare(b.maturityDate))
    .map((m) => ({ ...m, ratePa: rates.get(m.financialAccountId) ?? null }));

  const overdue = items.filter((i) => i.maturityDate < today);
  const open = items.filter((i) => i.maturityDate >= today);
  const keyOf = (d: string): LadderBucketKey => (d <= endOfMonth ? "month" : d <= endNext3 ? "next3" : d <= endYear ? "year" : "later");

  const buckets: LadderBucket[] = (["month", "next3", "year", "later"] as LadderBucketKey[])
    .map((key) => {
      const its = open.filter((i) => keyOf(i.maturityDate) === key);
      return { key, label: LABELS[key], items: its, amount: its.reduce((s, i) => s + i.maturityAmount, 0) };
    })
    .filter((b) => b.items.length > 0);

  const months: { month: string; amount: number }[] = [];
  for (let k = 0; k < 12; k++) {
    const month = ym(new Date(now.getFullYear(), now.getMonth() + k, 1));
    months.push({ month, amount: open.filter((i) => i.maturityDate.startsWith(month)).reduce((s, i) => s + i.maturityAmount, 0) });
  }

  return {
    overdue,
    buckets,
    months,
    next90: open.filter((i) => i.maturityDate <= in90).reduce((s, i) => s + i.maturityAmount, 0),
    interestToCome: open.reduce((s, i) => s + Math.max(0, i.interestAmount), 0),
    nextDate: open[0]?.maturityDate ?? null,
  };
}

/** The rate a year averaged by how much is in each FD; null when no rate is known. */
export function averageRate(items: { principal: number | null; rate: number | null }[]): number | null {
  let weight = 0;
  let sum = 0;
  for (const i of items) {
    if (i.rate == null || !(i.principal && i.principal > 0)) continue;
    weight += i.principal;
    sum += i.principal * i.rate;
  }
  return weight > 0 ? Math.round((sum / weight) * 100) / 100 : null;
}

export interface IdleCash {
  accountId: string;
  amount: number;
  /** The date of the cash figure (last sync or manual update). */
  asOf: string;
}

/** Cash sitting in each demat account, from its latest fund reading. Only accounts with some. */
export async function getIdleCash(accountIds: string[]): Promise<IdleCash[]> {
  if (accountIds.length === 0) return [];
  const rows = await getDatabase().getAllAsync<{ account_id: string; fund_value: number; snapshot_date: string }>(
    `SELECT s.account_id, s.fund_value, s.snapshot_date FROM demat_fund_snapshots s
      WHERE s.account_id IN (${accountIds.map(() => "?").join(",")})
        AND s.snapshot_date = (SELECT MAX(t.snapshot_date) FROM demat_fund_snapshots t WHERE t.account_id = s.account_id);`,
    ...accountIds,
  );
  const seen = new Set<string>();
  const out: IdleCash[] = [];
  for (const r of rows) {
    if (seen.has(r.account_id) || !(r.fund_value > 0)) continue;
    seen.add(r.account_id);
    out.push({ accountId: r.account_id, amount: r.fund_value, asOf: r.snapshot_date });
  }
  return out.sort((a, b) => b.amount - a.amount);
}
