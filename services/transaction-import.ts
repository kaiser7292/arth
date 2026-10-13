/**
 * Transaction import (Settings → Import from Excel).
 *
 * One sheet, one row per transaction, covering what the Transactions tab shows:
 *   expense    — everyday spending
 *   committed  — spending linked to a loan (an EMI) or an investment bucket (a SIP)
 *   credit     — money received (salary, refund, interest …)
 *   transfer   — money moved between two of your own accounts
 *
 * Three steps, the first two pure so the preview can show exactly what will happen:
 *   parseTransactionRows  — sheet → rows, with a reason for every row it can't read
 *   planTransactionImport — rows → what gets imported; resolves accounts and links, and drops
 *                           rows that are already in Arth
 *   importTransactions    — saves each row through the same functions the app uses when you add
 *                           one by hand, so balances, smart rules and links behave the same
 */

import { getDatabase } from "@/database";
import { getCurrentFY } from "@/utils/fiscal-year";
import type * as XLSXType from "xlsx";
import { createTransfer } from "./account-transfer";
import { createCategory, getAllCategories } from "./category";
import { fuzzyFindCategory, guessPaymentModeType, parseAmount, parseDate, parseRightSpend } from "./excel-import";
import { createExpense } from "./expense-crud";
import { CREDIT_KINDS, CREDIT_KIND_LABELS, type CreditKind } from "./expense-types";
import { createPaymentMode, getAllPaymentModes } from "./payment-mode";
import { getFYStartMonth } from "./settings";

let _xlsx: typeof XLSXType | null = null;
function loadXLSX(): typeof XLSXType {
  if (!_xlsx) _xlsx = require("xlsx") as typeof XLSXType;
  return _xlsx;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export const TRANSACTION_TYPES = ["expense", "committed", "credit", "transfer"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  expense: "Expenses",
  committed: "Committed",
  credit: "Credits",
  transfer: "Transfers",
};

export const TRANSACTION_TEMPLATE_COLUMNS = [
  "Date",
  "Type",
  "Amount",
  "Description",
  "Merchant",
  "Category",
  "Payment Mode",
  "Account",
  "To Account",
  "Credit Type",
  "Linked To",
  "Right Spend",
] as const;

export const TRANSACTION_REQUIRED_COLUMNS: readonly string[] = ["Date", "Amount"];

export function generateTransactionTemplateCSV(): string {
  const header = TRANSACTION_TEMPLATE_COLUMNS.join(",");
  const samples = [
    "2026-05-15,Expense,450,Swiggy order,Swiggy,Food,UPI,HDFC Savings,,,,Yes",
    "2026-05-05,Committed,25000,Home loan EMI,HDFC Ltd,Housing,,HDFC Savings,,,HDFC Home Loan,",
    "2026-05-07,Committed,10000,Monthly SIP,Zerodha,Investments,,HDFC Savings,,,Mutual Funds,",
    "2026-05-01,Credit,85000,May salary,Acme Corp,,,HDFC Savings,,Salary,,",
    "2026-05-03,Transfer,20000,Move to ICICI,,,,HDFC Savings,ICICI Savings,,,",
  ];
  return `${header}\n${samples.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface ParsedTransactionRow {
  /** Row in the sheet, counting the header as row 1. */
  rowNumber: number;
  type: TransactionType;
  date: string;
  amount: number;
  description: string | null;
  merchantName: string | null;
  categoryName: string | null;
  paymentModeName: string | null;
  accountName: string | null;
  toAccountName: string | null;
  creditKind: CreditKind | null;
  linkedToName: string | null;
  isRightSpend: number | null;
}

export interface SkippedRow {
  rowNumber: number;
  reason: string;
}

const MAX_ROWS = 5000;
const MAX_LEN = { description: 200, merchant: 100, name: 50 } as const;

const TYPE_WORDS: Record<string, TransactionType> = {
  expense: "expense", expenses: "expense", debit: "expense", spend: "expense", spent: "expense",
  committed: "committed", emi: "committed", sip: "committed", investment: "committed",
  credit: "credit", credits: "credit", income: "credit", received: "credit",
  transfer: "transfer", transfers: "transfer",
};

/** Blank means an expense, so a sheet without a Type column still imports. */
export function parseTransactionType(value: unknown): TransactionType | null {
  if (value === null || value === undefined) return "expense";
  const word = String(value).trim().toLowerCase();
  if (!word) return "expense";
  return TYPE_WORDS[word] ?? null;
}

/** Accepts the stored key ("gain") or the name shown in the app ("Investment gain"). */
export function parseCreditKind(value: unknown): CreditKind | null {
  if (value === null || value === undefined) return null;
  const word = String(value).trim().toLowerCase();
  if (!word) return null;
  return CREDIT_KINDS.find((k) => k === word || CREDIT_KIND_LABELS[k].toLowerCase() === word) ?? null;
}

function text(value: unknown, maxLen: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s.slice(0, maxLen) : null;
}

const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export function parseTransactionRows(
  workbook: XLSXType.WorkBook,
  sheetName: string,
): { rows: ParsedTransactionRow[]; skipped: SkippedRow[] } {
  const XLSX = loadXLSX();
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: null });

  const rows: ParsedTransactionRow[] = [];
  const skipped: SkippedRow[] = [];

  json.slice(0, MAX_ROWS).forEach((raw, index) => {
    const rowNumber = index + 2;
    // Headers are matched loosely: "Payment Mode", "payment_mode" and "PAYMENT MODE" are one column.
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      const key = headerKey(k);
      // Two columns with the same name: the one with a value wins.
      if (r[key] === undefined || r[key] === null || r[key] === "") r[key] = v;
    }
    if (Object.values(r).every((v) => v === null || v === undefined || String(v).trim() === "")) return;

    const type = parseTransactionType(r.type);
    if (!type) {
      skipped.push({ rowNumber, reason: `Type "${String(r.type).trim()}" isn't Expense, Committed, Credit or Transfer` });
      return;
    }
    const date = parseDate(r.date);
    if (!date) {
      skipped.push({ rowNumber, reason: "No readable date" });
      return;
    }
    const amount = parseAmount(r.amount);
    if (!amount) {
      skipped.push({ rowNumber, reason: "No amount, or it isn't a positive number" });
      return;
    }
    const rawKind = text(r.credittype, MAX_LEN.name);
    const creditKind = parseCreditKind(rawKind);
    if (type === "credit" && rawKind && !creditKind) {
      skipped.push({ rowNumber, reason: `Credit Type "${rawKind}" isn't one of ${CREDIT_KINDS.map((k) => CREDIT_KIND_LABELS[k]).join(", ")}` });
      return;
    }

    rows.push({
      rowNumber,
      type,
      date,
      amount,
      description: text(r.description, MAX_LEN.description),
      merchantName: text(r.merchant, MAX_LEN.merchant),
      categoryName: text(r.category, MAX_LEN.name),
      paymentModeName: text(r.paymentmode, MAX_LEN.name),
      accountName: text(r.account ?? r.fromaccount, MAX_LEN.name),
      toAccountName: text(r.toaccount, MAX_LEN.name),
      creditKind,
      linkedToName: text(r.linkedto, MAX_LEN.name),
      isRightSpend: parseRightSpend(r.rightspend),
    });
  });

  return { rows, skipped };
}

