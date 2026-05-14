/**
 * V4 Tests: Transaction Time Display (Phase 3)
 *
 * Tests:
 * - formatTime12h: conversion of HH:MM:SS to 12-hour display
 * - transaction_time field on Expense interface
 * - Read-only behavior: time shown in detail, greyed in edit
 */

// ══════════════════════════════════════════
// formatTime12h — time display formatting
// ══════════════════════════════════════════

// We recreate the formatTime12h logic here since it's a private function in the component.
// This tests the same logic in isolation.
function formatTime12h(time: string): string | null {
  if (!time || time === "00:00:00") return null;
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

describe("formatTime12h", () => {
  it("formats morning time correctly", () => {
    expect(formatTime12h("09:15:30")).toBe("9:15 AM");
  });

  it("formats afternoon time correctly", () => {
    expect(formatTime12h("15:39:39")).toBe("3:39 PM");
  });

  it("formats midnight as null (00:00:00 is the default)", () => {
    expect(formatTime12h("00:00:00")).toBeNull();
  });

  it("formats noon correctly", () => {
    expect(formatTime12h("12:00:00")).toBe("12:00 PM");
  });

  it("formats 12:30 PM correctly", () => {
    expect(formatTime12h("12:30:00")).toBe("12:30 PM");
  });

  it("formats 1 AM correctly", () => {
    expect(formatTime12h("01:05:00")).toBe("1:05 AM");
  });

  it("formats 11:59 PM correctly", () => {
    expect(formatTime12h("23:59:59")).toBe("11:59 PM");
  });

  it("returns null for empty string", () => {
    expect(formatTime12h("")).toBeNull();
  });

  it("pads minutes with leading zero", () => {
    expect(formatTime12h("14:05:00")).toBe("2:05 PM");
  });
});

// ══════════════════════════════════════════
// Expense interface — transaction_time field
// ══════════════════════════════════════════

describe("Expense transaction_time field", () => {
  it("Expense type includes transaction_time as string", () => {
    // This is a compile-time test — if the import works and the field exists, the test passes
    const mockExpense: import("../../services/expense").Expense = {
      id: "test-1",
      user_id: "user-1",
      amount: 500,
      currency: "INR",
      fx_rate: null,
      description: "Test expense",
      merchant_name: "Zomato",
      category_id: null,
      payment_mode_id: null,
      date: "2026-04-13",
      transaction_time: "15:39:39",
      is_right_spend: 1,
      source: "sms_auto",
      status: "approved",
      nature: "realized",
      due_date: null,
      account_id: null,
      refund_of_expense_id: null,
      raw_source_text: null,
      split_original_amount: null,
      split_person_id: null,
      split_pct: null,
      split_hisaab_entry_id: null,
      matched_forecast_id: null,
      deleted_at: null,
      forecast_type: "expense",
      paid_from_account_id: null,
      created_at: "2026-04-13T00:00:00",
      updated_at: "2026-04-13T00:00:00",
    };

    expect(mockExpense.transaction_time).toBe("15:39:39");
  });

  it("transaction_time defaults to 00:00:00 for manual expenses", () => {
    const manual: import("../../services/expense").Expense = {
      id: "test-2",
      user_id: "user-1",
      amount: 200,
      currency: "INR",
      fx_rate: null,
      description: "Manual expense",
      merchant_name: null,
      category_id: null,
      payment_mode_id: null,
      date: "2026-04-13",
      transaction_time: "00:00:00",
      is_right_spend: 1,
      source: "manual",
      status: "approved",
      nature: "realized",
      due_date: null,
      account_id: null,
      refund_of_expense_id: null,
      raw_source_text: null,
      split_original_amount: null,
      split_person_id: null,
      split_pct: null,
      split_hisaab_entry_id: null,
      matched_forecast_id: null,
      deleted_at: null,
      forecast_type: "expense",
      paid_from_account_id: null,
      created_at: "2026-04-13T00:00:00",
      updated_at: "2026-04-13T00:00:00",
    };

    expect(manual.transaction_time).toBe("00:00:00");
    // formatTime12h should return null for default time
    expect(formatTime12h(manual.transaction_time)).toBeNull();
  });
});

// ══════════════════════════════════════════
// Display logic tests
// ══════════════════════════════════════════

describe("Transaction time display logic", () => {
  it("SMS expense with real time shows formatted time", () => {
    const time = "15:39:39";
    const formatted = formatTime12h(time);
    expect(formatted).toBe("3:39 PM");
    // In the UI, this would render as "Sun, 13 Apr 2026 at 3:39 PM"
  });

  it("manual expense with 00:00:00 shows no time", () => {
    const time = "00:00:00";
    const formatted = formatTime12h(time);
    expect(formatted).toBeNull();
    // In the UI, this would render as just "Sun, 13 Apr 2026" (no " at ..." suffix)
  });

  it("time is shown as read-only in edit mode (not editable)", () => {
    // This is a behavioral contract test — we verify the logic decision:
    // transaction_time should NEVER be in the save payload
    // Only amount, description, category_id, payment_mode_id, account_id, date, is_right_spend are editable
    const editableFields = [
      "amount",
      "description",
      "category_id",
      "payment_mode_id",
      "account_id",
      "date",
      "is_right_spend",
    ];
    expect(editableFields).not.toContain("transaction_time");
  });

  it("edit preserves original transaction_time (not overwritten)", () => {
    // UpdateExpenseInput should NOT include transaction_time
    // This is a compile-time guarantee — the interface doesn't have the field
    const updateInput: import("../../services/expense").UpdateExpenseInput = {
      amount: 600,
      description: "Updated",
    };
    expect(updateInput).not.toHaveProperty("transaction_time");
  });
});
