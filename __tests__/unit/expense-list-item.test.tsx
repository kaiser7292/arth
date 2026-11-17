import React from "react";
import { render, fireEvent } from "@testing-library/react-native";

jest.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light", setColorScheme: jest.fn() }),
}));
jest.mock("@/services/privacy-mode", () => ({ isAmountsHidden: () => false }));

import { ExpenseListItem, rowStatus } from "../../components/expense/ExpenseListItem";
import type { Expense } from "../../services/expense";

const base = {
  id: "e1",
  user_id: "u",
  amount: 1000,
  currency: "INR",
  description: "Book store",
  merchant_name: "Book store",
  category_id: null,
  payment_mode_id: null,
  account_id: null,
  date: "2026-11-16",
  status: "approved",
  nature: "realized",
  due_date: null,
  split_original_amount: null,
  money_event: null,
  purchase_group_id: null,
  is_right_spend: null,
} as unknown as Expense;

const cat = { id: "c1", name: "Books", icon: "book-outline", color: "#0F766E" } as never;

describe("rowStatus", () => {
  it("shows one status, needs review first", () => {
    expect(rowStatus({ ...base, status: "pending_review" } as Expense, "full")).toEqual({ label: "Needs review", tone: "warning" });
    expect(rowStatus(base, "full")?.label).toBe("Refunded");
    expect(rowStatus(base, "partial")?.label).toBe("Partly refunded");
    expect(rowStatus({ ...base, nature: "forecast" } as Expense, "none")?.label).toBe("Forecast");
    expect(rowStatus({ ...base, money_event: "self_transfer" } as Expense, "none")).toEqual({ label: "Transfer", tone: "transfer" });
    expect(rowStatus({ ...base, purchase_group_id: "g" } as unknown as Expense, "none")?.label).toBe("Split payment");
    expect(rowStatus(base, "none")).toBeNull();
  });

  it("names the money event while it waits for review", () => {
    expect(rowStatus({ ...base, status: "pending_review", money_event: "fd_open" } as Expense, "none")?.label).toBe("Review · FD deposit");
  });
});

describe("ExpenseListItem", () => {
  it("strikes through a fully refunded amount", () => {
    const { getByText } = render(<ExpenseListItem expense={base} category={cat} refundedAmount={1000} />);
    expect(getByText("Refunded")).toBeTruthy();
    const amount = getByText(/1,000/);
    expect(String(amount.props.className)).toContain("line-through");
  });

  it("shows what's left of a partial refund, with the original struck small", () => {
    const { getByText } = render(<ExpenseListItem expense={base} category={cat} refundedAmount={400} />);
    expect(getByText(/600/)).toBeTruthy();
    expect(String(getByText(/1,000/).props.className)).toContain("line-through");
    expect(getByText("Partly refunded")).toBeTruthy();
  });

  it("drops the date under a day heading but keeps a forecast's due date", () => {
    const { queryByText, rerender } = render(<ExpenseListItem expense={base} category={cat} hideDate />);
    expect(queryByText(/16 Nov/)).toBeNull();
    rerender(<ExpenseListItem expense={{ ...base, nature: "forecast", due_date: "2026-11-20" } as Expense} category={cat} hideDate />);
    expect(queryByText(/Due/)).toBeTruthy();
  });

  it("offers Add category on an untagged row and keeps the split note", () => {
    const onAdd = jest.fn();
    const { getByLabelText, getByText } = render(
      <ExpenseListItem expense={base} onAddCategory={onAdd} splitNote="Your share of ₹2,000" />,
    );
    fireEvent.press(getByLabelText("Add a category to Book store"));
    expect(onAdd).toHaveBeenCalledWith(base);
    expect(getByText("Your share of ₹2,000")).toBeTruthy();
  });

  it("keeps long-press for bulk select", () => {
    const onLongPress = jest.fn();
    const { getByText } = render(<ExpenseListItem expense={base} category={cat} onLongPress={onLongPress} />);
    fireEvent(getByText("Book store"), "longPress");
    expect(onLongPress).toHaveBeenCalled();
  });
});
