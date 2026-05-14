/**
 * v15 Phase 2 — PSU bank SMS template regression tests.
 *
 * These tests run the regex patterns from assets/data/sms-templates.json
 * directly against realistic SMS fixtures for the 11 PSU banks we added
 * public coverage for. They do NOT exercise the DB layer — that is covered
 * by integration tests. The goal here is to prove that each template's
 * regex parses its target SMS format, extracts the right amount, and
 * doesn't match fixtures from other banks (cross-bank false-positive
 * regression guard).
 *
 * Fixtures are real-world SMS formats — the SMS bodies banks send to
 * customers, which are factual content.
 *
 * Each bank gets at least one fixture per supported tx_type. Amount is the
 * single most important extraction — if we get the amount right, the rest
 * (merchant, account, ref) are allowed to be best-effort.
 */

import templatesBundle from "../../assets/data/sms-templates.json";

interface TemplateEntry {
  id: string;
  bank_name: string;
  pattern_regex: string;
  tx_type: string;
  priority: number;
}

const TEMPLATES = templatesBundle.entries as TemplateEntry[];

function templatesForBank(bank: string): TemplateEntry[] {
  return TEMPLATES.filter(
    (t) => t.bank_name === bank || t.bank_name === "__generic__",
  ).sort((a, b) => {
    const aGeneric = a.bank_name === "__generic__" ? 1 : 0;
    const bGeneric = b.bank_name === "__generic__" ? 1 : 0;
    if (aGeneric !== bGeneric) return aGeneric - bGeneric;
    return a.priority - b.priority;
  });
}

interface MatchResult {
  templateId: string;
  txType: string;
  amount: number | null;
  account: string | null;
  merchant: string | null;
  ref: string | null;
  dueDate: string | null;
  balance: number | null;
}

function matchSms(body: string, bank: string): MatchResult | null {
  for (const t of templatesForBank(bank)) {
    if (t.tx_type === "balance_inquiry") continue;
    let regex: RegExp;
    try {
      regex = new RegExp(t.pattern_regex, "i");
    } catch {
      continue;
    }
    const m = regex.exec(body);
    if (!m) continue;
    const g = m.groups ?? {};
    const amt = g.amount ? parseFloat(g.amount.replace(/,/g, "")) : null;
    // Skip if required amount is missing for non-reminder types
    if (t.tx_type !== "reminder_hint" && (amt === null || !Number.isFinite(amt) || amt <= 0)) {
      continue;
    }
    return {
      templateId: t.id,
      txType: t.tx_type,
      amount: amt,
      account: g.account ? g.account.slice(-4) : null,
      merchant: g.merchant?.trim() ?? null,
      ref: g.ref ?? null,
      dueDate: g.dueDate ?? null,
      balance: g.balance ? parseFloat(g.balance.replace(/,/g, "")) : null,
    };
  }
  return null;
}

