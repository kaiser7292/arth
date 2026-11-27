/** Speed (docs/SPEED_AND_VOICE_PROPOSAL.md part 1): the cache and the load timings. */
let mockVersion = 1;
let mockFyStart = 4;
jest.mock("@/services/settings", () => ({
  getDataVersion: () => mockVersion,
  getFYStartMonth: () => mockFyStart,
}));
const mockStore = new Map<string, string>();
jest.mock("@/services/storage", () => ({
  settingsStorage: {
    getString: (k: string) => mockStore.get(k),
    set: (k: string, v: string) => mockStore.set(k, v),
    delete: (k: string) => mockStore.delete(k),
  },
}));

import { __resetVersionCache, __useCacheInTests, cachedByVersion, peekCached } from "@/services/version-cache";
import { summariseLoads, type LoadTiming } from "@/services/load-timings";

describe("remembered until something changes", () => {
  beforeEach(() => {
    __useCacheInTests(true);
    __resetVersionCache();
    mockVersion = 1;
    mockFyStart = 4;
  });
  afterAll(() => __useCacheInTests(false));

  it("reuses an answer for the same arguments, not for others", async () => {
    const fn = jest.fn(async (m: string) => `report ${m}`);
    const cached = cachedByVersion("t1", fn);
    expect(await cached("2026-11")).toBe("report 2026-11");
    expect(await cached("2026-11")).toBe("report 2026-11");
    expect(fn).toHaveBeenCalledTimes(1);
    await cached("2026-10");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(peekCached("t1", "2026-11")).toBe("report 2026-11");
  });

  it("works it out again after a save or a new financial-year start", async () => {
    const fn = jest.fn(async () => Math.random());
    const cached = cachedByVersion("t2", fn);
    const a = await cached();
    mockVersion = 2;
    const b = await cached();
    expect(b).not.toBe(a);
    mockFyStart = 1;
    await cached();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("never remembers a failure", async () => {
    let fail = true;
    const fn = jest.fn(async () => {
      if (fail) throw new Error("db busy");
      return "ok";
    });
    const cached = cachedByVersion("t3", fn);
    await expect(cached()).rejects.toThrow("db busy");
    fail = false;
    expect(await cached()).toBe("ok");
  });

  it("is off in tests unless switched on, so tests writing rows directly see them", async () => {
    __useCacheInTests(false);
    const fn = jest.fn(async () => 1);
    const cached = cachedByVersion("t4", fn);
    await cached();
    await cached();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("load timings", () => {
  it("per screen: typical (middle) and slowest, slowest screens first", () => {
    const t = (screen: string, ms: number): LoadTiming => ({ screen, why: "focus", ms, at: 0 });
    const s = summariseLoads([t("/a", 100), t("/a", 300), t("/a", 200), t("/b", 900)]);
    expect(s[0]).toMatchObject({ screen: "/b", typical: 900, slowest: 900, count: 1 });
    expect(s[1]).toMatchObject({ screen: "/a", typical: 200, slowest: 300, count: 3 });
  });
});
