import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import type { AssetClass, HistoryBroker, ParsedMoneyMove, ParsedReport, ParsedTrade } from "./types";

/**
 * Saving broker records. Every id is built from the record itself, so saving the same thing twice,
 * from a file or the API, leaves one row. Corrections the user made survive re-importing a report.
 */

function tradeId(broker: HistoryBroker, t: ParsedTrade, ordinal: number): string {
  if (t.tradeId) return `${broker}:${t.segment}:${t.tradeId}`;
  return `${broker}:${t.tradeDate}:${t.symbol}:${t.side}:${t.quantity}:${t.price}:${t.orderId ?? ""}:${ordinal}`;
}

/** Trades, leaving any already saved alone. Returns how many were new. */
export async function saveTrades(accountId: string, broker: HistoryBroker, trades: ParsedTrade[], source: "api" | "file"): Promise<number> {
  const db = getDatabase();
  let added = 0;
  const seen = new Map<string, number>();
  for (const t of trades) {
    const base = `${t.tradeDate}|${t.symbol}|${t.side}|${t.quantity}|${t.price}|${t.orderId}`;
    const ordinal = seen.get(base) ?? 0;
    seen.set(base, ordinal + 1);
    const r = await db.runAsync(
      `INSERT OR IGNORE INTO broker_trades
         (id, account_id, broker, segment, symbol, isin, exchange, product, side, quantity, price, trade_date, trade_time, order_id, trade_id, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      tradeId(broker, t, ordinal),
      accountId,
      broker,
      t.segment,
      t.symbol,
      t.isin,
      t.exchange,
      t.product,
      t.side,
      t.quantity,
      t.price,
      t.tradeDate,
      t.tradeTime,
      t.orderId,
      t.tradeId,
      source,
    );
    added += r.changes;
  }
  return added;
}

async function saveMoves(accountId: string, broker: HistoryBroker, moves: ParsedMoneyMove[], from: string, to: string): Promise<void> {
  const db = getDatabase();
  // The statement is the record for its period, and replaces what the daily saves noted.
  await db.runAsync(
    `DELETE FROM broker_money_moves WHERE account_id = ? AND broker = ? AND move_date >= ? AND move_date <= ?;`,
    accountId,
    broker,
    from,
    to,
  );
  const seen = new Map<string, number>();
  for (const m of moves) {
    const base = `${broker}:${m.date}:${m.direction}:${m.reference ?? m.amount}`;
    const ordinal = seen.get(base) ?? 0;
    seen.set(base, ordinal + 1);
    await db.runAsync(
      `INSERT OR REPLACE INTO broker_money_moves (id, account_id, broker, move_date, direction, amount, reference, narration, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'file');`,
      `${accountId}:${base}:${ordinal}`,
      accountId,
      broker,
      m.date,
      m.direction,
      m.amount,
      m.reference,
      m.narration,
    );
  }
}

/** Today's money in or out from the API, kept until a statement replaces it. */
export async function saveDayMove(accountId: string, broker: HistoryBroker, date: string, direction: "in" | "out", amount: number): Promise<void> {
  const db = getDatabase();
  const id = `${accountId}:${broker}:api:${date}:${direction}`;
  if (amount <= 0) {
    await db.runAsync(`DELETE FROM broker_money_moves WHERE id = ?;`, id);
    return;
  }
  // A statement already covering this day has the real entries.
  const fromFile = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM broker_report_imports WHERE account_id = ? AND broker = ? AND kind = 'ledger' AND period_from <= ? AND period_to >= ?;`,
    accountId,
    broker,
    date,
    date,
  );
  if ((fromFile?.n ?? 0) > 0) return;
  await db.runAsync(
    `INSERT OR REPLACE INTO broker_money_moves (id, account_id, broker, move_date, direction, amount, narration, source)
     VALUES (?, ?, ?, ?, ?, ?, 'Saved from the day''s funds', 'api');`,
    id,
    accountId,
    broker,
    date,
    direction,
    amount,
  );
}

/** A report's sales replace whatever was saved for its period, keeping the user's corrections. */
async function saveGains(accountId: string, report: ParsedReport): Promise<void> {
  const db = getDatabase();
  const { broker, gains, periodFrom, periodTo } = report;
  const sellDates = gains.map((g) => g.sellDate).sort();
  const from = sellDates[0] && sellDates[0] < periodFrom ? sellDates[0] : periodFrom;
  const to = sellDates.length && sellDates[sellDates.length - 1] > periodTo ? sellDates[sellDates.length - 1] : periodTo;
  const kept = await db.getAllAsync<{ id: string; cost_override: number | null; class_override: string | null }>(
    `SELECT id, cost_override, class_override FROM broker_gains
      WHERE account_id = ? AND broker = ? AND sell_date >= ? AND sell_date <= ?
        AND (cost_override IS NOT NULL OR class_override IS NOT NULL);`,
    accountId,
    broker,
    from,
    to,
  );
  const corrections = new Map(kept.map((k) => [k.id, k]));
  await db.runAsync(`DELETE FROM broker_gains WHERE account_id = ? AND broker = ? AND sell_date >= ? AND sell_date <= ?;`, accountId, broker, from, to);
  const seen = new Map<string, number>();
  for (const g of gains) {
    const base = `${g.isin ?? g.symbol}|${g.buyDate ?? ""}|${g.sellDate}|${g.quantity}|${g.category}`;
    const ordinal = seen.get(base) ?? 0;
    seen.set(base, ordinal + 1);
    const id = `${accountId}:${broker}:${base}:${ordinal}`;
    const c = corrections.get(id);
    await db.runAsync(
      `INSERT OR REPLACE INTO broker_gains
         (id, account_id, broker, symbol, isin, quantity, buy_date, sell_date, buy_value, sell_value, taxable, charges, stt, category, asset_class, check_reason, cost_override, class_override)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      id,
      accountId,
      broker,
      g.symbol,
      g.isin,
      g.quantity,
      g.buyDate,
      g.sellDate,
      g.buyValue,
      g.sellValue,
      g.taxable,
      g.charges,
      g.stt,
      g.category,
      g.assetClass,
      g.checkReason,
      c?.cost_override ?? null,
      c?.class_override ?? null,
    );
  }
}

export async function saveReport(accountId: string, report: ParsedReport, fileName: string, opts: { allowOther?: boolean } = {}): Promise<void> {
  if (report.broker === "other" && !opts.allowOther) throw new Error("Unknown report");
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    if (report.kind === "gains") await saveGains(accountId, report);
    if (report.kind === "tradebook") await saveTrades(accountId, report.broker, report.trades, "file");
    if (report.kind === "ledger") await saveMoves(accountId, report.broker, report.moves, report.periodFrom, report.periodTo);
    await db.runAsync(
      `INSERT OR REPLACE INTO broker_report_imports (id, account_id, broker, kind, period_from, period_to, file_name, row_count, charges_total, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      `${accountId}:${report.broker}:${report.kind}:${report.label}:${report.periodFrom}`,
      accountId,
      report.broker,
      report.kind,
      report.periodFrom,
      report.periodTo,
      fileName,
      report.gains.length + report.trades.length + report.moves.length,
      report.chargesTotal,
      new Date().toISOString(),
    );
  });
  bumpDataVersion();
}

/** The user's correction of one sale: what it really cost, and how it's taxed. */
export async function correctGain(id: string, change: { cost?: number | null; assetClass?: AssetClass | null }): Promise<void> {
  const db = getDatabase();
  if (change.cost !== undefined) await db.runAsync(`UPDATE broker_gains SET cost_override = ? WHERE id = ?;`, change.cost, id);
  if (change.assetClass !== undefined) await db.runAsync(`UPDATE broker_gains SET class_override = ? WHERE id = ?;`, change.assetClass, id);
  bumpDataVersion();
}

export async function saveCaptureDay(accountId: string, broker: HistoryBroker, date: string, tradeCount: number, holdings: Record<string, number> | null): Promise<void> {
  await getDatabase().runAsync(
    `INSERT OR REPLACE INTO broker_capture_days (id, account_id, broker, capture_date, captured_at, trade_count, holdings_json)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    `${accountId}:${broker}:${date}`,
    accountId,
    broker,
    date,
    new Date().toISOString(),
    tradeCount,
    holdings ? JSON.stringify(holdings) : null,
  );
}
