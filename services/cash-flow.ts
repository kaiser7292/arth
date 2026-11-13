import { getCurrentMonth } from "@/services/budget";
import { getMyMonth } from "@/services/my-month";
import { investmentReturns } from "@/services/reports/year-review";

/**
 * Money in and out over any run of months: My Month's sum, month by month and added up, so a month
 * reads the same here as it does on My Month. Investing counts as going out, because the money has
 * left your accounts; "Where it went" shows it apart from spending. Money taken back out of an
 * investment is netted against what went in, so redeeming and reinvesting the same money counts
 * once; when more came back than went in, the difference shows under "Where it came from".
 */
export interface CashFlowMonth {
  month: string;
  cameIn: number;
  wentOut: number;
  left: number;
}

export interface CashFlow {
  /** Oldest first. */
  months: CashFlowMonth[];
  cameIn: number;
  income: number;
  otherIn: number;
  repaid: number;
  wentOut: number;
  /** Put into investments, less what came back out (never below 0). */
  invested: number;
  /** Put into investments before netting. */
  investedGross: number;
  /** Taken out of investments into a bank or wallet. */
  investedBack: number;
  /** More came out of investments than went in: counted as money in. */
  fromInvestments: number;
  spent: number;
  /** Balance adjustments: money out, and money in (also inside cameIn), kept out of budgets. */
  adjusted: number;
  adjustedIn: number;
  forOthers: number;
  left: number;
  categories: { categoryId: string | null; name: string; total: number }[];
  waitingForReview: number;
  /** The latest month's income hasn't come yet, so being short so far says little. */
  incomeStillDue: boolean;
}

/** Every YYYY-MM from start to end, both included. Empty when they're the wrong way round. */
export function monthsBetween(startMonth: string, endMonth: string): string[] {
  const out: string[] = [];
  let [y, m] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export async function getCashFlow(
  userId: string,
  startMonth: string,
  endMonth: string,
  currentMonth: string = getCurrentMonth(),
): Promise<CashFlow> {
  // Months that haven't happened have nothing to show.
  const lastMonth = endMonth > currentMonth ? currentMonth : endMonth;
  const flow: CashFlow = {
    months: [],
    cameIn: 0,
    income: 0,
    otherIn: 0,
    repaid: 0,
    wentOut: 0,
    invested: 0,
    investedGross: 0,
    investedBack: 0,
    fromInvestments: 0,
    spent: 0,
    adjusted: 0,
    adjustedIn: 0,
    forOthers: 0,
    left: 0,
    categories: [],
    waitingForReview: 0,
    incomeStillDue: false,
  };
  const categories = new Map<string, CashFlow["categories"][number]>();

  // One at a time: each month is several queries, and a long custom period would queue them all at once.
  for (const month of monthsBetween(startMonth, lastMonth)) {
    const d = await getMyMonth(userId, month);
    const back = await investmentReturns(userId, `${month}-01`, `${month}-31`);
    const netInvested = d.savedTotal - back;
    const cameIn = d.moneyIn + d.people.repaid + Math.max(0, -netInvested);
    const wentOut = Math.max(0, netInvested) + d.spent + d.people.billsShare + d.adjustedOut;
    flow.months.push({ month, cameIn, wentOut, left: cameIn - wentOut });
    flow.cameIn += cameIn;
    flow.income += d.salary;
    flow.otherIn += d.otherIncome;
    flow.repaid += d.people.repaid;
    flow.wentOut += wentOut;
    flow.invested += Math.max(0, netInvested);
    flow.investedGross += d.savedTotal;
    flow.investedBack += back;
    flow.fromInvestments += Math.max(0, -netInvested);
    flow.spent += d.spent;
    flow.adjusted += d.adjustedOut;
    flow.adjustedIn += d.adjustedIn;
    flow.forOthers += d.people.billsShare;
    flow.waitingForReview += d.waitingForReview;
    flow.incomeStillDue = d.salaryDue != null;
    for (const c of d.categories) {
      const key = c.categoryId ?? "none";
      const seen = categories.get(key);
      if (seen) seen.total += c.total;
      else categories.set(key, { ...c });
    }
  }
  flow.left = flow.cameIn - flow.wentOut;
  flow.categories = [...categories.values()].sort((a, b) => b.total - a.total);
  return flow;
}
