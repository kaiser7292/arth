/**
 * Dismissing a duplicate group lives in MMKV, not the database, so it must bump the data version
 * itself - otherwise Home (which reloads on data-version changes) keeps showing the duplicate after
 * Catch Up's "Not duplicates".
 */
const mockBump = jest.fn();
jest.mock("../../services/settings", () => ({
  bumpDataVersion: () => mockBump(),
  getDataVersion: () => 1,
  subscribeDataVersion: () => ({ remove: () => {} }),
}));
const mockStore: Record<string, string> = {};
jest.mock("../../services/storage", () => {
  const s = {
    getString: (k: string) => mockStore[k],
    set: (k: string, v: string) => { mockStore[k] = v; },
    delete: (k: string) => { delete mockStore[k]; },
    getNumber: () => undefined, getBoolean: () => undefined,
  };
  return { duplicateDismissalsStorage: s, settingsStorage: s };
});
jest.mock("../../database", () => ({ getDatabase: jest.fn() }));

import { clearDismissedDuplicates, dismissDuplicateGroup, restoreDismissedGroup } from "../../services/duplicate-detection";

describe("duplicate dismissals refresh screens", () => {
  beforeEach(() => mockBump.mockClear());

  it("dismissing, restoring and clearing all bump the data version", () => {
    dismissDuplicateGroup([{ id: "a" }, { id: "b" }] as never);
    expect(mockBump).toHaveBeenCalledTimes(1);
    restoreDismissedGroup("a:b");
    expect(mockBump).toHaveBeenCalledTimes(2);
    clearDismissedDuplicates();
    expect(mockBump).toHaveBeenCalledTimes(3);
  });
});
