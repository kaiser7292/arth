/**
 * Transaction import: reading the sheet, matching accounts and links, and leaving out rows
 * that can't be imported or are already in Arth.
 */

jest.mock("../../database", () => ({ getDatabase: jest.fn() }));
jest.mock("../../services/account-transfer", () => ({ createTransfer: jest.fn() }));
jest.mock("../../services/category", () => ({ createCategory: jest.fn(), getAllCategories: jest.fn() }));
jest.mock("../../services/expense-crud", () => ({ createExpense: jest.fn() }));
jest.mock("../../services/payment-mode", () => ({ createPaymentMode: jest.fn(), getAllPaymentModes: jest.fn() }));
jest.mock("../../services/settings", () => ({ getFYStartMonth: () => 4 }));

import * as XLSX from "xlsx";
import {
  duplicateKey,
  generateTransactionTemplateCSV,
  getTransactionImportPreview,
  parseCreditKind,
  parseTransactionRows,
  parseTransactionType,
  planTransactionImport,
  resolveAccount,
  resolveLink,
  type ImportAccount,
  type ImportContext,
  type ParsedTransactionRow,
} from "../../services/transaction-import";

function book(data: Record<string, unknown>[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Sheet1");
  return wb;
}

const ACCOUNTS: ImportAccount[] = [
  { id: "hdfc", account_label: "HDFC Savings", bank_name: "HDFC Bank", account_identifier: "1234" },
  { id: "icici", account_label: null, bank_name: "ICICI Bank", account_identifier: "5678" },
  { id: "icici2", account_label: "ICICI Salary", bank_name: "ICICI Bank", account_identifier: "9012" },
  { id: "loan", account_label: "HDFC Home Loan", bank_name: "HDFC Ltd", account_identifier: "4455" },
];

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
  accounts: ACCOUNTS,
  buckets: [
    { id: "mf26", name: "Mutual Funds", financial_year: "2026" },
    { id: "mf25", name: "Mutual Funds", financial_year: "2025-26" },
  ],
  loans: [{ loanAccountId: "loan-1", account: ACCOUNTS[3] }],
  fyStartMonth: 4,
  existing: new Map(),
  ...over,
});

const row = (n: number, over: Partial<ParsedTransactionRow> = {}): ParsedTransactionRow => ({
  rowNumber: n,
  type: "expense",
  date: "2026-05-15",
  amount: 450,
  description: null,
  merchantName: "Swiggy",
  categoryName: null,
  paymentModeName: null,
  accountName: null,
  toAccountName: null,
  creditKind: null,
  linkedToName: null,
  isRightSpend: null,
  ...over,
});

