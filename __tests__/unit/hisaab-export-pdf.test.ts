/**
 * Hisaab PDF Export Service tests — V6.0.1
 *
 * Tests bank-statement-style HTML template generation for person statements.
 * Uses exposed _personStatementHtml.
 */

import {
  _personStatementHtml,
} from "../../services/hisaab-export-pdf";

// ─── Person Statement HTML (Bank Statement Format) ───

describe("personStatementHtml", () => {
  const entries = [
    {
      id: "e1",
      hisaab_person_id: "p1",
      amount: 3000,
      description: "Dinner bill",
      date: "2026-04-10",
      type: "debit" as const,
      status: "confirmed" as const,
      linked_expense_id: null,
      created_at: "2026-04-10",
      updated_at: "2026-04-10",
    },
    {
      id: "e2",
      hisaab_person_id: "p1",
      amount: 1000,
      description: "GPay transfer",
      date: "2026-04-11",
      type: "credit" as const,
      status: "confirmed" as const,
      linked_expense_id: null,
      created_at: "2026-04-11",
      updated_at: "2026-04-11",
    },
    {
      id: "e3",
      hisaab_person_id: "p1",
      amount: 500,
      description: "Settled up",
      date: "2026-04-12",
      type: "settlement" as const,
      status: "confirmed" as const,
      linked_expense_id: null,
      created_at: "2026-04-12",
      updated_at: "2026-04-12",
    },
  ];

  // Helper: generate statement with defaults
  function makeHtml(
    overrides: {
      name?: string;
      periodLabel?: string;
      startDate?: string;
      endDate?: string;
      openingBalance?: number;
      testEntries?: typeof entries;
      totalDebits?: number;
      totalCredits?: number;
      closingBalance?: number;
    } = {},
  ): string {
    return _personStatementHtml(
      overrides.name ?? "Tarun",
      overrides.periodLabel ?? "April 2026",
      overrides.startDate ?? "2026-04-01",
      overrides.endDate ?? "2026-04-30",
      overrides.openingBalance ?? 1000,
      overrides.testEntries ?? entries,
      overrides.totalDebits ?? 3000,
      overrides.totalCredits ?? 1500,
      overrides.closingBalance ?? 2500,
      new Map(),
      new Map(),
    );
  }

  it("includes person name and statement title", () => {
    const html = makeHtml();
    expect(html).toContain("Tarun");
    expect(html).toContain("HISAAB STATEMENT");
  });

  it("shows verdict: balance due when positive balance", () => {
    const html = makeHtml({ closingBalance: 2500 });
    expect(html).toContain("Balance Due");
    expect(html).toContain("2,500");
  });

  it("shows verdict: credit balance when negative balance", () => {
    const html = makeHtml({ name: "Ravi", closingBalance: -1200 });
    expect(html).toContain("Credit Balance");
    expect(html).toContain("1,200");
  });

  it("shows verdict: all settled when zero balance", () => {
    const html = makeHtml({ closingBalance: 0 });
    expect(html).toContain("All Settled");
  });

  it("shows settlement badge on settlement entries", () => {
    const html = makeHtml();
    expect(html).toContain("badge-settlement");
    expect(html).toContain("Settlement");
  });

  it("shows pending badge on pending entries", () => {
    const pendingEntry = {
      ...entries[0],
      status: "pending" as const,
    };
    const html = makeHtml({ testEntries: [pendingEntry] });
    expect(html).toContain("badge-pending");
    expect(html).toContain("Pending");
  });

  it("shows disputed badge on disputed entries", () => {
    const disputedEntry = {
      ...entries[0],
      status: "disputed" as const,
    };
    const html = makeHtml({ testEntries: [disputedEntry] });
    expect(html).toContain("badge-disputed");
    expect(html).toContain("Disputed");
  });

  it("shows period dates", () => {
    const html = makeHtml();
    // v15.9.0: default date format is DD/MM/YYYY. Dates pass through
    // formatDate() which honors the user's locale preference.
    expect(html).toContain("04/2026");
    expect(html).toContain("2026");
  });

  it("shows opening balance with Dr/Cr label", () => {
    const html = makeHtml({ openingBalance: 1000 });
    expect(html).toContain("Opening Balance");
    expect(html).toContain("1,000 Dr");
  });

  it("shows negative opening balance as Cr", () => {
    const html = makeHtml({ openingBalance: -500 });
    expect(html).toContain("500 Cr");
  });

  it("shows zero opening balance as Nil", () => {
    const html = makeHtml({ openingBalance: 0 });
    expect(html).toContain("Nil");
  });

  it("shows closing balance", () => {
    const html = makeHtml({ closingBalance: 2500 });
    expect(html).toContain("Closing Balance");
    expect(html).toContain("2,500 Dr");
  });

  it("shows total debits and credits", () => {
    const html = makeHtml({ totalDebits: 3000, totalCredits: 1500 });
    expect(html).toContain("Total Debits");
    expect(html).toContain("Total Credits");
    expect(html).toContain("₹3,000");
    expect(html).toContain("₹1,500");
  });

  it("renders Dr/Cr column headers", () => {
    const html = makeHtml();
    expect(html).toContain("Debit (Dr)");
    expect(html).toContain("Credit (Cr)");
    expect(html).toContain("Balance");
  });

  it("renders all entries in the table", () => {
    const html = makeHtml();
    expect(html).toContain("Dinner bill");
    expect(html).toContain("GPay transfer");
    expect(html).toContain("Settled up");
  });

  it("places debit amounts in Dr column", () => {
    // Debit entry (3000) should appear and the running balance should increase
    const html = makeHtml({ openingBalance: 0, testEntries: [entries[0]] });
    expect(html).toContain("₹3,000");
  });

  it("places credit amounts in Cr column", () => {
    const html = makeHtml({ openingBalance: 3000, testEntries: [entries[1]] });
    expect(html).toContain("₹1,000");
  });

  it("computes running balance through entries", () => {
    // OB=1000, +3000 Dr = 4000, -1000 Cr = 3000, -500 settlement = 2500
    const html = makeHtml({ openingBalance: 1000 });
    expect(html).toContain("4,000 Dr");  // After first debit
    expect(html).toContain("3,000 Dr");  // After credit
    expect(html).toContain("2,500 Dr");  // After settlement
  });

  it("shows 'No transactions in this period' when entries are empty", () => {
    const html = makeHtml({ testEntries: [], totalDebits: 0, totalCredits: 0 });
    expect(html).toContain("No transactions in this period");
  });

  it("includes explanatory legend", () => {
    const html = makeHtml();
    expect(html).toContain("Dr (Debit)");
    expect(html).toContain("amount spent on your behalf");
  });

  it("includes Artha branding in footer", () => {
    const html = makeHtml();
    expect(html).toContain("Artha");
    expect(html).toContain("अर्थ");
  });

  it("formats Indian comma numbers correctly", () => {
    const html = makeHtml({ closingBalance: 125000 });
    expect(html).toContain("1,25,000");
  });
});

