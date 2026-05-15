/**
 * Integration tests for SMS Scan Runs logging functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { getDatabase } from "@/database";
import { logScanRun, logScanDetails, getScanRuns, getScanRun, getScanDetails, deleteScanRun, cleanupOldScanRuns } from "@/services/sms-scan-logging";
import { DEFAULT_USER_ID } from "@/constants/app";

describe("SMS Scan Runs Integration Tests", () => {
  let scanRunId: string;

  beforeEach(async () => {
    // Clean up any existing test data
    const db = getDatabase();
    await db.runAsync("DELETE FROM sms_scan_details WHERE scan_run_id LIKE 'test-%';");
    await db.runAsync("DELETE FROM sms_scan_runs WHERE id LIKE 'test-%';");
  });

  afterEach(async () => {
    // Clean up test data
    const db = getDatabase();
    await db.runAsync("DELETE FROM sms_scan_details WHERE scan_run_id LIKE 'test-%';");
    await db.runAsync("DELETE FROM sms_scan_runs WHERE id LIKE 'test-%';");
  });

  it("should log a scan run successfully", async () => {
    const result = await logScanRun({
      userId: DEFAULT_USER_ID,
      isManual: true,
      startDate: "2024-01-01",
      endDate: "2024-01-31",
      accountIds: ["account1", "account2"],
      smsReadCount: 100,
      smsParsedCount: 80,
      smsFilteredCount: 20,
      smsHardcodedMatchCount: 60,
      smsTemplateMatchCount: 20,
      smsUnrecognizedCount: 10,
      smsSkippedCount: 10,
      expenseCreatedCount: 50,
      creditCreatedCount: 10,
    });

    expect(result).toBeTruthy();
    scanRunId = result;

    const scanRun = await getScanRun(result);
    expect(scanRun).toBeTruthy();
    expect(scanRun?.user_id).toBe(DEFAULT_USER_ID);
    expect(scanRun?.is_manual).toBe(1);
    expect(scanRun?.sms_read_count).toBe(100);
  });

  it("should log scan details successfully", async () => {
    // First create a scan run
    scanRunId = await logScanRun({
      userId: DEFAULT_USER_ID,
      isManual: true,
      startDate: "2024-01-01",
      endDate: "2024-01-31",
      accountIds: null,
      smsReadCount: 10,
      smsParsedCount: 8,
      smsFilteredCount: 2,
      smsHardcodedMatchCount: 5,
      smsTemplateMatchCount: 3,
      smsUnrecognizedCount: 1,
      smsSkippedCount: 1,
      expenseCreatedCount: 5,
      creditCreatedCount: 2,
    });

    // Then log scan details
    const details = [
      {
        scanRunId,
        smsId: "sms1",
        smsAddress: "AD-HDFCBK",
        smsBody: "Your A/c XX1234 debited Rs.500 for UPI transaction",
        smsDate: Date.now(),
        parseSource: "hardcoded" as const,
        parseResult: JSON.stringify({ amount: 500, merchant: "UPI", cardLast4: "1234" }),
        filterReason: null,
      },
      {
        scanRunId,
        smsId: "sms2",
        smsAddress: "VM-ICICIB",
        smsBody: "Rs.1000 credited to A/c XX5678",
        smsDate: Date.now(),
        parseSource: "template" as const,
        parseResult: JSON.stringify({ amount: 1000, merchant: "Credit", cardLast4: "5678" }),
        filterReason: null,
      },
    ];

    await logScanDetails(details);

    const retrievedDetails = await getScanDetails(scanRunId);
    expect(retrievedDetails.length).toBe(2);
    expect(retrievedDetails[0].sms_body).toContain("debited Rs.500");
    expect(retrievedDetails[1].sms_body).toContain("credited");
  });

  it("should retrieve scan runs for a user", async () => {
    // Create multiple scan runs
    await logScanRun({
      userId: DEFAULT_USER_ID,
      isManual: true,
      startDate: null,
      endDate: null,
      accountIds: null,
      smsReadCount: 50,
      smsParsedCount: 40,
      smsFilteredCount: 10,
      smsHardcodedMatchCount: 30,
      smsTemplateMatchCount: 10,
      smsUnrecognizedCount: 5,
      smsSkippedCount: 5,
      expenseCreatedCount: 30,
      creditCreatedCount: 5,
    });

    await logScanRun({
      userId: DEFAULT_USER_ID,
      isManual: false,
      startDate: null,
      endDate: null,
      accountIds: null,
      smsReadCount: 20,
      smsParsedCount: 15,
      smsFilteredCount: 5,
      smsHardcodedMatchCount: 10,
      smsTemplateMatchCount: 5,
      smsUnrecognizedCount: 2,
      smsSkippedCount: 3,
      expenseCreatedCount: 10,
      creditCreatedCount: 2,
    });

    const runs = await getScanRuns(DEFAULT_USER_ID);
    expect(runs.length).toBeGreaterThanOrEqual(2);
  });

  it("should filter scan details by parse source", async () => {
    // Create a scan run
    scanRunId = await logScanRun({
      userId: DEFAULT_USER_ID,
      isManual: true,
      startDate: null,
      endDate: null,
      accountIds: null,
      smsReadCount: 10,
      smsParsedCount: 8,
      smsFilteredCount: 2,
      smsHardcodedMatchCount: 5,
      smsTemplateMatchCount: 3,
      smsUnrecognizedCount: 1,
      smsSkippedCount: 1,
      expenseCreatedCount: 5,
      creditCreatedCount: 2,
    });

    // Log details with different sources
    await logScanDetails([
      {
        scanRunId,
        smsId: "sms1",
        smsAddress: "AD-HDFCBK",
        smsBody: "Debited Rs.500",
        smsDate: Date.now(),
        parseSource: "hardcoded" as const,
        parseResult: JSON.stringify({ amount: 500 }),
        filterReason: null,
      },
      {
        scanRunId,
        smsId: "sms2",
        smsAddress: "VM-ICICIB",
        smsBody: "Credited Rs.1000",
        smsDate: Date.now(),
        parseSource: "template" as const,
        parseResult: JSON.stringify({ amount: 1000 }),
        filterReason: null,
      },
    ]);

    const hardcodedDetails = await getScanDetails(scanRunId, "hardcoded");
    expect(hardcodedDetails.length).toBe(1);
    expect(hardcodedDetails[0].parse_source).toBe("hardcoded");

    const templateDetails = await getScanDetails(scanRunId, "template");
    expect(templateDetails.length).toBe(1);
    expect(templateDetails[0].parse_source).toBe("template");
  });

  it("should delete a scan run and cascade delete details", async () => {
    // Create a scan run with details
    scanRunId = await logScanRun({
      userId: DEFAULT_USER_ID,
      isManual: true,
      startDate: null,
      endDate: null,
      accountIds: null,
      smsReadCount: 5,
      smsParsedCount: 4,
      smsFilteredCount: 1,
      smsHardcodedMatchCount: 3,
      smsTemplateMatchCount: 1,
      smsUnrecognizedCount: 0,
      smsSkippedCount: 1,
      expenseCreatedCount: 3,
      creditCreatedCount: 1,
    });

    await logScanDetails([
      {
        scanRunId,
        smsId: "sms1",
        smsAddress: "AD-HDFCBK",
        smsBody: "Debited Rs.500",
        smsDate: Date.now(),
        parseSource: "hardcoded" as const,
        parseResult: JSON.stringify({ amount: 500 }),
        filterReason: null,
      },
    ]);

    // Verify details exist
    let details = await getScanDetails(scanRunId);
    expect(details.length).toBe(1);

    // Delete the scan run
    await deleteScanRun(scanRunId);

    // Verify scan run is deleted
    const deletedRun = await getScanRun(scanRunId);
    expect(deletedRun).toBeNull();

    // Verify details are cascade deleted
    details = await getScanDetails(scanRunId);
    expect(details.length).toBe(0);
  });

  it("should clean up old scan runs", async () => {
    // Create an old scan run (91 days ago)
    const oldTimestamp = Date.now() - 91 * 24 * 60 * 60 * 1000;
    const db = getDatabase();
    const oldRunId = "test-old-run";
    await db.runAsync(
      `INSERT INTO sms_scan_runs 
       (id, user_id, run_timestamp, is_manual, start_date, end_date, account_ids,
        sms_read_count, sms_parsed_count, sms_filtered_count,
        sms_hardcoded_match_count, sms_template_match_count,
        sms_unrecognized_count, sms_skipped_count,
        expense_created_count, credit_created_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'));`,
      oldRunId,
      DEFAULT_USER_ID,
      oldTimestamp,
      1,
      "2024-01-01",
      "2024-01-31",
      null,
      100,
      80,
      20,
      60,
      20,
      10,
      10,
      50,
      10,
    );

    // Create a recent scan run (30 days ago)
    const recentTimestamp = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentRunId = "test-recent-run";
    await db.runAsync(
      `INSERT INTO sms_scan_runs 
       (id, user_id, run_timestamp, is_manual, start_date, end_date, account_ids,
        sms_read_count, sms_parsed_count, sms_filtered_count,
        sms_hardcoded_match_count, sms_template_match_count,
        sms_unrecognized_count, sms_skipped_count,
        expense_created_count, credit_created_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'));`,
      recentRunId,
      DEFAULT_USER_ID,
      recentTimestamp,
      1,
      "2024-01-01",
      "2024-01-31",
      null,
      100,
      80,
      20,
      60,
      20,
      10,
      10,
      50,
      10,
    );

    // Run cleanup
    const deletedCount = await cleanupOldScanRuns(DEFAULT_USER_ID);

    // Verify old run is deleted
    const oldRun = await getScanRun(oldRunId);
    expect(oldRun).toBeNull();

    // Verify recent run still exists
    const recentRun = await getScanRun(recentRunId);
    expect(recentRun).toBeTruthy();

    // Clean up test data
    await db.runAsync("DELETE FROM sms_scan_runs WHERE id = ?;", recentRunId);
  });
});