// ---------------------------------------------------------------------------
// Matching names in the sheet to what's in Arth
// ---------------------------------------------------------------------------

export interface ImportAccount {
  id: string;
  account_label: string | null;
  bank_name: string;
  account_identifier: string;
}

/**
 * Find the account a sheet cell means: its name, "HDFC ****1234", or just the last digits.
 * "ambiguous" when more than one account fits — guessing would put money in the wrong ledger.
 */
export function resolveAccount(name: string, accounts: ImportAccount[]): string | "missing" | "ambiguous" {
  const needle = name.trim().toLowerCase();
  if (!needle) return "missing";
  const one = (matches: ImportAccount[]) => (matches.length === 1 ? matches[0].id : matches.length > 1 ? "ambiguous" : null);

  const byLabel = one(accounts.filter((a) => (a.account_label ?? "").trim().toLowerCase() === needle));
  if (byLabel) return byLabel;

  const digits = needle.match(/(\d{3,})\D*$/)?.[1];
  if (digits) {
    const byDigits = accounts.filter((a) => a.account_identifier && (a.account_identifier.endsWith(digits) || digits.endsWith(a.account_identifier)));
    const words = needle.replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 1);
    const narrowed = words.length
      ? byDigits.filter((a) => words.some((w) => `${a.bank_name} ${a.account_label ?? ""}`.toLowerCase().includes(w)))
      : byDigits;
    const hit = one(narrowed.length ? narrowed : byDigits);
    if (hit) return hit;
  }

  const byBank = one(accounts.filter((a) => a.bank_name.trim().toLowerCase() === needle));
  return byBank ?? "missing";
}

export interface ImportBucket {
  id: string;
  name: string;
  /** "2026" or "2026-27" — the year the financial year starts is what's compared. */
  financial_year: string | null;
}

