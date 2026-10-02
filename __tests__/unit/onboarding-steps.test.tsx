import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("nativewind", () => ({ useColorScheme: () => ({ colorScheme: "light", setColorScheme: jest.fn() }) }));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn() }) }));
jest.mock("../../hooks/use-alert", () => ({ useAlert: () => jest.fn() }));
jest.mock("../../services/settings", () => ({
  ...jest.requireActual("../../services/settings"),
  getFYStartMonth: () => 4,
  setOnboardingCompletedVersion: jest.fn(),
}));
jest.mock("../../services/onboarding", () => ({ getCurrentAppVersion: () => "4.4.1" }));
const mockCreate = jest.fn(async () => "sp1");
const mockUpdate = jest.fn(async () => {});
let mockExisting: unknown = null;
jest.mock("../../services/salary-profile", () => ({
  createSalaryProfile: (...a: unknown[]) => mockCreate(...(a as [])),
  updateSalaryProfile: (...a: unknown[]) => mockUpdate(...(a as [])),
  getSalaryProfileByFY: jest.fn(async () => mockExisting),
}));
const mockUpsert = jest.fn(async () => "b1");
jest.mock("../../services/budget", () => ({ upsertBudget: (...a: unknown[]) => mockUpsert(...(a as [])) }));
jest.mock("../../services/category", () => ({
  getCategories: jest.fn(async () => [
    { id: "c-food", name: "Food" }, { id: "c-groc", name: "Grocery & Supplies" }, { id: "c-misc", name: "Miscellaneous" },
  ]),
}));

import OnboardingIncome from "../../app/(onboarding)/income";
import OnboardingBudget from "../../app/(onboarding)/budget";

beforeEach(() => {
  jest.clearAllMocks();
  mockExisting = null;
});

describe("onboarding income step", () => {
  it("saves take-home pay as a direct salary profile and moves on", async () => {
    const s = render(<OnboardingIncome />);
    fireEvent.changeText(s.getByPlaceholderText("e.g. 85000"), "85,000");
    fireEvent.changeText(s.getByPlaceholderText("1 to 31"), "7");
    fireEvent.press(s.getByText("Continue"));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/(onboarding)/sms-consent"));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ input_mode: "direct", computed_monthly_in_hand: 85000, salary_credit_day: 7, status: "complete" }),
    );
  });

  it("updates an existing profile instead of adding a second one", async () => {
    mockExisting = { id: "sp-old" };
    const s = render(<OnboardingIncome />);
    fireEvent.changeText(s.getByPlaceholderText("e.g. 85000"), "50000");
    fireEvent.press(s.getByText("Continue"));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith("sp-old", expect.objectContaining({ computed_monthly_in_hand: 50000 })));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("skipping saves nothing", async () => {
    const s = render(<OnboardingIncome />);
    fireEvent.press(s.getByText("Skip this step"));
    expect(mockPush).toHaveBeenCalledWith("/(onboarding)/sms-consent");
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("onboarding budget step", () => {
  it("offers only the main everyday categories and saves the amounts typed", async () => {
    const s = render(<OnboardingBudget />);
    await waitFor(() => s.getByText("Grocery & Supplies"));
    expect(s.queryByText("Miscellaneous")).toBeNull();
    const inputs = s.getAllByPlaceholderText("₹ per month");
    fireEvent.changeText(inputs[0], "9000");
    fireEvent.press(s.getByText("Save budgets"));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/(onboarding)/protect"));
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ category_id: "c-food", amount: 9000 }));
    expect(mockUpsert.mock.calls.every((c) => (c as unknown as [{ category_id: string }])[0].category_id === "c-food")).toBe(true);
  });
});
