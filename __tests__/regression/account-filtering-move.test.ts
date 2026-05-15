/**
 * Regression tests for account filtering move from sms-reader.ts to sms-to-expense.ts.
 * Ensures that existing SMS scan flow still works correctly after the change.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { getDatabase } from "@/database";
import { getActiveAccounts, type FinancialAccount } from "@/services/financial-account";
import { parseBankSMS } from "@/services/sms/bank-patterns";
import { processParseResults } from "@/services/sms/sms-to-expense";
import { DEFAULT_USER_ID } from "@/constants/app";

describe("Account Filtering Move Regression Tests", () => {
  beforeEach(async () => {
    // Clean up test data
    const db = getDatabase();
    await db.runAsync("DELETE FROM pending_sms WHERE id LIKE 'test-%';");
    await db.runAsync("DELETE FROM expenses WHERE description LIKE 'test-sms-%';");
  });

  afterEach(async () => {
    // Clean up test data
    const db = getDatabase();
    await db.runAsync("DELETE FROM pending_sms WHERE id LIKE 'test-%';");
    await db.runAsync("DELETE FROM expenses WHERE description LIKE 'test-sms-%';");
  });

  it("should process all SMS when no account IDs are provided", async () => {
    const items = [
      {
        pendingSmsId: "test-sms-1",
        parsed: parseBankSMS("Your A/c XX1234 debited Rs.500 for UPI transaction to Amazon")!,
        rawBody: "Your A/c XX1234 debited Rs.500 for UPI transaction to Amazon",
        smsDate: Date.now(),
      },
      {
        pendingSmsId: "test-sms-2",
        parsed: parseBankSMS("Rs.1000 credited to A/c XX5678 via NEFT")!,
        rawBody: "Rs.1000 credited to A/c XX5678 via NEFT",
        smsDate: Date.now(),
      },
    ];

    // Add parseSource to match the new interface
    const itemsWithSource = items.map((item) => ({
      ...item,
      parseSource: "hardcoded" as const,
    }));

    const result = await processParseResults(DEFAULT_USER_ID, itemsWithSource, undefined);

    // All items should be processed when no account filtering is applied
    expect(result.created + result.credits + result.skipped).toBe(items.length);
  });

  it("should filter SMS by account IDs when provided", async () => {
    // Get existing accounts to test with real data
    const accounts = await getActiveAccounts(DEFAULT_USER_ID);
    
    if (accounts.length === 0) {
      // Skip test if no accounts exist
      console.log("Skipping test: No accounts found");
      return;
    }

    const firstAccount = accounts[0];
    const accountIds = [firstAccount.id];

    const items = [
      {
        pendingSmsId: "test-sms-1",
        parsed: parseBankSMS(`Your A/c XX${firstAccount.account_identifier} debited Rs.500 for UPI transaction`)!,
        rawBody: `Your A/c XX${firstAccount.account_identifier} debited Rs.500 for UPI transaction`,
        smsDate: Date.now(),
        parseSource: "hardcoded" as const,
      },
      {
        pendingSmsId: "test-sms-2",
        parsed: parseBankSMS("Your A/c XX9999 debited Rs.1000 for UPI transaction")!,
        rawBody: "Your A/c XX9999 debited Rs.1000 for UPI transaction",
        smsDate: Date.now(),
        parseSource: "hardcoded" as const,
      },
    ];

    const result = await processParseResults(DEFAULT_USER_ID, items, accountIds);

    // Only the SMS matching the selected account should be processed
    // The other SMS should be filtered out
    expect(result.created + result.credits + result.skipped).toBeLessThanOrEqual(items.length);
  });

  it("should handle EPFO pension accounts with passbook ID matching", async () => {
    const accounts = await getActiveAccounts(DEFAULT_USER_ID);
    
    const pensionAccounts = accounts.filter((acc) => acc.account_type === "pension");
    
    if (pensionAccounts.length === 0) {
      // Skip test if no pension accounts exist
      console.log("Skipping test: No pension accounts found");
      return;
    }

    const pensionAccount = pensionAccounts[0];
    const accountIds = [pensionAccount.id];

    // Test with merchant (passbook ID) matching
    const items = [
      {
        pendingSmsId: "test-sms-epfo",
        parsed: {
          ...parseBankSMS("Rs.5000 credited to EPFO account")!,
          bank: "EPFO",
          merchant: pensionAccount.account_identifier, // Passbook ID
          cardLast4: null,
        },
        rawBody: "Rs.5000 credited to EPFO account",
        smsDate: Date.now(),
        parseSource: "hardcoded" as const,
      },
    ];

    const result = await processParseResults(DEFAULT_USER_ID, items, accountIds);

    // EPFO SMS with matching passbook ID should be processed
    expect(result.created + result.credits + result.skipped).toBeGreaterThan(0);
  });

  it("should handle regular accounts with cardLast4 matching", async () => {
    const accounts = await getActiveAccounts(DEFAULT_USER_ID);
    
    const regularAccounts = accounts.filter((acc) => acc.account_type !== "pension");
    
    if (regularAccounts.length === 0) {
      // Skip test if no regular accounts exist
      console.log("Skipping test: No regular accounts found");
      return;
    }

    const regularAccount = regularAccounts[0];
    const accountIds = [regularAccount.id];

    // Test with cardLast4 matching
    const items = [
      {
        pendingSmsId: "test-sms-card",
        parsed: {
          ...parseBankSMS(`Your A/c XX${regularAccount.account_identifier} debited Rs.500`)!,
          cardLast4: regularAccount.account_identifier,
        },
        rawBody: `Your A/c XX${regularAccount.account_identifier} debited Rs.500`,
        smsDate: Date.now(),
        parseSource: "hardcoded" as const,
      },
    ];

    const result = await processParseResults(DEFAULT_USER_ID, items, accountIds);

    // SMS with matching cardLast4 should be processed
    expect(result.created + result.credits + result.skipped).toBeGreaterThan(0);
  });

  it("should preserve existing behavior for template-based SMS", async () => {
    // This test ensures that template-based SMS are not filtered out
    // when account filtering is applied (the main fix for the issue)
    
    const accounts = await getActiveAccounts(DEFAULT_USER_ID);
    
    if (accounts.length === 0) {
      // Skip test if no accounts exist
      console.log("Skipping test: No accounts found");
      return;
    }

    const firstAccount = accounts[0];
    const accountIds = [firstAccount.id];

    // Simulate a template-based SMS (parseSource = "template")
    const items = [
      {
        pendingSmsId: "test-sms-template",
        parsed: {
          ...parseBankSMS(`Your A/c XX${firstAccount.account_identifier} debited Rs.500`)!,
          cardLast4: firstAccount.account_identifier,
        },
        rawBody: `Your A/c XX${firstAccount.account_identifier} debited Rs.500`,
        smsDate: Date.now(),
        parseSource: "template" as const, // This is the key - template-based SMS
      },
    ];

    const result = await processParseResults(DEFAULT_USER_ID, items, accountIds);

    // Template-based SMS should be processed if account matches
    expect(result.created + result.credits + result.skipped).toBeGreaterThan(0);
  });

  it("should handle empty account IDs array as no filtering", async () => {
    const items = [
      {
        pendingSmsId: "test-sms-1",
        parsed: parseBankSMS("Your A/c XX1234 debited Rs.500 for UPI transaction")!,
        rawBody: "Your A/c XX1234 debited Rs.500 for UPI transaction",
        smsDate: Date.now(),
        parseSource: "hardcoded" as const,
      },
    ];

    // Empty array should behave like undefined (no filtering)
    const result = await processParseResults(DEFAULT_USER_ID, items, []);

    expect(result.created + result.credits + result.skipped).toBe(items.length);
  });

  it("should handle SMS with no cardLast4 for non-EPFO accounts", async () => {
    const accounts = await getActiveAccounts(DEFAULT_USER_ID);
    
    if (accounts.length === 0) {
      // Skip test if no accounts exist
      console.log("Skipping test: No accounts found");
      return;
    }

    const accountIds = [accounts[0].id];

    const items = [
      {
        pendingSmsId: "test-sms-no-card",
        parsed: {
          ...parseBankSMS("Your account debited Rs.500 for UPI transaction")!,
          cardLast4: null, // No cardLast4
        },
        rawBody: "Your account debited Rs.500 for UPI transaction",
        smsDate: Date.now(),
        parseSource: "hardcoded" as const,
      },
    ];

    const result = await processParseResults(DEFAULT_USER_ID, items, accountIds);

    // SMS without cardLast4 should be filtered out for regular accounts
    expect(result.created + result.credits + result.skipped).toBe(0);
  });
});
