const mockStore = new Map<string, string>();
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: (k: string) => mockStore.get(k),
    set: (k: string, v: string) => mockStore.set(k, v),
    delete: (k: string) => mockStore.delete(k),
    getBoolean: () => undefined,
    getNumber: () => undefined,
    getAllKeys: () => [...mockStore.keys()],
    contains: (k: string) => mockStore.has(k),
  })),
}));

import { dismissOpeningBanner, isOpeningBannerDismissed } from "@/services/opening-balance-banner";

describe("opening balance banner", () => {
  beforeEach(() => mockStore.clear());

  it("shows until dismissed, and only for the account dismissed", () => {
    expect(isOpeningBannerDismissed("a")).toBe(false);
    dismissOpeningBanner("a");
    expect(isOpeningBannerDismissed("a")).toBe(true);
    expect(isOpeningBannerDismissed("b")).toBe(false);
    dismissOpeningBanner("b");
    dismissOpeningBanner("a");
    expect(JSON.parse(mockStore.get("opening_balance_banner_dismissed")!)).toEqual(["a", "b"]);
  });

  it("a damaged saved value shows the banner rather than crashing", () => {
    mockStore.set("opening_balance_banner_dismissed", "{not json");
    expect(isOpeningBannerDismissed("a")).toBe(false);
  });
});
