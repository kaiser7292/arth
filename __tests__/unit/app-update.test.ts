/**
 * The "new version" check: Google Play only, never an older or dismissed version, nothing when
 * turned off, and nothing at all for a copy that didn't come from Play. It never goes online itself.
 */

const mockStore = new Map<string, unknown>();
jest.mock("@/services/storage", () => ({
  settingsStorage: {
    getString: (k: string) => mockStore.get(k) as string | undefined,
    getBoolean: (k: string) => mockStore.get(k) as boolean | undefined,
    set: (k: string, v: unknown) => mockStore.set(k, v),
  },
}));

const mockNative = { installer: null as string | null, playCode: null as number | null, started: 0 };
jest.mock("../../modules/arth-app-updates", () => ({
  installerPackage: () => mockNative.installer,
  playUpdate: async () => mockNative.playCode,
  startPlayUpdate: async () => {
    mockNative.started++;
    return true;
  },
}));

jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "4.28.1" } } }));

jest.mock("react-native", () => ({ Platform: { OS: "android" } }));

import { checkForUpdate, compareVersions, dismissUpdate, installUpdate, setUpdateCheckEnabled, versionFromCode } from "@/services/app-update";

const fetchMock = jest.fn();
beforeEach(() => {
  mockStore.clear();
  mockNative.installer = "com.android.vending";
  mockNative.playCode = null;
  mockNative.started = 0;
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
});

test("versions compare as numbers, and version codes decode", () => {
  expect(compareVersions("4.28.10", "4.28.9")).toBeGreaterThan(0);
  expect(compareVersions("v4.28.1", "4.28.1")).toBe(0);
  expect(compareVersions("4.27.0", "4.28.1")).toBeLessThan(0);
  expect(versionFromCode(42802)).toBe("4.28.2");
  expect(versionFromCode(50000)).toBe("5.0.0");
});

test("a Play install asks Play and opens Play's update", async () => {
  mockNative.playCode = 42802;
  const u = await checkForUpdate();
  expect(u).toEqual({ source: "play", version: "4.28.2" });
  await installUpdate(u!);
  expect(mockNative.started).toBe(1);
  mockNative.playCode = null;
  expect(await checkForUpdate()).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a copy not installed from Play doesn't check anywhere", async () => {
  mockNative.installer = null;
  mockNative.playCode = 42802;
  expect(await checkForUpdate({ force: true })).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("nothing for the same or an older version, a dismissed one, or when turned off", async () => {
  mockNative.playCode = 42801;
  expect(await checkForUpdate({ force: true })).toBeNull();
  mockNative.playCode = 42802;
  dismissUpdate("4.28.2");
  expect(await checkForUpdate()).toBeNull();
  expect((await checkForUpdate({ force: true }))?.version).toBe("4.28.2");
  setUpdateCheckEnabled(false);
  expect(await checkForUpdate({ force: true })).toBeNull();
});
