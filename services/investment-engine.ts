/**
 * Investment engine (docs/INVESTMENT_ACCOUNTS_PROPOSAL.md) — pure interest +
 * schedule math, no DB. v1 scope is FD only (`instrument='fd'`,
 * `payout_mode='cumulative'`) — RD and periodic payouts are out of scope.
 *
 * Modeled on services/loan-engine.ts: an FD is a loan in reverse, so the
 * schedule shape (dated rows carrying status) is the same, just with one
 * row instead of many, since a cumulative FD has a single maturity event.
 */

import { generateUUID } from "@/utils/uuid";

export type InterestMethod = "simple" | "compound";
export type CompoundingFreq = "monthly" | "quarterly" | "annually";

export interface FDParams {
  principal: number;
  interest_rate_pa: number;    // e.g. 7.1 (percent)
  start_date: string;          // YYYY-MM-DD
  maturity_date: string;       // YYYY-MM-DD
  interest_method: InterestMethod;
  compounding_freq?: CompoundingFreq; // required when interest_method='compound'
}

export interface InvestmentScheduleEntry {
  id: string;
  event_num: number;
  event_date: string;          // YYYY-MM-DD
  kind: "maturity" | "interest_payout";
  principal_component: number;
  interest_component: number;
  status: "scheduled" | "materialised" | "skipped";
}

const COMPOUNDING_PERIODS_PER_YEAR: Record<CompoundingFreq, number> = {
  monthly: 12,
  quarterly: 4,
  annually: 1,
};

function yearsBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate + "T00:00:00Z").getTime();
  const end = new Date(endDate + "T00:00:00Z").getTime();
  return (end - start) / (365.25 * 24 * 60 * 60 * 1000);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Rounds to the nearest whole rupee with a "half rounds down" rule — a
 * fractional part of exactly 0.5 rounds down, anything above 0.5 rounds up
 * (the opposite of JS's Math.round, which rounds 0.5 up). Applied to FD
 * interest specifically, at the user's request, rather than the generic
 * round2() used elsewhere for paise-precision amounts.
 */
function roundHalfDown(n: number): number {
  return Math.ceil(n - 0.5) || 0; // normalises -0 (e.g. from a zero/negative input) to 0
}

/** Raw (unrounded) interest for the FD's full tenure — simple: Prt, compound: P((1+r/n)^(nt) − 1). */
function computeFDInterestRaw(params: FDParams): number {
  const { principal, interest_rate_pa, start_date, maturity_date, interest_method, compounding_freq } = params;
  const t = yearsBetween(start_date, maturity_date);
  const r = interest_rate_pa / 100;

  if (t <= 0 || !Number.isFinite(t)) return 0;

  if (interest_method === "simple") {
    return principal * r * t;
  }

  const n = COMPOUNDING_PERIODS_PER_YEAR[compounding_freq ?? "quarterly"];
  return principal * (Math.pow(1 + r / n, n * t) - 1);
}

/** Interest for the FD's full tenure, rounded to the nearest whole rupee (see roundHalfDown). */
export function computeFDInterest(params: FDParams): number {
  return roundHalfDown(computeFDInterestRaw(params));
}

/**
 * Maturity value of a cumulative FD: principal (paise-precision, as entered)
 * plus the whole-rupee-rounded interest — see computeFDInterest. Computing it
 * this way (rather than rounding principal+rawInterest as one figure) keeps
 * this value and generateFDSchedule's interest_component exactly consistent
 * by construction, since both derive from the same computeFDInterest call.
 */
export function computeFDMaturityValue(params: FDParams): number {
  const t = yearsBetween(params.start_date, params.maturity_date);
  if (t <= 0 || !Number.isFinite(t)) return round2(params.principal);
  return round2(params.principal) + computeFDInterest(params);
}

/**
 * Generates the (single-row, v1) schedule for a cumulative FD: one
 * 'maturity' event carrying both the principal and interest components,
 * since a cumulative FD pays everything out at maturity. Kept as a list
 * (not a single object) because the schema/materialisation pass are built
 * for periodic instruments too — v1 just never produces more than one row.
 */
export function generateFDSchedule(params: FDParams): InvestmentScheduleEntry[] {
  return [
    {
      id: generateUUID(),
      event_num: 1,
      event_date: params.maturity_date,
      kind: "maturity",
      principal_component: round2(params.principal),
      interest_component: computeFDInterest(params),
      status: "scheduled",
    },
  ];
}

/**
 * Current value of a contract-valuation product: the principal while active
 * (an FD doesn't accrue visibly day to day, it steps at maturity), and zero
 * once matured or closed — materialisation moves the principal out via a
 * real transfer and credits interest to a different account, so the FD
 * account's own balance is genuinely zero from that point on, not the
 * maturity value (that value lived here for an instant and then left).
 */
export function currentFDValue(principal: number, status: "active" | "matured" | "closed"): number {
  return status === "active" ? round2(principal) : 0;
}
