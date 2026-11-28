/** Ask Arth: questions in any words (the owner's screenshots, Nov 2026, and more). Made-up data. */
jest.mock("@/services/privacy-mode", () => ({ isAmountsHidden: () => false }));
import { composeAnswer, type AskData } from "@/services/ask-arth";
import { readQuestionRules, type AskPlan } from "@/services/ask/plan";
import { checkQuestionAnswer } from "@/services/ai/tasks/read-question";
import type { Expense } from "@/services/expense-types";

const NOW = new Date(2026, 10, 18, 12);
const categories = [
  { id: "food", name: "Food", parent_id: null },
  { id: "groc", name: "Groceries", parent_id: null },
  { id: "shop", name: "Shopping", parent_id: null },
  { id: "snacks", name: "Snacks", parent_id: "food" },
];
const ctx = { merchants: ["Swiggy", "Swiggy Instamart", "DMart", "Nykaa", "Uber"], categories };
const read = (s: string, prev: AskPlan | null = null) => readQuestionRules(s, ctx, prev, NOW, 4);
const plan = (s: string, prev: AskPlan | null = null) => read(s, prev).plan!;

const row = (id: string, amount: number, date: string, merchant: string, category: string | null, description = ""): Expense =>
  ({ id, amount, date, merchant_name: merchant, category_id: category, description }) as unknown as Expense;

describe("the owner's screenshots", () => {
  it("Did I ever pay to zomato? → did-I-ever, Zomato (not in Arth), all time", () => {
    const p = plan("Did I ever pay to zomato?");
    expect(p.measure).toBe("exists");
    expect(p.subject).toMatchObject({ kind: "merchant", name: "Zomato", known: false });
    expect(p.period.allTime).toBe(true);
  });
  it("What are the other merchants in the food category I paid to? → which merchants, Food", () => {
    const p = plan("What are the other merchants in the food category I paid to?");
    expect(p.measure).toBe("merchants");
    expect(p.subject).toMatchObject({ kind: "category", id: "food" });
  });
  it("Across all months? after a Food question → Food, all time", () => {
    const first = plan("how much on food this month");
    const p = plan("Across all months?", first);
    expect(p.period.allTime).toBe(true);
    expect(p.subject).toMatchObject({ kind: "category", id: "food" });
  });
  it("I asked only for nykaa → Nykaa, keeps the period", () => {
    const first = plan("spend this month");
    expect(plan("I asked only for nykaa", first)).toMatchObject({ subject: { name: "Nykaa", known: true }, period: first.period });
  });
  it("I asked nykaa for all months → Nykaa, all time", () => {
    const p = plan("I asked nykaa for all months", plan("spend this month"));
    expect(p.subject).toMatchObject({ name: "Nykaa" });
    expect(p.period.allTime).toBe(true);
  });
});

describe("more phrasings", () => {
  it.each([
    ["What did I spend by day 15?", "total", "all"],
    ["how much did nykaa cost me", "total", "Nykaa"],
    ["kitna kharcha hua swiggy pe", "total", "Swiggy"],
    ["how many times did I order from swiggy", "count", "Swiggy"],
    ["swiggy month by month", "by_month", "Swiggy"],
    ["biggest payments this week", "biggest", "all"],
    ["when did I last pay uber", "last", "Uber"],
    ["first time I used dmart", "first", "DMart"],
    ["where did my money go in october", "categories", "all"],
    ["which shops in groceries", "merchants", "Groceries"],
    ["what's left in my budget", "budget_left", "all"],
    ["what came in last month", "earned", "all"],
    ["average a day on food", "average", "Food"],
  ])("%s → %s, %s", (q, measure, subject) => {
    const p = plan(q);
    expect(p.measure).toBe(measure);
    const s = p.subject;
    expect(s.kind === "all" ? "all" : s.kind === "text" ? s.words : s.name).toBe(subject);
  });

  it("payments mentioning a word", () => {
    expect(plan("payments mentioning wedding").subject).toEqual({ kind: "text", words: "wedding" });
  });
  it("a brand you've never paid isn't turned into a category", () => {
    expect(plan("zomato spend").subject).toMatchObject({ kind: "merchant", name: "Zomato", known: false });
  });
  it("words it can't place: not sure, so the AI gets a turn", () => {
    expect(read("how bad was the wedding month").sure).toBe(false);
    expect(read("hello there").plan).toBeNull();
  });
});

describe("the on-device AI's reading is checked", () => {
  it("names from your lists, or words in the question; nothing invented", () => {
    const p = checkQuestionAnswer('{"merchant":"Nykaa","period":"all","measure":"by_month"}', "nykaa over the years", ctx, null, NOW);
    expect(p).toMatchObject({ subject: { name: "Nykaa", known: true }, measure: "by_month", period: { allTime: true } });
    expect(checkQuestionAnswer('{"merchant":"Amazon"}', "what did i buy", ctx, null, NOW)).toBeNull();
    expect(checkQuestionAnswer('{"measure":"guess"}', "x", ctx, null, NOW)).toBeNull();
    expect(checkQuestionAnswer('{"period":"October","category":"Food"}', "food in oct", ctx, null, NOW)).toMatchObject({
      subject: { id: "food" },
      period: { start: "2026-10-01" },
    });
  });
});

describe("the answers", () => {
  const data: AskData = {
    rows: [
      row("a", 1200, "2026-11-03", "Swiggy", "food"),
      row("b", 300, "2026-11-05", "Corner Cafe", "snacks"),
      row("c", 2500, "2026-11-10", "DMart", "groc"),
      row("d", 4000, "2026-09-12", "Nykaa", "shop"),
      row("e", 1500, "2026-11-12", "Nykaa", "shop", "wedding gift"),
    ],
    previousRows: [],
    categories,
  };

  it("did I ever pay Zomato: no, and what was used instead", () => {
    const a = composeAnswer(plan("Did I ever pay to zomato?"), data);
    expect(a.sentence).toContain("No, there's no payment at Zomato in Arth");
    expect(a.sentence).toContain("For Food you've paid Swiggy");
  });
  it("which merchants in Food lists them, subcategories included", () => {
    const a = composeAnswer(plan("which merchants in food this month"), data);
    expect(a.list?.map((l) => l.label)).toEqual(["Swiggy", "Corner Cafe"]);
  });
  it("Nykaa all time adds up every month", () => {
    const a = composeAnswer(plan("nykaa all time"), data);
    expect(a.sentence).toContain("In all, you've spent ₹5,500 at Nykaa across 2 payments");
  });
  it("by month shows bars with the gap", () => {
    const a = composeAnswer(plan("nykaa month by month all time"), data);
    expect(a.bars?.map((b) => b.label)).toEqual(["Sep", "Oct", "Nov"]);
    expect(a.bars?.[1].value).toBe(0);
  });
  it("words in notes are found", () => {
    expect(composeAnswer(plan("payments mentioning wedding all time"), data).expenseIds).toEqual(["e"]);
  });
  it("every answer says how it read the question", () => {
    expect(composeAnswer(plan("nykaa all time"), data).reading?.map((c) => c.label)).toEqual(["Nykaa", "All time", "Total"]);
  });
});
