/**
 * Realised capital gains from withdrawals out of investment accounts.
 *
 * Nothing is stored: gains are worked out by replaying each account's money in (transfers to it)
 * and out (transfers from it) against its snapshot values, so editing, undoing or deleting a
 * withdrawal changes the gains with it.
 *
 * Cost of a withdrawal - proportional (average cost): taking out a share f of what the account is
 * worth takes the same share f of the money still invested. f = withdrawn / value just before,
 * where "value just before" is the latest snapshot before that day plus money moved since. With no
 * snapshot to go on, the money still invested comes out first (no gain until it's used up).
 *
 * Holding period - oldest money first (FIFO): the cost taken is drawn from the earliest deposits,
 * and the gain is split across them in proportion. A part held longer than the asset's threshold
 * (12 months equity, 24 months gold) is long-term.
 *
 * Tax classes (from the account's investment type):
 *   equity  - equity, mutual fund, untyped demat. STCG 20%, LTCG 12.5% over ₹1.25L.
 *   gold    - LTCG 12.5% after 24 months; short-term at slab.
 *   debt    - bonds, 'other': slab rate whatever the holding period.
 *   crypto  - virtual digital asset: flat 30%, no exemption, a loss offsets nothing.
 * FDs (interest), EPF / PPF / NPS aren't capital gains and are skipped.
 */

import { getDatabase } from "@/database";
import { getBrokerLinkedAccount } from "@/services/broker-link";
import type { CapitalGainsTaxInput } from "@/services/tax-engine";

export type GainClass = "equity" | "gold" | "debt" | "crypto";

export interface WithdrawalGain {
  transferId: string;
  accountId: string;
  accountName: string;
  date: string;
  /** Tax year start, e.g. 2026 for FY 2026-27 (April - March). */
  fy: number;
  assetClass: GainClass;
  proceeds: number;
  cost: number;
  gain: number;
  shortTerm: number;
  longTerm: number;
}

export interface AccountGains {
  withdrawals: WithdrawalGain[];
  /** Money still invested after every withdrawal (cost of what's left). */
  remainingCost: number;
  realisedGain: number;
}

interface Lot {
  date: string;
  cost: number;
}

export interface FlowEvent {
  id: string;
  date: string;
  amount: number;
  dir: "in" | "out";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function taxYearOf(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

const LONG_TERM_DAYS: Record<GainClass, number | null> = { equity: 365, gold: 730, debt: null, crypto: null };

/**
 * Replay one account. Pure: flows and snapshot readings in, per-withdrawal gains out.
 * `valueAt(dateExclusive)` gives the latest portfolio + cash reading strictly before a date.
 */
export function replayAccount(
  flows: FlowEvent[],
  valueBefore: (date: string) => { value: number; date: string } | null,
  assetClass: GainClass,
): { withdrawals: Omit<WithdrawalGain, "accountId" | "accountName" | "assetClass">[]; remainingCost: number } {
  // Money in before money out on the same day.
  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date) || (a.dir === b.dir ? 0 : a.dir === "in" ? -1 : 1));
  const lots: Lot[] = [];
  const done: FlowEvent[] = [];
  const out: Omit<WithdrawalGain, "accountId" | "accountName" | "assetClass">[] = [];

