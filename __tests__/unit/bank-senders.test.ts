import {
  isBankSender,
  identifyBank,
  looksLikeTransaction,
} from "../../services/sms/bank-senders";

describe("isBankSender", () => {
  it("recognizes ICICI sender", () => {
    expect(isBankSender("AD-ICICIB")).toBe(true);
    expect(isBankSender("VM-ICICIB")).toBe(true);
    expect(isBankSender("JD-ICICIS")).toBe(true);
  });

  it("recognizes HDFC sender", () => {
    expect(isBankSender("AD-HDFCBK")).toBe(true);
    expect(isBankSender("VM-HDFCBN")).toBe(true);
  });

  it("recognizes Axis sender", () => {
    expect(isBankSender("AD-AXISBK")).toBe(true);
    expect(isBankSender("JM-AXISBK")).toBe(true);
  });

  it("recognizes SBI sender", () => {
    expect(isBankSender("AX-SBIINB")).toBe(true);
  });

  it("recognizes Paytm sender", () => {
    expect(isBankSender("AD-PAYTMB")).toBe(true);
  });

  it("rejects non-bank senders", () => {
    expect(isBankSender("+919876543210")).toBe(false);
    expect(isBankSender("AD-AMAZON")).toBe(false);
    expect(isBankSender("SWIGGY")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isBankSender("ad-icicib")).toBe(true);
    expect(isBankSender("AD-hdfcbk")).toBe(true);
  });
});

describe("identifyBank", () => {
  it("identifies ICICI Bank", () => {
    const result = identifyBank("AD-ICICIB");
    expect(result).not.toBeNull();
    expect(result!.bank).toBe("ICICI Bank");
  });

  it("identifies HDFC Bank", () => {
    const result = identifyBank("VM-HDFCBK");
    expect(result).not.toBeNull();
    expect(result!.bank).toBe("HDFC Bank");
  });

  it("identifies Axis Bank", () => {
    const result = identifyBank("AD-AXISBK");
    expect(result).not.toBeNull();
    expect(result!.bank).toBe("Axis Bank");
  });

  it("returns null for unknown sender", () => {
    expect(identifyBank("+919876543210")).toBeNull();
  });
});

describe("looksLikeTransaction", () => {
  it("detects ICICI CC spend SMS", () => {
    expect(
      looksLikeTransaction(
        "INR 492.50 spent using ICICI Bank Card XX3001 on 11-Apr-26 on ZOMATO LIMITED. Avl Limit: INR 1,55,855.32.",
      ),
    ).toBe(true);
  });

  it("detects Axis UPI debit SMS", () => {
    expect(
      looksLikeTransaction(
        "INR 1236.00 debited A/c no. XX2836 11-04-26, 15:39:39 UPI/P2M/565346001016/Blue Tokai Coffee R",
      ),
    ).toBe(true);
  });

  it("detects HDFC CC spend SMS", () => {
    expect(
      looksLikeTransaction(
        "Spent Rs.1646.5 On HDFC Bank Card 8957 At TATA PAYMENTS LIMITED On 2026-04-07:19:25:50.",
      ),
    ).toBe(true);
  });

  it("detects EMI reminder", () => {
    expect(
      looksLikeTransaction(
        "EMI of INR 22317.00 for Axis Bank Loan A/c XX7249 is due on 10-04-26.",
      ),
    ).toBe(true);
  });

  it("detects HDFC payment received", () => {
    expect(
      looksLikeTransaction(
        "DEAR HDFCBANK CARDMEMBER, PAYMENT OF Rs. 937.05 RECEIVED TOWARDS YOUR CREDIT CARD ENDING WITH 8957",
      ),
    ).toBe(true);
  });

  it("rejects personal SMS", () => {
    expect(looksLikeTransaction("Hey, how are you?")).toBe(false);
    expect(looksLikeTransaction("Meeting at 3pm tomorrow")).toBe(false);
  });

  it("rejects OTP messages (only 1 keyword match)", () => {
    // OTP has "INR" but no second financial keyword
    expect(
      looksLikeTransaction(
        "Your OTP is 613934 for login. Do not share.",
      ),
    ).toBe(false);
  });

  it("detects ICICI standing instruction SMS", () => {
    expect(
      looksLikeTransaction(
        "We have successfully processed payment of INR 199.00 to Merchant NETFLIX, as per Standing Instruction",
      ),
    ).toBe(true);
  });

  it("rejects promo SMS", () => {
    expect(
      looksLikeTransaction(
        "Get 50% off on your next order! Use code SAVE50. Shop now at example.com",
      ),
    ).toBe(false);
  });
});
