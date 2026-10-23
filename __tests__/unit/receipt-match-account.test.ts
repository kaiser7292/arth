jest.mock("@/database", () => ({ getDatabase: () => ({}) }));
import { matchAccount, type OwnAccount } from "../../services/receipt/receipt-to-transaction";

const A = (id: string, bank_name: string, account_identifier: string | null, account_type = "savings", account_label: string | null = null, upi_ids: string[] = []): OwnAccount => ({
  id,
  bank_name,
  account_identifier,
  account_type,
  account_label,
  upi_ids,
});

const accounts = [
  A("hdfc", "HDFC Bank", "0221", "savings", null, ["asha@okhdfcbank"]),
  A("hdfc-2", "HDFC Bank", "7788", "savings", null, ["asha.m@ybl", "98xxxxxx01@ybl"]),
  A("icici", "ICICI Bank", "9304"),
  A("hdfc-cc", "HDFC Bank", "322", "credit_card"),
  A("amazon", "Amazon Pay", "0000", "wallet", "Amazon Pay"),
  A("paytm", "Paytm", "0000", "wallet"),
];

describe("matchAccount", () => {
  it("by digits, with the bank", () => {
    expect(matchAccount({ label: "HDFC Bank", last4: "0221", wallet: false }, accounts, null)?.id).toBe("hdfc");
  });
  it("by the last 3 digits (XX7322 is the card stored as 322)", () => {
    expect(matchAccount({ label: "HDFC Bank", last4: "7322", wallet: false }, accounts, null)?.id).toBe("hdfc-cc");
  });
  it("a gift card balance in Amazon Pay is the Amazon Pay wallet", () => {
    expect(matchAccount({ label: "Gift Cards", last4: null, wallet: true }, accounts, "Amazon Pay")?.id).toBe("amazon");
  });
  it("a bank with only one account, by name", () => {
    expect(matchAccount({ label: "ICICI Bank", last4: null, wallet: false }, accounts, null)?.id).toBe("icici");
  });
  it("doesn't guess between two accounts at one bank", () => {
    expect(matchAccount({ label: "HDFC Bank", last4: null, wallet: false }, accounts, null)).toBeNull();
  });
  it("a linked UPI ID decides it, even when the hint is unclear", () => {
    expect(matchAccount({ label: "HDFC Bank", last4: null, wallet: false }, accounts, null, "asha.m@ybl")?.id).toBe("hdfc-2");
    expect(matchAccount(null, accounts, "PhonePe", "98XXXXXX01@ybl")?.id).toBe("hdfc-2");
  });
  it("an unlinked UPI ID falls back to the hint", () => {
    expect(matchAccount({ label: "HDFC Bank", last4: "0221", wallet: false }, accounts, null, "someone@okaxis")?.id).toBe("hdfc");
  });
  it("nothing for digits no account has", () => {
    expect(matchAccount({ label: "SBI", last4: "5150", wallet: false }, accounts, null)).toBeNull();
  });
});
