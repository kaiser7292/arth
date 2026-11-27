/**
 * A month as a story: the "Your month" card at the top of Insights and the full-screen month story
 * (app/insights/month-story.tsx).
 *
 * Code finds every fact here, from the Budget tab's spending rule (getSpendingRows): the pace
 * against the month before on the same day, the place you went most, the quiet days, the biggest
 * day, the category that rose or fell most, and a badge for the month. On phones with on-device
 * AI the headline can be reworded (services/ai/tasks/month-note.ts), checked number by number;
 * without it, the headline below is what shows.
 */

import { DEFAULT_USER_ID } from "@/constants/app";
import { getSpendingRows } from "@/services/analytics/spending-rows";
import { getBudgetVsActual } from "@/services/budget";
import { categoryNames } from "@/services/reports/year-review";
import { getMonthDateRange } from "@/utils/budget-helpers";
import { toIsoDate } from "@/utils/date";
import { formatShortAmount } from "@/utils/format";
import { getDatabase } from "@/database";
import { rolledUpCategorySql } from "@/services/category-rollup";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const monthLong = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
export const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export function prevYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** A change in one category against the month before, up to the same day. */
export interface CategoryChange {
  categoryId: string;
  name: string;
  now: number;
  before: number;
  /** Percent change, rounded. */
  pct: number;
}

export interface Persona {
  label: string;
  icon: string;
}

export interface MonthStory {
  month: string;
  prevMonth: string;
  /** True while the month is still running. */
  isCurrent: boolean;
  /** Days counted: today's date for the running month, else the month's length. */
  day: number;
  daysInMonth: number;
  spent: number;
  payments: number;
  /** The month before, up to the same day (its last day when it's shorter). */
  prevSameDay: number;
  prevTotal: number;
  /** Spending added up day by day: index 0 is day 1. */
  cumulative: number[];
  prevCumulative: number[];
  /** Days counted with no spending at all. */
  quietDays: number;
  /** The place with the most payments (2 or more). */
  topPlace: { name: string; count: number; amount: number } | null;
  /** The day with the most spending. */
  biggestDay: { date: string; amount: number; count: number } | null;
  /** The biggest single payment. */
  biggestPayment: { name: string | null; amount: number; date: string } | null;
  topCategory: { categoryId: string; name: string; amount: number; share: number } | null;
  rise: CategoryChange | null;
  drop: CategoryChange | null;
  budgetsOver: number;
  persona: Persona;
}

interface Row {
  id: string;
  date: string;
  amount: number;
  category_id: string | null;
  merchant_name: string | null;
  raw_merchant_name: string | null;
}

/** A category change counts only when it moves at least this many rupees (and 20%). */
const MIN_CHANGE = 500;

const dayOf = (date: string) => Number(date.slice(8, 10));

function cumulate(rows: Row[], days: number): number[] {
  const perDay = new Array<number>(days).fill(0);
  for (const r of rows) {
    const d = dayOf(r.date);
    if (d >= 1 && d <= days) perDay[d - 1] += r.amount;
  }
  let run = 0;
  return perDay.map((v) => (run += v));
}

function byCategory(rows: Row[], upToDay: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.category_id || dayOf(r.date) > upToDay) continue;
    out.set(r.category_id, (out.get(r.category_id) ?? 0) + r.amount);
  }
  return out;
}

const PERSONA_BY_WORD: [RegExp, Persona][] = [
  [/food|dining|restaurant|eat|grocer|swiggy|zomato|cafe/i, { label: "The foodie month", icon: "restaurant-outline" }],
  [/shop|cloth|fashion|gift|amazon|flipkart/i, { label: "The shopping month", icon: "bag-handle-outline" }],
  [/travel|trip|holiday|flight|hotel/i, { label: "The wanderer's month", icon: "airplane-outline" }],
  [/car|vehicle|fuel|petrol|transport|commute|cab|auto/i, { label: "The on-the-move month", icon: "car-sport-outline" }],
  [/health|medic|wellness|fitness|gym|pharma|doctor/i, { label: "The self-care month", icon: "fitness-outline" }],
  [/bill|utilit|rent|electric|recharge|internet/i, { label: "The bills month", icon: "receipt-outline" }],
  [/entertain|movie|fun|game|ott|subscription/i, { label: "The fun month", icon: "game-controller-outline" }],
  [/educat|school|course|book/i, { label: "The learning month", icon: "school-outline" }],
  [/home|house|furnish|repair/i, { label: "The homebody month", icon: "home-outline" }],
];

