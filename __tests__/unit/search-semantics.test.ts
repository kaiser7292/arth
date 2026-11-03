import { editDistance, queryTokens, semanticScore, stem, synonymsFor } from "../../utils/search-semantics";

const finds = (q: string, ...texts: string[]) => semanticScore(q, texts) > 0;

describe("what someone meant", () => {
  it("ignores filler", () => {
    expect(queryTokens("how do I change my income")).toEqual(["change", "income"]);
    expect(queryTokens("how")).toEqual(["how"]);
    expect(queryTokens("")).toEqual([]);
  });

  it("word endings", () => {
    expect(stem("investments")).toBe("investment");
    expect(stem("categories")).toBe("category");
    expect(stem("bills")).toBe("bill");
    expect(finds("investments", "Add an investment")).toBe(true);
    expect(finds("bill", "Bills check")).toBe(true);
  });

  it("words that mean the same, in English and everyday Hindi", () => {
    expect(finds("salary", "Change my income")).toBe(true);
    expect(finds("emi", "Loans")).toBe(true);
    expect(finds("kharcha", "Add an expense")).toBe(true);
    expect(finds("udhaar", "Hisaab")).toBe(true);
    expect(finds("password", "Vault")).toBe(true);
    expect(finds("kite", "Zerodha")).toBe(true);
    expect(finds("networth", "Net worth")).toBe(true);
    expect(synonymsFor("food")).toEqual(expect.arrayContaining(["zomato", "swiggy", "restaurant"]));
  });

  it("any word order, and every word has to match", () => {
    expect(finds("income change", "Change my income")).toBe(true);
    expect(finds("change xylophone", "Change my income")).toBe(false);
  });

  it("nothing like it finds nothing", () => {
    expect(finds("xylophone", "Change my income")).toBe(false);
    expect(semanticScore("income", [null, undefined])).toBe(0);
  });
});

describe("typos", () => {
  it("counts slips, including two swapped letters", () => {
    expect(editDistance("swigy", "swiggy")).toBe(1);
    expect(editDistance("swigyg", "swiggy")).toBe(1);
    expect(editDistance("abc", "xyz", 1)).toBe(2);
  });

  it("finds minor typos in titles and in what they mean", () => {
    expect(finds("incme", "Income Calculator")).toBe(true);
    expect(finds("budgte", "Set a budget")).toBe(true);
    expect(finds("investmnet", "Add an investment")).toBe(true);
    expect(finds("swigy", "Swiggy")).toBe(true);
    expect(finds("slary", "Change my income")).toBe(true);
    expect(finds("pasword", "Vault")).toBe(true);
  });

  it("short words have to be right", () => {
    expect(finds("cat", "Car loan xyz")).toBe(false);
    expect(finds("emj", "Mark paid")).toBe(false);
  });
});

describe("ranking", () => {
  const score = (q: string, t: string) => semanticScore(q, [t]);

  it("exact beats starts-with, beats a synonym, beats a typo's meaning", () => {
    expect(score("vault", "Vault")).toBeGreaterThan(score("vault", "Vault notes"));
    expect(score("income", "Income Calculator")).toBeGreaterThan(score("income", "Salary slip"));
    expect(score("budget", "Budget")).toBeGreaterThan(score("budgte", "Budget"));
  });

  it("a match in the title beats one further down", () => {
    expect(semanticScore("loan", ["Loans", null])).toBeGreaterThan(semanticScore("loan", ["Something", "Loans"]));
  });
});