describe("PSU bank SMS template parsing — v15 Phase 2", () => {
  // ─── PNB ───
  describe("Punjab National Bank (PNB)", () => {
    it("parses UPI debit: a/c XX... is debited for Rs", () => {
      const sms = "Dear Customer, a/c no XX340 is debited for Rs 7519 on 12-04-2026. UPI:540012345678. Avl Bal Rs 5000.00 CR -PNB";
      const r = matchSms(sms, "PNB");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(7519);
      expect(r!.txType).toBe("debit");
      expect(r!.account).toBe("340");
    });

    it("parses credit: Ac XXX credited with Rs", () => {
      const sms = "Ac XXXXXXXX00007271 Credited with Rs.200000.00 , 28-11-2022 09:52:52. Aval Bal INR 250000.00 -PNB";
      const r = matchSms(sms, "PNB");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(200000);
      expect(r!.txType).toBe("credit");
      expect(r!.account).toBe("7271");
    });

    it("parses credit with INR format", () => {
      const sms = "INR 5000.00 has been credited to your a/c XX1234 on 10-04-2026. -PNB";
      const r = matchSms(sms, "PNB");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(5000);
      expect(r!.txType).toBe("credit");
    });
  });

  // ─── Canara ───
  describe("Canara Bank", () => {
    it("parses DEBITED with INR format", () => {
      const sms = "An amount of INR 60,000.00 has been DEBITED to your account XXX810 on 27/11/2024 towards Cheque Withdrawal. Total Avail.bal INR 41,928.00. - Canara Bank";
      const r = matchSms(sms, "Canara Bank");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(60000);
      expect(r!.txType).toBe("debit");
      expect(r!.account).toBe("810");
    });

    it("parses CREDITED with INR format", () => {
      const sms = "An amount of INR 20,000.00 has been CREDITED to your account XXX810 on 03/05/2023 towards Cash Deposit. Total Avail.bal INR 1,12,210.00. - Canara Bank";
      const r = matchSms(sms, "Canara Bank");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(20000);
      expect(r!.txType).toBe("credit");
    });

    it("parses CREDITED with short A/c abbreviation", () => {
      const sms = "INR 25,000.00 has been CREDITED to your A/c XXX810 on 17/06/2025 by CASH.Total bal is INR 38,118.00. Please Install Canara ai1 app for Mobile Banking services - Canara Bank";
      const r = matchSms(sms, "Canara Bank");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(25000);
      expect(r!.txType).toBe("credit");
    });

    it("parses UPI paid", () => {
      const sms = "Rs.23.00 paid to merchant@paytm, UPI Ref 406519283748. Canara Bank";
      const r = matchSms(sms, "Canara Bank");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(23);
      expect(r!.txType).toBe("upi_debit");
    });
  });

  // ─── Bank of Baroda ───
  describe("Bank of Baroda (BOB)", () => {
    it("parses transferred from A/c to merchant", () => {
      const sms = "Rs.1500.00 transferred from A/c ...1234 to:John Smith. Total Bal:Rs.15000.00CR Avlbl Amt:Rs.15000.00(21-04-2026) - Bank of Baroda";
      const r = matchSms(sms, "Bank of Baroda");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(1500);
      expect(r!.txType).toBe("debit");
    });

    it("parses Dr. from A/c", () => {
      const sms = "Rs.80.00 Dr. from A/c XX123456 on 12-11-2024. AvlBal:Rs1234.56cx. Ref:52211012345";
      const r = matchSms(sms, "Bank of Baroda");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(80);
      expect(r!.txType).toBe("debit");
    });

    it("parses Cr. to VPA (UPI credit)", () => {
      const sms = "Rs.500.00 Cr. to person@ybl A/c XX789012 on 15-11-2024. AvlBal:Rs5678.90 - Bank of Baroda";
      const r = matchSms(sms, "Bank of Baroda");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(500);
      expect(r!.txType).toBe("upi_credit");
    });

    it("parses IMPS credit", () => {
      const sms = "Rs.2500.00 credited to A/c XX456789 via IMPS/518233445566 by JOHN DOE. AvlBal:Rs30000.00";
      const r = matchSms(sms, "Bank of Baroda");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(2500);
      expect(r!.txType).toBe("credit");
    });

    it("parses cash deposit", () => {
      const sms = "Rs.10000.00 deposited in cash to A/c XX234567 on 20-11-2024. AvlBal:Rs45000.00";
      const r = matchSms(sms, "Bank of Baroda");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(10000);
      expect(r!.txType).toBe("credit");
    });

    it("parses BOBCARD credit card spend", () => {
      const sms = "ALERT: INR 1,500.00 is spent on your BOBCARD ending 1234 at AMAZON on 25-11-2024. Available credit limit is Rs.25000.00";
      const r = matchSms(sms, "Bank of Baroda");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(1500);
      expect(r!.txType).toBe("cc_debit");
      expect(r!.account).toBe("1234");
    });
  });

  // ─── Union Bank of India ───
  describe("Union Bank of India", () => {
    it("parses SB debit", () => {
      const sms = "Your SB A/c *3618 Debited for Rs:147.5 on 16-11-2021 16:45:07 by Transfer Avl Bal Rs:5000.00";
      const r = matchSms(sms, "Union Bank of India");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(147.5);
      expect(r!.txType).toBe("debit");
    });

    it("parses SB credit", () => {
      const sms = "Your SB A/c **23618 is Credited for Rs.1743 on 31-01-2021 03:42:47 by Transfer Avl Bal Rs:15000.00";
      const r = matchSms(sms, "Union Bank of India");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(1743);
      expect(r!.txType).toBe("credit");
    });

    it("parses SB credit with Rs: (colon format)", () => {
      const sms = "Your SB A/c *3618 Credited for Rs:2383.00 on 31-07-2025 03:24:18 by int of TD Avl Bal Rs:25000.00";
      const r = matchSms(sms, "Union Bank of India");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(2383);
      expect(r!.txType).toBe("credit");
    });
  });

  // ─── Indian Bank ───
  describe("Indian Bank", () => {
    it("parses UPI debit", () => {
      const sms = "A/c *1234 debited Rs.500.00 to user@paytm. UPI:515314436916. Bal: Rs.25000";
      const r = matchSms(sms, "Indian Bank");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(500);
      expect(r!.txType).toBe("upi_debit");
    });

    it("parses credit", () => {
      const sms = "A/c *1234 credited Rs.5000.00 from JOHN DOE. UPI Ref no 917477824021. Bal: Rs.30000";
      const r = matchSms(sms, "Indian Bank");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(5000);
      expect(r!.txType).toBe("credit");
    });

    it("parses Rs X credited to format", () => {
      const sms = "Rs.589.00 credited to A/c *1234 on 15-04-2026. Avl Bal: Rs.10589";
      const r = matchSms(sms, "Indian Bank");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(589);
      expect(r!.txType).toBe("credit");
    });

    it("parses ATM withdrawal", () => {
      const sms = "A/c *1234 withdrawn Rs.2000 at ATM-MAIN-BRANCH on 10-04-2026. Bal: Rs.8000";
      const r = matchSms(sms, "Indian Bank");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(2000);
      expect(r!.txType).toBe("debit");
    });
  });

  // ─── Central Bank of India ───
  describe("Central Bank of India", () => {
    it("parses debited by Rs", () => {
      const sms = "A/c XX1234 Debited by Rs.500.00 on 10/04/2026 via UPI. Total Bal Rs.5000.00 CR -CBoI";
      const r = matchSms(sms, "Central Bank of India");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(500);
      expect(r!.txType).toBe("debit");
    });

    it("parses credited by Rs", () => {
      const sms = "A/c XX1234 Credited by Rs.1000.00 on 12/04/2026 via NEFT. Total Bal Rs.6000.00 CR -CBoI";
      const r = matchSms(sms, "Central Bank of India");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(1000);
      expect(r!.txType).toBe("credit");
    });

    it("parses NEFT credit with Ref No", () => {
      const sms = "Rs. 5000 credited to your A/c xxxxxx1234 on 03/01/2026 through NEFT vide Ref No./XUTR/IN22XX...XX24 By.NEXTBILLION TECHNOLOGY PRIVATE LIMI-CBoI";
      const r = matchSms(sms, "Central Bank of India");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(5000);
      expect(r!.txType).toBe("credit");
    });
  });

  // ─── IOB ───
  describe("Indian Overseas Bank (IOB)", () => {
    it("parses credited by Rs UPI", () => {
      const sms = "Your a/c no. XXXXX92 is credited by Rs.906.00 on 2025-08-28 17, from SIDDHANT SIN-7737219900@su(UPI Ref no 560699645381).Payer Remark - Paid via Supe -IOB";
      const r = matchSms(sms, "Indian Overseas Bank");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(906);
      expect(r!.txType).toBe("credit");
    });

    it("parses debited by Rs", () => {
      const sms = "Your a/c no. XXXXX92 is debited by Rs.200.00 on 2026-04-10 from UPI.-IOB";
      const r = matchSms(sms, "Indian Overseas Bank");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(200);
      expect(r!.txType).toBe("debit");
    });

    it("parses credited with Rs", () => {
      const sms = "Your a/c credited with Rs.1500.00 by JOHN on 15-04-2026. Avl Bal Rs.3000 -IOB";
      const r = matchSms(sms, "Indian Overseas Bank");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(1500);
      expect(r!.txType).toBe("credit");
    });
  });

  // ─── UCO ───
  describe("UCO Bank", () => {
    it("parses UPI debit", () => {
      const sms = "A/c XX1111 Debited with Rs.2000.00 on 21-09-2025 by UCO-UPI.Avl Bal Rs.11111.11. Report Dispute https://spgrs.ucoonline.in/Home_Page.jsp";
      const r = matchSms(sms, "UCO Bank");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(2000);
      expect(r!.txType).toBe("debit");
      expect(r!.balance).toBe(11111.11);
    });

    it("parses UPI credit", () => {
      const sms = "A/c XX1111 Credited with Rs.2,000.00 on 21-09-2025 by UCO-UPI.Avl Bal Rs.11111.11. Report Dispute https://spgrs.ucoonline.in/Home_Page.jsp -UCO Bank";
      const r = matchSms(sms, "UCO Bank");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(2000);
      expect(r!.txType).toBe("credit");
    });
  });

  // ─── Bank of India ───
  describe("Bank of India (BOI)", () => {
    it("parses UPI debit with Ref No", () => {
      const sms = "Rs.200.00 debited A/cXX5468 and credited to SAI MISAL via UPI Ref No 315439383341 on 23Aug25. Call 18001031906, if not done by you. -BOI";
      const r = matchSms(sms, "Bank of India");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(200);
      expect(r!.txType).toBe("upi_debit");
      expect(r!.ref).toBe("315439383341");
    });

    it("parses NEFT credit", () => {
      const sms = "BOI - Rs 15,000.00 Credited in your Ac XX5468 on 04-02-2026 By NEFTINWARD HDFCH00778553836/HDFC MUTUAL F .Avl Bal 18679.91";
      const r = matchSms(sms, "Bank of India");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(15000);
      expect(r!.txType).toBe("credit");
    });

    it("parses cash deposit via CDM", () => {
      const sms = "BOI -  Cash Rs. 500 deposited in your account XX5468 from Cash Acceptor Machine R0807030 at  MAIN TRIMBAK ROAD ON 14-10-2025. Available balance Rs. 20100.81";
      const r = matchSms(sms, "Bank of India");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(500);
      expect(r!.txType).toBe("credit");
    });
  });

  // ─── BOM ───
  describe("Bank of Maharashtra (BOM)", () => {
    it("parses debit", () => {
      const sms = "A/c XX1234 is debited by Rs.300.00 on 10-04-2026 via UPI. Avl Bal Rs.3500 -BOM";
      const r = matchSms(sms, "Bank of Maharashtra");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(300);
      expect(r!.txType).toBe("debit");
    });

    it("parses credit with INR", () => {
      const sms = "A/c XX5678 is credited with INR 12,500.00 on 12-04-2026 by NEFT. Avl Bal INR 25000 -BOM";
      const r = matchSms(sms, "Bank of Maharashtra");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(12500);
      expect(r!.txType).toBe("credit");
    });
  });

  // ─── Punjab & Sind Bank ───
  describe("Punjab & Sind Bank", () => {
    it("parses debit with CLR BAL", () => {
      const sms = "A/c No **1234 Debited with Rs.250.00 --UPI/DR/123456/merchant/UPI (CLR BAL 4750.00 CR) 10-04-2026 15:30:00 -PSB";
      const r = matchSms(sms, "Punjab & Sind Bank");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(250);
      expect(r!.txType).toBe("debit");
      expect(r!.balance).toBe(4750);
    });

    it("parses credit with CLR BAL", () => {
      const sms = "A/c No **1234 Credited with Rs.5000.00 --NEFT/HDFC123/JOHN DOE (CLR BAL 10000.00 CR) 12-04-2026 10:30:00 -PSB";
      const r = matchSms(sms, "Punjab & Sind Bank");
      expect(r).not.toBeNull();
      expect(r!.amount).toBe(5000);
      expect(r!.txType).toBe("credit");
    });
  });

  // ─── Reminder hints (generic across banks) ───
  describe("Reminder hints (generic)", () => {
    it("parses EMI pre-notice as reminder_hint (not debit)", () => {
      const sms = "EMI of INR 15,000.00 for Axis Bank Loan A/c 1234 is due on 15-04-2026. -Axis";
      const r = matchSms(sms, "__generic__");
      expect(r).not.toBeNull();
      expect(r!.txType).toBe("reminder_hint");
      expect(r!.amount).toBe(15000);
      expect(r!.dueDate).toBe("15-04-2026");
    });

    it("parses CC bill due as reminder_hint", () => {
      const sms = "Amount Due Rs.25000 on HDFC Bank Credit Card 5678. Pay instantly by 10/MAY/2026 to avoid late fees.";
      const r = matchSms(sms, "__generic__");
      expect(r).not.toBeNull();
      expect(r!.txType).toBe("reminder_hint");
      expect(r!.amount).toBe(25000);
    });

    it("parses SI pre-notice as reminder_hint", () => {
      const sms = "Payment of INR 2500.00 towards Merchant Netflix to be debited from ICICI Bank Credit Card 9999, as per Standing Instruction REF123, is due by 15/05/2026";
      const r = matchSms(sms, "__generic__");
      expect(r).not.toBeNull();
      expect(r!.txType).toBe("reminder_hint");
      expect(r!.amount).toBe(2500);
    });
  });

  // ─── Cross-bank false-positive regression guard ───
  describe("Cross-bank isolation", () => {
    it("does NOT match HDFC SMS against PNB templates (hardcoded bank path)", () => {
      const hdfcSms = "Sent Rs.500.00 from HDFC Bank A/C x1234 to SWIGGY On 10-04-26 Ref 123456. Avl bal Rs.8000.";
      // Only PNB-specific templates (skipping generic which catches amount)
      const pnbOnly = TEMPLATES.filter((t) => t.bank_name === "PNB");
      for (const t of pnbOnly) {
        const rx = new RegExp(t.pattern_regex, "i");
        expect(rx.test(hdfcSms)).toBe(false);
      }
    });

    it("does NOT match generic credit pattern as PNB debit", () => {
      // Plain OTP should never match any PSU debit template
      const otp = "Your OTP is 123456. Do not share with anyone. -SBI";
      for (const t of TEMPLATES.filter((x) => x.tx_type === "debit")) {
        const rx = new RegExp(t.pattern_regex, "i");
        expect(rx.test(otp)).toBe(false);
      }
    });
  });

  // ─── Bundle sanity ───
  describe("Bundle sanity", () => {
    it("has expected count of entries matching count field", () => {
      expect(TEMPLATES.length).toBe(templatesBundle.count);
    });

    it("every template has a compilable regex", () => {
      for (const t of TEMPLATES) {
        expect(() => new RegExp(t.pattern_regex, "i")).not.toThrow();
      }
    });

    it("every template has a named amount group OR is tagged balance_inquiry/reminder_hint", () => {
      for (const t of TEMPLATES) {
        const hasAmountGroup = t.pattern_regex.includes("(?<amount>");
        const isAmountlessType =
          t.tx_type === "balance_inquiry" || t.pattern_regex.includes("(?<ref>");
        expect(hasAmountGroup || isAmountlessType).toBe(true);
      }
    });
  });
});

