import { DatabaseSync } from "node:sqlite";
import { amountPartsSql, effectiveAmountSql } from "../../services/expense-effective-amount";

/**
 * effectiveAmountSql against a real SQLite engine: refunds come off what an expense counts as,
 * and on a split expense the refund (made against the whole bill) shrinks your share in
 * proportion - the same figure the list rows show (ExpenseListItem).
 */
let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE expenses (
      id TEXT PRIMARY KEY, amount REAL, split_original_amount REAL, nature TEXT,
      status TEXT, deleted_at TEXT, refund_of_expense_id TEXT
    );
  `);
});

function effective(id: string): number {
  const row = db.prepare(`SELECT ${effectiveAmountSql("expenses")} AS v FROM expenses WHERE id = ?`).get(id) as { v: number };
  return row.v;
}

function add(id: string, amount: number, over: { split?: number; refundOf?: string; status?: string; deleted?: boolean } = {}) {
  db.prepare(
    `INSERT INTO expenses (id, amount, split_original_amount, nature, status, deleted_at, refund_of_expense_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    amount,
    over.split ?? null,
    over.refundOf ? "credit" : "realized",
    over.status ?? "approved",
    over.deleted ? "2026-10-01" : null,
    over.refundOf ?? null,
  );
}

test("an unrefunded expense counts in full", () => {
  add("e", 1000);
  expect(effective("e")).toBe(1000);
});

test("a refund comes off", () => {
  add("e", 1000);
  add("r", 400, { refundOf: "e" });
  expect(effective("e")).toBe(600);
});

test("pending or deleted refunds don't count yet", () => {
  add("e", 1000);
  add("r1", 400, { refundOf: "e", status: "pending_review" });
  add("r2", 300, { refundOf: "e", deleted: true });
  expect(effective("e")).toBe(1000);
});

test("a refund on a split bill shrinks your share in proportion", () => {
  // ₹1,000 bill, your share ₹500; ₹400 back on the bill → ₹600 left, half is yours.
  add("e", 500, { split: 1000 });
  add("r", 400, { refundOf: "e" });
  expect(effective("e")).toBe(300);
});

test("never goes below zero", () => {
  add("e", 1000);
  add("r", 1500, { refundOf: "e" });
  expect(effective("e")).toBe(0);
  add("s", 500, { split: 1000 });
  add("rs", 1200, { refundOf: "s" });
  expect(effective("s")).toBe(0);
});

describe("amountPartsSql", () => {
  function parts(id: string) {
    const p = amountPartsSql("expenses");
    return db
      .prepare(
        `SELECT ${p.gross} AS gross, ${p.othersShare} AS othersShare, ${p.myRefund} AS myRefund,
                ${effectiveAmountSql("expenses")} AS net
           FROM expenses WHERE id = ?`,
      )
      .get(id) as { gross: number; othersShare: number; myRefund: number; net: number };
  }

  test("plain expense with a refund: gross − refund = net", () => {
    add("e", 1000);
    add("r", 400, { refundOf: "e" });
    expect(parts("e")).toEqual({ gross: 1000, othersShare: 0, myRefund: 400, net: 600 });
  });

  test("split bill with a refund: only your share of the refund comes off yours", () => {
    // ₹1,000 bill, your share ₹500, ₹400 refunded on the bill.
    add("e", 500, { split: 1000 });
    add("r", 400, { refundOf: "e" });
    const r = parts("e");
    expect(r).toEqual({ gross: 1000, othersShare: 500, myRefund: 200, net: 300 });
    expect(r.gross - r.othersShare - r.myRefund).toBe(r.net);
  });

  test("over-refunded split bill still adds up (to zero)", () => {
    add("e", 500, { split: 1000 });
    add("r", 1500, { refundOf: "e" });
    const r = parts("e");
    expect(r.net).toBe(0);
    expect(r.gross - r.othersShare - r.myRefund).toBe(0);
  });
});
