import { settingsStorage } from "@/services/storage";

/**
 * Where each investment could get to: what it's worth now, what you plan to add, and a yearly return
 * you choose per investment. This is arithmetic on assumptions, not a forecast or advice.
 */

/** Registered in SETTINGS_REGISTRY (services/backup-settings.ts). */
const KEY = "investment_projection_assumptions";

export interface LumpSum {
  /** YYYY-MM */
  month: string;
  amount: number;
}

export interface ProjectionAssumption {
  returnPct: number;
  monthly: number;
  lumpSums: LumpSum[];
}

export interface ProjectionPoint {
  /** Months from now. */
  month: number;
  value: number;
  /** Today's value plus everything added, so value minus this is the growth. */
  putIn: number;
}

const monthsFrom = (from: string, to: string) => {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
};

/**
 * Month by month: additions go in at the start of the month, then the month's growth applies. A yearly
 * return of R compounds to exactly R over 12 months. Lump sums dated in the past are ignored, because
 * they're already in today's value.
 */
export function projectInvestment(
  startValue: number,
  a: ProjectionAssumption,
  months: number,
  startMonth: string,
): ProjectionPoint[] {
  const monthlyRate = Math.pow(1 + a.returnPct / 100, 1 / 12) - 1;
  const lumpAt = new Map<number, number>();
  for (const l of a.lumpSums) {
    const at = monthsFrom(startMonth, l.month);
    if (at >= 0) lumpAt.set(at, (lumpAt.get(at) ?? 0) + l.amount);
  }
  const points: ProjectionPoint[] = [{ month: 0, value: startValue, putIn: startValue }];
  let value = startValue;
  let putIn = startValue;
  for (let m = 0; m < months; m++) {
    const added = a.monthly + (lumpAt.get(m) ?? 0);
    value = (value + added) * (1 + monthlyRate);
    putIn += added;
    points.push({ month: m + 1, value, putIn });
  }
  return points;
}

/** Adds several investments' projections together, month by month. They must cover the same months. */
export function combineProjections(lines: ProjectionPoint[][]): ProjectionPoint[] {
  if (lines.length === 0) return [];
  return lines[0].map((p, i) => ({
    month: p.month,
    value: lines.reduce((s, l) => s + l[i].value, 0),
    putIn: lines.reduce((s, l) => s + l[i].putIn, 0),
  }));
}

export function defaultReturnPct(kind: "fd" | "market" | "pension", fdRate?: number | null): number {
  if (kind === "fd") return fdRate && fdRate > 0 ? fdRate : 7;
  return kind === "pension" ? 8 : 12;
}

export function loadAssumptions(): Record<string, ProjectionAssumption> {
  const raw = settingsStorage.getString(KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveAssumption(accountId: string, a: ProjectionAssumption): void {
  settingsStorage.set(KEY, JSON.stringify({ ...loadAssumptions(), [accountId]: a }));
}
