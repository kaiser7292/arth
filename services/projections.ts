import { computeUnseededBalance, getComputedBalances } from "@/services/account-balance";
import { getCurrentMonth } from "@/services/budget";
import { getActiveAccounts } from "@/services/financial-account";
import { getMyMonth } from "@/services/my-month";
import { getEntriesForScenario, listActiveScenarios, type SimulationScenario } from "@/services/simulator";
import { todayIso } from "@/utils/date";

/**
 * Projections: where your bank and wallet money is heading, month by month, for the next year.
 *
 * The starting line is what Arth already knows: today's bank + wallet balance, moved on each month
 * by what was left over in your last three complete months (money in, less spending, investing and
 * others' share of bills, as My Month counts it). That already holds salary, EMIs, rent and every
 * habit, without asking for anything.
 *
 * What-ifs are the simulator's scenarios: each one's planned entries (a car in March, a bonus in
 * June) move the line from the month they land in. They can be switched on and off, so "what if
 * both?" is two taps.
 */

export const PROJECTION_MONTHS = 12;
const HISTORY_MONTHS = 3;

export interface ProjectionMonth {
  /** YYYY-MM; the balance is at its end. */
  month: string;
  baseline: number;
  /** With the switched-on what-ifs. Equal to baseline when none are on. */
  withWhatIfs: number;
}

export interface ProjectionScenario {
  scenario: SimulationScenario;
  /** Planned money in and out still ahead, inside the projection. */
  plannedIn: number;
  plannedOut: number;
  count: number;
}

export interface Projection {
  startBalance: number;
  /** Average left over per month in the months it's based on (negative = more went out). */
  monthlyLeft: number;
  basedOn: string[];
  months: ProjectionMonth[];
  scenarios: ProjectionScenario[];
}

function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Today's bank + wallet total, from the ledger (unseeded accounts chain up from ₹0, as on Home). */
async function bankAndWalletToday(userId: string): Promise<number> {
  const accounts = (await getActiveAccounts(userId)).filter((a) =>
    ["savings", "bank", "wallet"].includes(a.account_type as string),
  );
  if (accounts.length === 0) return 0;
  const computed = await getComputedBalances(accounts.map((a) => a.id));
  const month = getCurrentMonth();
  let total = 0;
  for (const a of accounts) {
    const c = computed[a.id];
    total += c != null ? c : (await computeUnseededBalance(a.id, month)).closing;
  }
  return total;
}

/** Signed effect on bank + wallet: money between your own accounts moves nothing. */
function entryEffect(e: { direction: "in" | "out"; amount: number; from_account_id: string | null; to_account_id: string | null }): number {
  if (e.from_account_id && e.to_account_id) return 0;
  return e.direction === "in" ? e.amount : -e.amount;
}

export async function getProjection(userId: string, activeScenarioIds: ReadonlySet<string>): Promise<Projection> {
  const current = getCurrentMonth();
  const today = todayIso();
  const basedOn = Array.from({ length: HISTORY_MONTHS }, (_, i) => addMonths(current, -(i + 1))).reverse();

  const [startBalance, history, scenarios] = await Promise.all([
    bankAndWalletToday(userId),
    Promise.all(basedOn.map((m) => getMyMonth(userId, m))),
    listActiveScenarios(userId),
  ]);
  // Months with nothing at all (before you started) would drag the average to zero.
  const used = history.filter((h) => h.moneyIn > 0 || h.spent > 0);
  const monthlyLeft = used.length > 0 ? used.reduce((s, h) => s + h.leftOver, 0) / used.length : 0;

  const lastMonth = addMonths(current, PROJECTION_MONTHS - 1);
  const byScenario = await Promise.all(
    scenarios.map(async (scenario) => {
      const entries = (await getEntriesForScenario(scenario.id)).filter(
        (e) => e.status === "upcoming" && e.date >= today && e.date.slice(0, 7) <= lastMonth,
      );
      return { scenario, entries };
    }),
  );

  const whatIfByMonth = new Map<string, number>();
  for (const { scenario, entries } of byScenario) {
    if (!activeScenarioIds.has(scenario.id)) continue;
    for (const e of entries) {
      const m = e.date.slice(0, 7);
      whatIfByMonth.set(m, (whatIfByMonth.get(m) ?? 0) + entryEffect(e));
    }
  }

  // This month only has its remaining days to go.
  const [y, m] = current.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const dayToday = Number(today.slice(8, 10));
  const restOfThisMonth = Math.max(0, (daysInMonth - dayToday) / daysInMonth);

  const months: ProjectionMonth[] = [];
  let baseline = startBalance;
  let withWhatIfs = startBalance;
  for (let i = 0; i < PROJECTION_MONTHS; i++) {
    const month = addMonths(current, i);
    const step = monthlyLeft * (i === 0 ? restOfThisMonth : 1);
    baseline += step;
    withWhatIfs += step + (whatIfByMonth.get(month) ?? 0);
    months.push({ month, baseline: Math.round(baseline), withWhatIfs: Math.round(withWhatIfs) });
  }

  return {
    startBalance,
    monthlyLeft,
    basedOn: used.length > 0 ? basedOn.filter((_, i) => history[i].moneyIn > 0 || history[i].spent > 0) : [],
    months,
    scenarios: byScenario.map(({ scenario, entries }) => ({
      scenario,
      plannedIn: entries.filter((e) => entryEffect(e) > 0).reduce((s, e) => s + e.amount, 0),
      plannedOut: entries.filter((e) => entryEffect(e) < 0).reduce((s, e) => s + e.amount, 0),
      count: entries.length,
    })),
  };
}