/** The month's badge, picked by code from what stands out most. Pure. */
export function pickPersona(s: Omit<MonthStory, "persona">): Persona {
  const pace = s.prevSameDay > 0 ? s.spent / s.prevSameDay : 1;
  if (s.quietDays >= Math.max(5, Math.round(s.day * 0.3)) && pace < 0.85) return { label: "The quiet month", icon: "leaf-outline" };
  // One payment that makes up much of the month explains it better than "you spent more".
  if (s.biggestPayment && s.spent > 0 && s.biggestPayment.amount >= s.spent * 0.4) return { label: "The big-ticket month", icon: "diamond-outline" };
  if (s.prevSameDay > 0 && pace >= 1.3) return { label: "The big-spend month", icon: "flame-outline" };
  if (s.topCategory && s.topCategory.share >= 0.3) {
    const hit = PERSONA_BY_WORD.find(([re]) => re.test(s.topCategory!.name));
    if (hit) return hit[1];
  }
  if (s.prevSameDay > 0 && pace <= 0.85) return { label: "The saver's month", icon: "trending-down-outline" };
  if (s.topPlace && s.topPlace.count >= 8) return { label: "The regular's month", icon: "storefront-outline" };
  return { label: "A steady month", icon: "pulse-outline" };
}

/** Everything in the story, from the rows. Pure: exported for tests. */
export function buildMonthStory(
  month: string,
  rows: Row[],
  prevRows: Row[],
  names: Map<string, string>,
  budgetsOver: number,
  today: Date = new Date(),
): MonthStory {
  const prevMonth = prevYm(month);
  const daysInMonth = Number(getMonthDateRange(month).endDate.slice(8, 10));
  const prevDays = Number(getMonthDateRange(prevMonth).endDate.slice(8, 10));
  const isCurrent = ymOf(today) === month;
  const day = isCurrent ? today.getDate() : daysInMonth;
  // The running month against the month before up to the same day; a finished month against all of it.
  const sameDay = isCurrent ? Math.min(day, prevDays) : prevDays;

  const counted = rows.filter((r) => dayOf(r.date) <= day);
  const cumulative = cumulate(counted, day);
  const prevCumulative = cumulate(prevRows, prevDays);
  const spent = cumulative[day - 1] ?? 0;

  const daysWithSpend = new Set(counted.filter((r) => r.amount > 0).map((r) => dayOf(r.date)));
  const quietDays = day - daysWithSpend.size;

  // Places, by number of payments; the amount breaks ties.
  const places = new Map<string, { name: string; count: number; amount: number }>();
  for (const r of counted) {
    const name = (r.merchant_name ?? r.raw_merchant_name ?? "").trim();
    if (!name) continue;
    const p = places.get(name.toLowerCase()) ?? { name, count: 0, amount: 0 };
    p.count += 1;
    p.amount += r.amount;
    places.set(name.toLowerCase(), p);
  }
  const topPlace = [...places.values()].sort((a, b) => b.count - a.count || b.amount - a.amount)[0] ?? null;

  const days = new Map<string, { date: string; amount: number; count: number }>();
  for (const r of counted) {
    const d = r.date.slice(0, 10);
    const cur = days.get(d) ?? { date: d, amount: 0, count: 0 };
    cur.amount += r.amount;
    cur.count += 1;
    days.set(d, cur);
  }
  const biggestDay = [...days.values()].sort((a, b) => b.amount - a.amount)[0] ?? null;
  const big = [...counted].sort((a, b) => b.amount - a.amount)[0];
  const biggestPayment = big ? { name: (big.merchant_name ?? big.raw_merchant_name ?? "").trim() || null, amount: big.amount, date: big.date.slice(0, 10) } : null;

  const nowCats = byCategory(counted, day);
  const prevCats = byCategory(prevRows, sameDay);
  const changes: CategoryChange[] = [];
  // Nothing spent yet: every category "falling 100%" isn't news.
  for (const id of counted.length === 0 ? [] : new Set([...nowCats.keys(), ...prevCats.keys()])) {
    const now = nowCats.get(id) ?? 0;
    const before = prevCats.get(id) ?? 0;
    if (before <= 0 || Math.abs(now - before) < MIN_CHANGE) continue;
    const pct = Math.round(((now - before) / before) * 100);
    if (Math.abs(pct) < 20) continue;
    changes.push({ categoryId: id, name: names.get(id) ?? "Uncategorised", now, before, pct });
  }
  const rise = changes.filter((c) => c.pct > 0).sort((a, b) => b.now - b.before - (a.now - a.before))[0] ?? null;
  const drop = changes.filter((c) => c.pct < 0).sort((a, b) => a.now - a.before - (b.now - b.before))[0] ?? null;

  const top = [...nowCats.entries()].sort((a, b) => b[1] - a[1])[0];
  const topCategory = top && spent > 0 ? { categoryId: top[0], name: names.get(top[0]) ?? "Uncategorised", amount: top[1], share: top[1] / spent } : null;

  const base = {
    month,
    prevMonth,
    isCurrent,
    day,
    daysInMonth,
    spent,
    payments: counted.length,
    prevSameDay: prevCumulative[sameDay - 1] ?? 0,
    prevTotal: prevCumulative[prevDays - 1] ?? 0,
    cumulative,
    prevCumulative,
    quietDays,
    topPlace: topPlace && topPlace.count >= 2 ? topPlace : null,
    biggestDay,
    biggestPayment,
    topCategory,
    rise,
    drop,
    budgetsOver,
  };
  return { ...base, persona: pickPersona(base) };
}

