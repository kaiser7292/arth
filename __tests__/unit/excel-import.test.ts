import {
  parseDate,
  parseAmount,
  suggestColumnMappings,
  getImportPreview,
  parseExpenseRows,
} from "@/services/excel-import";
import type { ParsedExpenseRow } from "@/services/excel-import";
import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// parseDate
// ---------------------------------------------------------------------------

describe("parseDate", () => {
  it("parses YYYY-MM-DD format", () => {
    expect(parseDate("2025-04-12")).toBe("2025-04-12");
  });

  it("parses DD-MM-YYYY Indian format", () => {
    expect(parseDate("12-04-2025")).toBe("2025-04-12");
  });

  it("parses DD/MM/YYYY with slashes", () => {
    expect(parseDate("12/04/2025")).toBe("2025-04-12");
  });

  it("parses DD.MM.YYYY with dots", () => {
    expect(parseDate("12.04.2025")).toBe("2025-04-12");
  });

  it("parses Date object", () => {
    const date = new Date(2025, 3, 12); // April 12, 2025
    expect(parseDate(date)).toBe("2025-04-12");
  });

  it("parses Excel serial date number", () => {
    // 45759 = April 12, 2025 in Excel serial
    const result = parseDate(45759);
    expect(result).toBeTruthy();
    // Just verify it produces a valid date string
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("handles ambiguous dates — defaults to DD-MM (Indian format)", () => {
    // 05-06-2025 → June 5 (not May 6) — Indian default
    expect(parseDate("05-06-2025")).toBe("2025-06-05");
  });

  it("detects MM-DD when month > 12", () => {
    // 05-15-2025 → 15 can't be a month, so it's month=5, day=15
    expect(parseDate("05-15-2025")).toBe("2025-05-15");
  });

  it("returns null for empty/null/undefined", () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate("")).toBeNull();
  });

  it("returns null for invalid date", () => {
    expect(parseDate("not-a-date")).toBeNull();
  });

  it("pads single-digit month and day", () => {
    expect(parseDate("2025-4-2")).toBe("2025-04-02");
  });
});

// ---------------------------------------------------------------------------
// parseAmount
// ---------------------------------------------------------------------------

