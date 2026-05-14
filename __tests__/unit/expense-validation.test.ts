import {
  parseAmount,
  validateExpense,
  formatDateForStorage,
  formatDateForDisplay,
  formatAmount,
} from "../../utils/expense-validation";

describe("parseAmount", () => {
  it("parses valid integer", () => {
    expect(parseAmount("500")).toBe(500);
  });

  it("parses valid decimal", () => {
    expect(parseAmount("49.99")).toBe(49.99);
  });

  it("rounds to 2 decimal places", () => {
    expect(parseAmount("10.999")).toBe(11);
    expect(parseAmount("10.005")).toBe(10.01);
  });

  it("trims whitespace", () => {
    expect(parseAmount("  250  ")).toBe(250);
  });

  it("returns null for empty string", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("   ")).toBeNull();
  });

  it("returns null for non-numeric", () => {
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("12abc")).toBeNull();
  });

  it("returns null for zero", () => {
    expect(parseAmount("0")).toBeNull();
  });

  it("allows negative numbers", () => {
    expect(parseAmount("-100")).toBe(-100);
  });

  it("returns null for Infinity", () => {
    expect(parseAmount("Infinity")).toBeNull();
  });

  it("parses large amounts", () => {
    expect(parseAmount("1000000")).toBe(1000000);
  });
});

describe("validateExpense", () => {
  const validData = {
    amount: "500",
    description: "Lunch",
    category_id: "cat-1",
    payment_mode_id: "pm-1",
    date: "2026-04-12",
    is_right_spend: true,
  };

  it("returns null for valid data", () => {
    expect(validateExpense(validData)).toBeNull();
  });

  it("returns error for empty amount", () => {
    const errors = validateExpense({ ...validData, amount: "" });
    expect(errors).not.toBeNull();
    expect(errors!.amount).toBeDefined();
  });

  it("returns error for zero amount", () => {
    const errors = validateExpense({ ...validData, amount: "0" });
    expect(errors).not.toBeNull();
    expect(errors!.amount).toBeDefined();
  });

  it("allows negative amount", () => {
    const errors = validateExpense({ ...validData, amount: "-50" });
    expect(errors).toBeNull();
  });

  it("returns error for non-numeric amount", () => {
    const errors = validateExpense({ ...validData, amount: "abc" });
    expect(errors).not.toBeNull();
    expect(errors!.amount).toBeDefined();
  });

  it("returns error for missing date", () => {
    const errors = validateExpense({ ...validData, date: "" });
    expect(errors).not.toBeNull();
    expect(errors!.date).toBeDefined();
  });

  it("does not require category", () => {
    const errors = validateExpense({ ...validData, category_id: null });
    expect(errors).toBeNull();
  });

  it("does not require payment mode", () => {
    const errors = validateExpense({ ...validData, payment_mode_id: null });
    expect(errors).toBeNull();
  });

  it("does not require description", () => {
    const errors = validateExpense({ ...validData, description: "" });
    expect(errors).toBeNull();
  });

  it("can return multiple errors", () => {
    const errors = validateExpense({ ...validData, amount: "", date: "" });
    expect(errors).not.toBeNull();
    expect(errors!.amount).toBeDefined();
    expect(errors!.date).toBeDefined();
  });
});

describe("formatDateForStorage", () => {
  it("formats date as YYYY-MM-DD", () => {
    const date = new Date(2026, 3, 12); // April 12, 2026
    expect(formatDateForStorage(date)).toBe("2026-04-12");
  });

  it("pads single-digit month and day", () => {
    const date = new Date(2026, 0, 5); // January 5, 2026
    expect(formatDateForStorage(date)).toBe("2026-01-05");
  });

  it("handles December correctly", () => {
    const date = new Date(2026, 11, 31); // December 31, 2026
    expect(formatDateForStorage(date)).toBe("2026-12-31");
  });
});

describe("formatDateForDisplay", () => {
  it("shows 'Today' for today's date", () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    expect(formatDateForDisplay(`${yyyy}-${mm}-${dd}`)).toBe("Today");
  });

  it("shows 'Yesterday' for yesterday's date", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yyyy = yesterday.getFullYear();
    const mm = String(yesterday.getMonth() + 1).padStart(2, "0");
    const dd = String(yesterday.getDate()).padStart(2, "0");
    expect(formatDateForDisplay(`${yyyy}-${mm}-${dd}`)).toBe("Yesterday");
  });

  it("shows formatted date for older dates (default locale: DD/MM/YYYY)", () => {
    // As of v15.9.0, formatDateForDisplay honors the user's date-format
    // preference. Default is DD/MM/YYYY.
    expect(formatDateForDisplay("2026-01-15")).toBe("15/01/2026");
    expect(formatDateForDisplay("2025-12-25")).toBe("25/12/2025");
  });
});

describe("formatAmount", () => {
  it("formats INR with rupee symbol", () => {
    const result = formatAmount(500);
    expect(result).toContain("\u20B9");
    expect(result).toContain("500");
  });

  it("formats large INR amounts with Indian grouping", () => {
    const result = formatAmount(1500000, "INR");
    expect(result).toContain("\u20B9");
    // Indian locale: 15,00,000
    expect(result).toContain("15");
  });

  it("formats decimal amounts", () => {
    const result = formatAmount(49.5, "INR");
    expect(result).toContain("49.5");
  });

  it("formats non-INR without rupee symbol", () => {
    const result = formatAmount(100, "USD");
    expect(result).not.toContain("\u20B9");
    expect(result).toContain("100");
  });
});