describe("reading the sheet", () => {
  it("a blank or missing Type is an expense, so old sheets still import", () => {
    expect(parseTransactionType(null)).toBe("expense");
    expect(parseTransactionType("  ")).toBe("expense");
    expect(parseTransactionType("Transfers")).toBe("transfer");
    expect(parseTransactionType("COMMITTED")).toBe("committed");
    expect(parseTransactionType("loan")).toBeNull();
  });

  it("reads a credit kind by its key or the name shown in the app", () => {
    expect(parseCreditKind("salary")).toBe("salary");
    expect(parseCreditKind("Investment gain")).toBe("gain");
    expect(parseCreditKind("bonus")).toBeNull();
  });

  it("matches headers loosely and numbers rows as the sheet does", () => {
    const { rows, skipped } = parseTransactionRows(
      book([
        { DATE: "15/05/2026", type: "Credit", Amount: "85,000", "payment_mode": "UPI", "Credit Type": "Salary", Account: "HDFC Savings" },
      ]),
      "Sheet1",
    );
    expect(skipped).toEqual([]);
    expect(rows[0]).toMatchObject({ rowNumber: 2, type: "credit", date: "2026-05-15", amount: 85000, paymentModeName: "UPI", creditKind: "salary", accountName: "HDFC Savings" });
  });

  it("says why a row can't be read instead of dropping it silently", () => {
    const { rows, skipped } = parseTransactionRows(
      book([
        { Date: "2026-05-15", Type: "Expense", Amount: 100 },
        { Date: "not a date", Type: "Expense", Amount: 100 },
        { Date: "2026-05-15", Type: "Expense", Amount: -5 },
        { Date: "2026-05-15", Type: "Loan", Amount: 100 },
        { Date: "2026-05-15", Type: "Credit", Amount: 100, "Credit Type": "Bonus" },
      ]),
      "Sheet1",
    );
    expect(rows).toHaveLength(1);
    expect(skipped.map((s) => s.rowNumber)).toEqual([3, 4, 5, 6]);
    expect(skipped[0].reason).toMatch(/date/i);
    expect(skipped[1].reason).toMatch(/amount/i);
    expect(skipped[2].reason).toMatch(/Loan/);
    expect(skipped[3].reason).toMatch(/Bonus/);
  });

  it("the template it hands out reads back cleanly, one row of each kind", () => {
    const wb = XLSX.read(generateTransactionTemplateCSV(), { type: "string", cellDates: true });
    const { rows, skipped } = parseTransactionRows(wb, wb.SheetNames[0]);
    expect(skipped).toEqual([]);
    expect(rows.map((r) => r.type)).toEqual(["expense", "committed", "committed", "credit", "transfer"]);
    expect(rows[4]).toMatchObject({ accountName: "HDFC Savings", toAccountName: "ICICI Savings" });
  });
});

describe("resolveAccount", () => {
  it("finds an account by its name, bank + digits, or digits alone", () => {
    expect(resolveAccount("hdfc savings", ACCOUNTS)).toBe("hdfc");
    expect(resolveAccount("ICICI ****5678", ACCOUNTS)).toBe("icici");
    expect(resolveAccount("9012", ACCOUNTS)).toBe("icici2");
  });

  it("won't guess between two accounts of one bank", () => {
    expect(resolveAccount("ICICI Bank", ACCOUNTS)).toBe("ambiguous");
  });

  it("reports an account Arth doesn't have", () => {
    expect(resolveAccount("Kotak", ACCOUNTS)).toBe("missing");
  });
});

describe("resolveLink", () => {
  it("picks the investment bucket of the payment's financial year", () => {
    expect(resolveLink("mutual funds", "2026-05-07", ctx().buckets, ctx().loans, 4)).toEqual({ kind: "bucket", id: "mf26" });
    // February 2026 belongs to the year that started in April 2025.
    expect(resolveLink("Mutual Funds", "2026-02-07", ctx().buckets, ctx().loans, 4)).toEqual({ kind: "bucket", id: "mf25" });
  });

  it("refuses a bucket that has no plan for that year", () => {
    expect(resolveLink("Mutual Funds", "2024-06-01", ctx().buckets, ctx().loans, 4)).toEqual({ error: expect.stringContaining("no plan") });
  });

  it("finds a loan by its account name", () => {
    expect(resolveLink("HDFC Home Loan", "2026-05-05", ctx().buckets, ctx().loans, 4)).toEqual({ kind: "loan", id: "loan-1" });
  });

  it("reports a name that is neither", () => {
    expect(resolveLink("PPF", "2026-05-05", ctx().buckets, ctx().loans, 4)).toEqual({ error: expect.stringContaining("PPF") });
  });
});

