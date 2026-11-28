/** Ask Arth (docs/SPEED_AND_VOICE_PROPOSAL.md §2.3): questions answered in a sentence. Made-up data. */
jest.mock("@/services/privacy-mode", () => ({ isAmountsHidden: () => false }));
import { composeAnswer, readQuestion, type AskData } from "@/services/ask-arth";
import type { Expense } from "@/services/expense-types";

const NOW = new Date(2026, 10, 18, 12);
const categories = [
  { id: "food", name: "Food", parent_id: null },
  { id: "groc", name: "Groceries", parent_id: null },
  { id: "snacks", name: "Snacks", parent_id: "food" },
];
const ctx = { merchants: ["Swiggy", "DMart", "Uber"], categories };
const ask = (s: string, prev = null as ReturnType<typeof readQuestion>) => readQuestion(s, ctx, prev, NOW, 4);

const row = (id: string, amount: number, date: string, merchant: string, category: string | null): Expense =>
  ({ id, amount, date, merchant_name: merchant, category_id: category }) as unknown as Expense;

describe("reading the question", () => {
  it("spend by day 15", () => {
    expect(ask("What did I spend by day 15?")).toMatchObject({ measure: "spent", subject: { kind: "all" }, period: { start: "2026-11-01", end: "2026-11-15" } });
  });
  it("a category over a period", () => {
    expect(ask("how much on food last month")).toMatchObject({ measure: "spent", subject: { kind: "category", id: "food" }, period: { start: "2026-10-01", end: "2026-10-31" } });
  });
  it("how often at a merchant", () => {
    expect(ask("How often did I order from swiggy this month?")).toMatchObject({ measure: "count", subject: { kind: "merchant", name: "Swiggy" } });
  });
  it("biggest, budget left, money in, where it went", () => {
    expect(ask("biggest payments this week")?.measure).toBe("biggest");
    expect(ask("what's left in my budget")?.measure).toBe("budget_left");
    expect(ask("what came in last month")?.measure).toBe("earned");
    expect(ask("where did my money go in october")?.measure).toBe("top");
  });
  it("a follow-up keeps the rest of the last question", () => {
    const first = ask("how much on food this month")!;
    expect(ask("and last month?", first)).toMatchObject({ subject: { kind: "category", id: "food" }, period: { start: "2026-10-01" } });
    expect(ask("only swiggy", first)).toMatchObject({ subject: { kind: "merchant", name: "Swiggy" }, period: first.period });
  });
  it("nothing to answer", () => {
    expect(ask("hello there")).toBeNull();
  });
});

describe("the reply", () => {
  const q = ask("What did I spend by day 15?")!;
  const data: AskData = {
    rows: [row("a", 1200, "2026-11-03", "Swiggy", "food"), row("b", 300, "2026-11-05", "Corner Cafe", "snacks"), row("c", 2500, "2026-11-10", "DMart", "groc")],
    previousRows: [row("d", 5000, "2026-10-04", "DMart", "groc")],
    categories,
  };

  it("says the total, against the same days last month, and where most went", () => {
    const a = composeAnswer(q, data);
    expect(a.sentence).toContain("By 15 Nov you'd spent ₹4,000");
    expect(a.sentence).toContain("₹1,000 less than 1–15 Oct");
    expect(a.sentence).toContain("Groceries (₹2,500) and Food (₹1,500)");
    expect(a.expenseIds).toEqual(["a", "b", "c"]);
  });

  it("a category counts its subcategories", () => {
    const a = composeAnswer(ask("how much on food by day 15")!, data);
    expect(a.sentence).toContain("₹1,500 on Food");
  });

  it("biggest payments", () => {
    const a = composeAnswer(ask("biggest payments this month")!, data);
    expect(a.sentence).toContain("₹2,500 at DMart on 10th Nov");
    expect(a.expenseIds[0]).toBe("c");
  });

  it("how often", () => {
    const a = composeAnswer(ask("how often at swiggy this month")!, data);
    expect(a.sentence).toContain("1 payment at Swiggy");
  });

  it("budget left", () => {
    const a = composeAnswer(ask("what's left in my budget")!, { ...data, budget: { budget: 10000, spent: 4000 } });
    expect(a.sentence).toContain("₹6,000 left this month");
  });
});
