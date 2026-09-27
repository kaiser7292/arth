import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light", setColorScheme: jest.fn() }),
}));
jest.mock("expo-router", () => ({ router: { back: jest.fn(), push: jest.fn() } }));
const mockAlert = jest.fn();
jest.mock("../../hooks/use-alert", () => ({ useAlert: () => mockAlert }));
jest.mock("../../components/broker/BrokerTermsCard", () => ({ BrokerTermsCard: () => null }));
jest.mock("../../components/broker/BrokerVaultActions", () => ({ BrokerVaultActions: () => null }));
jest.mock("../../services/broker-terms", () => ({
  hasAcceptedBrokerTerms: () => true,
  acceptBrokerTerms: jest.fn(),
}));
jest.mock("../../services/kite-connect", () => ({
  getKiteApiKey: jest.fn(async () => "apikey123"),
  getKiteApiSecret: jest.fn(async () => "secret456"),
  storeKiteApiKey: jest.fn(async () => {}),
  storeKiteApiSecret: jest.fn(async () => {}),
  clearKiteCredentials: jest.fn(),
}));
const mockSave = jest.fn(async () => ({ entryId: "vault_z", created: true }));
const mockLoad = jest.fn(async () => null as any);
jest.mock("../../services/broker-vault", () => ({
  saveBrokerSecretsToVault: (...a: unknown[]) => mockSave(...(a as [])),
  loadBrokerSecretsFromVault: (...a: unknown[]) => mockLoad(...(a as [])),
}));
const mockLink = jest.fn();
jest.mock("../../services/kite-login-autofill", () => ({ setKiteVaultEntryId: (id: string) => mockLink(id) }));

import KiteConnectApiKeyScreen from "../../app/settings/kite-connect-api-key";
import { storeKiteApiKey } from "../../services/kite-connect";

beforeEach(() => {
  mockAlert.mockClear();
  mockSave.mockClear();
  mockLink.mockClear();
  mockLoad.mockResolvedValue(null);
  (storeKiteApiKey as jest.Mock).mockClear();
});

describe("Zerodha credentials screen", () => {
  it("saves the login and TOTP key to the Vault and links it for the login fill", async () => {
    const { findByPlaceholderText, getByText } = render(<KiteConnectApiKeyScreen />);
    fireEvent.changeText(await findByPlaceholderText("User ID, e.g. AB1234"), "ab1234");
    fireEvent.changeText(await findByPlaceholderText("Password"), "s3cret");
    fireEvent.changeText(await findByPlaceholderText("TOTP key"), "jbsw y3dp ehpk 3pxp");
    fireEvent.press(getByText("Save"));

    await waitFor(() => expect(mockLink).toHaveBeenCalledWith("vault_z"));
    expect(storeKiteApiKey).toHaveBeenCalledWith("apikey123");
    expect(mockSave).toHaveBeenCalledWith("kite", {
      apiKey: "apikey123", apiSecret: "secret456", clientId: "AB1234", password: "s3cret", totpSecret: "JBSWY3DPEHPK3PXP",
    });
  });

  it("works with only a TOTP key", async () => {
    const { findByPlaceholderText, getByText } = render(<KiteConnectApiKeyScreen />);
    fireEvent.changeText(await findByPlaceholderText("TOTP key"), "JBSWY3DPEHPK3PXP");
    fireEvent.press(getByText("Save"));
    await waitFor(() => expect(mockLink).toHaveBeenCalledWith("vault_z"));
  });

  it("rejects a 6-digit code typed in place of the key", async () => {
    const { findByPlaceholderText, getByText } = render(<KiteConnectApiKeyScreen />);
    fireEvent.changeText(await findByPlaceholderText("TOTP key"), "123456");
    fireEvent.press(getByText("Save"));
    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith("Invalid TOTP key", expect.any(String)));
    expect(mockSave).not.toHaveBeenCalled();
    expect(storeKiteApiKey).not.toHaveBeenCalled();
  });

  it("keeps saving just the API key when no login is entered", async () => {
    const { findByText } = render(<KiteConnectApiKeyScreen />);
    fireEvent.press(await findByText("Save"));
    await waitFor(() => expect(storeKiteApiKey).toHaveBeenCalledWith("apikey123"));
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockLink).not.toHaveBeenCalled();
  });

  it("prefills the login from the Vault", async () => {
    mockLoad.mockResolvedValue({ clientId: "AB1234", password: "pw", totpSecret: "JBSWY3DPEHPK3PXP" });
    const { findByDisplayValue } = render(<KiteConnectApiKeyScreen />);
    expect(await findByDisplayValue("AB1234")).toBeTruthy();
    expect(await findByDisplayValue("JBSWY3DPEHPK3PXP")).toBeTruthy();
  });
});
