/**
 * Tests for account type keyword inference from SMS body.
 *
 * Covers: credit card patterns, loan patterns, savings patterns, wallet patterns.
 */

import { inferAccountTypeFromKeywords } from "../../services/financial-account";

describe("inferAccountTypeFromKeywords", () => {
  // ─── Credit Card ───
  it("detects credit card from 'Credit Card'", () => {
    expect(inferAccountTypeFromKeywords("Your HDFC Credit Card ending 3001 has been charged Rs.500")).toBe("credit_card");
  });

  it("detects credit card from 'CC No'", () => {
    expect(inferAccountTypeFromKeywords("Transaction on CC No XX1234 for INR 2500")).toBe("credit_card");
  });

  it("detects credit card from 'Avail Cr Limit'", () => {
    expect(inferAccountTypeFromKeywords("Avail Cr Limit: INR 150000. Card ending 9876")).toBe("credit_card");
  });

  it("detects credit card from 'Available Credit'", () => {
    expect(inferAccountTypeFromKeywords("Your Available Credit limit is Rs.85000")).toBe("credit_card");
  });

  it("detects credit card from 'Card ending XX' without debit mention", () => {
    expect(inferAccountTypeFromKeywords("Your Card ending XX4455 was used for Rs.1200")).toBe("credit_card");
  });

  it("does NOT detect credit card when 'DEBIT' is present", () => {
    // The 3rd regex for credit card excludes DEBIT
    const result = inferAccountTypeFromKeywords("Your DEBIT Card ending XX4455 was used for Rs.1200");
    expect(result).not.toBe("credit_card");
  });

  // ─── Loan ───
  it("detects loan from 'Loan A/C'", () => {
    expect(inferAccountTypeFromKeywords("EMI debited from Loan A/C 98765 for Rs.45000")).toBe("loan");
  });

  it("detects loan from 'Home Loan'", () => {
    expect(inferAccountTypeFromKeywords("Your Home Loan EMI of Rs.45000 has been deducted")).toBe("loan");
  });

  it("detects loan from 'Personal Loan'", () => {
    expect(inferAccountTypeFromKeywords("Personal Loan EMI Rs.12000 debited")).toBe("loan");
  });

  it("detects loan from 'EMI for Loan'", () => {
    expect(inferAccountTypeFromKeywords("EMI for Loan account has been processed")).toBe("loan");
  });

  // ─── Savings ───
  it("detects savings from 'A/C No'", () => {
    expect(inferAccountTypeFromKeywords("Rs.5000 debited from A/C No 12345678")).toBe("savings");
  });

  it("detects savings from 'Avl Bal'", () => {
    expect(inferAccountTypeFromKeywords("Avl Bal: INR 25,678.50")).toBe("savings");
  });

  it("detects savings from 'Available Bal'", () => {
    expect(inferAccountTypeFromKeywords("Available Bal Rs.50000")).toBe("savings");
  });

  it("detects savings from 'Savings A/C'", () => {
    expect(inferAccountTypeFromKeywords("Your Savings A/C has been credited with Rs.100000")).toBe("savings");
  });

  it("detects savings from 'SB A/C'", () => {
    expect(inferAccountTypeFromKeywords("Rs.2000 debited from SB A/C")).toBe("savings");
  });

  // ─── Wallet ───
  it("detects wallet from 'wallet'", () => {
    expect(inferAccountTypeFromKeywords("Your Wallet balance is Rs.500")).toBe("wallet");
  });

  it("detects wallet from 'Paytm Balance'", () => {
    expect(inferAccountTypeFromKeywords("Paytm Balance: Rs.1200")).toBe("wallet");
  });

  // ─── No match ───
  it("returns null for generic SMS with no keywords", () => {
    expect(inferAccountTypeFromKeywords("Thank you for your purchase")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(inferAccountTypeFromKeywords("")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(inferAccountTypeFromKeywords("your hdfc credit card ending 3001")).toBe("credit_card");
    expect(inferAccountTypeFromKeywords("LOAN A/C 12345")).toBe("loan");
  });
});
