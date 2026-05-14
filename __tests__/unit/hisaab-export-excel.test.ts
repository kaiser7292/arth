/**
 * Hisaab Excel Export Service tests — V6.0.1
 *
 * Tests bank-statement-style workbook generation for person exports.
 * Mocks database services and file system, verifies sheet structure.
 */

import * as XLSX from "xlsx";

// ─── Mock File System ───
const mockFileWrites: { uri: string; content: string; options?: Record<string, string> }[] = [];

jest.mock("expo-file-system", () => {
  class MockFile {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === "string" ? p : p?.uri ?? "")).join("");
    }
    write(content: string, options?: Record<string, string>) {
      mockFileWrites.push({ uri: this.uri, content, options });
    }
  }
  return {
    File: MockFile,
    Paths: { cache: { uri: "/tmp/test-cache/" } },
  };
});

// ─── Mock Hisaab Service ───
const mockPerson = {
  id: "p1",
  name: "Tarun",
  initial_balance: 1000,
  phone: "9876543210",
  email: "tarun@example.com",
  notes: "College friend",
  owner_user_id: "user-1",
  is_active: 1,
  created_at: "2026-04-01",
  updated_at: "2026-04-01",
};

const mockEntries = [
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
];

jest.mock("../../services/hisaab", () => ({
  getPerson: jest.fn(async () => mockPerson),
  getEntries: jest.fn(async () => mockEntries),
  getPersonBalance: jest.fn(async () => 3000),
  getBalanceAsOfDate: jest.fn(async () => 1000),
  getEntriesByDateRangeAsc: jest.fn(async () => mockEntries),
  enrichEntriesFromExpenses: jest.fn(async () => new Map<string, string>()),
}));

import { generatePersonExcel } from "../../services/hisaab-export-excel";

beforeEach(() => {
  jest.clearAllMocks();
  mockFileWrites.length = 0;
});

// ─── Person Excel Export (Bank Statement Format) ───

describe("generatePersonExcel", () => {
  const dateRange = {
    startDate: "2026-04-01",
    endDate: "2026-04-30",
    label: "April 2026",
  };

  it("returns file path and name", async () => {
    const result = await generatePersonExcel("p1", "user-1", dateRange);
    expect(result.filePath).toContain("Hisaab_Tarun_");
    expect(result.filePath).toContain(".xlsx");
    expect(result.fileName).toContain("Hisaab_Tarun_");
  });

  it("writes file to cache directory", async () => {
    await generatePersonExcel("p1", "user-1", dateRange);
    expect(mockFileWrites).toHaveLength(1);
    expect(mockFileWrites[0].uri).toContain("/tmp/test-cache/");
    expect(mockFileWrites[0].options?.encoding).toBe("base64");
  });

  it("creates workbook with Statement and Summary sheets", async () => {
    await generatePersonExcel("p1", "user-1", dateRange);
    const base64 = mockFileWrites[0].content;
    const wb = XLSX.read(base64, { type: "base64" });
    expect(wb.SheetNames).toEqual(["Statement", "Summary"]);
  });

  it("Statement sheet has header with person name and period", async () => {
    await generatePersonExcel("p1", "user-1", dateRange);
    const base64 = mockFileWrites[0].content;
    const wb = XLSX.read(base64, { type: "base64" });
    const data = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets["Statement"], { header: 1 });
    // First row should be "HISAAB STATEMENT"
    const allText = JSON.stringify(data);
    expect(allText).toContain("HISAAB STATEMENT");
    expect(allText).toContain("Tarun");
    expect(allText).toContain("April 2026");
  });

  it("Statement sheet has opening and closing balance", async () => {
    await generatePersonExcel("p1", "user-1", dateRange);
    const base64 = mockFileWrites[0].content;
    const wb = XLSX.read(base64, { type: "base64" });
    const data = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets["Statement"], { header: 1 });
    const allText = JSON.stringify(data);
    expect(allText).toContain("Opening Balance");
    expect(allText).toContain("CLOSING BALANCE");
  });

  it("Statement sheet contains transaction entries", async () => {
    await generatePersonExcel("p1", "user-1", dateRange);
    const base64 = mockFileWrites[0].content;
    const wb = XLSX.read(base64, { type: "base64" });
    const data = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets["Statement"], { header: 1 });
    const allText = JSON.stringify(data);
    expect(allText).toContain("Dinner bill");
    expect(allText).toContain("GPay transfer");
  });

  it("Statement sheet has Dr/Cr column headers", async () => {
    await generatePersonExcel("p1", "user-1", dateRange);
    const base64 = mockFileWrites[0].content;
    const wb = XLSX.read(base64, { type: "base64" });
    const data = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets["Statement"], { header: 1 });
    const allText = JSON.stringify(data);
    expect(allText).toContain("Debit (Dr)");
    expect(allText).toContain("Credit (Cr)");
  });

  it("Summary sheet contains account details", async () => {
    await generatePersonExcel("p1", "user-1", dateRange);
    const base64 = mockFileWrites[0].content;
    const wb = XLSX.read(base64, { type: "base64" });
    const summaryData = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Summary"]);
    const items = summaryData.map((r) => r.Item);
    expect(items).toContain("Account Name");
    expect(items).toContain("Opening Balance");
    expect(items).toContain("Closing Balance");
    expect(items).toContain("Total Debits (Spent on Your Behalf)");
  });

  it("works without dateRange (all time fallback)", async () => {
    const result = await generatePersonExcel("p1", "user-1");
    expect(result.filePath).toContain("Hisaab_Tarun_");
    const base64 = mockFileWrites[0].content;
    const wb = XLSX.read(base64, { type: "base64" });
    expect(wb.SheetNames).toEqual(["Statement", "Summary"]);
  });

  it("throws error when person not found", async () => {
    const { getPerson } = require("../../services/hisaab");
    getPerson.mockResolvedValueOnce(null);
    await expect(generatePersonExcel("bad-id", "user-1")).rejects.toThrow("Person not found");
  });
});