  for (const ev of sorted) {
    if (ev.dir === "in") {
      lots.push({ date: ev.date, cost: ev.amount });
      done.push(ev);
      continue;
    }
    const remaining = lots.reduce((s, l) => s + l.cost, 0);
    const reading = valueBefore(ev.date);
    let value: number | null = null;
    if (reading) {
      // Money moved after that reading and before this withdrawal.
      const moved = done
        .filter((d) => d.date > reading.date)
        .reduce((s, d) => s + (d.dir === "in" ? d.amount : -d.amount), 0);
      value = reading.value + moved;
    }
    const share = value != null && value > 0 ? Math.min(ev.amount / value, 1) : remaining > 0 ? Math.min(ev.amount / remaining, 1) : 0;
    const cost = remaining * share;
    const gain = ev.amount - cost;

    // Draw the cost from the oldest deposits; split the gain across them in proportion.
    let need = cost;
    let shortTerm = 0;
    let longTerm = 0;
    const threshold = LONG_TERM_DAYS[assetClass];
    for (const lot of lots) {
      if (need <= 1e-9) break;
      const take = Math.min(lot.cost, need);
      lot.cost -= take;
      need -= take;
      const part = cost > 0 ? gain * (take / cost) : 0;
      if (threshold != null && daysBetween(lot.date, ev.date) > threshold) longTerm += part;
      else shortTerm += part;
    }
    if (cost <= 1e-9) shortTerm += gain; // nothing invested to draw on: all of it is gain
    for (let i = lots.length - 1; i >= 0; i--) if (lots[i].cost <= 1e-9) lots.splice(i, 1);

    out.push({
      transferId: ev.id,
      date: ev.date,
      fy: taxYearOf(ev.date),
      proceeds: round2(ev.amount),
      cost: round2(cost),
      gain: round2(gain),
      shortTerm: round2(shortTerm),
      longTerm: round2(longTerm),
    });
    done.push(ev);
  }
  return { withdrawals: out, remainingCost: round2(lots.reduce((s, l) => s + l.cost, 0)) };
}

/** The tax class an investment account's gains fall in, or null when they aren't capital gains. */
export function gainClassFor(account: { id: string; account_type: string }, instrument: string | null): GainClass | null {
  if (instrument === "crypto") return "crypto";
  if (instrument === "gold") return "gold";
  if (instrument === "bond" || instrument === "other") return "debt";
  if (instrument === "fd" || instrument === "epf" || instrument === "ppf" || instrument === "nps") return null;
  if (account.account_type === "pension") return null;
  // An account linked to Zebpay that hasn't been given a type yet is crypto.
  if (!instrument && safeLinked("zebpay") === account.id) return "crypto";
  return "equity";
}

function safeLinked(broker: "zebpay"): string | null {
  try {
    return getBrokerLinkedAccount(broker);
  } catch {
    return null;
  }
}

/** Gains for one account (every withdrawal so far). */
export async function getAccountGains(accountId: string): Promise<AccountGains> {
  const db = getDatabase();
  const account = await db.getFirstAsync<{ id: string; account_type: string; account_label: string | null; bank_name: string }>(
    `SELECT id, account_type, account_label, bank_name FROM financial_accounts WHERE id = ?;`,
    accountId,
  );
  if (!account) return { withdrawals: [], remainingCost: 0, realisedGain: 0 };
  const product = await db.getFirstAsync<{ instrument: string }>(
    `SELECT instrument FROM investment_products WHERE financial_account_id = ?;`,
    accountId,
  );
  const cls = gainClassFor(account, product?.instrument ?? null);
  const [transfers, portfolio, fund] = await Promise.all([
    db.getAllAsync<{ id: string; date: string; amount: number; from_account_id: string }>(
      `SELECT id, date, amount, from_account_id FROM account_transfers
        WHERE (from_account_id = ? OR to_account_id = ?) AND deleted_at IS NULL;`,
      accountId,
      accountId,
    ),
    db.getAllAsync<{ date: string; value: number }>(
      `SELECT snapshot_date AS date, portfolio_value AS value FROM demat_portfolio_snapshots WHERE account_id = ? ORDER BY snapshot_date;`,
      accountId,
    ),
    db.getAllAsync<{ date: string; value: number }>(
      `SELECT snapshot_date AS date, fund_value AS value FROM demat_fund_snapshots WHERE account_id = ? ORDER BY snapshot_date;`,
      accountId,
    ),
  ]);
  const flows: FlowEvent[] = transfers.map((t) => ({
    id: t.id,
    date: t.date,
    amount: t.amount,
    dir: t.from_account_id === accountId ? "out" : "in",
  }));
  // Holdings already there when the account was added (its first snapshot, beyond any money moved
  // in by then) count as invested on that date - otherwise withdrawing them would read as all gain.
  const firstDate = [portfolio[0]?.date, fund[0]?.date].filter((d): d is string => !!d).sort()[0];
  if (firstDate) {
    const atFirst = (rows: { date: string; value: number }[]) => rows.filter((r) => r.date <= firstDate).pop()?.value ?? 0;
    const movedIn = flows
      .filter((f) => f.date <= firstDate)
      .reduce((sum, f) => sum + (f.dir === "in" ? f.amount : -f.amount), 0);
    const opening = atFirst(portfolio) + atFirst(fund) - movedIn;
    if (opening > 0.01) flows.push({ id: "__opening__", date: firstDate, amount: opening, dir: "in" });
  }
  const latestBefore = (rows: { date: string; value: number }[], date: string) => {
    let hit: { date: string; value: number } | null = null;
    for (const r of rows) {
      if (r.date >= date) break;
      hit = r;
    }
    return hit;
  };
  const valueBefore = (date: string) => {
    const p = latestBefore(portfolio, date);
    const f = latestBefore(fund, date);
    if (!p && !f) return null;
    return { value: (p?.value ?? 0) + (f?.value ?? 0), date: [p?.date ?? "", f?.date ?? ""].sort()[1] };
  };
  const { withdrawals, remainingCost } = replayAccount(flows, valueBefore, cls ?? "debt");
  const name = account.account_label || account.bank_name;
  const list: WithdrawalGain[] = cls
    ? withdrawals.map((w) => ({ ...w, accountId, accountName: name, assetClass: cls }))
    : [];
  return { withdrawals: list, remainingCost, realisedGain: round2(list.reduce((s, w) => s + w.gain, 0)) };
}

