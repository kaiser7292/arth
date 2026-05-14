/**
 * v15 onboarding migration + gating tests.
 *
 * Critical invariant: upgraders from <=14.7 who already have data must NEVER
 * see the wizard on first launch of 15.x. `migrateExistingUser()` stamps
 * them "pre-existing" so the layout redirect short-circuits.
 */

type MockRow = Record<string, unknown>;

let mockRows: Record<string, MockRow[]> = {};
let mockStore: Record<string, string | number> = {};

const mockDb = {
  getFirstAsync: jest.fn(async (sql: string) => {
    const rows = mockRows[sql] ?? [];
    return rows[0] ?? null;
  }),
  getAllAsync: jest.fn(async (sql: string) => mockRows[sql] ?? []),
  runAsync: jest.fn(async () => ({ changes: 1, lastInsertRowId: 1 })),
};

jest.mock("../../database", () => ({
  getDatabase: () => mockDb,
}));

// Stub MMKV inline — the real module pulls native bindings that Jest can't
// resolve in a unit environment.
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: (key: string) => {
      const value = mockStore[key];
      return typeof value === "string" ? value : undefined;
    },
    getNumber: (key: string) => {
      const value = mockStore[key];
      return typeof value === "number" ? value : undefined;
    },
    set: (key: string, value: string | number) => {
      mockStore[key] = value;
    },
    delete: (key: string) => {
      delete mockStore[key];
    },
    addOnValueChangedListener: () => ({ remove: () => {} }),
  })),
}));

jest.mock("expo-constants", () => ({
  default: {
    expoConfig: { version: "15.0.0" },
  },
}));

import { migrateExistingUser, getCurrentAppVersion } from "../../services/onboarding";
import {
  getOnboardingCompletedVersion,
  setOnboardingCompletedVersion,
  clearOnboardingCompletedVersion,
} from "../../services/settings";

describe("migrateExistingUser", () => {
  beforeEach(() => {
    mockRows = {};
    mockStore = {};
    jest.clearAllMocks();
  });

  it("is a no-op when the stamp already exists", async () => {
    setOnboardingCompletedVersion("pre-existing");
    mockRows["SELECT 1 AS n FROM expenses LIMIT 1;"] = [{ n: 1 }];

    await migrateExistingUser();

    // Stamp unchanged
    expect(getOnboardingCompletedVersion()).toBe("pre-existing");
    // Should NOT query the DB — early return before any getFirstAsync.
    expect(mockDb.getFirstAsync).not.toHaveBeenCalled();
  });

  it("stamps 'pre-existing' when expenses exist", async () => {
    mockRows["SELECT 1 AS n FROM expenses LIMIT 1;"] = [{ n: 1 }];

    await migrateExistingUser();

    expect(getOnboardingCompletedVersion()).toBe("pre-existing");
  });

  it("stamps 'pre-existing' when a financial_account exists (no expenses)", async () => {
    mockRows["SELECT 1 AS n FROM expenses LIMIT 1;"] = [];
    mockRows["SELECT 1 AS n FROM financial_accounts LIMIT 1;"] = [{ n: 1 }];

    await migrateExistingUser();

    expect(getOnboardingCompletedVersion()).toBe("pre-existing");
  });

  it("leaves the stamp null on a genuinely fresh install", async () => {
    mockRows["SELECT 1 AS n FROM expenses LIMIT 1;"] = [];
    mockRows["SELECT 1 AS n FROM financial_accounts LIMIT 1;"] = [];

    await migrateExistingUser();

    expect(getOnboardingCompletedVersion()).toBeNull();
  });
});

describe("onboarding completion stamp", () => {
  beforeEach(() => {
    mockStore = {};
  });

  it("set/get round-trip", () => {
    setOnboardingCompletedVersion("15.0.0");
    expect(getOnboardingCompletedVersion()).toBe("15.0.0");
  });

  it("clear removes the stamp", () => {
    setOnboardingCompletedVersion("15.0.0");
    clearOnboardingCompletedVersion();
    expect(getOnboardingCompletedVersion()).toBeNull();
  });
});

describe("getCurrentAppVersion", () => {
  it("reads from expo-constants", () => {
    expect(getCurrentAppVersion()).toBe("15.0.0");
  });
});