describe("parseAmount", () => {
  it("parses plain number", () => {
    expect(parseAmount(1500)).toBe(1500);
  });

  it("parses string number", () => {
    expect(parseAmount("1500")).toBe(1500);
  });

  it("parses string with commas", () => {
    expect(parseAmount("1,500")).toBe(1500);
  });

  it("parses string with Rs prefix", () => {
    expect(parseAmount("Rs 1500")).toBe(1500);
  });

  it("parses string with ₹ symbol", () => {
    expect(parseAmount("₹1,500")).toBe(1500);
  });

  it("parses decimal amounts", () => {
    expect(parseAmount("1500.50")).toBe(1500.5);
  });

  it("returns null for zero or negative", () => {
    expect(parseAmount(0)).toBeNull();
    expect(parseAmount(-100)).toBeNull();
  });

  it("returns null for empty/null", () => {
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });

  it("returns null for non-numeric string", () => {
    expect(parseAmount("abc")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// suggestColumnMappings
// ---------------------------------------------------------------------------

describe("suggestColumnMappings", () => {
  it("maps standard column names", () => {
    const cols = ["Date", "Amount", "Description", "Category", "Payment Mode"];
    const mappings = suggestColumnMappings(cols);

    expect(mappings["Date"]).toBe("date");
    expect(mappings["Amount"]).toBe("amount");
    expect(mappings["Description"]).toBe("description");
    expect(mappings["Category"]).toBe("category");
    expect(mappings["Payment Mode"]).toBe("payment_mode");
  });

  it("maps common aliases", () => {
    const cols = ["Dt", "Amt", "Particulars", "Cat", "Paid Via"];
    const mappings = suggestColumnMappings(cols);

    expect(mappings["Dt"]).toBe("date");
    expect(mappings["Amt"]).toBe("amount");
    expect(mappings["Particulars"]).toBe("description");
    expect(mappings["Cat"]).toBe("category");
    expect(mappings["Paid Via"]).toBe("payment_mode");
  });

  it("maps right spend column", () => {
    const cols = ["Date", "Amount", "Right Spend"];
    const mappings = suggestColumnMappings(cols);

    expect(mappings["Right Spend"]).toBe("is_right_spend");
  });

  it("marks unknown columns as skip", () => {
    const cols = ["Date", "Amount", "Serial No", "Random Col"];
    const mappings = suggestColumnMappings(cols);

    expect(mappings["Serial No"]).toBe("skip");
    expect(mappings["Random Col"]).toBe("skip");
  });

  it("does not double-assign fields", () => {
    const cols = ["Date", "Transaction Date", "Amount"];
    const mappings = suggestColumnMappings(cols);

    // Only one should be "date"
    const dateMappings = Object.values(mappings).filter((v) => v === "date");
    expect(dateMappings.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getImportPreview
// ---------------------------------------------------------------------------

describe("getImportPreview", () => {
  const rows: ParsedExpenseRow[] = [
    {
      date: "2025-01-15",
      amount: 500,
      description: "Lunch",
      merchantName: null,
      categoryName: "Food",
      paymentModeName: "GPay",
      isRightSpend: 1,
    },
    {
      date: "2025-02-20",
      amount: 1000,
      description: "Groceries",
      merchantName: null,
      categoryName: "Grocery",
      paymentModeName: "Cash",
      isRightSpend: 0,
    },
    {
      date: "2025-01-10",
      amount: 300,
      description: "Coffee",
      merchantName: null,
      categoryName: "Food",
      paymentModeName: "GPay",
      isRightSpend: null,
    },
  ];

  it("returns correct count", () => {
    expect(getImportPreview(rows).count).toBe(3);
  });

  it("returns correct date range", () => {
    const preview = getImportPreview(rows);
    expect(preview.dateRange?.from).toBe("2025-01-10");
    expect(preview.dateRange?.to).toBe("2025-02-20");
  });

  it("returns correct total amount", () => {
    expect(getImportPreview(rows).totalAmount).toBe(1800);
  });

  it("returns unique categories", () => {
    const preview = getImportPreview(rows);
    expect(preview.uniqueCategories).toContain("Food");
    expect(preview.uniqueCategories).toContain("Grocery");
    expect(preview.uniqueCategories.length).toBe(2);
  });

  it("returns unique payment modes", () => {
    const preview = getImportPreview(rows);
    expect(preview.uniquePaymentModes).toContain("GPay");
    expect(preview.uniquePaymentModes).toContain("Cash");
    expect(preview.uniquePaymentModes.length).toBe(2);
  });

  it("handles empty rows", () => {
    const preview = getImportPreview([]);
    expect(preview.count).toBe(0);
    expect(preview.dateRange).toBeNull();
    expect(preview.totalAmount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseExpenseRows (end-to-end with in-memory workbook)
// ---------------------------------------------------------------------------

describe("parseExpenseRows", () => {
  function createTestWorkbook(
    data: Record<string, unknown>[],
    sheetName = "Sheet1",
  ): XLSX.WorkBook {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return wb;
  }

  it("parses a simple expense sheet", () => {
    const wb = createTestWorkbook([
      {
        Date: "12-04-2025",
        Amount: 500,
        Description: "Lunch at cafe",
        Category: "Food",
        "Payment Mode": "GPay",
        "Right Spend": "Yes",
      },
      {
        Date: "13-04-2025",
        Amount: 1200,
        Description: "Groceries",
        Category: "Grocery",
        "Payment Mode": "Cash",
        "Right Spend": "No",
      },
    ]);

    const mappings = suggestColumnMappings([
      "Date",
      "Amount",
      "Description",
      "Category",
      "Payment Mode",
      "Right Spend",
    ]);
    const rows = parseExpenseRows(wb, "Sheet1", mappings);

    expect(rows.length).toBe(2);
    expect(rows[0].date).toBe("2025-04-12");
    expect(rows[0].amount).toBe(500);
    expect(rows[0].description).toBe("Lunch at cafe");
    expect(rows[0].categoryName).toBe("Food");
    expect(rows[0].paymentModeName).toBe("GPay");
    expect(rows[0].isRightSpend).toBe(1);

    expect(rows[1].date).toBe("2025-04-13");
    expect(rows[1].amount).toBe(1200);
    expect(rows[1].isRightSpend).toBe(0);
  });

  it("skips rows with missing date or amount", () => {
    const wb = createTestWorkbook([
      { Date: "12-04-2025", Amount: 500, Description: "Valid" },
      { Date: "", Amount: 500, Description: "No date" },
      { Date: "13-04-2025", Amount: 0, Description: "Zero amount" },
      { Date: "14-04-2025", Amount: null, Description: "Null amount" },
    ]);

    const mappings = { Date: "date" as const, Amount: "amount" as const, Description: "description" as const };
    const rows = parseExpenseRows(wb, "Sheet1", mappings);

    expect(rows.length).toBe(1);
    expect(rows[0].description).toBe("Valid");
  });

  it("handles string amounts with Rs prefix and commas", () => {
    const wb = createTestWorkbook([
      { Date: "12-04-2025", Amount: "Rs 1,500" },
      { Date: "13-04-2025", Amount: "₹2,300.50" },
    ]);

    const mappings = { Date: "date" as const, Amount: "amount" as const };
    const rows = parseExpenseRows(wb, "Sheet1", mappings);

    expect(rows.length).toBe(2);
    expect(rows[0].amount).toBe(1500);
    expect(rows[1].amount).toBe(2300.5);
  });

  it("handles null category and payment mode gracefully", () => {
    const wb = createTestWorkbook([
      { Date: "12-04-2025", Amount: 500 },
    ]);

    const mappings = { Date: "date" as const, Amount: "amount" as const };
    const rows = parseExpenseRows(wb, "Sheet1", mappings);

    expect(rows.length).toBe(1);
    expect(rows[0].categoryName).toBeNull();
    expect(rows[0].paymentModeName).toBeNull();
    expect(rows[0].isRightSpend).toBeNull();
  });
});