export interface ImportLoan {
  loanAccountId: string;
  account: ImportAccount;
}

export type PlannedLink = { kind: "bucket"; id: string } | { kind: "loan"; id: string };

/** What "Linked To" means for a payment on `date`: an investment bucket of that financial year, or a loan. */
export function resolveLink(
  name: string,
  date: string,
  buckets: ImportBucket[],
  loans: ImportLoan[],
  fyStartMonth: number,
): PlannedLink | { error: string } {
  const needle = name.trim().toLowerCase();
  const named = buckets.filter((b) => b.name.trim().toLowerCase() === needle);
  if (named.length > 0) {
    const fy = String(getCurrentFY(fyStartMonth, new Date(`${date}T00:00:00`)));
    const inYear = named.find((b) => (b.financial_year ?? "").startsWith(fy));
    return inYear
      ? { kind: "bucket", id: inYear.id }
      : { error: `Investment bucket "${name}" has no plan for the year of ${date}` };
  }
  const loan = resolveAccount(name, loans.map((l) => l.account));
  if (loan === "ambiguous") return { error: `More than one loan matches "${name}"` };
  if (loan !== "missing") return { kind: "loan", id: loans.find((l) => l.account.id === loan)!.loanAccountId };
  return { error: `No loan or investment bucket called "${name}"` };
}

// ---------------------------------------------------------------------------
// Planning (what the preview shows)
// ---------------------------------------------------------------------------

export interface PlannedTransaction extends ParsedTransactionRow {
  accountId: string | null;
  toAccountId: string | null;
  link: PlannedLink | null;
}

export interface ImportContext {
  accounts: ImportAccount[];
  buckets: ImportBucket[];
  loans: ImportLoan[];
  fyStartMonth: number;
  /** How many of each transaction (see duplicateKey) Arth already holds. */
  existing: Map<string, number>;
}

/**
 * Two transactions are "the same" when type, date, amount and who it was with all match.
 * Transfers compare the two accounts instead of a name.
 */
export function duplicateKey(
  type: "spend" | "credit" | "transfer",
  date: string,
  amount: number,
  who: string,
): string {
  return `${type}|${date}|${amount.toFixed(2)}|${who.trim().toLowerCase()}`;
}

function rowDuplicateKey(row: PlannedTransaction): string {
  if (row.type === "transfer") return duplicateKey("transfer", row.date, row.amount, `${row.accountId}>${row.toAccountId}`);
  const who = row.merchantName ?? row.description ?? "";
  return duplicateKey(row.type === "credit" ? "credit" : "spend", row.date, row.amount, who);
}

export interface ImportPlan {
  ready: PlannedTransaction[];
  skipped: SkippedRow[];
  /** How many of `skipped` were left out because Arth already has them. */
  duplicates: number;
}

export function planTransactionImport(rows: ParsedTransactionRow[], ctx: ImportContext): ImportPlan {
  const ready: PlannedTransaction[] = [];
  const skipped: SkippedRow[] = [];
  let duplicates = 0;
  // Counted, not just looked up: two identical coffees on one day are two transactions, and if
  // Arth already has one of them only the other is imported.
  const remaining = new Map(ctx.existing);

  for (const row of rows) {
    const skip = (reason: string) => skipped.push({ rowNumber: row.rowNumber, reason });

    let accountId: string | null = null;
    if (row.accountName) {
      const hit = resolveAccount(row.accountName, ctx.accounts);
      if (hit === "missing") { skip(`Account "${row.accountName}" isn't in Arth`); continue; }
      if (hit === "ambiguous") { skip(`More than one account matches "${row.accountName}"`); continue; }
      accountId = hit;
    }

    let toAccountId: string | null = null;
    if (row.type === "transfer") {
      if (!accountId) { skip("A transfer needs the Account it left"); continue; }
      if (!row.toAccountName) { skip("A transfer needs a To Account"); continue; }
      const hit = resolveAccount(row.toAccountName, ctx.accounts);
      if (hit === "missing") { skip(`To Account "${row.toAccountName}" isn't in Arth`); continue; }
      if (hit === "ambiguous") { skip(`More than one account matches "${row.toAccountName}"`); continue; }
      if (hit === accountId) { skip("Account and To Account are the same"); continue; }
      toAccountId = hit;
    }

    let link: PlannedLink | null = null;
    if (row.type === "committed") {
      if (!row.linkedToName) { skip("A committed row needs Linked To (a loan or an investment bucket)"); continue; }
      const hit = resolveLink(row.linkedToName, row.date, ctx.buckets, ctx.loans, ctx.fyStartMonth);
      if ("error" in hit) { skip(hit.error); continue; }
      link = hit;
    }

    const planned: PlannedTransaction = { ...row, accountId, toAccountId, link };
    const key = rowDuplicateKey(planned);
    const have = remaining.get(key) ?? 0;
    if (have > 0) {
      remaining.set(key, have - 1);
      duplicates++;
      skip("Already in Arth");
      continue;
    }
    ready.push(planned);
  }

  return { ready, skipped, duplicates };
}

