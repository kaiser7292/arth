/**
 * The startup loader waits for Home's own data, not the whole 14-section preload - and never
 * longer than its cap.
 *
 * Every service home-preload imports is replaced by a stub whose functions resolve right away,
 * except the ones a test deliberately holds open: getInsights (Insights section only) and
 * scanAllDuplicatesCached (Home section).
 */

const mockHold: { insights: Promise<unknown> | null; duplicates: Promise<unknown> | null } = {
  insights: null,
  duplicates: null,
};

function mockStubModule(overrides: Record<string, (...a: unknown[]) => unknown> = {}) {
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "__esModule") return true;
        if (typeof prop === "string" && overrides[prop]) return overrides[prop];
        return async () => [];
      },
    },
  );
}

jest.mock("@/constants/app", () => ({ DEFAULT_USER_ID: "u" }));
jest.mock("@/utils/logger", () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("@/services/settings", () => ({ getDataVersion: () => 1 }));
jest.mock("@/utils/budget-helpers", () => ({ getMonthDateRange: () => ({ startDate: "2026-09-01", endDate: "2026-09-30" }) }));
jest.mock("@/utils/fiscal-year", () => mockStubModule());
jest.mock("@/services/insight-engine", () =>
  mockStubModule({ getInsights: () => mockHold.insights ?? Promise.resolve([]) }),
);
jest.mock("@/services/duplicate-detection", () =>
  mockStubModule({ scanAllDuplicatesCached: () => mockHold.duplicates ?? Promise.resolve({ groups: [] }) }),
);
for (const m of [
  "account-balance", "account-master", "account-transfer", "analytics-forecast", "balance-sheet",
  "balance-source", "budget", "category", "comparison-insights", "expense", "financial-account",
  "financial-cockpit", "hisaab", "investment-accounts", "life-milestone", "loan-accounts",
  "merchant-alias", "payment-mode", "recurring-rules", "reminder-matching", "salary-profile",
  "smart-rules", "tags", "vault", "yearly-plan",
]) {
  jest.doMock(`@/services/${m}`, () => mockStubModule());
}

const never = <T,>() => new Promise<T>(() => {});

beforeEach(() => {
  jest.resetModules();
  mockHold.insights = null;
  mockHold.duplicates = null;
});

describe("startup loader waits for Home's data only", () => {
  it("is released as soon as Home's section is done, while Insights is still loading", async () => {
    mockHold.insights = never();
    const { preloadHomeData, waitForHomeSection } = require("../../services/home-preload");
    let fullPreloadDone = false;
    preloadHomeData().then(() => {
      fullPreloadDone = true;
    });
    await expect(waitForHomeSection(2000)).resolves.toBe(true);
    expect(fullPreloadDone).toBe(false);
  });

  it("gives up at the cap when Home's own data is slow", async () => {
    mockHold.duplicates = never();
    const { preloadHomeData, waitForHomeSection } = require("../../services/home-preload");
    void preloadHomeData();
    const started = Date.now();
    await expect(waitForHomeSection(60)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
