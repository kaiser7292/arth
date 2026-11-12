import { applyAmfiNavs, parseAmfiDate, parseAmfiNavFile } from "@/services/amfi-nav";

const FILE = [
  "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date",
  " ",
  "Open Ended Schemes(Children's Fund - Childrens' Fund)",
  " ",
  "Axis Mutual Fund",
  "135762;INF846K01WO1;-;Axis Children's Fund;Direct Plan;Growth Option;31.0915;11-Nov-2026",
  "135765;INF846K01WP8;INF846K01WQ6;Axis Children's Fund;Direct Plan;IDCW Option;28.6409;11-Nov-2026",
  "135766;INF846K01ZZ1;-;Some Closed Fund;Direct Plan;Growth Option;N.A.;11-Nov-2026",
  // The older six-column layout reads the same.
  "100001;INF000A01AB2;-;Old Layout Fund;12.5;10-Nov-2026",
].join("\r\n");

describe("AMFI NAV file", () => {
  it("reads dates", () => {
    expect(parseAmfiDate("11-Nov-2026")).toBe("2026-11-11");
    expect(parseAmfiDate("1-Jan-2027")).toBe("2027-01-01");
    expect(parseAmfiDate("N.A.")).toBeNull();
  });

  it("keeps only the ISINs asked for, from either ISIN column, in any layout", () => {
    const navs = parseAmfiNavFile(
      FILE,
      new Set(["INF846K01WO1", "INF846K01WQ6", "INF846K01ZZ1", "INF000A01AB2"]),
    );
    expect(navs).toEqual({
      INF846K01WO1: { nav: 31.0915, date: "2026-11-11" },
      INF846K01WQ6: { nav: 28.6409, date: "2026-11-11" },
      INF000A01AB2: { nav: 12.5, date: "2026-11-10" },
    });
  });
});

describe("applyAmfiNavs", () => {
  const holding = {
    tradingsymbol: "INF846K01WO1",
    last_price: 30,
    last_price_date: "2026-11-10",
    average_price: 25,
    quantity: 10,
    pnl: 50,
  };

  it("uses AMFI's NAV when it is newer and recomputes the gain", () => {
    const r = applyAmfiNavs([holding], { INF846K01WO1: { nav: 31, date: "2026-11-11" } });
    expect(r.updated).toBe(1);
    expect(r.asOf).toBe("2026-11-11");
    expect(r.holdings[0]).toMatchObject({ last_price: 31, last_price_date: "2026-11-11", pnl: 60 });
  });

  it("leaves the broker's price when it is as new or newer", () => {
    const r = applyAmfiNavs([{ ...holding, last_price_date: "2026-11-11 00:00:00" }], {
      INF846K01WO1: { nav: 31, date: "2026-11-11" },
    });
    expect(r.updated).toBe(0);
    expect(r.holdings[0].last_price).toBe(30);
  });
});