export interface ImportPreview {
  count: number;
  byType: Record<TransactionType, { count: number; total: number }>;
  dateRange: { from: string; to: string } | null;
  newCategories: string[];
  newPaymentModes: string[];
}

export function getTransactionImportPreview(
  ready: PlannedTransaction[],
  known: { categories: string[]; paymentModes: string[] },
): ImportPreview {
  const byType = Object.fromEntries(TRANSACTION_TYPES.map((t) => [t, { count: 0, total: 0 }])) as ImportPreview["byType"];
  for (const r of ready) {
    byType[r.type].count++;
    byType[r.type].total += r.amount;
  }
  const dates = ready.map((r) => r.date).sort();
  const lower = (list: string[]) => new Set(list.map((s) => s.toLowerCase()));
  const cats = lower(known.categories);
  const modes = lower(known.paymentModes);
  const fresh = (names: (string | null)[], have: Set<string>) =>
    [...new Map(names.filter((n): n is string => !!n && !have.has(n.toLowerCase())).map((n) => [n.toLowerCase(), n])).values()];
  return {
    count: ready.length,
    byType,
    dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    // A rough count: importing also folds near-matches ("Subscription" / "Subscriptions") together.
    newCategories: fresh(ready.filter((r) => r.type !== "transfer").map((r) => r.categoryName), cats),
    newPaymentModes: fresh(ready.filter((r) => r.type === "expense" || r.type === "committed").map((r) => r.paymentModeName), modes),
  };
}

// ---------------------------------------------------------------------------
// Database: context for the plan, and the import itself
// ---------------------------------------------------------------------------

/** Everything planTransactionImport needs from the database, for the rows' date span. */
export async function loadImportContext(userId: string, rows: ParsedTransactionRow[]): Promise<ImportContext & { categories: string[]; paymentModes: string[] }> {
  const db = getDatabase();
  const accounts = await db.getAllAsync<ImportAccount & { account_type: string }>(
    `SELECT id, account_label, bank_name, account_identifier, account_type
       FROM financial_accounts WHERE user_id = ? AND is_active = 1;`,
    userId,
  );
  const buckets = await db.getAllAsync<ImportBucket>(
    `SELECT id, name, financial_year FROM investment_buckets WHERE user_id = ? AND is_active = 1;`,
    userId,
  );
  const loanRows = await db.getAllAsync<{ id: string; financial_account_id: string }>(
    `SELECT la.id, la.financial_account_id FROM loan_accounts la
       JOIN financial_accounts fa ON fa.id = la.financial_account_id
      WHERE fa.user_id = ?;`,
    userId,
  );
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const loans: ImportLoan[] = loanRows
    .filter((l) => byId.has(l.financial_account_id))
    .map((l) => ({ loanAccountId: l.id, account: byId.get(l.financial_account_id)! }));

  const existing = new Map<string, number>();
  const dates = rows.map((r) => r.date).sort();
  if (dates.length > 0) {
    const from = dates[0];
    const to = dates[dates.length - 1];
    const bump = (key: string) => existing.set(key, (existing.get(key) ?? 0) + 1);
    // The full amount paid, not your share of a split; rejected and deleted rows don't count.
    const spendAndCredits = await db.getAllAsync<{ nature: string; date: string; amount: number; who: string | null }>(
      `SELECT nature, date, COALESCE(split_original_amount, amount) AS amount,
              COALESCE(NULLIF(merchant_name, ''), description) AS who
         FROM expenses
        WHERE user_id = ? AND deleted_at IS NULL AND status != 'rejected'
          AND nature IN ('realized', 'credit') AND date >= ? AND date <= ?;`,
      userId, from, to,
    );
    for (const e of spendAndCredits) {
      bump(duplicateKey(e.nature === "credit" ? "credit" : "spend", e.date, e.amount, e.who ?? ""));
    }
    const transfers = await db.getAllAsync<{ date: string; amount: number; from_account_id: string; to_account_id: string }>(
      `SELECT date, amount, from_account_id, to_account_id FROM account_transfers
        WHERE user_id = ? AND deleted_at IS NULL AND date >= ? AND date <= ?;`,
      userId, from, to,
    );
    for (const t of transfers) bump(duplicateKey("transfer", t.date, t.amount, `${t.from_account_id}>${t.to_account_id}`));
  }

  const [categories, paymentModes] = await Promise.all([getAllCategories(userId), getAllPaymentModes(userId)]);
  return {
    accounts,
    buckets,
    loans,
    fyStartMonth: getFYStartMonth(),
    existing,
    categories: categories.map((c) => c.name),
    paymentModes: paymentModes.map((m) => m.name),
  };
}

