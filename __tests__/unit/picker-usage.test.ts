/**
 * @jest-environment node
 */
jest.mock("@/database", () => ({ getDatabase: jest.fn() }));
import { summarise } from "@/services/picker-usage";

const row = (merchant_name: string, date: string, category_id: string | null, account_id: string | null, payment_mode_id: string | null) => ({
  merchant_name,
  date,
  category_id,
  account_id,
  payment_mode_id,
});

describe("picker usage", () => {
  // Newest first, as the query returns them.
  const rows = [
    row("Swiggy", "2026-11-15", "food", "acc1", "upi"),
    row("Rent", "2026-11-01", "home", "acc2", "neft"),
    row("swiggy ", "2026-10-20", "food", "acc1", "card"),
    row("Swiggy", "2026-10-02", "fun", "acc1", "upi"),
  ];

  it("groups names ignoring case and spaces, with the usual category, account and mode", () => {
    const { byName } = summarise(rows);
    const s = byName.get("swiggy")!;
    expect(s.count).toBe(3);
    expect(s.categoryId).toBe("food");
    expect(s.accountId).toBe("acc1");
    expect(s.paymentModeId).toBe("upi");
    expect(s.lastDate).toBe("2026-11-15");
  });

  it("orders recent by last use and most used by count", () => {
    const { recent, mostUsed } = summarise(rows);
    expect(recent.map((m) => m.name)).toEqual(["Swiggy", "Rent"]);
    expect(mostUsed[0].name).toBe("Swiggy");
  });

  it("leaves a field empty when it was never set", () => {
    const { byName } = summarise([row("Cash shop", "2026-11-10", null, null, null)]);
    expect(byName.get("cash shop")).toMatchObject({ categoryId: null, accountId: null, paymentModeId: null });
  });
});
