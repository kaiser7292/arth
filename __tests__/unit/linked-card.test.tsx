import React from "react";
import { render, fireEvent } from "@testing-library/react-native";

jest.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light", setColorScheme: jest.fn() }),
}));

import { LinkedCard } from "../../components/expense/LinkedCard";

describe("LinkedCard", () => {
  it("shows the heading, lead line and note, and runs its actions", () => {
    const view = jest.fn();
    const unlink = jest.fn();
    const open = jest.fn();
    const { getByText, getByLabelText } = render(
      <LinkedCard
        heading="Loan payment"
        icon="calendar"
        title="EMI · HDFC home loan"
        subtitle="Logged against the scheduled instalment"
        onPressTitle={open}
        actions={[{ label: "View loan", primary: true, onPress: view }, { label: "Unlink", onPress: unlink }]}
        note="Unlink keeps the expense."
      />,
    );
    expect(getByText("Loan payment")).toBeTruthy();
    expect(getByText("Unlink keeps the expense.")).toBeTruthy();
    fireEvent.press(getByLabelText("EMI · HDFC home loan, Logged against the scheduled instalment"));
    fireEvent.press(getByLabelText("View loan"));
    fireEvent.press(getByLabelText("Unlink"));
    expect([open, view, unlink].every((f) => f.mock.calls.length === 1)).toBe(true);
  });
});