describe("planTransactionImport", () => {
  it("keeps a plain expense with no account", () => {
    const plan = planTransactionImport([row(2)], ctx());
    expect(plan.ready).toHaveLength(1);
    expect(plan.ready[0]).toMatchObject({ accountId: null, link: null });
  });

  it("leaves out a row naming an account Arth doesn't have — it never creates accounts", () => {
    const plan = planTransactionImport([row(2, { accountName: "Kotak" })], ctx());
    expect(plan.ready).toEqual([]);
    expect(plan.skipped).toEqual([{ rowNumber: 2, reason: expect.stringContaining("Kotak") }]);
  });

  it("a transfer needs two different accounts", () => {
    const transfer = (n: number, over: Partial<ParsedTransactionRow>) => row(n, { type: "transfer", merchantName: null, ...over });
    const plan = planTransactionImport(
      [
        transfer(2, { accountName: "HDFC Savings", toAccountName: "5678" }),
        transfer(3, { accountName: "HDFC Savings" }),
        transfer(4, { toAccountName: "5678" }),
        transfer(5, { accountName: "HDFC Savings", toAccountName: "1234" }),
      ],
      ctx(),
    );
    expect(plan.ready.map((r) => [r.accountId, r.toAccountId])).toEqual([["hdfc", "icici"]]);
    expect(plan.skipped.map((s) => s.rowNumber)).toEqual([3, 4, 5]);
  });

  it("a committed row must link to a loan or bucket that exists", () => {
    const committed = (n: number, linkedToName: string | null) => row(n, { type: "committed", linkedToName, date: "2026-05-07" });
    const plan = planTransactionImport([committed(2, "Mutual Funds"), committed(3, null), committed(4, "PPF")], ctx());
    expect(plan.ready.map((r) => r.link)).toEqual([{ kind: "bucket", id: "mf26" }]);
    expect(plan.skipped.map((s) => s.rowNumber)).toEqual([3, 4]);
  });

  it("skips what Arth already has, one for one", () => {
    // Arth holds one ₹450 Swiggy on the day; the sheet has two.
    const existing = new Map([[duplicateKey("spend", "2026-05-15", 450, "Swiggy"), 1]]);
    const plan = planTransactionImport([row(2), row(3, { merchantName: "swiggy " })], ctx({ existing }));
    expect(plan.duplicates).toBe(1);
    expect(plan.ready.map((r) => r.rowNumber)).toEqual([3]);
    expect(plan.skipped).toEqual([{ rowNumber: 2, reason: "Already in Arth" }]);
  });

  it("a credit and an expense of the same amount are not duplicates of each other", () => {
    const existing = new Map([[duplicateKey("credit", "2026-05-15", 450, "Swiggy"), 1]]);
    expect(planTransactionImport([row(2)], ctx({ existing })).ready).toHaveLength(1);
  });

  it("transfers are compared by their two accounts", () => {
    const existing = new Map([[duplicateKey("transfer", "2026-05-15", 450, "hdfc>icici"), 1]]);
    const t = row(2, { type: "transfer", merchantName: null, accountName: "HDFC Savings", toAccountName: "5678" });
    expect(planTransactionImport([t], ctx({ existing })).duplicates).toBe(1);
    // The other direction is a different transfer.
    const back = { ...t, accountName: "5678", toAccountName: "HDFC Savings" };
    expect(planTransactionImport([back], ctx({ existing })).ready).toHaveLength(1);
  });
});

describe("getTransactionImportPreview", () => {
  it("counts and totals each type, and lists only genuinely new names", () => {
    const plan = planTransactionImport(
      [
        row(2, { categoryName: "Food", paymentModeName: "UPI" }),
        row(3, { amount: 50, categoryName: "Pets", paymentModeName: "Sodexo" }),
        row(4, { type: "credit", amount: 85000, merchantName: "Acme", date: "2026-05-01" }),
      ],
      ctx(),
    );
    const preview = getTransactionImportPreview(plan.ready, { categories: ["food"], paymentModes: ["UPI"] });
    expect(preview.count).toBe(3);
    expect(preview.byType.expense).toEqual({ count: 2, total: 500 });
    expect(preview.byType.credit).toEqual({ count: 1, total: 85000 });
    expect(preview.dateRange).toEqual({ from: "2026-05-01", to: "2026-05-15" });
    expect(preview.newCategories).toEqual(["Pets"]);
    expect(preview.newPaymentModes).toEqual(["Sodexo"]);
  });
});
