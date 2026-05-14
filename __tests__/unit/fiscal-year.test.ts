import {
  getCurrentFY,
  getFYRange,
  getFYLabel,
  getFiscalMonth,
  getFYMonthLabels,
} from "../../utils/fiscal-year";

describe("getCurrentFY", () => {
  describe("Indian FY (startMonth=4, Apr-Mar)", () => {
    it("returns 2026 for June 2026", () => {
      expect(getCurrentFY(4, new Date(2026, 5, 15))).toBe(2026); // June = month 5 (0-based)
    });

    it("returns 2026 for April 1 2026 (first day of FY)", () => {
      expect(getCurrentFY(4, new Date(2026, 3, 1))).toBe(2026);
    });

    it("returns 2025 for March 31 2026 (last day of previous FY)", () => {
      expect(getCurrentFY(4, new Date(2026, 2, 31))).toBe(2025);
    });

    it("returns 2025 for January 2026", () => {
      expect(getCurrentFY(4, new Date(2026, 0, 15))).toBe(2025);
    });

    it("returns 2026 for December 2026", () => {
      expect(getCurrentFY(4, new Date(2026, 11, 25))).toBe(2026);
    });
  });

  describe("Calendar year (startMonth=1, Jan-Dec)", () => {
    it("returns 2026 for any month in 2026", () => {
      expect(getCurrentFY(1, new Date(2026, 0, 1))).toBe(2026);
      expect(getCurrentFY(1, new Date(2026, 6, 15))).toBe(2026);
      expect(getCurrentFY(1, new Date(2026, 11, 31))).toBe(2026);
    });
  });

  describe("Australian FY (startMonth=7, Jul-Jun)", () => {
    it("returns 2026 for August 2026", () => {
      expect(getCurrentFY(7, new Date(2026, 7, 15))).toBe(2026);
    });

    it("returns 2025 for June 2026", () => {
      expect(getCurrentFY(7, new Date(2026, 5, 15))).toBe(2025);
    });

    it("returns 2026 for July 1 2026 (first day)", () => {
      expect(getCurrentFY(7, new Date(2026, 6, 1))).toBe(2026);
    });
  });
});

describe("getFYRange", () => {
  describe("Indian FY (startMonth=4)", () => {
    it("returns Apr 1 2026 to Mar 31 2027 for FY 2026", () => {
      const { start, end } = getFYRange(2026, 4);
      expect(start.getFullYear()).toBe(2026);
      expect(start.getMonth()).toBe(3); // April (0-based)
      expect(start.getDate()).toBe(1);
      expect(end.getFullYear()).toBe(2027);
      expect(end.getMonth()).toBe(2); // March (0-based)
      expect(end.getDate()).toBe(31);
    });
  });

  describe("Calendar year (startMonth=1)", () => {
    it("returns Jan 1 to Dec 31 for FY 2026", () => {
      const { start, end } = getFYRange(2026, 1);
      expect(start.getFullYear()).toBe(2026);
      expect(start.getMonth()).toBe(0);
      expect(start.getDate()).toBe(1);
      expect(end.getFullYear()).toBe(2026);
      expect(end.getMonth()).toBe(11);
      expect(end.getDate()).toBe(31);
    });
  });

  describe("Australian FY (startMonth=7)", () => {
    it("returns Jul 1 2026 to Jun 30 2027 for FY 2026", () => {
      const { start, end } = getFYRange(2026, 7);
      expect(start.getFullYear()).toBe(2026);
      expect(start.getMonth()).toBe(6); // July
      expect(start.getDate()).toBe(1);
      expect(end.getFullYear()).toBe(2027);
      expect(end.getMonth()).toBe(5); // June
      expect(end.getDate()).toBe(30);
    });
  });

  it("handles leap year correctly for Feb end month (startMonth=3)", () => {
    // FY starting in March: ends in February
    const { end } = getFYRange(2024, 3); // 2024 is a leap year
    expect(end.getFullYear()).toBe(2025);
    expect(end.getMonth()).toBe(1); // February
    expect(end.getDate()).toBe(28); // 2025 is not a leap year
  });
});

describe("getFYLabel", () => {
  it("returns 'FY 2026-27' for Indian FY", () => {
    expect(getFYLabel(2026, 4)).toBe("FY 2026-27");
  });

  it("returns 'FY 2026' for calendar year", () => {
    expect(getFYLabel(2026, 1)).toBe("FY 2026");
  });

  it("returns 'FY 2099-00' for century boundary", () => {
    expect(getFYLabel(2099, 4)).toBe("FY 2099-00");
  });

  it("returns 'FY 2026-27' for Australian FY", () => {
    expect(getFYLabel(2026, 7)).toBe("FY 2026-27");
  });
});

describe("getFiscalMonth", () => {
  describe("Indian FY (startMonth=4)", () => {
    it("April is fiscal month 1", () => {
      expect(getFiscalMonth(4, new Date(2026, 3, 15))).toBe(1);
    });

    it("March is fiscal month 12", () => {
      expect(getFiscalMonth(4, new Date(2027, 2, 15))).toBe(12);
    });

    it("January is fiscal month 10", () => {
      expect(getFiscalMonth(4, new Date(2027, 0, 15))).toBe(10);
    });
  });

  describe("Calendar year (startMonth=1)", () => {
    it("January is fiscal month 1", () => {
      expect(getFiscalMonth(1, new Date(2026, 0, 15))).toBe(1);
    });

    it("December is fiscal month 12", () => {
      expect(getFiscalMonth(1, new Date(2026, 11, 15))).toBe(12);
    });
  });
});

describe("getFYMonthLabels", () => {
  it("returns Apr-Mar for Indian FY", () => {
    const labels = getFYMonthLabels(4);
    expect(labels).toEqual([
      "Apr", "May", "Jun", "Jul", "Aug", "Sep",
      "Oct", "Nov", "Dec", "Jan", "Feb", "Mar",
    ]);
  });

  it("returns Jan-Dec for calendar year", () => {
    const labels = getFYMonthLabels(1);
    expect(labels).toEqual([
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]);
  });

  it("returns Jul-Jun for Australian FY", () => {
    const labels = getFYMonthLabels(7);
    expect(labels[0]).toBe("Jul");
    expect(labels[11]).toBe("Jun");
  });
});
