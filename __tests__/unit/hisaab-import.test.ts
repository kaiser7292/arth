/**
 * Hisaab import: the sheet format, old and new.
 */

jest.mock("../../database", () => ({ getDatabase: jest.fn() }));
jest.mock("../../services/settings", () => ({ bumpDataVersion: jest.fn() }));
jest.mock("../../services/category", () => ({ createCategory: jest.fn(), getAllCategories: jest.fn() }));

import * as XLSX from "xlsx";
import {
  HISAAB_TEMPLATE_COLUMNS,
  generateHisaabTemplateCSV,
  parseHisaabRows,
} from "../../services/hisaab-import";

function book(data: Record<string, unknown>[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Sheet1");
  return wb;
}

describe("parseHisaabRows", () => {
  it("still reads the five-column format from before", () => {
    const rows = parseHisaabRows(
      book([{ Person: "Jane Doe", Date: "2025-04-12", Amount: 850, Type: "debit", Description: "Dinner share" }]),
      "Sheet1",
    );
    expect(rows).toEqual([
      { person: "Jane Doe", date: "2025-04-12", amount: 850, type: "debit", description: "Dinner share", category: null, merchant: null },
    ]);
  });

  it("reads Category and Merchant, and the type as the export writes it", () => {
    const rows = parseHisaabRows(
      book([
        { person: "Jane Doe", DATE: "12/04/2025", Amount: "1,200", Type: "Settlement", Category: "Food", Merchant: "Barbeque Nation" },
        { Person: "Jane Doe", Amount: 5000, Type: "Initial Balance" },
      ]),
      "Sheet1",
    );
    expect(rows[0]).toMatchObject({ type: "settlement", amount: 1200, date: "2025-04-12", category: "Food", merchant: "Barbeque Nation" });
    expect(rows[1]).toMatchObject({ type: "initial_balance", date: null });
  });

  it("the template it hands out reads back cleanly", () => {
    const wb = XLSX.read(generateHisaabTemplateCSV(), { type: "string", cellDates: true });
    const rows = parseHisaabRows(wb, wb.SheetNames[0]);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.type)).toEqual(["initial_balance", "credit", "debit", "settlement", "initial_balance"]);
    expect(HISAAB_TEMPLATE_COLUMNS).toEqual(["Person", "Date", "Amount", "Type", "Description", "Category", "Merchant"]);
  });
});
