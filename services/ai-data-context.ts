import { DEFAULT_USER_ID } from "@/constants/app";
import { formatAmount } from "@/utils/format";
import { getCategories } from "./category";
import {
  getExpenseCount,
  getExpenseTotal,
  getTopCategoriesBySpending,
} from "./expense-queries";
import { getAccountSummary, getActiveAccounts } from "./financial-account";
import { getBudgetVsActual, getCurrentMonth } from "./budget";
import { getHisaabSummary, getPersonsWithBalances } from "./hisaab";
import { getVaultEntries } from "./vault";

export interface AIDataContextOptions {
  expenses: boolean;
  accounts: boolean;
  budget: boolean;
  hisaab: boolean;
  vault: boolean;
}

const MAX_CONTEXT_CHARS = 6000;

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[parseInt(m, 10) - 1]} ${y}`;
}

function prevMonth(month: string): string {
  const d = new Date(month + "-01");
  d.setMonth(d.getMonth() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthRange(month: string): { start: string; end: string } {
  const d = new Date(month + "-01");
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function maskAccount(identifier: string): string {
  if (!identifier) return "—";
  const digits = identifier.replace(/\D/g, "");
  if (digits.length === 16) {
    return `XXXX-XXXX-XXXX-${digits.slice(-4)}`;
  }
  if (identifier.length <= 4) return identifier;
  return "****" + identifier.slice(-4);
}

async function buildExpensesContext(): Promise<string> {
  const uid = DEFAULT_USER_ID;
  const cur = getCurrentMonth();
  const prev = prevMonth(cur);
  const curRange = monthRange(cur);
  const prevRange = monthRange(prev);

  const [curTotal, prevTotal, curCount, topCats, categories] = await Promise.all([
    getExpenseTotal(uid, curRange.start, curRange.end),
    getExpenseTotal(uid, prevRange.start, prevRange.end),
    getExpenseCount(uid, curRange.start, curRange.end),
    getTopCategoriesBySpending(uid, curRange.start, curRange.end, 10),
    getCategories(uid),
  ]);

  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const catLines = topCats
    .map((c) => `${catMap.get(c.category_id) ?? "Other"} ${formatAmount(c.total)}`)
    .join(" | ");

  let out = `[SPENDING]\n`;
  out += `This month (${monthLabel(cur)}): ${formatAmount(curTotal)} across ${curCount} transactions.\n`;
  out += `Last month (${monthLabel(prev)}): ${formatAmount(prevTotal)}.\n`;
  if (catLines) out += `Top categories: ${catLines}.`;
  return out;
}

async function buildAccountsContext(): Promise<string> {
  const uid = DEFAULT_USER_ID;
  const [summary, accounts] = await Promise.all([
    getAccountSummary(uid),
    getActiveAccounts(uid),
  ]);

  let out = `[ACCOUNTS]\n`;
  out += `Total savings: ${formatAmount(summary.totalBalance)}. Credit available: ${formatAmount(summary.totalCreditAvailable)}. Dues: ${formatAmount(summary.totalDues)}. ${summary.accountCount} accounts.\n`;

  const lines = accounts.slice(0, 15).map((a) => {
    const label = a.account_label || `${a.bank_name} ${maskAccount(a.account_identifier)}`;
    const bal =
      a.account_type === "credit_card"
        ? `${formatAmount(a.last_known_balance ?? 0)} avail`
        : formatAmount(a.last_known_balance ?? 0);
    return `${label} (${a.account_type}): ${bal}`;
  });
  if (lines.length) out += lines.join(" | ");
  return out;
}

async function buildBudgetContext(): Promise<string> {
  const uid = DEFAULT_USER_ID;
  const cur = getCurrentMonth();
  const curRange = monthRange(cur);

  const result = await getBudgetVsActual(uid, cur, cur, curRange.start, curRange.end);

  let out = `[BUDGET]\n`;
  const pct = result.totalBudget > 0 ? Math.round((result.totalActual / result.totalBudget) * 100) : 0;
  out += `${monthLabel(cur)} budget: ${formatAmount(result.totalBudget)}. Spent so far: ${formatAmount(result.totalActual)} (${pct}%).\n`;

  const over = result.rows
    .filter((r) => r.totalActual > r.totalBudget && r.totalBudget > 0)
    .sort((a, b) => (b.totalActual - b.totalBudget) - (a.totalActual - a.totalBudget))
    .slice(0, 8);
  if (over.length) {
    const lines = over.map((r) => {
      const oPct = Math.round(((r.totalActual - r.totalBudget) / r.totalBudget) * 100);
      return `${r.categoryName} ${formatAmount(r.totalActual)}/${formatAmount(r.totalBudget)} (+${oPct}%)`;
    });
    out += `Over budget: ${lines.join(" | ")}.\n`;
  }

  const under = result.rows
    .filter((r) => r.totalActual <= r.totalBudget && r.totalBudget > 0)
    .sort((a, b) => a.totalActual / a.totalBudget - b.totalActual / b.totalBudget)
    .slice(0, 8);
  if (under.length) {
    const lines = under.map((r) => {
      const uPct = Math.round((r.totalActual / r.totalBudget) * 100);
      return `${r.categoryName} ${formatAmount(r.totalActual)}/${formatAmount(r.totalBudget)} (${uPct}%)`;
    });
    out += `Under budget: ${lines.join(" | ")}.\n`;
  }

  if (result.unbudgetedRows.length) {
    const topUn = result.unbudgetedRows.slice(0, 3);
    const lines = topUn.map((r) => `${r.categoryName} ${formatAmount(r.totalActual)}`);
    out += `Unbudgeted spend: ${lines.join(" | ")}.`;
  }

  return out;
}

async function buildHisaabContext(): Promise<string> {
  const uid = DEFAULT_USER_ID;
  const [summary, persons] = await Promise.all([
    getHisaabSummary(uid),
    getPersonsWithBalances(uid),
  ]);

  let out = `[HISAAB]\n`;
  out += `Net: ${formatAmount(summary.netBalance)} (positive = owed to you). Owed to you: ${formatAmount(summary.totalOwedToYou)}. You owe: ${formatAmount(summary.totalYouOwe)}.\n`;

  const top = persons
    .filter((p) => p.balance !== 0)
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
    .slice(0, 12);
  if (top.length) {
    const lines = top.map((p) => {
      const sign = p.balance > 0 ? "+" : "";
      return `${p.name}: ${sign}${formatAmount(p.balance)}`;
    });
    out += lines.join(" | ");
  }
  return out;
}

async function buildVaultContext(): Promise<string> {
  const entries = await getVaultEntries();
  const active = entries.filter((e) => !e.deleted_at);

  const catCounts = new Map<string, number>();
  const upcoming: { title: string; date: string }[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysLater = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  for (const e of active) {
    catCounts.set(e.category, (catCounts.get(e.category) ?? 0) + 1);
    if (e.renewal_date && e.renewal_date >= today && e.renewal_date <= thirtyDaysLater) {
      upcoming.push({ title: e.title, date: e.renewal_date });
    }
  }

  let out = `[VAULT]\n`;
  out += `${active.length} entries.`;
  if (catCounts.size) {
    const cats = [...catCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cat, n]) => `${cat} ${n}`)
      .join(", ");
    out += ` Categories: ${cats}.`;
  }
  if (upcoming.length) {
    upcoming.sort((a, b) => a.date.localeCompare(b.date));
    const lines = upcoming.slice(0, 4).map((u) => {
      const d = new Date(u.date);
      const label = `${d.toLocaleString("en", { month: "short" })} ${d.getDate()}`;
      return `${u.title} (${label})`;
    });
    out += `\nUpcoming renewals: ${lines.join(" | ")}.`;
  }
  return out;
}

export async function buildAIDataContext(options: AIDataContextOptions): Promise<string> {
  const builders: Promise<string>[] = [];
  if (options.expenses) builders.push(buildExpensesContext());
  if (options.accounts) builders.push(buildAccountsContext());
  if (options.budget) builders.push(buildBudgetContext());
  if (options.hisaab) builders.push(buildHisaabContext());
  if (options.vault) builders.push(buildVaultContext());

  if (builders.length === 0) return "";

  const sections = await Promise.all(builders);
  let result = sections.join("\n\n");

  if (result.length > MAX_CONTEXT_CHARS) {
    result = result.slice(0, MAX_CONTEXT_CHARS) + "\n[...truncated]";
  }

  return result;
}
