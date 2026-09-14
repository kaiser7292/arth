/**
 * "Hide amounts" privacy mode — formatAmount/formatCompact/formatNumber
 * must mask real digits when the flag is on, and the mask must not vary
 * with the amount's magnitude (a fixed-length mask can't leak how big the
 * number is, the way a password field's dots don't reveal password length).
 */
jest.mock("../../services/privacy-mode", () => ({
  isAmountsHidden: jest.fn(() => false),
}));
jest.mock("../../services/locale-preferences", () => ({
  getCurrency: () => "INR",
  getNumberGrouping: () => "indian",
}));

import { formatAmount, formatCompact, formatNumber } from "../../utils/format";
import { isAmountsHidden } from "../../services/privacy-mode";

const mockedIsHidden = isAmountsHidden as jest.Mock;

describe("amount masking (hide-amounts privacy mode)", () => {
  afterEach(() => mockedIsHidden.mockReturnValue(false));

  it("formatAmount shows real digits when not hidden", () => {
    expect(formatAmount(150000)).toMatch(/\d/);
  });

  it("formatAmount masks the digits but keeps the currency symbol when hidden", () => {
    mockedIsHidden.mockReturnValue(true);
    const masked = formatAmount(150000);
    expect(masked).not.toMatch(/\d/);
    expect(masked).toContain("₹");
  });

  it("formatCompact masks fully when hidden", () => {
    mockedIsHidden.mockReturnValue(true);
    expect(formatCompact(250000)).not.toMatch(/\d/);
  });

  it("formatNumber masks fully when hidden", () => {
    mockedIsHidden.mockReturnValue(true);
    expect(formatNumber(12345)).not.toMatch(/\d/);
  });

  it("the mask doesn't vary with the amount's magnitude", () => {
    mockedIsHidden.mockReturnValue(true);
    expect(formatAmount(5)).toBe(formatAmount(50000000));
    expect(formatCompact(5)).toBe(formatCompact(50000000));
  });

  it("negative amounts don't leak their sign through the mask", () => {
    mockedIsHidden.mockReturnValue(true);
    expect(formatAmount(-5000)).toBe(formatAmount(5000));
  });
});
