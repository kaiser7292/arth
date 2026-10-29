/**
 * The "new version" check: Play for Play installs, GitHub (once a day) for APKs, never an older or
 * dismissed version, and nothing when turned off.
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

jest.mock("react-native", () => ({ Platform: { OS: "android" }, Linking: { openURL: jest.fn(async () => true) } }));

import { checkForUpdate, compareVersions, dismissUpdate, installUpdate, setUpdateCheckEnabled, versionFromCode } from "@/services/app-update";

let fetches = 0;
let latest = "v4.28.2";
beforeEach(() => {
  mockStore.clear();
  mockNative.installer = null;
  mockNative.playCode = null;
  fetches = 0;
  latest = "v4.28.2";
  global.fetch = jest.fn(async () => {
    fetches++;
    return {
      ok: true,
      json: async () => ({
        tag_name: latest,
        html_url: "https://github.com/kaiser7292/arth/releases/tag/" + latest,
        assets: [{ name: `Arth-${latest.slice(1)}.apk`, browser_download_url: `https://github.com/x/Arth-${latest.slice(1)}.apk` }],
      }),
    };
  }) as unknown as typeof fetch;
});

test("versions compare as numbers, and version codes decode", () => {
  expect(compareVersions("4.28.10", "4.28.9")).toBeGreaterThan(0);
  expect(compareVersions("v4.28.1", "4.28.1")).toBe(0);
  expect(compareVersions("4.27.0", "4.28.1")).toBeLessThan(0);
  expect(versionFromCode(42802)).toBe("4.28.2");
  expect(versionFromCode(50000)).toBe("5.0.0");
});

test("an APK install asks GitHub, at most once a day, and offers the APK", async () => {
  const now = Date.UTC(2026, 9, 29);
  const u = await checkForUpdate({ now });
  expect(u).toEqual({ source: "github", version: "4.28.2", url: "https://github.com/x/Arth-4.28.2.apk" });
  await checkForUpdate({ now: now + 60_000 });
  expect(fetches).toBe(1); // the second answer came from the cache
  await checkForUpdate({ now: now + 25 * 3600_000 });
  expect(fetches).toBe(2);
});

test("a Play install asks Play, never GitHub, and opens Play's update", async () => {
  mockNative.installer = "com.android.vending";
  mockNative.playCode = 42802;
  const u = await checkForUpdate();
  expect(u).toEqual({ source: "play", version: "4.28.2" });
  expect(fetches).toBe(0);
  await installUpdate(u!);
  expect(mockNative.started).toBe(1);
  mockNative.playCode = null;
  expect(await checkForUpdate()).toBeNull();
});

test("nothing for the same or an older version, a dismissed one, or when turned off", async () => {
  latest = "v4.28.1";
  expect(await checkForUpdate({ force: true })).toBeNull();
  latest = "v4.28.2";
  dismissUpdate("4.28.2");
  expect(await checkForUpdate({ force: false, now: 1 })).toBeNull();
  latest = "v4.28.3";
  expect((await checkForUpdate({ force: true }))?.version).toBe("4.28.3");
  setUpdateCheckEnabled(false);
  expect(await checkForUpdate({ force: true })).toBeNull();
});

test("offline is quiet", async () => {
  global.fetch = jest.fn(async () => {
    throw new Error("Network request failed");
  }) as unknown as typeof fetch;
  expect(await checkForUpdate({ force: true })).toBeNull();
});
