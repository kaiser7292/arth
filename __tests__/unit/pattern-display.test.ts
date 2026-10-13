/**
 * Insights → Patterns: how learned bill patterns are grouped, what counts in the projection,
 * and what the edit form saves.
 */

jest.mock("../../utils/format", () => ({ formatAmount: (n: number) => `Rs${n}` }));
jest.mock("../../components/ui", () => ({}));
jest.mock("../../components/ui/Button", () => ({}));
jest.mock("expo-haptics", () => ({}));
jest.mock("../../hooks/use-color-scheme", () => ({}));
jest.mock("../../hooks/use-theme", () => ({}));

import type { ExpenseClassificationRow } from "../../services/analytics/classifier";
import { readPatternEdit } from "../../components/analytics/PatternEditSheet";
import {
  amountText,
  countedBills,
  dayText,
  groupPatterns,
  monthlyEquivalent,
} from "../../utils/analytics/pattern-display";

const row = (id: string, over: Partial<ExpenseClassificationRow> = {}) =>
  ({
    id,
    merchant_normalized: id,
    amount_range_low: 600,
    amount_range_high: 600,
    classification: "fixed",
    frequency: "monthly",
    source: "auto_detected",
    is_active: 1,
    ...over,
  }) as ExpenseClassificationRow;

describe("groupPatterns", () => {
  const rows = [
    row("auto"),
    row("confirmed", { source: "user_confirmed" }),
    row("edited", { source: "user_corrected", classification: "semi_fixed" }),
    row("paused", { source: "user_confirmed", is_active: 0 }),
    row("varies", { source: "user_corrected", classification: "variable" }),
  ];

  it("puts each pattern in exactly one group", () => {
    const g = groupPatterns(rows);
    expect(g.toConfirm.map((r) => r.id)).toEqual(["auto"]);
    expect(g.yours.map((r) => r.id).sort()).toEqual(["confirmed", "edited"]);
    expect(g.paused.map((r) => r.id)).toEqual(["paused"]);
    expect(g.notBills.map((r) => r.id)).toEqual(["varies"]);
  });

  it("lists the costliest bills first", () => {
    const g = groupPatterns([row("small"), row("big", { amount_range_low: 9000, amount_range_high: 9000 })]);
    expect(g.toConfirm.map((r) => r.id)).toEqual(["big", "small"]);
  });

  it("counts what the projection counts: active bills, answered or not", () => {
    expect(countedBills(rows).map((r) => r.id).sort()).toEqual(["auto", "confirmed", "edited"]);
  });
});

describe("monthlyEquivalent", () => {
  it("spreads quarterly and yearly bills over the months", () => {
    expect(monthlyEquivalent(row("q", { frequency: "quarterly", amount_range_low: 3000, amount_range_high: 3000 }))).toBe(1000);
    expect(monthlyEquivalent(row("y", { frequency: "yearly", amount_range_low: 12000, amount_range_high: 12000 }))).toBe(1000);
  });

  it("uses the middle of a range", () => {
    expect(monthlyEquivalent(row("r", { amount_range_low: 1000, amount_range_high: 3000 }))).toBe(2000);
  });
});

describe("wording", () => {
  it("shows one amount or a range", () => {
    expect(amountText(row("a"))).toBe("Rs600");
    expect(amountText(row("a", { amount_range_high: 900 }))).toBe("Rs600–Rs900");
  });

  it("names the day", () => {
    expect(dayText(1)).toBe("Around the 1st");
    expect(dayText(12)).toBe("Around the 12th");
    expect(dayText(23)).toBe("Around the 23rd");
    expect(dayText(31)).toBe("End of the month");
  });
});

describe("readPatternEdit", () => {
  it("a single amount is a fixed bill", () => {
    expect(readPatternEdit("649", "649", "monthly", "5")).toEqual({
      edit: { classification: "fixed", amountLow: 649, amountHigh: 649, frequency: "monthly", expectedDay: 5 },
    });
  });

  it("an empty highest amount means the same as the lowest", () => {
    const r = readPatternEdit("649", "", "monthly", "5");
    expect("edit" in r && r.edit.amountHigh).toBe(649);
  });

  it("a wide range is a bill whose amount varies", () => {
    const r = readPatternEdit("1800", "3200", "monthly", "12");
    expect("edit" in r && r.edit.classification).toBe("semi_fixed");
  });

  it("refuses a missing amount, a reversed range, or an impossible day", () => {
    expect(readPatternEdit("", "", "monthly", "5")).toEqual({ error: expect.any(String) });
    expect(readPatternEdit("900", "600", "monthly", "5")).toEqual({ error: expect.any(String) });
    expect(readPatternEdit("600", "600", "monthly", "32")).toEqual({ error: expect.any(String) });
    expect(readPatternEdit("600", "600", "monthly", "")).toEqual({ error: expect.any(String) });
  });
});
