import { defaultEntryDate } from "../../utils/ledger-dates";

describe("defaultEntryDate (ledger FAB: Add credit / Add transfer)", () => {
  it("uses today when today is in the viewed month", () => {
    expect(defaultEntryDate("2026-11-16", "2026-11-01", "2026-11-30")).toBe("2026-11-16");
  });
  it("uses the viewed month's first day for a past month", () => {
    expect(defaultEntryDate("2026-11-16", "2026-08-01", "2026-08-31")).toBe("2026-08-01");
  });
  it("uses the first day for a future month too", () => {
    expect(defaultEntryDate("2026-11-16", "2026-12-01", "2026-12-31")).toBe("2026-12-01");
  });
  it("counts the month's edges as inside it", () => {
    expect(defaultEntryDate("2026-11-01", "2026-11-01", "2026-11-30")).toBe("2026-11-01");
    expect(defaultEntryDate("2026-11-30", "2026-11-01", "2026-11-30")).toBe("2026-11-30");
  });
});
