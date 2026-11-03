import { draftFromConfig, draftFromView, draftShares, draftToSave, splitViewOf, type SplitDraft } from "../../services/split-draft";
import { computeSplitAmounts } from "../../services/split-math";

const person = (personId: string, value = "") => ({ personId, value, description: "" });

describe("shares", () => {
  it("equal, including me", () => {
    const r = draftShares(900, { paidBy: "me", mode: "equal", people: [person("a"), person("b")] });
    expect(r).toEqual({ me: 300, people: [300, 300], error: null });
  });

  it("percentages leave me the rest", () => {
    expect(draftShares(2400, { paidBy: "me", mode: "percent", people: [person("a", "40")] })).toEqual({ me: 1440, people: [960], error: null });
  });

  it("they owe all of it adds up exactly, however it divides", () => {
    const r = draftShares(100, { paidBy: "me", mode: "full", people: [person("a"), person("b"), person("c")] });
    expect(r.people).toEqual([33.33, 33.33, 33.34]);
    expect(r.me).toBe(0);
  });

  it("says what's wrong when it can't be saved", () => {
    expect(draftShares(100, { paidBy: "me", mode: "equal", people: [] }).error).toMatch(/Add someone/);
    expect(draftShares(100, { paidBy: "me", mode: "percent", people: [person("a", "70"), person("b", "40")] }).error).toMatch(/100%/);
    expect(draftShares(100, { paidBy: "me", mode: "amount", people: [person("a", "150")] }).error).toMatch(/more than the total/);
    expect(draftShares(100, { paidBy: "me", mode: "amount", people: [person("a", "")] }).error).toMatch(/Enter a share/);
  });
});

describe("what gets saved matches what the sheet showed", () => {
  const cases: SplitDraft[] = [
    { paidBy: "me", mode: "equal", people: [person("a")] },
    { paidBy: "me", mode: "percent", people: [person("a", "40")] },
    { paidBy: "me", mode: "amount", people: [person("a", "250")] },
    { paidBy: "me", mode: "full", people: [person("a")] },
    { paidBy: "a", mode: "equal", people: [person("a")] },
    { paidBy: "a", mode: "percent", people: [person("a", "40")] },
    { paidBy: "a", mode: "amount", people: [person("a", "250")] },
    { paidBy: "a", mode: "full", people: [person("a")] },
  ];
  it.each(cases.map((d) => [`${d.paidBy} paid, ${d.mode}`, d] as const))("%s", (_name, draft) => {
    const save = draftToSave(1000, draft);
    if (save.kind !== "single") throw new Error("expected one person");
    expect(computeSplitAmounts(1000, save.config).myBudgetAmount).toBe(draftShares(1000, draft).me);
    // Reopening what's held shows the same thing.
    expect(draftShares(1000, draftFromConfig(1000, save.config))).toEqual(draftShares(1000, draft));
  });

  it("several people are saved as a split among several", () => {
    const save = draftToSave(900, { paidBy: "me", mode: "percent", people: [person("a", "50"), person("b", "25")] });
    expect(save.kind).toBe("multi");
    if (save.kind === "multi") expect(save.config.splits.map((s) => s.amount)).toEqual([450, 225]);
  });
});

describe("reading a saved split", () => {
  const base = { amount: 1440, split_person_id: "a", split_pct: 60, split_original_amount: 2400, split_mode: "percentage" };

  it("one person, I paid", () => {
    const v = splitViewOf(base, "Ravi", { type: "debit", amount: 960 }, null)!;
    expect(v.paidBy).toBe("me");
    expect(v.modeLabel).toBe("by percentage");
    expect(v.me).toEqual({ amount: 1440, pct: 60 });
    expect(v.people[0]).toMatchObject({ name: "Ravi", amount: 960, pct: 40 });
    expect(v.owes).toEqual({ text: "Ravi owes you", amount: 960 });
    expect(draftFromView(v)).toEqual({ paidBy: "me", mode: "percent", people: [person("a", "40")] });
  });

  it("one person, they paid: the entry holds what I owe them", () => {
    const v = splitViewOf(base, "Ravi", { type: "credit", amount: 1440 }, null)!;
    expect(v.paidBy).toBe("a");
    expect(v.people[0].amount).toBe(960);
    expect(v.owes).toEqual({ text: "You owe Ravi", amount: 1440 });
  });

  it("several people, equal shares read as equal", () => {
    const multi = {
      splits: [
        { id: "1", expense_id: "e", hisaab_person_id: "a", person_name: "Ravi", description: null, amount: 300, hisaab_entry_id: null, created_at: "" },
        { id: "2", expense_id: "e", hisaab_person_id: "b", person_name: "Mira", description: "Tickets", amount: 300, hisaab_entry_id: null, created_at: "" },
      ],
      totalSplitAmount: 600,
      convenienceFee: 300,
      feeAbsorbed: true,
      myShare: 300,
      originalAmount: 900,
    };
    const v = splitViewOf({ ...base, split_person_id: null }, null, null, multi)!;
    expect(v.mode).toBe("equal");
    expect(v.owes).toEqual({ text: "2 people owe you", amount: 600 });
    expect(v.people[1].description).toBe("Tickets");
  });

  it("no split", () => {
    expect(splitViewOf({ ...base, split_person_id: null }, null, null, null)).toBeNull();
  });
});
