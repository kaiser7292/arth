import React from "react";
import { Linking } from "react-native";
import { render, fireEvent } from "@testing-library/react-native";

jest.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light", setColorScheme: jest.fn() }),
}));

const mockStore: Record<string, string> = {};
jest.mock("../../services/storage", () => ({
  settingsStorage: {
    getString: (k: string) => mockStore[k],
    set: (k: string, v: string) => {
      mockStore[k] = v;
    },
  },
}));

import { BrokerTermsCard } from "../../components/broker/BrokerTermsCard";
import {
  BROKER_TERMS,
  acceptBrokerTerms,
  hasAcceptedBrokerTerms,
  type BrokerId,
} from "../../services/broker-terms";

describe("BrokerTermsCard", () => {
  beforeEach(() => {
    for (const k in mockStore) delete mockStore[k];
  });

  it.each(["kite", "angel", "zebpay"] as BrokerId[])("shows every %s policy link and opens it", (id) => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    const { getByText } = render(<BrokerTermsCard broker={id} agreed={false} onAgreedChange={() => {}} />);
    for (const link of BROKER_TERMS[id].links) {
      fireEvent.press(getByText(link.label));
      expect(open).toHaveBeenLastCalledWith(link.url);
    }
    open.mockRestore();
  });

  it("shows the TOTP warning only for Angel One", () => {
    const angel = render(<BrokerTermsCard broker="angel" agreed={false} onAgreedChange={() => {}} />);
    expect(angel.queryByText(/2FA \(TOTP\) secret/)).toBeTruthy();
    const zeb = render(<BrokerTermsCard broker="zebpay" agreed={false} onAgreedChange={() => {}} />);
    expect(zeb.queryByText(/2FA \(TOTP\) secret/)).toBeNull();
  });

  it("toggles agreement from the tick box", () => {
    const onChange = jest.fn();
    const { getByText } = render(<BrokerTermsCard broker="kite" agreed={false} onAgreedChange={onChange} />);
    fireEvent.press(getByText(/agree to follow Zerodha's terms/));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("remembers agreement per broker", () => {
    expect(hasAcceptedBrokerTerms("angel")).toBe(false);
    acceptBrokerTerms("angel");
    expect(hasAcceptedBrokerTerms("angel")).toBe(true);
    expect(hasAcceptedBrokerTerms("zebpay")).toBe(false);
  });
});
