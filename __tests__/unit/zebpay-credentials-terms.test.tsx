import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";

jest.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light", setColorScheme: jest.fn() }),
}));
jest.mock("expo-router", () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock("../../hooks/use-alert", () => ({ useAlert: () => jest.fn() }));
const mockStore: Record<string, string> = {};
jest.mock("../../services/storage", () => ({
  settingsStorage: {
    getString: (k: string) => mockStore[k],
    set: (k: string, v: string) => {
      mockStore[k] = v;
    },
  },
}));
const mockConnect = jest.fn(async () => {});
jest.mock("../../services/zebpay-connect", () => ({
  connectZebpay: (...args: unknown[]) => mockConnect(...(args as [])),
  getZebpayCredentials: jest.fn(async () => null),
  clearZebpayCredentials: jest.fn(async () => {}),
}));

import ZebpayConnectCredentialsScreen from "../../app/settings/zebpay-connect-credentials";

describe("Zebpay credentials — BYOK terms gate", () => {
  beforeEach(() => {
    for (const k in mockStore) delete mockStore[k];
    mockConnect.mockClear();
  });

  it("keeps Connect disabled until the terms box is ticked, then records agreement", async () => {
    const screen = render(<ZebpayConnectCredentialsScreen />);
    await waitFor(() => screen.getByText("Connect"));
    fireEvent.changeText(screen.getByPlaceholderText("Your Zebpay API key"), "key");
    fireEvent.changeText(screen.getByPlaceholderText("Your Zebpay secret key"), "secret");

    fireEvent.press(screen.getByText("Connect"));
    expect(mockConnect).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText(/agree to follow Zebpay's terms/));
    fireEvent.press(screen.getByText("Connect"));
    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1));
    expect(mockStore["broker_terms_accepted_zebpay"]).toBeTruthy();
  });

  it("skips the gate once the user has agreed before", async () => {
    mockStore["broker_terms_accepted_zebpay"] = "2026-09-26T00:00:00.000Z";
    const screen = render(<ZebpayConnectCredentialsScreen />);
    await waitFor(() => screen.getByText("Connect"));
    fireEvent.changeText(screen.getByPlaceholderText("Your Zebpay API key"), "key");
    fireEvent.changeText(screen.getByPlaceholderText("Your Zebpay secret key"), "secret");
    fireEvent.press(screen.getByText("Connect"));
    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1));
  });
});
