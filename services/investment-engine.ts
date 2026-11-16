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

/** Months in one compounding period. */
const PERIOD_MONTHS: Record<CompoundingFreq, number> = {
  monthly: 1,
  quarterly: 3,
  annually: 12,
};

/** Banks reckon the year at 365 days for FD interest, leap years included (RBI/IBA). */
const DAYS_IN_YEAR = 365;

/** Below this many months a deposit earns simple interest, paid at maturity, whatever its type. */
const SIMPLE_INTEREST_BELOW_MONTHS = 6;

function parseIso(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate + "T00:00:00Z").getTime();
  const end = new Date(endDate + "T00:00:00Z").getTime();
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

/** Adds calendar months the way banks date an FD: the same day of the month, clamped to the month's end (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsClamped(iso: string, months: number): string {
  const [y, m, d] = parseIso(iso);
  const totalMonths = y * 12 + (m - 1) + months;
  const ny = Math.floor(totalMonths / 12);
  const nm = totalMonths - ny * 12; // 0-based
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${String(ny).padStart(4, "0")}-${String(nm + 1).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  const t = new Date(iso + "T00:00:00Z").getTime() + days * 24 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

/** An FD's term as the bank states it: years, months and days. */
export interface FDTerm {
  years: number;
  months: number;
  days: number;
}

/** The maturity date for a term: months (years × 12 + months) are added first, then days. */
export function addFDTerm(startDate: string, term: FDTerm): string {
  const months = Math.max(0, Math.floor(term.years || 0)) * 12 + Math.max(0, Math.floor(term.months || 0));
  return addDays(addMonthsClamped(startDate, months), Math.max(0, Math.floor(term.days || 0)));
}

/** The term between two dates: the most whole calendar months that fit, then the days left over. Inverse of addFDTerm. */
export function fdTermBetween(startDate: string, endDate: string): FDTerm {
  if (endDate <= startDate) return { years: 0, months: 0, days: 0 };
  const [sy, sm] = parseIso(startDate);
  const [ey, em] = parseIso(endDate);
  let months = (ey - sy) * 12 + (em - sm);
  while (months > 0 && addMonthsClamped(startDate, months) > endDate) months--;
  const days = daysBetween(addMonthsClamped(startDate, months), endDate);
  return { years: Math.floor(months / 12), months: months % 12, days };
}

/** "1 year 6 months 17 days" — zero parts left out. */
export function formatFDTerm(term: FDTerm): string {
  const parts: string[] = [];
  const add = (n: number, unit: string) => {
    if (n > 0) parts.push(`${n} ${unit}${n === 1 ? "" : "s"}`);
  };
  add(term.years, "year");
  add(term.months, "month");
  add(term.days, "day");
  return parts.length > 0 ? parts.join(" ") : "0 days";
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

/**
 * Raw (unrounded) interest for the FD's full tenure, the way Indian banks
 * compute it (docs/FD_IMPROVEMENTS_PROPOSAL.md section A):
 *   - simple interest, or any deposit shorter than 6 months: P × r × days / 365
 *   - otherwise: compounded once per COMPLETED period (quarter by default),
 *     counted in calendar months from the start date, and the leftover days
 *     (the "broken period") earn simple interest on the compounded amount at
 *     days / 365.
 * An earlier version used days / 365.25 with fractional compounding, which
 * left exact-year FDs about ₹5 per lakh short of the bank's figure.
 */
function computeFDInterestRaw(params: FDParams): number {
  const { principal, interest_rate_pa, start_date, maturity_date, interest_method, compounding_freq } = params;
  const days = daysBetween(start_date, maturity_date);
  const r = interest_rate_pa / 100;

  if (!(days > 0) || !Number.isFinite(days)) return 0;

  if (interest_method === "simple" || maturity_date < addMonthsClamped(start_date, SIMPLE_INTEREST_BELOW_MONTHS)) {
    return (principal * r * days) / DAYS_IN_YEAR;
  }

  const step = PERIOD_MONTHS[compounding_freq ?? "quarterly"];
  let periods = 0;
  while (addMonthsClamped(start_date, step * (periods + 1)) <= maturity_date) periods++;
  let amount = principal * Math.pow(1 + (r * step) / 12, periods);
  const brokenDays = daysBetween(addMonthsClamped(start_date, step * periods), maturity_date);
  amount += (amount * r * brokenDays) / DAYS_IN_YEAR;
  return amount - principal;
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
  if (!(daysBetween(params.start_date, params.maturity_date) > 0)) return round2(params.principal);
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
