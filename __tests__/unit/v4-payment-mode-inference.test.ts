/**
 * V4 Tests: Payment Mode Inference + Time Extraction
 *
 * Tests the inferPaymentMode() decision tree and extractTime() helper
 * that were added to bank-patterns.ts for V4.
 */

import type { ParsedSMS } from "../../services/sms/bank-patterns";
import {
    extractTime,
    inferPaymentMode,
} from "../../services/sms/bank-patterns";

// Helper to create a minimal ParsedSMS for testing
function makeParsed(overrides: Partial<ParsedSMS> = {}): ParsedSMS {
  return {
    amount: 1000,
    type: "debit",
    bank: "ICICI",
    cardLast4: "1234",
    merchant: "Test Merchant",
    date: "2026-04-13",
    skip: false,
    confidence: 1,
    dueDate: null,
    ...overrides,
  } as ParsedSMS;
}

// ════════════════════════════════════════════
// inferPaymentMode — Decision Tree Tests
// ════════════════════════════════════════════

describe("inferPaymentMode", () => {
  // Priority 1: UPI subtype
  it("returns 'upi' for P2M UPI transactions", () => {
    const parsed = makeParsed({ upiSubtype: "p2m" });
    expect(inferPaymentMode(parsed, "UPI P2M transaction")).toBe("upi");
  });

  it("returns 'upi' for P2A UPI transactions", () => {
    const parsed = makeParsed({ upiSubtype: "p2a" });
    expect(inferPaymentMode(parsed, "UPI transfer")).toBe("upi");
  });

  // Priority 2: UPI type
  it("returns 'upi' for upi_debit type", () => {
    const parsed = makeParsed({ type: "upi_debit" });
    expect(inferPaymentMode(parsed, "Debited")).toBe("upi");
  });

  it("returns 'upi' for upi_credit type", () => {
    const parsed = makeParsed({ type: "upi_credit" });
    expect(inferPaymentMode(parsed, "Credited")).toBe("upi");
  });

  // Priority 3: Auto-debit types
  it("returns 'auto_debit' for standing_instruction type", () => {
    const parsed = makeParsed({ type: "standing_instruction" });
    expect(inferPaymentMode(parsed, "Standing Instruction executed")).toBe("auto_debit");
  });

  it("returns 'auto_debit' for nach_debit type", () => {
    const parsed = makeParsed({ type: "nach_debit" });
    expect(inferPaymentMode(parsed, "NACH debit for EMI")).toBe("auto_debit");
  });

  it("returns 'auto_debit' for emi type", () => {
    const parsed = makeParsed({ type: "emi" as ParsedSMS["type"] });
    expect(inferPaymentMode(parsed, "EMI debit")).toBe("auto_debit");
  });

  it("returns 'auto_debit' for standing_instruction_reminder", () => {
    const parsed = makeParsed({ type: "standing_instruction_reminder" });
    expect(inferPaymentMode(parsed, "SI reminder")).toBe("auto_debit");
  });

  it("returns 'auto_debit' for emi_reminder", () => {
    const parsed = makeParsed({ type: "emi_reminder" });
    expect(inferPaymentMode(parsed, "EMI reminder")).toBe("auto_debit");
  });

  // Priority 4: Wallet
  it("returns 'wallet' for wallet accountType", () => {
    const parsed = makeParsed({ accountType: "wallet" as ParsedSMS["accountType"] });
    expect(inferPaymentMode(parsed, "Paytm wallet")).toBe("wallet");
  });

  // Priority 5: Credit card accountType
  it("returns 'credit_card' for credit_card accountType", () => {
    const parsed = makeParsed({ accountType: "credit_card" });
    expect(inferPaymentMode(parsed, "Card transaction")).toBe("credit_card");
  });

  // Priority 6: Card keyword analysis
  it("returns 'credit_card' when CARD + credit limit mentioned", () => {
    const parsed = makeParsed({ creditLimit: 200000 });
    expect(inferPaymentMode(parsed, "Your ICICI CARD ending 3001 has been used for Rs 1000. Avl Credit Limit: Rs 199000")).toBe("credit_card");
  });

  it("returns 'credit_card' when CARD + AVL LIMIT mentioned", () => {
    const parsed = makeParsed({});
    expect(inferPaymentMode(parsed, "ICICI CARD xx3001 debited for Rs 500. AVL LIMIT Rs 50000")).toBe("credit_card");
  });

  it("returns 'debit_card' when CARD + available balance mentioned", () => {
    const parsed = makeParsed({ availableBalance: 50000 });
    expect(inferPaymentMode(parsed, "Your ICICI Bank CARD ending 1234 debited Rs 500. Avl Bal Rs 49500")).toBe("debit_card");
  });

  it("returns 'debit_card' when CARD + AVL BAL mentioned", () => {
    const parsed = makeParsed({});
    expect(inferPaymentMode(parsed, "Your Axis Bank CARD xx2836 has been debited for Rs 431. AVL BAL Rs 12000")).toBe("debit_card");
  });

  it("returns 'credit_card' as default when CARD keyword with no balance/limit clues", () => {
    const parsed = makeParsed({});
    expect(inferPaymentMode(parsed, "Your CARD ending 9999 was used for a transaction")).toBe("credit_card");
  });

  // Priority 7: Savings account → net_banking
  it("returns 'net_banking' for savings accountType without card/UPI", () => {
    const parsed = makeParsed({ accountType: "savings" });
    expect(inferPaymentMode(parsed, "A/c XX1234 debited for Rs 5000")).toBe("net_banking");
  });

  // Priority 8: Loan → auto_debit
  it("returns 'auto_debit' for loan accountType", () => {
    const parsed = makeParsed({ accountType: "loan" });
    expect(inferPaymentMode(parsed, "Loan account EMI debited")).toBe("auto_debit");
  });

  // Null fallback
  it("returns null when no payment mode can be inferred", () => {
    const parsed = makeParsed({});
    expect(inferPaymentMode(parsed, "Transaction processed")).toBeNull();
  });
});

// ════════════════════════════════════════════
// extractTime — SMS Time Extraction Tests
// ════════════════════════════════════════════

describe("extractTime", () => {
  it("extracts time from comma-separated format (DD-MM-YY,HH:MM:SS)", () => {
    expect(extractTime("Txn of Rs 1000 on 11-04-26,15:39:39")).toBe("15:39:39");
  });

  it("extracts time from colon-separated format (YYYY-MM-DD:HH:MM:SS)", () => {
    expect(extractTime("Transaction on 2026-04-11:09:15:30 for Rs 500")).toBe("09:15:30");
  });

  it("extracts time from space-separated format (DD-MM-YY HH:MM:SS)", () => {
    expect(extractTime("Debited Rs 2000 on 11-04-26 14:22:10")).toBe("14:22:10");
  });

  it("extracts time with IST suffix (2-digit year)", () => {
    expect(extractTime("Transaction at 11-04-26 18:45:00 IST for Rs 100")).toBe("18:45:00");
  });

  it("returns null when no time is present", () => {
    expect(extractTime("Rs 1000 debited from your A/c on 11-Apr-2026")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractTime("")).toBeNull();
  });

  it("returns null when only a date is present (no time component)", () => {
    expect(extractTime("Debited on 11/04/2026 for Rs 500")).toBeNull();
  });
});