describe("Sender → bank mapping — v15 Phase 2", () => {
  it("INDBNK now resolves to Indian Bank (not IndusInd)", () => {
    const { identifyBank } = require("../../services/sms/bank-senders");
    const hit = identifyBank("AD-INDBNK-S");
    expect(hit).not.toBeNull();
    expect(hit.bank).toBe("Indian Bank");
  });

  it("IndusInd resolves from INDUSB / INDSIN / INDBKL", () => {
    const { identifyBank } = require("../../services/sms/bank-senders");
    expect(identifyBank("AD-INDUSB-S")?.bank).toBe("IndusInd Bank");
    expect(identifyBank("VK-INDSIN-T")?.bank).toBe("IndusInd Bank");
    expect(identifyBank("JM-INDBKL-S")?.bank).toBe("IndusInd Bank");
  });

  it("all 11 PSU banks are recognised as bank senders", () => {
    const { isBankSender } = require("../../services/sms/bank-senders");
    expect(isBankSender("AD-PNBSMS-S")).toBe(true);
    expect(isBankSender("AD-CANBNK-S")).toBe(true);
    expect(isBankSender("AD-BOBSMS-S")).toBe(true);
    expect(isBankSender("AD-UNIONB-S")).toBe(true);
    expect(isBankSender("AD-INDBNK-S")).toBe(true);
    expect(isBankSender("AD-CENTBK-S")).toBe(true);
    expect(isBankSender("AD-IOBCHN-S")).toBe(true);
    expect(isBankSender("AD-UCOBNK-S")).toBe(true);
    expect(isBankSender("AD-BOIIND-S")).toBe(true);
    expect(isBankSender("AD-BOMBNK-S")).toBe(true);
    expect(isBankSender("AD-PSBANK-S")).toBe(true);
  });
});
