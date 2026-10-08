import {
  detectFdEvent,
  detectInvestmentWithdrawal,
  detectSip,
  extractCounterpartyName,
  matchesAnySelfName,
  namesMatch,
  normalizeName,
  sipFundLabel,
} from "../../services/sms/money-signals";

describe("detectFdEvent", () => {
  it.each([
    ["Info: FD through MOBILE-XXXX1234:RAHUL", "debit", "open"],
    ["Rs 5000 debited towards FD", "debit", "open"],
    ["transferred to TD A/c XXXX12345", "debit", "open"],
    ["e-TDR created for Rs 10000", "debit", "open"],
    ["RD instalment of Rs 2000 debited", "debit", "open"],
    ["on account of Closure of TD A/c XXXXX031705", "credit", "closure"],
    ["FD no 1234 matured and proceeds credited", "credit", "closure"],
    ["maturity proceeds of your deposit", "credit", "closure"],
    ["premature closure of deposit", "credit", "closure"],
  ])("%s (%s) → %s", (body, type, expected) => {
    expect(detectFdEvent(body, type).fdEvent).toBe(expected);
  });

  it("ignores FD words on the wrong side", () => {
    expect(detectFdEvent("Closure of TD A/c 1234", "debit").fdEvent).toBeNull();
    expect(detectFdEvent("FD through MOBILE", "credit").fdEvent).toBeNull();
  });

  it("ignores ordinary transactions", () => {
    expect(detectFdEvent("Rs 500 spent at SWIGGY", "debit").fdEvent).toBeNull();
    expect(detectFdEvent("Salary credited", "credit").fdEvent).toBeNull();
  });

  it("captures the deposit number", () => {
    expect(detectFdEvent("Closure of TD A/c XXXXX031705.-SBI", "credit").fdNumber).toBe("031705");
  });
});

describe("extractCounterpartyName", () => {
  it.each([
    ["-Deposit by transfer from Mr. RAHULVERMA", "RAHULVERMA"],
    ["-Transferred to Mr. RAHULVERMA", "RAHULVERMA"],
    ["by a/c linked to mobile 9XXXXXX963-RAHUL VER (IMPS Ref# 627344741256)", "RAHUL VER"],
    ["by trf from ACME PRIVATE LTD", "ACME PRIVATE LTD"],
  ])("%s → %s", (text, name) => {
    expect(extractCounterpartyName(text)).toBe(name);
  });

  it("returns null when there's no name", () => {
    expect(extractCounterpartyName("on account of Closure of TD A/c XXXXX031705")).toBeNull();
  });
});

describe("namesMatch", () => {
  it("normalises honorifics, case and spaces", () => {
    expect(normalizeName("Mr. Rahul Verma")).toBe("RAHULVERMA");
    expect(normalizeName("Mr.RAHULVERMA")).toBe("RAHULVERMA");
  });

  it.each([
    ["RAHULVERMA", "Rahul Verma", true],
    ["RAHUL VER", "Rahul Verma", true],
    ["Mr. RAHUL VERMA", "RAHUL VERMA", true],
    ["RAHUL", "Rahul Verma", false],
    ["RAHUL SHARMA", "Rahul Verma", false],
    ["", "Rahul Verma", false],
  ])("%s vs %s → %s", (a, b, expected) => {
    expect(namesMatch(a, b)).toBe(expected);
  });

  it("matchesAnySelfName handles null and lists", () => {
    expect(matchesAnySelfName(null, ["Rahul Verma"])).toBe(false);
    expect(matchesAnySelfName("RAHULVERMA", ["Priya Verma", "Rahul Verma"])).toBe(true);
  });
});

describe("detectSip", () => {
  it("NACH to a clearing house or fund house is a SIP", () => {
    expect(detectSip("nach_debit", "BSE STAR MF", "")).toBe(true);
    expect(detectSip("nach_debit", "PARAG PARIKH MUTUAL FUND", "")).toBe(true);
    expect(detectSip("standing_instruction", null, "towards ICICI PRUDENTIAL MF")).toBe(true);
  });

  it("a plain debit needs a SIP / mandate / autopay word", () => {
    expect(detectSip("debit", "HDFC MUTUAL FUND", "Rs 5000 debited to HDFC MUTUAL FUND")).toBe(false);
    expect(detectSip("upi_debit", "GROWW", "UPI AutoPay mandate executed for GROWW SIP")).toBe(true);
  });

  it("non-MF auto-debits aren't SIPs", () => {
    expect(detectSip("nach_debit", "NETFLIX", "")).toBe(false);
    expect(detectSip("nach_debit", "HDFC LIFE INSURANCE", "")).toBe(false);
    expect(detectSip("credit", "BSE STAR MF", "")).toBe(false);
  });

  it("labels the fund house", () => {
    expect(sipFundLabel("PARAG PARIKH MUTUAL FUND", "")).toBe("PARAG PARIKH MUTUAL FUND");
    expect(sipFundLabel("BSE STAR MF", "")).toBe("BSE STAR MF");
  });
});

describe("inferDirection", () => {
  const { inferDirection } = jest.requireActual("../../services/sms/money-signals");
  it.each([
    ["your a/c credited rs.500", "credit"],
    ["rs.500 debited from a/c xx12", "debit"],
    ["rs.200 spent on card at swiggy", "debit"],
    ["refund of rs.300 processed", "refund"],
    ["cashback of rs.20 added", "refund"],
    ["rs.500 debited from a/c xx12 and credited to ramesh", "debit"],
    ["a/c xx12 credited with rs.500 by transfer, debited a/c xx99", "credit"],
  ])("%s → %s", (text, type) => {
    const amountAt = text.indexOf("rs.");
    expect(inferDirection(text, amountAt >= 0 ? amountAt : undefined).type).toBe(type);
  });
  it("is unsure without direction words", () => {
    expect(inferDirection("rs.500 at shop")).toEqual({ type: "debit", confident: false });
  });
});

describe("detectInvestmentWithdrawal", () => {
  it.each([
    ["credit", null, "Rs 1,50,000 credited to A/c XX12 - ICCL MF REDEMPTION"],
    ["upi_credit", "ZERODHA BROKING", "Rs 20,000 credited to A/c XX12 from ZERODHA BROKING"],
    ["credit", null, "INR 80,000 credited - PPF withdrawal from A/c 1234"],
    ["credit", null, "Amount of Rs 2,40,000 credited towards EPF claim settlement"],
    ["credit", "PARAG PARIKH MUTUAL FUND", "INR 5,000 credited by PARAG PARIKH MUTUAL FUND"],
  ])("%s from %s is a withdrawal", (type, merchant, body) => {
    expect(detectInvestmentWithdrawal(type, merchant, body)).toBe(true);
  });

  it("dividends, interest and refunds are income, not withdrawals", () => {
    expect(detectInvestmentWithdrawal("credit", null, "Rs 50 credited ACH*IPL FNLDIV dividend")).toBe(false);
    expect(detectInvestmentWithdrawal("credit", "ZERODHA", "Interest credited Rs 12")).toBe(false);
  });

  it("only credits count", () => {
    expect(detectInvestmentWithdrawal("debit", null, "ICCL MF REDEMPTION")).toBe(false);
  });

  it("ordinary credits aren't withdrawals", () => {
    expect(detectInvestmentWithdrawal("credit", "ACME PVT LTD", "Salary for Sep credited")).toBe(false);
  });
});
