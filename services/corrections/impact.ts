import { computeUnseededBalance, getComputedBalances } from "@/services/account-balance";
import { getCurrentMonth } from "@/services/budget";
import { getCashFlow } from "@/services/cash-flow";
import { getActiveAccounts } from "@/services/financial-account";
import { getMyMonth } from "@/services/my-month";
import { getSavingsSnapshot } from "@/services/savings-tracker";
import { getFYStartMonth } from "@/services/settings";
import { getCurrentFY } from "@/utils/fiscal-year";
import { getHealthReport } from "./health";

/**
 * The app's own figures, measured before and after corrections, so the impact report shows what
 * really moved: balances, this year's money in and out, this month's spending, savings rate and
 * data health. Each figure comes from the service the screens use.
 */

export interface Metric {
  id: string;
  label: string;
  value: number;
  /** How to show it. */
  unit: "money" | "percent" | "count";
  /** For counts and gaps: lower is better. */
  lowerIsBetter?: boolean;
}

export interface MetricChange extends Metric {
  before: number;
}

export async function measure(userId: string): Promise<Metric[]> {
  const out: Metric[] = [];
  const month = getCurrentMonth();
  const fyStart = getFYStartMonth();
  const fy = getCurrentFY(fyStart);
  const fyStartMonth = `${fyStart <= Number(month.slice(5, 7)) ? Number(month.slice(0, 4)) : Number(month.slice(0, 4)) - 1}-${String(fyStart).padStart(2, "0")}`;

  const attempt = async (f: () => Promise<void>) => {
    try {
      await f();
    } catch {
      // A figure that can't be measured is simply not shown.
    }
  };

  await attempt(async () => {
    const accounts = (await getActiveAccounts(userId)).filter((a) =>
      ["savings", "bank", "wallet", "credit_card"].includes(a.account_type as string),
    );
    const computed = await getComputedBalances(accounts.map((a) => a.id));
    for (const a of accounts) {
      const value = computed[a.id] ?? (await computeUnseededBalance(a.id, month)).closing;
      const name = `${a.account_label || a.bank_name}${a.account_identifier ? ` ··${a.account_identifier}` : ""}`;
      out.push({
        id: `balance:${a.id}`,
        label: a.account_type === "credit_card" ? `${name} dues` : name,
        value: Math.round(value * 100) / 100,
        unit: "money",
      });
    }
  });
  await attempt(async () => {
    const flow = await getCashFlow(userId, fyStartMonth, month);
    out.push(
      { id: "fy:in", label: "Came in this year", value: Math.round(flow.cameIn), unit: "money" },
      { id: "fy:spent", label: "Spent this year", value: Math.round(flow.spent), unit: "money" },
      { id: "fy:invested", label: "Invested this year", value: Math.round(flow.invested), unit: "money" },
      { id: "fy:left", label: "Left this year", value: Math.round(flow.left), unit: "money" },
    );
  });
  await attempt(async () => {
    const snap = await getSavingsSnapshot(userId, fy);
    if (snap) out.push({ id: "fy:rate", label: "Savings rate", value: Math.round(snap.actualSavingsRatePct * 10) / 10, unit: "percent" });
  });
  await attempt(async () => {
    const m = await getMyMonth(userId, month);
    out.push({ id: "month:spent", label: "Spent this month", value: Math.round(m.spent), unit: "money" });
  });
  await attempt(async () => {
    const h = await getHealthReport(userId);
    out.push({ id: "health:score", label: "Data health", value: h.score, unit: "percent" });
    const c = (id: string) => h.checks.find((x) => x.id === id)?.count ?? 0;
    out.push(
      { id: "health:uncategorised", label: "Uncategorised", value: c("uncategorised"), unit: "count", lowerIsBetter: true },
      { id: "health:duplicates", label: "Possible duplicates", value: c("duplicates"), unit: "count", lowerIsBetter: true },
      { id: "health:transfers", label: "Transfers counted as spending", value: c("transfers"), unit: "count", lowerIsBetter: true },
      { id: "health:spellings", label: "Merchants spelled several ways", value: c("merchant_spellings"), unit: "count", lowerIsBetter: true },
      { id: "health:mix", label: "Merchants in several categories", value: c("merchant_categories"), unit: "count", lowerIsBetter: true },
      { id: "health:gaps", label: "Balances differing from the bank", value: c("balance_gaps"), unit: "count", lowerIsBetter: true },
    );
  });
  return out;
}

/** Figures that moved (by at least ₹1 or 0.1 point), in the order they were measured. */
export function diffMetrics(before: Metric[], after: Metric[]): MetricChange[] {
  const was = new Map(before.map((m) => [m.id, m.value]));
  return after
    .filter((m) => was.has(m.id) && Math.abs((was.get(m.id) ?? 0) - m.value) >= (m.unit === "money" ? 1 : 0.1))
    .map((m) => ({ ...m, before: was.get(m.id) ?? 0 }));
}
