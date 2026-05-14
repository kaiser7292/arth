/**
 * Capital Gains Reference Data — FY 2025-26
 *
 * Static reference for LTCG/STCG tax rates across asset classes.
 * Update yearly when Union Budget changes apply.
 */

export interface CapitalGainsRate {
  assetClass: string;
  icon: string; // Ionicons name
  holdingPeriod: string; // e.g. "12 months" for equity
  ltcgRate: string;
  stcgRate: string;
  exemption: string | null;
  notes: string;
}

export const CAPITAL_GAINS_FY = "2025-26";

export const CAPITAL_GAINS_RATES: CapitalGainsRate[] = [
  {
    assetClass: "Listed Equity & Equity MFs",
    icon: "trending-up-outline",
    holdingPeriod: "12 months",
    ltcgRate: "12.5%",
    stcgRate: "20%",
    exemption: "LTCG up to Rs 1.25L/year is exempt",
    notes:
      "Applies to listed shares, equity mutual funds, and equity-oriented hybrid funds. STT must be paid on sale.",
  },
  {
    assetClass: "Debt Mutual Funds",
    icon: "document-text-outline",
    holdingPeriod: "N/A (no LTCG benefit)",
    ltcgRate: "Slab rate",
    stcgRate: "Slab rate",
    exemption: null,
    notes:
      "Post April 2023: No indexation benefit. All gains taxed at your income tax slab rate regardless of holding period.",
  },
  {
    assetClass: "Fixed Deposits",
    icon: "lock-closed-outline",
    holdingPeriod: "N/A",
    ltcgRate: "Slab rate",
    stcgRate: "Slab rate",
    exemption: "Up to Rs 40K interest exempt (Rs 50K for senior citizens) under Sec 80TTA/80TTB",
    notes:
      "FD interest is taxed as income from other sources at your slab rate. TDS deducted at 10% if interest exceeds Rs 40K/year.",
  },
  {
    assetClass: "Gold & Gold ETFs",
    icon: "diamond-outline",
    holdingPeriod: "24 months",
    ltcgRate: "12.5%",
    stcgRate: "Slab rate",
    exemption: null,
    notes:
      "Physical gold, gold ETFs, and sovereign gold bonds. SGBs held to maturity are fully tax-exempt on capital gains.",
  },
  {
    assetClass: "Real Estate",
    icon: "home-outline",
    holdingPeriod: "24 months",
    ltcgRate: "12.5%",
    stcgRate: "Slab rate",
    exemption: "Sec 54/54F exemption on reinvestment in residential property",
    notes:
      "Post Budget 2024: Indexation removed. Flat 12.5% LTCG. STCG taxed at slab rate.",
  },
  {
    assetClass: "International Equity MFs",
    icon: "globe-outline",
    holdingPeriod: "N/A (no LTCG benefit)",
    ltcgRate: "Slab rate",
    stcgRate: "Slab rate",
    exemption: null,
    notes:
      "Fund of funds investing in foreign equities treated as debt funds. No indexation. Taxed at slab rate.",
  },
  {
    assetClass: "NPS (National Pension System)",
    icon: "shield-checkmark-outline",
    holdingPeriod: "Till retirement",
    ltcgRate: "60% tax-free on maturity",
    stcgRate: "N/A",
    exemption: "Sec 80CCD(1B): Additional Rs 50K deduction beyond 80C",
    notes:
      "On maturity: 60% lump sum is tax-free, 40% must go to annuity (taxed as income when received).",
  },
];
