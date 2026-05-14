/**
 * V4 Tests: Insights Merchant Display Names
 *
 * Tests that analyzeMerchants() prefers canonical merchantName
 * (from the alias system) over parsing from description.
 */

import { analyzeMerchants } from "../../utils/spending-insights";
import type { ExpenseRecord } from "../../utils/spending-insights";

describe("analyzeMerchants — V4 merchantName support", () => {
  it("uses merchantName when available instead of parsing description", () => {
    const expenses: ExpenseRecord[] = [
      { id: "1", amount: 500, description: "PYU*ZOMATO LTD via HDFC Card ****9628", merchantName: "Zomato", date: "2026-04-01", categoryId: "c1", paymentModeId: "p1" },
      { id: "2", amount: 300, description: "PYU*ZOMATO LTD via ICICI Card ****3001", merchantName: "Zomato", date: "2026-04-02", categoryId: "c1", paymentModeId: "p1" },
    ];

    const result = analyzeMerchants(expenses);
    expect(result).toHaveLength(1);
    expect(result[0].merchant).toBe("zomato");
    expect(result[0].totalSpent).toBe(800);
    expect(result[0].transactionCount).toBe(2);
  });

  it("buckets expenses without merchantName as 'unknown'", () => {
    const expenses: ExpenseRecord[] = [
      { id: "1", amount: 500, description: "Swiggy", merchantName: null, date: "2026-04-01", categoryId: "c1", paymentModeId: "p1" },
      { id: "2", amount: 300, description: "Swiggy", merchantName: null, date: "2026-04-02", categoryId: "c1", paymentModeId: "p1" },
    ];

    const result = analyzeMerchants(expenses);
    expect(result).toHaveLength(1);
    expect(result[0].merchant).toBe("unknown");
    expect(result[0].totalSpent).toBe(800);
  });

  it("groups by merchantName correctly even when descriptions differ", () => {
    const expenses: ExpenseRecord[] = [
      { id: "1", amount: 200, description: "SWIGGY FOOD via HDFC ****9628", merchantName: "Swiggy", date: "2026-04-01", categoryId: "c1", paymentModeId: "p1" },
      { id: "2", amount: 150, description: "SWIGGY INSTAMART via ICICI ****3001", merchantName: "Swiggy", date: "2026-04-02", categoryId: "c1", paymentModeId: "p2" },
    ];

    const result = analyzeMerchants(expenses);
    // Both should group under "swiggy" because merchantName is the same
    expect(result).toHaveLength(1);
    expect(result[0].merchant).toBe("swiggy");
    expect(result[0].totalSpent).toBe(350);
    expect(result[0].transactionCount).toBe(2);
  });

  it("separates different merchantNames into different merchants", () => {
    const expenses: ExpenseRecord[] = [
      { id: "1", amount: 500, description: "Food order", merchantName: "Zomato", date: "2026-04-01", categoryId: "c1", paymentModeId: "p1" },
      { id: "2", amount: 300, description: "Food order", merchantName: "Swiggy", date: "2026-04-02", categoryId: "c1", paymentModeId: "p1" },
    ];

    const result = analyzeMerchants(expenses);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.merchant).sort()).toEqual(["swiggy", "zomato"]);
  });

  it("separates merchantName entries from unknown bucket", () => {
    const expenses: ExpenseRecord[] = [
      { id: "1", amount: 500, description: "Amazon order", merchantName: "Amazon", date: "2026-04-01", categoryId: "c1", paymentModeId: "p1" },
      { id: "2", amount: 300, description: "Amazon Prime", merchantName: null, date: "2026-04-02", categoryId: "c1", paymentModeId: "p1" },
    ];

    const result = analyzeMerchants(expenses);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.merchant).sort()).toEqual(["amazon", "unknown"]);
  });

  it("buckets expenses without merchantName or description as 'unknown'", () => {
    const expenses: ExpenseRecord[] = [
      { id: "1", amount: 500, description: null, merchantName: null, date: "2026-04-01", categoryId: "c1", paymentModeId: "p1" },
    ];

    const result = analyzeMerchants(expenses);
    expect(result).toHaveLength(1);
    expect(result[0].merchant).toBe("unknown");
  });

  it("trims merchantName whitespace for consistent grouping", () => {
    const expenses: ExpenseRecord[] = [
      { id: "1", amount: 200, description: "desc", merchantName: "  Zomato  ", date: "2026-04-01", categoryId: "c1", paymentModeId: "p1" },
      { id: "2", amount: 300, description: "desc", merchantName: "Zomato", date: "2026-04-02", categoryId: "c1", paymentModeId: "p1" },
    ];

    const result = analyzeMerchants(expenses);
    expect(result).toHaveLength(1);
    expect(result[0].totalSpent).toBe(500);
  });

  it("respects the limit parameter", () => {
    const expenses: ExpenseRecord[] = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      amount: (i + 1) * 100,
      description: `Merchant ${i}`,
      merchantName: `Merchant ${i}`,
      date: "2026-04-01",
      categoryId: "c1",
      paymentModeId: "p1",
    }));

    const result = analyzeMerchants(expenses, 5);
    expect(result).toHaveLength(5);
    // Should be sorted by totalSpent desc
    expect(result[0].totalSpent).toBeGreaterThan(result[4].totalSpent);
  });
});