export async function loadMonthStory(month: string, today: Date = new Date()): Promise<MonthStory> {
  const prev = prevYm(month);
  const range = getMonthDateRange(month);
  const prevRange = getMonthDateRange(prev);
  const isCurrent = ymOf(today) === month;
  const end = isCurrent ? toIsoDate(today) : range.endDate;
  const [rows, prevRows, cats, parents, budgets] = await Promise.all([
    getSpendingRows(DEFAULT_USER_ID, range.startDate, end),
    getSpendingRows(DEFAULT_USER_ID, prevRange.startDate, prevRange.endDate),
    categoryNames(DEFAULT_USER_ID).catch(() => new Map<string, { name: string; color: string | null }>()),
    topCategories().catch(() => new Map<string, string>()),
    getBudgetVsActual(DEFAULT_USER_ID, month, month, range.startDate, end).catch(() => null),
  ]);
  const over = budgets ? budgets.rows.filter((r) => r.totalBudget > 0 && r.totalActual > r.totalBudget).length : 0;
  const names = new Map([...cats].map(([id, c]) => [id, c.name]));
  // Sub-categories count toward their parent, as on the Budget tab.
  const rollUp = (list: Row[]) => list.map((r) => (r.category_id && parents.has(r.category_id) ? { ...r, category_id: parents.get(r.category_id)! } : r));
  return buildMonthStory(month, rollUp(rows as Row[]), rollUp(prevRows as Row[]), names, over, today);
}

/** Each category's id on the Budget tab: its parent when it has an active one (category-rollup.ts). */
async function topCategories(): Promise<Map<string, string>> {
  const rows = await getDatabase().getAllAsync<{ id: string; top: string }>(
    `SELECT c.id, ${rolledUpCategorySql("c.id")} AS top FROM categories c WHERE c.user_id = ?;`,
    DEFAULT_USER_ID,
  );
  return new Map(rows.filter((r) => r.top && r.top !== r.id).map((r) => [r.id, r.top]));
}

const amt = (n: number) => formatShortAmount(Math.round(n));

