/**
 * Report numbers (Settings → Region): full by default, or short to two places ("₹24.92L"), for
 * the crore-sized figures a full number can't fit.
 */
let mockReportStyle: "full" | "short" = "full";
let mockShortStyle: "lakh" | "million" = "lakh";
let mockDecimals: "show" | "round" = "show";
jest.mock("../../services/privacy-mode", () => ({
  isAmountsHidden: jest.fn(() => false),
}));
jest.mock("../../services/locale-preferences", () => ({
  getCurrency: () => "INR",
  getNumberGrouping: () => "indian",
  getShortAmountStyle: () => mockShortStyle,
  getReportAmountStyle: () => mockReportStyle,
  getDecimalsStyle: () => mockDecimals,
}));

import { formatAmount, formatExactAmount, formatReportAmount, formatReportShort } from "../../utils/format";
import { isAmountsHidden } from "../../services/privacy-mode";

afterEach(() => {
  mockReportStyle = "full";
  mockShortStyle = "lakh";
  mockDecimals = "show";
  (isAmountsHidden as jest.Mock).mockReturnValue(false);
});

it("is the full figure until short is chosen", () => {
  expect(formatReportAmount(2492209.1)).toBe("₹24,92,209.10");
});

it("short: two places in lakh and crore, trailing zeros dropped", () => {
  mockReportStyle = "short";
  expect(formatReportAmount(2492209.1)).toBe("₹24.92L");
  expect(formatReportShort(126400000)).toBe("₹12.64Cr");
  expect(formatReportShort(300000)).toBe("₹3L");
  expect(formatReportShort(65433.85)).toBe("₹65.43K");
  expect(formatReportShort(845.4)).toBe("₹845");
  expect(formatReportShort(-15230.99)).toBe("-₹15.23K");
});

it("short follows million and billion when chosen", () => {
  mockShortStyle = "million";
  expect(formatReportShort(2492209.1)).toBe("₹2.49M");
});

it("short still hides amounts in privacy mode", () => {
  (isAmountsHidden as jest.Mock).mockReturnValue(true);
  expect(formatReportShort(2492209.1)).not.toMatch(/\d/);
});

describe("Decimals (Settings → Region)", () => {
  it("Round off shows whole amounts; Show keeps the paise", () => {
    expect(formatAmount(159017.45)).toBe("₹1,59,017.45");
    mockDecimals = "round";
    expect(formatAmount(159017.45)).toBe("₹1,59,017");
    expect(formatAmount(-0.4)).toBe("₹0");
  });
  it("exact amounts ignore it (ledger balances, Update balances)", () => {
    mockDecimals = "round";
    expect(formatExactAmount(159017.45)).toBe("₹1,59,017.45");
  });
});
