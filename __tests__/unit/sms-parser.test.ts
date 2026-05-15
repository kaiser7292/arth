/**
 * Tests for SMS parser — bank pattern matching with real SMS samples.
 *
 * Each test uses actual SMS text from __tests__/fixtures/sms-samples/real-bank-sms-samples.txt
 */

import { parseBankSMS } from "../../services/sms/bank-patterns";

// ═══════════════════════════════════════════════
// ICICI Credit Card Spend
// ═══════════════════════════════════════════════

describe("ICICI CC Spend", () => {
  it("parses Zomato transaction", () => {
    const result = parseBankSMS(
      "INR 492.50 spent using ICICI Bank Card XX3001 on 11-Apr-26 on ZOMATO LIMITED. Avl Limit: INR 1,55,855.32. If not you, call 1800 2662/SMS BLOCK 3001 to 9215676766.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(492.5);
    expect(result!.merchant).toBe("ZOMATO LIMITED");
    expect(result!.cardLast4).toBe("3001");
    expect(result!.date).toBe("2026-04-11");
    expect(result!.bank).toBe("ICICI Bank");
    expect(result!.type).toBe("debit");
    expect(result!.skip).toBe(false);
  });

  it("parses Uber transaction", () => {
    const result = parseBankSMS(
      "INR 2.00 spent using ICICI Bank Card XX3001 on 09-Apr-26 on UBER INDIA SYST. Avl Limit: INR 1,58,964.57. If not you, call 1800 2662/SMS BLOCK 3001 to 9215676766.",
    );
    expect(result!.amount).toBe(2.0);
    expect(result!.merchant).toBe("UBER INDIA SYST");
    expect(result!.date).toBe("2026-04-09");
  });

  it("parses Amazon Pay transaction", () => {
    const result = parseBankSMS(
      "INR 299.00 spent using ICICI Bank Card XX3001 on 28-Mar-26 on AMAZON PAY IN R. Avl Limit: INR 1,62,961.83. If not you, call 1800 2662/SMS BLOCK 3001 to 9215676766.",
    );
    expect(result!.amount).toBe(299);
    expect(result!.merchant).toBe("AMAZON PAY IN R");
    expect(result!.date).toBe("2026-03-28");
  });

  it("parses large amount with commas", () => {
    const result = parseBankSMS(
      "INR 2,204.00 spent using ICICI Bank Card XX3001 on 14-Feb-26 on AMAZON PAY IN E. Avl Limit: INR 1,23,052.52. If not you, call 1800 2662/SMS BLOCK 3001 to 9215676766.",
    );
    expect(result!.amount).toBe(2204);
    expect(result!.date).toBe("2026-02-14");
  });

  it("parses Netflix transaction", () => {
    const result = parseBankSMS(
      "INR 199.00 spent using ICICI Bank Card XX3001 on 11-Apr-26 on NETFLIX. Avl Limit: INR 1,56,767.57. If not you, call 1800 2662/SMS BLOCK 3001 to 9215676766.",
    );
    expect(result!.amount).toBe(199);
    expect(result!.merchant).toBe("NETFLIX");
  });

  it("parses current ICICI format with 'Rs ... spent on' + 'at MERCHANT' + 'Avl Lmt:'", () => {
    const result = parseBankSMS(
      "Rs 71,000.00 spent on ICICI Bank Card XX3001 on 22-Apr-26 at Tagmango Pvt Lt. Avl Lmt: Rs 85,911.92. To dispute, call 18002662/SMS BLOCK 3001 to 9215676766.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(71000);
    expect(result!.merchant).toBe("Tagmango Pvt Lt");
    expect(result!.cardLast4).toBe("3001");
    expect(result!.date).toBe("2026-04-22");
    expect(result!.bank).toBe("ICICI Bank");
    expect(result!.type).toBe("debit");
    expect(result!.availableCreditLimit).toBe(85911.92);
    expect(result!.accountType).toBe("credit_card");
  });

  it("parses URBANCLAP spend with new format", () => {
    const result = parseBankSMS(
      "Rs 6,344.00 spent on ICICI Bank Card XX3001 on 23-Apr-26 at URBANCLAP TECHN. Avl Lmt: Rs 79,567.92. To dispute, call 18002662/SMS BLOCK 3001 to 9215676766.",
    );
    expect(result!.amount).toBe(6344);
    expect(result!.merchant).toBe("URBANCLAP TECHN");
    expect(result!.date).toBe("2026-04-23");
    expect(result!.availableCreditLimit).toBe(79567.92);
  });

  it("parses Blink Commerce transaction", () => {
    const result = parseBankSMS(
      "INR 389.00 spent using ICICI Bank Card XX3001 on 06-Apr-26 on BLINK COMMERCE . Avl Limit: INR 1,60,796.78. If not you, call 1800 2662/SMS BLOCK 3001 to 9215676766.",
    );
    expect(result!.amount).toBe(389);
    expect(result!.merchant).toContain("BLINK COMMERCE");
  });
});

// ═══════════════════════════════════════════════
// ICICI Account Debit
// ═══════════════════════════════════════════════

describe("ICICI Account Debit", () => {
  it("parses account debit with merchant", () => {
    const result = parseBankSMS(
      "ICICI Bank Acc XX322 debited Rs. 5,696.00 on 11-Mar-26 InfoEBA*IPO LLOPP.Avl Bal Rs. 1,032.75.To dispute call 18002662 or SMS BLOCK 322 to 9215676766",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(5696);
    expect(result!.cardLast4).toBe("322");
    expect(result!.date).toBe("2026-03-11");
    expect(result!.bank).toBe("ICICI Bank");
    expect(result!.type).toBe("debit");
  });
});

// ═══════════════════════════════════════════════
// ICICI Standing Instruction
// ═══════════════════════════════════════════════

describe("ICICI Standing Instruction", () => {
  it("parses Netflix standing instruction (processed)", () => {
    const result = parseBankSMS(
      "We have successfully processed payment of INR 199.00 to Merchant NETFLIX, as per Standing Instruction Y278Vqc4sx on 11/04/2026 for ICICI Bank Credit Card 3001. To manage your Standing Instructions, visit www.icici.bank.in - Personal - Cards - Manage Standing Instructions. Call 1800 1080 for queries.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(199);
    expect(result!.merchant).toBe("NETFLIX");
    expect(result!.cardLast4).toBe("3001");
    expect(result!.date).toBe("2026-04-11");
    expect(result!.type).toBe("standing_instruction");
  });

  it("parses YouTube standing instruction", () => {
    const result = parseBankSMS(
      "We have successfully processed payment of INR 299.00 to Merchant Youtube, as per Standing Instruction XoO5wn2RU4 on 01/03/2026 for ICICI Bank Credit Card 3001. To manage your Standing Instructions, visit www.icici.bank.in - Personal - Cards - Manage Standing Instructions. Call 1800 1080 for queries.",
    );
    expect(result!.amount).toBe(299);
    expect(result!.merchant).toBe("Youtube");
    expect(result!.date).toBe("2026-03-01");
  });
});

// ═══════════════════════════════════════════════
// Axis Bank UPI Debit
// ═══════════════════════════════════════════════

describe("Axis UPI Debit", () => {
  it("parses UPI P2M (merchant) payment", () => {
    const result = parseBankSMS(
      "INR 1236.00 debited\nA/c no. XX2836\n11-04-26, 15:39:39\nUPI/P2M/565346001016/Blue Tokai Coffee R\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1236);
    expect(result!.merchant).toBe("Blue Tokai Coffee R");
    expect(result!.cardLast4).toBe("2836");
    expect(result!.date).toBe("2026-04-11");
    expect(result!.bank).toBe("Axis Bank");
  });

  it("parses UPI P2A (person) payment", () => {
    const result = parseBankSMS(
      "INR 120.00 debited\nA/c no. XX2836\n07-04-26, 19:47:58\nUPI/P2A/747576280976/BABAJAN\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank",
    );
    expect(result!.amount).toBe(120);
    expect(result!.merchant).toBe("BABAJAN");
    expect(result!.date).toBe("2026-04-07");
  });

  it("parses fuel station UPI payment", () => {
    const result = parseBankSMS(
      "INR 2112.36 debited\nA/c no. XX2836\n06-04-26, 15:00:43\nUPI/P2M/527206330966/Supra Fuel Mart\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank",
    );
    expect(result!.amount).toBe(2112.36);
    expect(result!.merchant).toBe("Supra Fuel Mart");
  });

  it("parses motor services UPI payment", () => {
    const result = parseBankSMS(
      "INR 1200.00 debited\nA/c no. XX2836\n06-04-26, 14:03:06\nUPI/P2M/518969090966/SHREE TRIPURA MOTOR\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank",
    );
    expect(result!.amount).toBe(1200);
    expect(result!.merchant).toBe("SHREE TRIPURA MOTOR");
  });
});

// ═══════════════════════════════════════════════
// Axis Bank Credit Card Spend
// ═══════════════════════════════════════════════

describe("Axis CC Spend", () => {
  it("parses format 1 (Spent INR ... Axis Bank Card no.)", () => {
    const result = parseBankSMS(
      "Spent INR 1087\nAxis Bank Card no. XX2445\n09-09-25 02:31:10 IST\nSTEAMGAMES.\nAvl Limit: INR 231506.85\nNot you? SMS BLOCK 2445 to 919951860002",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1087);
    expect(result!.merchant).toBe("STEAMGAMES");
    expect(result!.cardLast4).toBe("2445");
    expect(result!.date).toBe("2025-09-09");
    expect(result!.bank).toBe("Axis Bank");
  });

  it("parses format 2 (Spent / Card no. / INR)", () => {
    const result = parseBankSMS(
      "Spent\nCard no. XX2445\nINR 566.08\n22-06-25 20:14:43\nBOOKMYSHOW\nAvl Lmt INR 187633.87\nSMS BLOCK 2445 to 919951860002, if not you - Axis Bank",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(566.08);
    expect(result!.merchant).toBe("BOOKMYSHOW");
    expect(result!.cardLast4).toBe("2445");
    expect(result!.date).toBe("2025-06-22");
  });
});

// ═══════════════════════════════════════════════
// HDFC Credit Card Spend
// ═══════════════════════════════════════════════

describe("HDFC CC Spend", () => {
  it("parses Tata Payments transaction", () => {
    const result = parseBankSMS(
      "Spent Rs.1646.5 On HDFC Bank Card 8957 At TATA PAYMENTS LIMITED On 2026-04-07:19:25:50.Not You? To Block+Reissue Call 18002586161/SMS BLOCK CC 8957 to 7308080808",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1646.5);
    expect(result!.merchant).toBe("TATA PAYMENTS LIMITED");
    expect(result!.cardLast4).toBe("8957");
    expect(result!.date).toBe("2026-04-07");
    expect(result!.bank).toBe("HDFC Bank");
  });

  it("parses Swiggy Food transaction", () => {
    const result = parseBankSMS(
      "Spent Rs.316 On HDFC Bank Card 9628 At PYU*Swiggy Food On 2026-03-30:14:53:13.Not You? To Block+Reissue Call 18002586161/SMS BLOCK CC 9628 to 7308080808",
    );
    expect(result!.amount).toBe(316);
    expect(result!.merchant).toBe("PYU*Swiggy Food");
    expect(result!.cardLast4).toBe("9628");
    expect(result!.date).toBe("2026-03-30");
  });

  it("parses small decimal amount", () => {
    const result = parseBankSMS(
      "Spent Rs.238.7 On HDFC Bank Card 8957 At TATA PAYMENTS LIMITED On 2026-03-27:16:29:17.Not You? To Block+Reissue Call 18002586161/SMS BLOCK CC 8957 to 7308080808",
    );
    expect(result!.amount).toBe(238.7);
  });
});

// ═══════════════════════════════════════════════
// HDFC Payment Received (credit)
// ═══════════════════════════════════════════════

describe("HDFC Payment Received", () => {
  it("parses payment received SMS", () => {
    const result = parseBankSMS(
      "DEAR HDFCBANK CARDMEMBER, PAYMENT OF Rs. 937.05 RECEIVED TOWARDS YOUR CREDIT CARD ENDING WITH 8957 ON 2-4-2026.YOUR AVAILABLE LIMIT IS RS. 161956.10",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(937.05);
    expect(result!.cardLast4).toBe("8957");
    expect(result!.date).toBe("2026-04-02");
    expect(result!.type).toBe("payment_received");
    expect(result!.bank).toBe("HDFC Bank");
  });

  it("parses larger payment received", () => {
    const result = parseBankSMS(
      "DEAR HDFCBANK CARDMEMBER, PAYMENT OF Rs. 29942.04 RECEIVED TOWARDS YOUR CREDIT CARD ENDING WITH 8957 ON 26-3-2026.YOUR AVAILABLE LIMIT IS RS. 162000.00",
    );
    expect(result!.amount).toBe(29942.04);
    expect(result!.date).toBe("2026-03-26");
  });
});

// ═══════════════════════════════════════════════
// Skip patterns (should NOT create expenses)
// ═══════════════════════════════════════════════

describe("Skip patterns", () => {
  it("skips OTP messages", () => {
    const result = parseBankSMS(
      "Amazon: OTP for payment of INR 218.73 to Zomato Limited is 613934. If unauthorized, deny here: https://amazon.in/a/c/r/9Kis3dSYxCgxmEYOLV71CIx9J",
    );
    expect(result).not.toBeNull();
    expect(result!.skip).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// Forecast patterns (create forecast entries, NOT skip)
// ═══════════════════════════════════════════════

describe("Forecast: ICICI Standing Instruction Reminder", () => {
  it("parses Netflix SI reminder as forecast", () => {
    const result = parseBankSMS(
      "Payment of INR 199.00 towards Merchant NETFLIX to be debited from ICICI Bank Credit Card 3001, as per Standing Instruction Y278Vqc4sx, is due by 09/04/2026. To cancel this debit or your Standing Instructions, visit www.icici.bank.in - Personal - Cards - Manage Standing Instructions. Call 1800 1080 for queries.",
    );
    expect(result).not.toBeNull();
    expect(result!.skip).toBe(false);
    expect(result!.isForecast).toBe(true);
    expect(result!.type).toBe("standing_instruction_reminder");
    expect(result!.amount).toBe(199);
    expect(result!.merchant).toBe("NETFLIX");
    expect(result!.cardLast4).toBe("3001");
    expect(result!.dueDate).toBe("2026-04-09");
    expect(result!.date).toBeNull();
    expect(result!.bank).toBe("ICICI Bank");
    expect(result!.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("parses YouTube SI reminder as forecast", () => {
    const result = parseBankSMS(
      "Payment of INR 299.00 towards Merchant YOUTUBE PREMIUM to be debited from ICICI Bank Credit Card 3001, as per Standing Instruction XoO5wn2RU4, is due by 01/05/2026. To cancel this debit, visit www.icici.bank.in.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(299);
    expect(result!.merchant).toBe("YOUTUBE PREMIUM");
    expect(result!.dueDate).toBe("2026-05-01");
    expect(result!.isForecast).toBe(true);
  });
});

describe("Forecast: HDFC Amount Due", () => {
  it("parses HDFC amount due as forecast", () => {
    const result = parseBankSMS(
      "Amount Due\nRs.937 on HDFC Bank Credit Card 8957. Pay instantly by 21/APR/2026 via PayZapp > Bill Pay > Credit Card: https://hdfcbk.io/HDFCBK/s/6xqG7PV9",
    );
    expect(result).not.toBeNull();
    expect(result!.skip).toBe(false);
    expect(result!.isForecast).toBe(true);
    expect(result!.type).toBe("amount_due_reminder");
    expect(result!.amount).toBe(937);
    expect(result!.cardLast4).toBe("8957");
    expect(result!.dueDate).toBe("2026-04-21");
    expect(result!.date).toBeNull();
    expect(result!.bank).toBe("HDFC Bank");
    expect(result!.merchant).toBe("Credit Card Amount Due");
  });

  it("parses HDFC amount due with decimal", () => {
    const result = parseBankSMS(
      "Amount Due\nRs.12345.67 on HDFC Bank Credit Card 9628. Pay instantly by 15/MAR/2026 via PayZapp",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(12345.67);
    expect(result!.cardLast4).toBe("9628");
    expect(result!.dueDate).toBe("2026-03-15");
    expect(result!.isForecast).toBe(true);
  });
});

describe("Forecast: Axis EMI Reminder", () => {
  it("parses EMI due as forecast", () => {
    const result = parseBankSMS(
      "EMI of INR 22317.00 for Axis Bank Loan A/c XX7249 is due on 10-04-26. Maintain adequate balance prior to the due date to avoid lien / bounce / penal charges.",
    );
    expect(result).not.toBeNull();
    expect(result!.skip).toBe(false);
    expect(result!.isForecast).toBe(true);
    expect(result!.type).toBe("emi_reminder");
    expect(result!.amount).toBe(22317);
    expect(result!.cardLast4).toBe("7249");
    expect(result!.dueDate).toBe("2026-04-10");
    expect(result!.date).toBeNull();
    expect(result!.bank).toBe("Axis Bank");
    expect(result!.merchant).toBe("EMI Payment");
  });

  it("parses EMI with smaller amount", () => {
    const result = parseBankSMS(
      "EMI of INR 5000.00 for Loan A/c XX1234 is due on 15-05-26. Maintain adequate balance.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(5000);
    expect(result!.cardLast4).toBe("1234");
    expect(result!.dueDate).toBe("2026-05-15");
    expect(result!.isForecast).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// Forecast fields on realized transactions (should be false)
// ═══════════════════════════════════════════════

describe("Realized transactions have isForecast=false", () => {
  it("ICICI CC debit is not a forecast", () => {
    const result = parseBankSMS(
      "INR 492.50 spent using ICICI Bank Card XX3001 on 11-Apr-26 on ZOMATO LIMITED. Avl Limit: INR 1,55,855.32.",
    );
    expect(result!.isForecast).toBe(false);
    expect(result!.dueDate).toBeNull();
  });

  it("Axis UPI debit is not a forecast", () => {
    const result = parseBankSMS(
      "INR 1236.00 debited\nA/c no. XX2836\n11-04-26, 15:39:39\nUPI/P2M/565346001016/Blue Tokai Coffee R\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank",
    );
    expect(result!.isForecast).toBe(false);
    expect(result!.dueDate).toBeNull();
  });

  it("HDFC CC debit is not a forecast", () => {
    const result = parseBankSMS(
      "Spent Rs.1646.5 On HDFC Bank Card 8957 At TATA PAYMENTS LIMITED On 2026-04-07:19:25:50.Not You?",
    );
    expect(result!.isForecast).toBe(false);
    expect(result!.dueDate).toBeNull();
  });

  it("ICICI Standing Instruction (processed) is not a forecast", () => {
    const result = parseBankSMS(
      "We have successfully processed payment of INR 199.00 to Merchant NETFLIX, as per Standing Instruction Y278Vqc4sx on 11/04/2026 for ICICI Bank Credit Card 3001. To manage your Standing Instructions, visit www.icici.bank.in.",
    );
    expect(result!.isForecast).toBe(false);
    expect(result!.dueDate).toBeNull();
    expect(result!.type).toBe("standing_instruction");
  });
});

// ═══════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════

describe("Edge cases", () => {
  it("returns null for non-financial SMS", () => {
    expect(parseBankSMS("Hey, how are you?")).toBeNull();
    expect(parseBankSMS("Your order has been shipped!")).toBeNull();
  });

  it("returns null for empty body", () => {
    expect(parseBankSMS("")).toBeNull();
  });

  it("handles confidence scoring", () => {
    const result = parseBankSMS(
      "INR 492.50 spent using ICICI Bank Card XX3001 on 11-Apr-26 on ZOMATO LIMITED. Avl Limit: INR 1,55,855.32.",
    );
    expect(result!.confidence).toBeGreaterThanOrEqual(0.85);
  });
});

// ═══════════════════════════════════════════════
// EXPANDED PATTERNS (Task 11.4)
// ═══════════════════════════════════════════════

// ─── ICICI Extended ───

describe("ICICI UPI Debit", () => {
  it("parses UPI debit from ICICI account", () => {
    const result = parseBankSMS(
      "ICICI Bank Acc XX322 debited Rs. 500.00 on 12-Apr-26 for UPI txn to SWIGGY. UPI Ref: 123456789012. Avl Bal Rs. 15,032.75.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(500);
    expect(result!.cardLast4).toBe("322");
    expect(result!.date).toBe("2026-04-12");
    expect(result!.type).toBe("upi_debit");
    expect(result!.bank).toBe("ICICI Bank");
    expect(result!.merchant).toBe("SWIGGY");
    expect(result!.upiRef).toBe("123456789012");
    expect(result!.accountType).toBe("savings");
  });
});

describe("ICICI UPI Credit", () => {
  it("parses UPI credit to ICICI account", () => {
    const result = parseBankSMS(
      "ICICI Bank Acc XX322 credited Rs. 5000.00 on 12-Apr-26. UPI Ref: 987654321012. Avl Bal Rs. 20,032.75.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(5000);
    expect(result!.cardLast4).toBe("322");
    expect(result!.date).toBe("2026-04-12");
    expect(result!.type).toBe("upi_credit");
    expect(result!.upiRef).toBe("987654321012");
    expect(result!.availableBalance).toBe(20032.75);
    expect(result!.accountType).toBe("savings");
  });
});

describe("ICICI Refund", () => {
  it("parses refund to ICICI card", () => {
    const result = parseBankSMS(
      "ICICI Bank: Rs.500.00 refund credited to your Card XX3001 on 12-Apr-26. Ref: 123456.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(500);
    expect(result!.type).toBe("refund");
    expect(result!.cardLast4).toBe("3001");
    expect(result!.date).toBe("2026-04-12");
    expect(result!.accountType).toBe("credit_card");
  });
});

describe("ICICI CC Payment", () => {
  it("parses credit card bill payment", () => {
    const result = parseBankSMS(
      "ICICI Bank: Payment of Rs.25000.00 received towards your Credit Card XX3001 on 12-Apr-26.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(25000);
    expect(result!.type).toBe("payment_received");
    expect(result!.cardLast4).toBe("3001");
    expect(result!.accountType).toBe("credit_card");
  });
});

describe("ICICI Balance Info", () => {
  it("parses balance inquiry SMS", () => {
    const result = parseBankSMS(
      "ICICI Bank Acc XX322: Avl Bal Rs. 15,032.75 as on 12-Apr-26.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(0);
    expect(result!.type).toBe("balance_inquiry");
    expect(result!.cardLast4).toBe("322");
    expect(result!.availableBalance).toBe(15032.75);
    expect(result!.accountType).toBe("savings");
  });
});

// ─── HDFC Extended ───

describe("HDFC UPI Debit", () => {
  it("parses UPI debit from HDFC account", () => {
    const result = parseBankSMS(
      "Rs.500.00 debited from HDFC Bank a/c XX5678 on 12-04-26 for UPI txn to SWIGGY. UPI Ref 123456789012. Avl Bal Rs.25000.00",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(500);
    expect(result!.type).toBe("upi_debit");
    expect(result!.cardLast4).toBe("5678");
    expect(result!.date).toBe("2026-04-12");
    expect(result!.merchant).toBe("SWIGGY");
    expect(result!.upiRef).toBe("123456789012");
  });
});

describe("HDFC Refund", () => {
  it("parses refund to HDFC card", () => {
    const result = parseBankSMS(
      "Refund of Rs.500.00 has been credited to your HDFC Bank Card ending 8957 on 12-4-2026.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(500);
    expect(result!.type).toBe("refund");
    expect(result!.cardLast4).toBe("8957");
    expect(result!.date).toBe("2026-04-12");
    expect(result!.accountType).toBe("credit_card");
  });

  // v15.3.0: new pattern — "Alert! Rs. X refunded by MERCHANT ... adjusted
  // against HDFC Bank Credit Card NNNN on DD/MMM/YYYY". Different wording,
  // different date format.
  it("parses HDFC CC 'Alert! Rs. X refunded by ... adjusted against' format", () => {
    const result = parseBankSMS(
      "Alert! Rs. 1438.2 refunded by HOUSEOFPUREECO           NEW DELHI    IN on 29/APR/2026 & adjusted against HDFC Bank Credit Card 8957 View updated balance here: https://hdfcbk.io/HDFCBK/s/3GZLlqdy",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1438.2);
    expect(result!.type).toBe("refund");
    expect(result!.cardLast4).toBe("8957");
    expect(result!.date).toBe("2026-04-29");
    expect(result!.merchant).toBe("HOUSEOFPUREECO NEW DELHI IN");
    expect(result!.bank).toBe("HDFC Bank");
    expect(result!.accountType).toBe("credit_card");
  });
});

describe("ICICI CC Refund (merchant-prefixed)", () => {
  // v15.3.0: "IND*AMAZON refund of Rs X credited to ICICI Bank Credit Card
  // XXNNNN on DD-MMM-YY. Revised total due ..."
  it("parses IND*AMAZON refund with commas in amount", () => {
    const result = parseBankSMS(
      "IND*AMAZON refund of Rs 4,936.00 credited to ICICI Bank Credit Card XX3001 on 19-AUG-25. Revised total due Rs 57,531.50, minimum due Rs 12,094.00",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(4936);
    expect(result!.type).toBe("refund");
    expect(result!.cardLast4).toBe("3001");
    expect(result!.date).toBe("2025-08-19");
    expect(result!.merchant).toBe("IND*AMAZON");
    expect(result!.bank).toBe("ICICI Bank");
    expect(result!.accountType).toBe("credit_card");
  });

  it("parses multi-word merchant (AMAZON PAY IN E COMMERC)", () => {
    const result = parseBankSMS(
      "AMAZON PAY IN E COMMERC refund of Rs 454.00 credited to ICICI Bank Credit Card XX3001 on 23-SEP-25. Revised total due Rs 0, minimum due Rs .00",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(454);
    expect(result!.type).toBe("refund");
    expect(result!.cardLast4).toBe("3001");
    expect(result!.date).toBe("2025-09-23");
    expect(result!.merchant).toBe("AMAZON PAY IN E COMMERC");
  });
});

describe("HDFC NACH Debit", () => {
  it("parses NACH debit from HDFC account", () => {
    const result = parseBankSMS(
      "NACH debit of Rs.199.00 from your HDFC Bank A/c XX5678 on 12-04-26 towards NETFLIX.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(199);
    expect(result!.type).toBe("nach_debit");
    expect(result!.cardLast4).toBe("5678");
    expect(result!.merchant).toBe("NETFLIX");
  });
});

describe("HDFC CC Limit", () => {
  it("parses credit card limit alert", () => {
    const result = parseBankSMS(
      "Your HDFC Bank Credit Card 8957: Credit Limit Rs.1,62,000. Available Limit Rs.1,55,000.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(0);
    expect(result!.type).toBe("balance_inquiry");
    expect(result!.creditLimit).toBe(162000);
    expect(result!.availableCreditLimit).toBe(155000);
    expect(result!.accountType).toBe("credit_card");
  });
});

describe("HDFC Account Credit", () => {
  it("parses credit to HDFC account", () => {
    const result = parseBankSMS(
      "Rs.50000.00 credited to HDFC Bank A/c XX5678 on 12-04-26 by NEFT from ABC. Avl Bal Rs.75000.00.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(50000);
    expect(result!.type).toBe("credit");
    expect(result!.cardLast4).toBe("5678");
    expect(result!.availableBalance).toBe(75000);
  });
});

// ─── Axis Extended ───

describe("Axis Account Credit", () => {
  it("parses credit to Axis account", () => {
    const result = parseBankSMS(
      "INR 5000.00 credited\nA/c no. XX2836\n12-04-26, 10:30:00\nNEFT/ICICI/SALARY\nAxis Bank",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(5000);
    expect(result!.type).toBe("credit");
    expect(result!.cardLast4).toBe("2836");
    expect(result!.date).toBe("2026-04-12");
    expect(result!.merchant).toBe("NEFT/ICICI/SALARY");
  });
});

describe("Axis Refund", () => {
  it("parses refund to Axis card", () => {
    const result = parseBankSMS(
      "Refund INR 1087.00 credited to Axis Bank Card XX2445 on 12-04-26.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1087);
    expect(result!.type).toBe("refund");
    expect(result!.cardLast4).toBe("2445");
    expect(result!.accountType).toBe("credit_card");
  });
});

describe("Axis NACH Debit", () => {
  it("parses NACH mandate debit", () => {
    const result = parseBankSMS(
      "NACH mandate debit of INR 1500.00 from A/c XX2836 on 12-04-26 towards TATA AIA LIFE INS. Axis Bank",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1500);
    expect(result!.type).toBe("nach_debit");
    expect(result!.merchant).toBe("TATA AIA LIFE INS");
    expect(result!.cardLast4).toBe("2836");
  });
});

describe("Axis NACH Bounce", () => {
  it("parses NACH bounce notification", () => {
    const result = parseBankSMS(
      "NACH mandate debit of INR 1500.00 from A/c XX2836 failed on 12-04-26 due to insufficient funds. Axis Bank",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1500);
    expect(result!.type).toBe("nach_bounce");
    expect(result!.cardLast4).toBe("2836");
  });
});

// ─── SBI ───

describe("SBI Account Debit", () => {
  it("parses SBI account debit", () => {
    const result = parseBankSMS(
      "Dear SBI Customer, Your a/c no. XXXXXXXX5678 is debited for Rs 2500.00 on 12-04-26 by trf to MERCHANT STORE. Ref No 123456.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(2500);
    expect(result!.type).toBe("debit");
    expect(result!.bank).toBe("SBI");
    expect(result!.cardLast4).toBe("5678");
    expect(result!.merchant).toBe("MERCHANT STORE");
  });
});

describe("SBI Account Credit", () => {
  it("parses SBI account credit", () => {
    const result = parseBankSMS(
      "Your a/c no. XXXXXXXX5678 is credited with Rs 50000.00 on 12-04-26 by trf from EMPLOYER. Avl Bal Rs 75000.00 - SBI",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(50000);
    expect(result!.type).toBe("credit");
    expect(result!.bank).toBe("SBI");
    expect(result!.availableBalance).toBe(75000);
  });
});

describe("SBI UPI Debit", () => {
  it("parses SBI UPI debit", () => {
    const result = parseBankSMS(
      "Dear Customer, Rs.500.00 debited from your SBI A/c XX5678 on 12-04-26 for UPI txn to SWIGGY. UPI Ref 123456.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(500);
    expect(result!.type).toBe("upi_debit");
    expect(result!.bank).toBe("SBI");
    expect(result!.merchant).toBe("SWIGGY");
    expect(result!.upiRef).toBe("123456");
  });
});

describe("SBI Balance Info", () => {
  it("parses SBI balance inquiry", () => {
    const result = parseBankSMS(
      "Dear SBI Customer, Avl Bal in your A/c no. XXXXXXXX5678 is Rs 75000.00 as on 12-Apr-26.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(0);
    expect(result!.type).toBe("balance_inquiry");
    expect(result!.bank).toBe("SBI");
    expect(result!.availableBalance).toBe(75000);
  });
});

// ─── Kotak ───

describe("Kotak Debit", () => {
  it("parses Kotak Bank debit", () => {
    const result = parseBankSMS(
      "Rs.1500.00 debited from your Kotak Bank A/c XX4567 on 12-04-26. Info: UPI/SWIGGY.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1500);
    expect(result!.type).toBe("debit");
    expect(result!.bank).toBe("Kotak Mahindra Bank");
    expect(result!.merchant).toBe("UPI/SWIGGY");
  });
});

describe("Kotak UPI Debit", () => {
  it("parses Kotak UPI debit", () => {
    const result = parseBankSMS(
      "INR 1500.00 debited from a/c XX4567 on 12-04-26 towards UPI/P2M/123456/MERCHANT STORE. Avl Bal: INR 25000.00 -Kotak Mahindra Bank",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1500);
    expect(result!.type).toBe("upi_debit");
    expect(result!.bank).toBe("Kotak Mahindra Bank");
    expect(result!.merchant).toBe("MERCHANT STORE");
    expect(result!.availableBalance).toBe(25000);
  });
});

describe("Kotak CC Alert", () => {
  it("parses Kotak CC spend alert", () => {
    const result = parseBankSMS(
      "Rs.2500.00 charged on your Kotak Credit Card XX1234 at AMAZON on 12-04-26. Avl Lmt Rs.1,50,000.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(2500);
    expect(result!.type).toBe("debit");
    expect(result!.merchant).toBe("AMAZON");
    expect(result!.availableCreditLimit).toBe(150000);
    expect(result!.accountType).toBe("credit_card");
  });
});

// ─── IDFC First ───

describe("IDFC First Debit", () => {
  it("parses IDFC First debit", () => {
    const result = parseBankSMS(
      "Rs.2000.00 debited from your IDFC FIRST Bank A/c XX1234 on 12-Apr-26. UPI Ref 123456. If not done by you, call 18004190332",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(2000);
    expect(result!.type).toBe("debit");
    expect(result!.bank).toBe("IDFC FIRST Bank");
    expect(result!.upiRef).toBe("123456");
  });
});

describe("IDFC First Credit", () => {
  it("parses IDFC First credit", () => {
    const result = parseBankSMS(
      "Rs.10000.00 credited to your IDFC FIRST Bank A/c XX1234 on 12-Apr-26. Avl Bal Rs.35000.00.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(10000);
    expect(result!.type).toBe("credit");
    expect(result!.bank).toBe("IDFC FIRST Bank");
    expect(result!.availableBalance).toBe(35000);
  });
});

describe("IDFC First UPI", () => {
  it("parses IDFC First UPI debit", () => {
    const result = parseBankSMS(
      "Rs.500.00 debited from IDFC FIRST Bank A/c XX1234 on 12-04-26 for UPI to SWIGGY. UPI Ref 987654.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(500);
    expect(result!.type).toBe("upi_debit");
    expect(result!.merchant).toBe("SWIGGY");
    expect(result!.upiRef).toBe("987654");
  });
});

// ─── Federal Bank ───

describe("Federal Bank Debit", () => {
  it("parses Federal Bank debit", () => {
    const result = parseBankSMS(
      "Rs.3000.00 debited from your Federal Bank A/c XX9876 on 12-Apr-26. Info: NEFT/MERCHANT.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(3000);
    expect(result!.type).toBe("debit");
    expect(result!.bank).toBe("Federal Bank");
    expect(result!.merchant).toBe("NEFT/MERCHANT");
  });
});

describe("Federal Bank Credit", () => {
  it("parses Federal Bank credit", () => {
    const result = parseBankSMS(
      "Rs.15000.00 credited to your Federal Bank A/c XX9876 on 12-Apr-26. Avl Bal Rs.45000.00.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(15000);
    expect(result!.type).toBe("credit");
    expect(result!.bank).toBe("Federal Bank");
    expect(result!.availableBalance).toBe(45000);
  });
});

// ─── Citi ───

describe("Citi CC Spend", () => {
  it("parses Citi Card spend", () => {
    const result = parseBankSMS(
      "Rs.4500.00 spent on Citi Card XX6789 at AMAZON on 12-04-26. Avl Credit Limit: Rs.2,50,000.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(4500);
    expect(result!.type).toBe("debit");
    expect(result!.bank).toBe("Citi Bank");
    expect(result!.merchant).toBe("AMAZON");
    expect(result!.availableCreditLimit).toBe(250000);
  });
});

describe("Citi CC Due", () => {
  it("parses Citi Card due reminder", () => {
    const result = parseBankSMS(
      "Citi Card XX6789: Min Due Rs.2500, Total Due Rs.45000. Pay by 15-05-26 to avoid late fee.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(45000);
    expect(result!.type).toBe("amount_due_reminder");
    expect(result!.isForecast).toBe(true);
    expect(result!.dueDate).toBe("2026-05-15");
  });
});

// ─── Amex ───

describe("Amex Spend Alert", () => {
  it("parses Amex spend alert", () => {
    const result = parseBankSMS(
      "INR 8500.00 charged on your AMEX Card XX5555 at PREMIUM LOUNGE on 12-Apr-26.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(8500);
    expect(result!.type).toBe("debit");
    expect(result!.bank).toBe("American Express");
    expect(result!.merchant).toBe("PREMIUM LOUNGE");
    expect(result!.accountType).toBe("credit_card");
  });
});

describe("Amex Payment Due", () => {
  it("parses Amex payment due", () => {
    const result = parseBankSMS(
      "Payment of INR 25000.00 due on your AMEX Card XX5555 by 20-05-26.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(25000);
    expect(result!.type).toBe("amount_due_reminder");
    expect(result!.isForecast).toBe(true);
    expect(result!.dueDate).toBe("2026-05-20");
  });
});

// ─── RBL ───

describe("RBL CC Spend", () => {
  it("parses RBL Card spend", () => {
    const result = parseBankSMS(
      "Rs.3200.00 spent on RBL Bank Card XX7890 at FLIPKART on 12-04-26.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(3200);
    expect(result!.type).toBe("debit");
    expect(result!.bank).toBe("RBL Bank");
    expect(result!.merchant).toBe("FLIPKART");
  });
});

describe("RBL CC Due", () => {
  it("parses RBL CC due reminder", () => {
    const result = parseBankSMS(
      "Payment reminder: Rs.15000 due on RBL CC XX7890 by 20-05-26. Pay now to avoid charges.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(15000);
    expect(result!.type).toBe("amount_due_reminder");
    expect(result!.isForecast).toBe(true);
    expect(result!.dueDate).toBe("2026-05-20");
  });
});

// ─── HSBC ───

describe("HSBC Debit", () => {
  it("parses HSBC account debit", () => {
    const result = parseBankSMS(
      "Rs.5000.00 debited from HSBC A/c XX3456 on 12-Apr-26. Info: NEFT/RENT PAYMENT.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(5000);
    expect(result!.type).toBe("debit");
    expect(result!.bank).toBe("HSBC");
    expect(result!.merchant).toBe("NEFT/RENT PAYMENT");
  });
});

describe("HSBC CC Alert", () => {
  it("parses HSBC CC spend", () => {
    const result = parseBankSMS(
      "Rs.7500.00 spent on HSBC CC XX4567 at PREMIUM STORE on 12-04-26.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(7500);
    expect(result!.type).toBe("debit");
    expect(result!.bank).toBe("HSBC");
    expect(result!.merchant).toBe("PREMIUM STORE");
  });
});

// ─── AU Small Finance Bank ───

describe("AU Bank Debit", () => {
  it("parses AU Bank debit", () => {
    const result = parseBankSMS(
      "Rs.1500.00 debited from your AU Small Finance Bank A/c XX8901 on 12-Apr-26. Info: UPI/ZOMATO.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1500);
    expect(result!.type).toBe("debit");
    expect(result!.bank).toBe("AU Small Finance Bank");
    expect(result!.merchant).toBe("UPI/ZOMATO");
  });
});

describe("AU Bank Credit", () => {
  it("parses AU Bank credit", () => {
    const result = parseBankSMS(
      "Rs.25000.00 credited to your AU Small Finance Bank A/c XX8901 on 12-Apr-26. Avl Bal Rs.50000.00.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(25000);
    expect(result!.type).toBe("credit");
    expect(result!.bank).toBe("AU Small Finance Bank");
    expect(result!.availableBalance).toBe(50000);
  });
});

// ─── Google Pay ───

describe("Google Pay UPI Debit", () => {
  it("parses GPay send", () => {
    const result = parseBankSMS(
      "Sent Rs.500 to SWIGGY via Google Pay. UPI Ref: 123456789012.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(500);
    expect(result!.type).toBe("upi_debit");
    expect(result!.bank).toBe("Google Pay");
    expect(result!.merchant).toBe("SWIGGY");
    expect(result!.upiRef).toBe("123456789012");
  });
});

describe("Google Pay UPI Credit", () => {
  it("parses GPay receive", () => {
    const result = parseBankSMS(
      "Received Rs.1000 from JOHN DOE via Google Pay. UPI Ref: 987654321012.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1000);
    expect(result!.type).toBe("upi_credit");
    expect(result!.bank).toBe("Google Pay");
    expect(result!.merchant).toBe("JOHN DOE");
    expect(result!.upiRef).toBe("987654321012");
  });
});

// ─── PhonePe ───

describe("PhonePe UPI Debit", () => {
  it("parses PhonePe send", () => {
    const result = parseBankSMS(
      "Rs 1000 sent to ZOMATO from your HDFC Bank A/c XX5678 via PhonePe. UPI Ref No. 123456789012.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1000);
    expect(result!.type).toBe("upi_debit");
    expect(result!.bank).toBe("PhonePe");
    expect(result!.merchant).toBe("ZOMATO");
    expect(result!.cardLast4).toBe("5678");
    expect(result!.upiRef).toBe("123456789012");
  });
});

describe("PhonePe UPI Credit", () => {
  it("parses PhonePe receive", () => {
    const result = parseBankSMS(
      "Rs 5000 received from JANE DOE to your ICICI Bank A/c XX322 via PhonePe. UPI Ref No. 987654321012.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(5000);
    expect(result!.type).toBe("upi_credit");
    expect(result!.bank).toBe("PhonePe");
    expect(result!.merchant).toBe("JANE DOE");
    expect(result!.cardLast4).toBe("322");
  });
});

// ─── Paytm ───

describe("Paytm UPI Credit", () => {
  it("parses Paytm UPI receive", () => {
    const result = parseBankSMS(
      "Rs.2000 received from FRIEND via Paytm UPI. Ref: 123456789012.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(2000);
    expect(result!.type).toBe("upi_credit");
    expect(result!.bank).toBe("Paytm");
    expect(result!.merchant).toBe("FRIEND");
    expect(result!.upiRef).toBe("123456789012");
  });
});

describe("Paytm Wallet Debit", () => {
  it("parses Paytm Wallet spend", () => {
    const result = parseBankSMS(
      "Rs.350 debited from Paytm Wallet for UBER RIDE. Balance: Rs.1500.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(350);
    expect(result!.type).toBe("debit");
    expect(result!.bank).toBe("Paytm");
    expect(result!.merchant).toBe("UBER RIDE");
    expect(result!.availableBalance).toBe(1500);
  });
});

// ═══════════════════════════════════════════════════════════
// Task 11.6: Refund, NACH, Extended CC Due patterns
// ═══════════════════════════════════════════════════════════

describe("SBI Refund", () => {
  it("parses SBI refund SMS", () => {
    const result = parseBankSMS(
      "SBI: Refund of Rs.1500.00 credited to A/c XX4567 on 12-Apr-26. Ref 789012.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(1500);
    expect(result!.type).toBe("refund");
    expect(result!.bank).toBe("SBI");
    expect(result!.cardLast4).toBe("4567");
    expect(result!.merchant).toBe("Refund");
  });
});

describe("Generic Refund", () => {
  it("parses generic refund SMS", () => {
    const result = parseBankSMS(
      "Rs.500 refund credited to your account XX1234 on 12-04-2026.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(500);
    expect(result!.type).toBe("refund");
    expect(result!.cardLast4).toBe("1234");
    expect(result!.merchant).toBe("Refund");
  });
});

describe("SBI NACH Debit", () => {
  it("parses SBI NACH debit SMS", () => {
    const result = parseBankSMS(
      "SBI: NACH debit of Rs.499.00 from A/c XX4567 on 12-Apr-26 towards SPOTIFY INDIA.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(499);
    expect(result!.type).toBe("nach_debit");
    expect(result!.bank).toBe("SBI");
    expect(result!.cardLast4).toBe("4567");
    expect(result!.merchant).toBe("SPOTIFY INDIA");
  });
});

describe("ICICI CC Total Due", () => {
  it("parses ICICI CC due reminder", () => {
    const result = parseBankSMS(
      "ICICI Bank Credit Card XX3001: Total Due Rs.45000, Min Due Rs.2500. Pay by 15-May-26.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(45000);
    expect(result!.type).toBe("amount_due_reminder");
    expect(result!.bank).toBe("ICICI Bank");
    expect(result!.cardLast4).toBe("3001");
    expect(result!.dueDate).toBe("2026-05-15");
    expect(result!.isForecast).toBe(true);
  });
});

describe("Kotak CC Payment Reminder", () => {
  it("parses Kotak CC payment reminder", () => {
    const result = parseBankSMS(
      "Kotak Bank: Your Credit Card XX5678 payment of Rs.32000 is due on 20-May-26. Min Due Rs.1600.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(32000);
    expect(result!.type).toBe("amount_due_reminder");
    expect(result!.bank).toBe("Kotak Mahindra Bank");
    expect(result!.cardLast4).toBe("5678");
    expect(result!.dueDate).toBe("2026-05-20");
    expect(result!.isForecast).toBe(true);
  });
});

describe("SBI CC Statement", () => {
  it("parses SBI CC statement generated SMS", () => {
    const result = parseBankSMS(
      "SBI Card XX8901: Statement generated. Total Due Rs.28000, Min Due Rs.1400. Pay by 05-May-26.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(28000);
    expect(result!.type).toBe("amount_due_reminder");
    expect(result!.bank).toBe("SBI");
    expect(result!.cardLast4).toBe("8901");
    expect(result!.dueDate).toBe("2026-05-05");
    expect(result!.isForecast).toBe(true);
  });
});

describe("Axis CC Outstanding", () => {
  it("parses Axis CC outstanding SMS", () => {
    const result = parseBankSMS(
      "Axis Bank: Your Credit Card XX2445 outstanding is Rs.18500. Min Due Rs.925. Due date: 10-May-26.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(18500);
    expect(result!.type).toBe("amount_due_reminder");
    expect(result!.bank).toBe("Axis Bank");
    expect(result!.cardLast4).toBe("2445");
    expect(result!.dueDate).toBe("2026-05-10");
    expect(result!.isForecast).toBe(true);
  });
});

describe("IDFC First CC Due", () => {
  it("parses IDFC First CC bill due SMS", () => {
    const result = parseBankSMS(
      "IDFC FIRST Bank: Your Credit Card XX3456 bill of Rs.15000 is due on 25-May-26.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(15000);
    expect(result!.type).toBe("amount_due_reminder");
    expect(result!.bank).toBe("IDFC First Bank");
    expect(result!.cardLast4).toBe("3456");
    expect(result!.dueDate).toBe("2026-05-25");
    expect(result!.isForecast).toBe(true);
  });
});

describe("EPFO Pension", () => {
  it("parses EPFO passbook balance with masked account ID", () => {
    const result = parseBankSMS(
      "Dear XXXXXXXX6138, your passbook balance against PUPUN**************1275 is Rs. 3,81,039/-. Contribution of Rs. 14,750/- for due month Mar-26 has been received.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(14750); // Contribution amount
    expect(result!.merchant).toBe("PUPUN**************1275"); // Full passbook ID
    expect(result!.cardLast4).toBe("6138"); // UAN/account ID from beginning
    expect(result!.date).toBe("2026-03-31"); // Month-end date
    expect(result!.bank).toBe("EPFO");
    expect(result!.type).toBe("credit");
    expect(result!.accountType).toBe("pension");
    expect(result!.availableBalance).toBe(381039); // Passbook balance
    expect(result!.isForecast).toBe(false);
  });

  it("parses EPFO passbook balance with org-level account ID", () => {
    const result = parseBankSMS(
      "Dear XXXXXXXX6138, your passbook balance against APHYD00641440000014984 is Rs. 5,42,180/-. Contribution of Rs. 15,000/- for due month Apr-26 has been received.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(15000);
    expect(result!.merchant).toBe("APHYD00641440000014984");
    expect(result!.cardLast4).toBe("6138");
    expect(result!.date).toBe("2026-04-30"); // Month-end date
    expect(result!.bank).toBe("EPFO");
    expect(result!.type).toBe("credit");
    expect(result!.accountType).toBe("pension");
    expect(result!.availableBalance).toBe(542180);
    expect(result!.isForecast).toBe(false);
  });

  it("parses EPFO with Jan-25 date", () => {
    const result = parseBankSMS(
      "Dear XXXXXXXX6138,your passbook balance against APHYD00641440000014984 is Rs. 1,77,791/-. Contribution of Rs. 8,736/- for due month Jan-25 has been received.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(8736);
    expect(result!.date).toBe("2025-01-31"); // Month-end date
    expect(result!.cardLast4).toBe("6138");
    expect(result!.accountType).toBe("pension");
  });

  it("parses EPFO with Mar-25 date", () => {
    const result = parseBankSMS(
      "Dear XXXXXXXX6138,your passbook balance against APHYD00641440000014984 is Rs. 1,95,263/-. Contribution of Rs. 8,736/- for due month Mar-25 has been received.",
    );
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(8736);
    expect(result!.date).toBe("2025-03-31"); // Month-end date
    expect(result!.cardLast4).toBe("6138");
    expect(result!.accountType).toBe("pension");
  });
});

// ─── Pattern count validation ───

describe("Pattern count", () => {
  it("has 60+ bank patterns", () => {
    const { BANK_PATTERNS } = require("../../services/sms/bank-patterns");
    expect(BANK_PATTERNS.length).toBeGreaterThanOrEqual(60);
  });
});