/** The headline when there's no AI one: the pace, said plainly. Pure. */
export function plainHeadline(s: MonthStory): string {
  const prev = monthLong(s.prevMonth);
  if (s.payments === 0) return s.isCurrent ? `A clean slate: nothing spent in ${monthLong(s.month)} yet.` : `Nothing spent in ${monthLong(s.month)}.`;
  if (s.prevSameDay <= 0) return `${amt(s.spent)} across ${s.payments} payment${s.payments === 1 ? "" : "s"}${s.isCurrent ? " so far" : ""}.`;
  const diff = s.spent - s.prevSameDay;
  if (Math.abs(diff) < Math.max(500, s.prevSameDay * 0.03)) return s.isCurrent ? `Right on ${prev}'s pace, almost to the rupee.` : `Almost exactly what you spent in ${prev}.`;
  const place = s.topPlace && s.topPlace.count >= 4 ? `, with ${s.topPlace.name} ${s.topPlace.count} times` : "";
  if (s.isCurrent) return diff < 0 ? `You're ${amt(-diff)} under ${prev}'s pace${place}.` : `You're ${amt(diff)} ahead of ${prev}'s pace${place}.`;
  return diff < 0 ? `${amt(-diff)} less than ${prev}${place}.` : `${amt(diff)} more than ${prev}${place}.`;
}

/**
 * The facts the AI headline may use, one per line, in the same wording and number format the card
 * shows, so the checker can match every number. Pure.
 */
export function storyFacts(s: MonthStory): string[] {
  const m = monthLong(s.month);
  const prev = monthLong(s.prevMonth);
  const facts: string[] = [`Spent ${amt(s.spent)} in ${m}${s.isCurrent ? ` so far (day ${s.day} of ${s.daysInMonth})` : ""}`];
  if (s.prevSameDay > 0) {
    const diff = s.spent - s.prevSameDay;
    facts.push(`That is ${amt(Math.abs(diff))} ${diff < 0 ? "less" : "more"} than ${prev} by the same day`);
  }
  if (s.topPlace) facts.push(`Most visited place: ${s.topPlace.name}, ${s.topPlace.count} times, ${amt(s.topPlace.amount)}`);
  if (s.quietDays > 0) facts.push(`${s.quietDays} days with no spending`);
  if (s.drop) facts.push(`${s.drop.name} down ${Math.abs(s.drop.pct)}% from ${prev}`);
  if (s.rise) facts.push(`${s.rise.name} up ${s.rise.pct}% from ${prev}`);
  facts.push(`Badge for the month: ${s.persona.label}`);
  return facts;
}

/** Up to three small tiles for the card, the most interesting first. Pure. */
export interface StoryTile {
  label: string;
  value: string;
  note: string;
  tone: "success" | "warning" | "muted";
}
export function storyTiles(s: MonthStory): StoryTile[] {
  const prev = monthLong(s.prevMonth).slice(0, 3);
  const out: StoryTile[] = [];
  if (s.topPlace) {
    const every = s.topPlace.count >= 3 ? Math.round(s.day / s.topPlace.count) : 0;
    out.push({ label: s.topPlace.name, value: `${s.topPlace.count} visits`, note: every >= 1 && every <= 7 ? (every === 1 ? "every day" : `every ${ordinal(every)} day`) : amt(s.topPlace.amount), tone: "muted" });
  }
  if (s.drop) out.push({ label: s.drop.name, value: `−${Math.abs(s.drop.pct)}%`, note: `vs ${prev}`, tone: "success" });
  if (s.quietDays > 0) out.push({ label: "No-spend days", value: String(s.quietDays), note: `of ${s.day}`, tone: "success" });
  if (s.rise) out.push({ label: s.rise.name, value: `+${s.rise.pct}%`, note: `vs ${prev}`, tone: "warning" });
  if (s.biggestDay) out.push({ label: "Biggest day", value: amt(s.biggestDay.amount), note: dayLabel(s.biggestDay.date), tone: "muted" });
  return out.slice(0, 3);
}

function ordinal(n: number): string {
  return n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}

/** "Sat 8 Nov". Pure. */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getDay()]} ${d} ${MONTHS[m - 1].slice(0, 3)}`;
}