export interface TransactionImportResult {
  imported: Record<TransactionType, number>;
  failed: SkippedRow[];
  /** Saved as spending, but the loan or bucket link didn't take. */
  notLinked: SkippedRow[];
  categoriesCreated: string[];
  paymentModesCreated: string[];
}

export async function importTransactions(userId: string, ready: PlannedTransaction[]): Promise<TransactionImportResult> {
  const result: TransactionImportResult = {
    imported: { expense: 0, committed: 0, credit: 0, transfer: 0 },
    failed: [],
    notLinked: [],
    categoriesCreated: [],
    paymentModesCreated: [],
  };

  const categoryMap = new Map((await getAllCategories(userId)).map((c) => [c.name.toLowerCase(), c.id]));
  const modeMap = new Map((await getAllPaymentModes(userId)).map((m) => [m.name.toLowerCase(), m.id]));

  const categoryFor = async (name: string | null): Promise<string | undefined> => {
    if (!name) return undefined;
    const key = name.toLowerCase();
    const known = categoryMap.get(key) ?? fuzzyFindCategory(key, categoryMap);
    if (known) {
      categoryMap.set(key, known);
      return known;
    }
    const id = await createCategory({ user_id: userId, name });
    categoryMap.set(key, id);
    result.categoriesCreated.push(name);
    return id;
  };

  const modeFor = async (name: string | null): Promise<string | undefined> => {
    if (!name) return undefined;
    const key = name.toLowerCase();
    const known = modeMap.get(key);
    if (known) return known;
    const id = await createPaymentMode({ user_id: userId, name, type: guessPaymentModeType(name) });
    modeMap.set(key, id);
    result.paymentModesCreated.push(name);
    return id;
  };

  for (const row of ready) {
    try {
      if (row.type === "transfer") {
        await createTransfer({
          userId,
          fromAccountId: row.accountId!,
          toAccountId: row.toAccountId!,
          amount: row.amount,
          description: row.description ?? row.merchantName ?? undefined,
          date: row.date,
        });
      } else if (row.type === "credit") {
        await createExpense({
          user_id: userId,
          amount: row.amount,
          description: row.description ?? undefined,
          merchant_name: row.merchantName ?? undefined,
          category_id: await categoryFor(row.categoryName),
          account_id: row.accountId,
          date: row.date,
          nature: "credit",
          credit_kind: row.creditKind,
        });
      } else {
        const id = await createExpense({
          user_id: userId,
          amount: row.amount,
          description: row.description ?? undefined,
          merchant_name: row.merchantName ?? undefined,
          category_id: await categoryFor(row.categoryName),
          payment_mode_id: await modeFor(row.paymentModeName),
          account_id: row.accountId,
          date: row.date,
          is_right_spend: row.isRightSpend,
        });
        if (row.link) {
          const problem = await linkImported(id, userId, row.link);
          if (problem) result.notLinked.push({ rowNumber: row.rowNumber, reason: problem });
        }
      }
      result.imported[row.type]++;
    } catch (e) {
      result.failed.push({ rowNumber: row.rowNumber, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  return result;
}

/** Link a just-imported payment; returns why it couldn't be linked, or null when it was. */
async function linkImported(expenseId: string, userId: string, link: PlannedLink): Promise<string | null> {
  const db = getDatabase();
  try {
    if (link.kind === "bucket") {
      // A smart rule may already have linked it while it was being saved.
      const { getLinkForExpense, linkExpenseToBucket } = await import("./expense-investment-link");
      if (!(await getLinkForExpense(expenseId))) await linkExpenseToBucket(expenseId, link.id);
      return null;
    }
    const linked = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM loan_schedule_entries WHERE linked_expense_id = ? LIMIT 1;`,
      expenseId,
    );
    if (linked) return null;
    const { tryMatchExpenseToEMI } = await import("./loan-sms-matcher");
    const matched = await tryMatchExpenseToEMI(expenseId, userId, link.id);
    return matched ? null : "No EMI of this amount is due around that date on the loan";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
