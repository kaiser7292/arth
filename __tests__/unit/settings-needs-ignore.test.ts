/** Settings' "Needs a look": Ignore hides a count until it grows, and the backup reminder for 30 days. */
jest.mock("react-native-mmkv", () => {
  const m = new Map<string, string>();
  return {
    MMKV: jest.fn().mockImplementation(() => ({
      getString: (k: string) => m.get(k),
      getNumber: () => undefined,
      getBoolean: () => undefined,
      set: (k: string, v: string) => void m.set(k, v),
      delete: (k: string) => void m.delete(k),
      getAllKeys: () => [...m.keys()],
    })),
  };
});

import { ignoreNeeds, isNeedIgnored } from "../../services/settings";

const DAY = 24 * 60 * 60 * 1000;

describe("Needs a look: Ignore", () => {
  it("shows what was never ignored", () => {
    expect(isNeedIgnored("n-unread", 4)).toBe(false);
  });

  it("hides a count until it grows", () => {
    ignoreNeeds({ "n-dupes": 3 });
    expect(isNeedIgnored("n-dupes", 3)).toBe(true);
    expect(isNeedIgnored("n-dupes", 2)).toBe(true);
    expect(isNeedIgnored("n-dupes", 4)).toBe(false);
  });

  it("hides the backup reminder for 30 days", () => {
    const at = Date.UTC(2026, 10, 19);
    ignoreNeeds({ "n-backup": 0 }, at);
    expect(isNeedIgnored("n-backup", 0, true, at + 29 * DAY)).toBe(true);
    expect(isNeedIgnored("n-backup", 0, true, at + 31 * DAY)).toBe(false);
  });
});
