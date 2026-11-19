import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

jest.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light", setColorScheme: jest.fn() }),
}));
jest.mock("@/services/privacy-mode", () => ({ isAmountsHidden: () => false }));

import { TransactionRow } from "../../components/ui/TransactionRow";

/** Ledger rows read like Transactions: red out with no sign, green in with a plus, purple transfers. */
describe("TransactionRow", () => {
  it("shows money out without a sign and money in with a plus", () => {
    const { getByText, rerender } = render(<TransactionRow icon="cart-outline" color="#0F766E" title="Groceries" amount={1200} flow="out" date="16 Nov" />);
    expect(getByText(/1,200/).props.children.join("")).not.toMatch(/^[+−]/);
    rerender(<TransactionRow icon="arrow-down-outline" color="#0F766E" title="Salary" amount={50000} flow="in" />);
    expect(getByText(/50,000/).props.children.join("")).toMatch(/^\+/);
  });

  it("gives a transfer in a plus, a transfer out none", () => {
    const { getByText, rerender } = render(<TransactionRow icon="swap-horizontal" color="#7C3AED" title="To card" amount={300} flow="moved" />);
    expect(getByText(/300/).props.children.join("")).not.toMatch(/^\+/);
    rerender(<TransactionRow icon="swap-horizontal" color="#7C3AED" title="From savings" amount={300} flow="moved" plus />);
    expect(getByText(/300/).props.children.join("")).toMatch(/^\+/);
  });

  it("shows the chip, one status, the date and the balance after", () => {
    const { getByText } = render(
      <TransactionRow
        icon="cart-outline"
        color="#0F766E"
        title="Big Bazaar"
        amount={800}
        flow="out"
        chip={{ label: "Groceries", color: "#0F766E" }}
        status={{ label: "Correction · debit" }}
        date="12 Nov"
        after="Balance ₹4,200"
      />,
    );
    for (const t of ["Groceries", "Correction · debit", "12 Nov", "Balance ₹4,200"]) expect(getByText(t)).toBeTruthy();
  });

  it("keeps a ledger's own sign and colour when given (Hisaab)", () => {
    const { getByText } = render(<TransactionRow icon="return-down-back-outline" color="#64748B" title="They paid" amount={500} flow="out" sign="−" amountColor="#111111" />);
    const amount = getByText(/500/);
    expect(amount.props.children.join("")).toMatch(/^−/);
    expect(JSON.stringify(amount.props.style)).toContain("#111111");
  });

  it("opens on tap and offers more on a long-press", () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    const { getByLabelText } = render(<TransactionRow icon="cart-outline" color="#0F766E" title="Rent" amount={20000} flow="out" onPress={onPress} onLongPress={onLongPress} />);
    fireEvent.press(getByLabelText(/Rent/));
    fireEvent(getByLabelText(/Rent/), "longPress");
    expect(onPress).toHaveBeenCalled();
    expect(onLongPress).toHaveBeenCalled();
  });
});
