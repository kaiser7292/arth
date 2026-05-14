/**
 * v15.11.0 — sender-based template routing tests.
 *
 * Covers the three match modes (code / exact / contains) and the DLT code
 * extraction that powers the default "code" mode.
 */

// Mock the DB wrapper so we can import the matcher module without a real
// sqlite connection. The tests only exercise the pure senderMatches helper.
jest.mock("@/database", () => ({
  getDatabase: () => ({}),
}));
jest.mock("@/services/sms/bank-senders", () => ({
  identifyBank: () => null,
}));
jest.mock("../../services/public-data/lookup", () => ({
  resolveBankFromSender: async () => null,
}));

import { __test__ } from "@/services/public-data/sms-template-matcher";

const { senderMatches } = __test__;

type TR = {
  sender_match_mode: string | null;
  sender_pattern: string | null;
};

const codeOf = (addr: string) =>
  addr.toUpperCase().match(/[A-Z]{4,}/)?.[0] ?? null;

describe("senderMatches — v15.11.0", () => {
  describe("code mode (default)", () => {
    it("matches different prefixes on the same bank code", () => {
      const row: TR = { sender_match_mode: "code", sender_pattern: "HDFCBK" };
      expect(senderMatches(row as never, "VM-HDFCBK-S", codeOf("VM-HDFCBK-S"))).toBe(true);
      expect(senderMatches(row as never, "AD-HDFCBK-T", codeOf("AD-HDFCBK-T"))).toBe(true);
      expect(senderMatches(row as never, "JD-HDFCBK", codeOf("JD-HDFCBK"))).toBe(true);
    });

    it("does not cross-match different banks", () => {
      const row: TR = { sender_match_mode: "code", sender_pattern: "MYTNEU" };
      expect(senderMatches(row as never, "VM-HDFCBK-S", codeOf("VM-HDFCBK-S"))).toBe(false);
    });

    it("is case-insensitive", () => {
      const row: TR = { sender_match_mode: "code", sender_pattern: "mytneu" };
      expect(senderMatches(row as never, "vm-mytneu-s", codeOf("vm-mytneu-s"))).toBe(true);
    });

    it("returns false when the incoming sender has no DLT-style code", () => {
      const row: TR = { sender_match_mode: "code", sender_pattern: "MYTNEU" };
      expect(senderMatches(row as never, "12345", codeOf("12345"))).toBe(false);
    });
  });

  describe("exact mode", () => {
    it("matches only the literal sender string (case-insensitive)", () => {
      const row: TR = { sender_match_mode: "exact", sender_pattern: "VM-MYTNEU-S" };
      expect(senderMatches(row as never, "VM-MYTNEU-S", codeOf("VM-MYTNEU-S"))).toBe(true);
      expect(senderMatches(row as never, "vm-mytneu-s", codeOf("vm-mytneu-s"))).toBe(true);
    });

    it("rejects different prefix / suffix", () => {
      const row: TR = { sender_match_mode: "exact", sender_pattern: "VM-MYTNEU-S" };
      expect(senderMatches(row as never, "AD-MYTNEU-T", codeOf("AD-MYTNEU-T"))).toBe(false);
      expect(senderMatches(row as never, "VM-MYTNEU", codeOf("VM-MYTNEU"))).toBe(false);
    });
  });

  describe("contains mode", () => {
    it("matches any sender with the substring", () => {
      const row: TR = { sender_match_mode: "contains", sender_pattern: "MYTNEU" };
      expect(senderMatches(row as never, "VM-MYTNEU-S", codeOf("VM-MYTNEU-S"))).toBe(true);
      expect(senderMatches(row as never, "MYTNEU-COINS", codeOf("MYTNEU-COINS"))).toBe(true);
    });

    it("is case-insensitive", () => {
      const row: TR = { sender_match_mode: "contains", sender_pattern: "mytneu" };
      expect(senderMatches(row as never, "VM-MYTNEU-S", codeOf("VM-MYTNEU-S"))).toBe(true);
    });
  });

  describe("null guards", () => {
    it("returns false when mode is null", () => {
      const row: TR = { sender_match_mode: null, sender_pattern: "MYTNEU" };
      expect(senderMatches(row as never, "VM-MYTNEU-S", "MYTNEU")).toBe(false);
    });
    it("returns false when pattern is null", () => {
      const row: TR = { sender_match_mode: "code", sender_pattern: null };
      expect(senderMatches(row as never, "VM-MYTNEU-S", "MYTNEU")).toBe(false);
    });
  });
});
