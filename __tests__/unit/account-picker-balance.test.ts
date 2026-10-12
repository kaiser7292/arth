/**
 * The number shown beside an account in pickers: ledger balance for bank accounts, the limit
 * still available for credit cards (pooled per bank).
 */

jest.mock("../../constants/app", () => ({ DEFAULT_USER_ID: "user-1" }));
jest.mock("../../services/account-balance", () => ({ getComputedBalances: jest.fn() }));
jest.mock("../../services/financial-account", () => ({ getActiveAccounts: jest.fn() }));
jest.mock("../../utils/format", () => ({ formatAmount: (n: number) => `Rs${n}` }));

import { resolvePickerBalances, withPickerBalance } from "../../services/account-picker-balance";

const acct = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  account_type: "savings" as const,
  bank_name: "HDFC",
  credit_limit: null,
  last_known_balance: null,
  ...over,
});
const cc = (id: string, over: Record<string, unknown> = {}) =>
  acct(id, { account_type: "credit_card", credit_limit: 100000, ...over });

describe("resolvePickerBalances", () => {
  it("uses the ledger balance for a bank account", () => {
    expect(resolvePickerBalances([acct("a", { last_known_balance: 10 })], [], { a: 500 })).toEqual({ a: 500 });
  });

  it("falls back to the last SMS balance while unseeded, else nothing", () => {
    const out = resolvePickerBalances([acct("a", { last_known_balance: 10 }), acct("b")], [], { a: null, b: null });
    expect(out).toEqual({ a: 10, b: null });
  });

  it("shows a credit card's available limit", () => {
    const card = cc("c");
    expect(resolvePickerBalances([card], [card], { c: 30000 })).toEqual({ c: 70000 });
  });

  it("pools cards of the same bank, including ones the picker isn't listing", () => {
    const one = cc("c1");
    const two = cc("c2", { credit_limit: null });
    const other = cc("c3", { bank_name: "ICICI", credit_limit: 50000 });
    const out = resolvePickerBalances([one, other], [one, two, other], { c1: 30000, c2: 20000, c3: 5000 });
    expect(out).toEqual({ c1: 50000, c3: 45000 });
  });

  it("shows nothing for a card with no limit set", () => {
    const card = cc("c", { credit_limit: null });
    expect(resolvePickerBalances([card], [card], { c: 30000 })).toEqual({ c: null });
  });
});

describe("withPickerBalance", () => {
  it("appends the bare amount", () => {
    expect(withPickerBalance("Savings · HDFC", 500)).toBe("Savings · HDFC · Rs500");
    expect(withPickerBalance("", 500)).toBe("Rs500");
  });

  it("leaves the text alone when there is no balance", () => {
    expect(withPickerBalance("Savings", null)).toBe("Savings");
  });
});
