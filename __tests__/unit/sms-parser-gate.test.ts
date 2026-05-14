/**
 * v15.11.1 regression test — wallet SMSes with no transaction keywords
 * should still trigger template matching when a user has authored a
 * sender-scoped template. Pre-v15.11.1 the keyword heuristic rejected
 * these SMSes before the matcher ran.
 *
 * Tests the core `hasSenderScopedUserTemplate` helper that the parser
 * uses to bypass the keyword gate.
 */

jest.mock("@/database", () => {
  const rows: unknown[] = [];
  return {
    getDatabase: () => ({
      getAllAsync: jest.fn().mockImplementation(async () => rows),
    }),
    __setMockRows: (r: unknown[]) => {
      rows.length = 0;
      rows.push(...r);
    },
  };
});

jest.mock("@/services/settings", () => ({
  bumpDataVersion: jest.fn(),
}));
jest.mock("@/utils/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn() },
}));
jest.mock("@/constants/app", () => ({
  DEFAULT_USER_ID: "user-1",
}));

import { hasSenderScopedUserTemplate } from "@/services/sms/user-sms-templates";
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const { __setMockRows } = require("@/database") as any;

describe("hasSenderScopedUserTemplate — v15.11.1", () => {
  it("returns false when no user templates exist", async () => {
    __setMockRows([]);
    const result = await hasSenderScopedUserTemplate("VM-MYTNEU-S");
    expect(result).toBe(false);
  });

  it("matches by code when template has mode=code", async () => {
    __setMockRows([{ sender_match_mode: "code", sender_pattern: "MYTNEU" }]);
    expect(await hasSenderScopedUserTemplate("VM-MYTNEU-S")).toBe(true);
    expect(await hasSenderScopedUserTemplate("AD-MYTNEU-T")).toBe(true);
    expect(await hasSenderScopedUserTemplate("VM-HDFCBK-S")).toBe(false);
  });

  it("matches by exact when mode=exact", async () => {
    __setMockRows([{ sender_match_mode: "exact", sender_pattern: "VM-MYTNEU-S" }]);
    expect(await hasSenderScopedUserTemplate("VM-MYTNEU-S")).toBe(true);
    expect(await hasSenderScopedUserTemplate("vm-mytneu-s")).toBe(true); // case-insensitive
    expect(await hasSenderScopedUserTemplate("AD-MYTNEU-T")).toBe(false);
  });

  it("matches by substring when mode=contains", async () => {
    __setMockRows([{ sender_match_mode: "contains", sender_pattern: "MYTNEU" }]);
    expect(await hasSenderScopedUserTemplate("VM-MYTNEU-COINS")).toBe(true);
    expect(await hasSenderScopedUserTemplate("RANDOM-MYTNEU")).toBe(true);
    expect(await hasSenderScopedUserTemplate("AXIS-BANK")).toBe(false);
  });

  it("returns false when mode or pattern is null", async () => {
    __setMockRows([{ sender_match_mode: null, sender_pattern: "MYTNEU" }]);
    expect(await hasSenderScopedUserTemplate("VM-MYTNEU-S")).toBe(false);
    __setMockRows([{ sender_match_mode: "code", sender_pattern: null }]);
    expect(await hasSenderScopedUserTemplate("VM-MYTNEU-S")).toBe(false);
  });

  it("short-circuits on first match when multiple templates exist", async () => {
    __setMockRows([
      { sender_match_mode: "code", sender_pattern: "AMAZONPAY" },
      { sender_match_mode: "code", sender_pattern: "MYTNEU" },
      { sender_match_mode: "contains", sender_pattern: "TATA" },
    ]);
    expect(await hasSenderScopedUserTemplate("VM-MYTNEU-S")).toBe(true);
  });

  it("handles empty sender address gracefully", async () => {
    __setMockRows([{ sender_match_mode: "code", sender_pattern: "MYTNEU" }]);
    expect(await hasSenderScopedUserTemplate("")).toBe(false);
  });
});
