import { getDatabase } from "@/database";
import type { StmtDirection, MatchConfidence } from "./reconciliation-crud";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StatementRow {
  date: string;       // ISO: "2026-04-15"
  amount: number;     // Always positive
  direction: StmtDirection;
  narration: string;
}

export interface ArthPoolEntry {
  id: string;
  kind: "expense" | "transfer";
  date: string;
  amount: number;       // match amount (split_original_amount if set, else amount)
  direction: StmtDirection;
  description: string;
  status?: string;      // 'approved' | 'pending_review' | 'rejected'
  is_pending?: boolean;
}

export interface MatchResult {
  stmtRow: StatementRow;
  stmtIndex: number;
  matched: ArthPoolEntry | null;
  confidence: MatchConfidence | null;
  amountDiff: number | null;
  dateDiff: number | null;  // days
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
  return Math.abs(
    (new Date(a).getTime() - new Date(b).getTime()) / 86_400_000,
  );
}

// ─── Pool builder ─────────────────────────────────────────────────────────────

export async function buildArthPool(
  accountId: string,
  startDate: string,
  endDate: string,
): Promise<ArthPoolEntry[]> {
  const db = getDatabase();

  // Widen the date window by 7 days each side for the pool (matcher will apply
  // the final ±3 / ±7 day tolerance windows)
  const poolStart = new Date(new Date(startDate).getTime() - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const poolEnd = new Date(new Date(endDate).getTime() + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // Expenses (realized + credits + ledger_adjustments, not rejected)
  const expenses = await db.getAllAsync<{
    id: string;
    date: string;
    amount: number;
    split_original_amount: number | null;
    nature: string;
    description: string | null;
    merchant_name: string | null;
    status: string;
  }>(
    `SELECT id, date, amount, split_original_amount, nature, description,
            merchant_name, status
     FROM expenses
     WHERE account_id = ?
       AND date BETWEEN ? AND ?
       AND deleted_at IS NULL
       AND status != 'rejected'
       AND nature IN ('realized', 'credit', 'ledger_adjustment')`,
    [accountId, poolStart, poolEnd],
  );

  const expenseEntries: ArthPoolEntry[] = expenses.map((e) => {
    const matchAmount =
      e.split_original_amount && e.split_original_amount > 0
        ? e.split_original_amount
        : e.amount;
    const direction: StmtDirection =
      e.nature === "credit" ? "credit" : "debit";
    return {
      id: e.id,
      kind: "expense",
      date: e.date,
      amount: matchAmount,
      direction,
      description: e.merchant_name || e.description || "",
      status: e.status,
      is_pending: e.status === "pending_review",
    };
  });

  // Transfers (from_account = debit for this account, to_account = credit)
  const transfers = await db.getAllAsync<{
    id: string;
    date: string;
    amount: number;
    description: string | null;
    from_account_id: string;
    to_account_id: string;
  }>(
    `SELECT id, date, amount, description, from_account_id, to_account_id
     FROM account_transfers
     WHERE (from_account_id = ? OR to_account_id = ?)
       AND date BETWEEN ? AND ?
       AND deleted_at IS NULL`,
    [accountId, accountId, poolStart, poolEnd],
  );

  const transferEntries: ArthPoolEntry[] = transfers.map((t) => ({
    id: t.id,
    kind: "transfer",
    date: t.date,
    amount: t.amount,
    direction: t.from_account_id === accountId ? "debit" : "credit",
    description: t.description || "",
  }));

  return [...expenseEntries, ...transferEntries];
}

// ─── Core matcher ─────────────────────────────────────────────────────────────

const AMOUNT_TOLERANCE = 1.0;   // ₹1
const AUTO_DAY_TOLERANCE = 3;   // days
const SUGGEST_DAY_TOLERANCE = 7;

export function matchStatementRows(
  stmtRows: StatementRow[],
  pool: ArthPoolEntry[],
): {
  results: MatchResult[];
  extraInArth: ArthPoolEntry[];
} {
  const usedPoolIds = new Set<string>();
  const results: MatchResult[] = [];

  for (let i = 0; i < stmtRows.length; i++) {
    const s = stmtRows[i];

    // Candidates: same direction + within amount tolerance
    const candidates = pool.filter((a) => {
      if (usedPoolIds.has(a.id)) return false;
      if (a.direction !== s.direction) return false;
      return Math.abs(a.amount - s.amount) <= AMOUNT_TOLERANCE;
    });

    if (candidates.length === 0) {
      results.push({ stmtRow: s, stmtIndex: i, matched: null, confidence: null, amountDiff: null, dateDiff: null });
      continue;
    }

    // Rank by date proximity
    const ranked = candidates
      .map((a) => ({ entry: a, days: daysBetween(a.date, s.date) }))
      .sort((x, y) => x.days - y.days);

    const best = ranked[0];

    let confidence: MatchConfidence | null = null;
    if (best.days <= AUTO_DAY_TOLERANCE) {
      confidence = "auto";
    } else if (best.days <= SUGGEST_DAY_TOLERANCE) {
      confidence = "suggested";
    }

    if (confidence) {
      usedPoolIds.add(best.entry.id);
      results.push({
        stmtRow: s,
        stmtIndex: i,
        matched: best.entry,
        confidence,
        amountDiff: Math.abs(best.entry.amount - s.amount),
        dateDiff: best.days,
      });
    } else {
      results.push({ stmtRow: s, stmtIndex: i, matched: null, confidence: null, amountDiff: null, dateDiff: null });
    }
  }

  const extraInArth = pool.filter((a) => !usedPoolIds.has(a.id));

  return { results, extraInArth };
}

// ─── Cashback pair detector ───────────────────────────────────────────────────

export interface CashbackPair {
  plusIndex: number;
  minusIndex: number;
  amount: number;
}

export function detectCashbackPairs(
  rows: StatementRow[],
  windowDays = 5,
): CashbackPair[] {
  const pairs: CashbackPair[] = [];
  const used = new Set<number>();

  for (let i = 0; i < rows.length; i++) {
    if (used.has(i)) continue;
    const a = rows[i];
    for (let j = i + 1; j < rows.length; j++) {
      if (used.has(j)) continue;
      const b = rows[j];
      // Opposite directions, same amount, within window
      if (
        a.direction !== b.direction &&
        Math.abs(a.amount - b.amount) <= AMOUNT_TOLERANCE &&
        daysBetween(a.date, b.date) <= windowDays
      ) {
        const plus = a.direction === "credit" ? i : j;
        const minus = a.direction === "debit" ? i : j;
        pairs.push({ plusIndex: plus, minusIndex: minus, amount: a.amount });
        used.add(i);
        used.add(j);
        break;
      }
    }
  }

  return pairs;
}