/** Every withdrawal gain in a tax year (April - March), across all investment accounts. */
export async function getRealizedGainsForTaxYear(userId: string, fy: number): Promise<WithdrawalGain[]> {
  const db = getDatabase();
  const accounts = await db.getAllAsync<{ id: string }>(
    `SELECT DISTINCT fa.id FROM financial_accounts fa
       JOIN account_transfers t ON t.from_account_id = fa.id AND t.deleted_at IS NULL
      WHERE fa.user_id = ? AND fa.account_type IN ('investment', 'demat')
        AND t.date >= ? AND t.date <= ?;`,
    userId,
    `${fy}-04-01`,
    `${fy + 1}-03-31`,
  );
  const all: WithdrawalGain[] = [];
  for (const a of accounts) {
    const g = await getAccountGains(a.id);
    all.push(...g.withdrawals.filter((w) => w.fy === fy));
  }
  return all.sort((a, b) => a.date.localeCompare(b.date));
}

export interface GainsTaxInputs {
  /** Added to the Income Calculator's own figures. */
  input: Pick<CapitalGainsTaxInput, "equity_ltcg" | "equity_stcg" | "debt" | "gold" | "crypto">;
  /** About 1% of crypto sale proceeds - deducted by the exchange (TDS), claimable as credit. */
  cryptoTds: number;
}

/**
 * Turn a year's withdrawal gains into the tax engine's buckets, applying the set-off rules:
 * an equity short-term loss offsets short- then long-term gains; a long-term loss only long-term;
 * gold short-term is taxed at slab with debt; crypto - each sale stands alone, losses count for
 * nothing.
 */
export function toTaxInputs(gains: WithdrawalGain[]): GainsTaxInputs {
  let eqShort = 0;
  let eqLong = 0;
  let debt = 0;
  let gold = 0;
  let crypto = 0;
  let cryptoProceeds = 0;
  for (const g of gains) {
    if (g.assetClass === "equity") {
      eqShort += g.shortTerm;
      eqLong += g.longTerm;
    } else if (g.assetClass === "gold") {
      gold += g.longTerm;
      debt += g.shortTerm;
    } else if (g.assetClass === "debt") {
      debt += g.gain;
    } else {
      crypto += Math.max(g.gain, 0);
      cryptoProceeds += g.proceeds;
    }
  }
  if (eqLong < 0) eqLong = 0;
  if (eqShort < 0) {
    eqLong = Math.max(eqLong + eqShort, 0);
    eqShort = 0;
  }
  return {
    input: {
      equity_stcg: round2(eqShort),
      equity_ltcg: round2(eqLong),
      debt: round2(Math.max(debt, 0)),
      gold: round2(Math.max(gold, 0)),
      crypto: round2(crypto),
    },
    cryptoTds: round2(cryptoProceeds * 0.01),
  };
}
