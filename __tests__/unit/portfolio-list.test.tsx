import React from "react";
import { fireEvent, render, within } from "@testing-library/react-native";

jest.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light", setColorScheme: jest.fn() }),
}));
const mockStorage = new Map<string, string>();
jest.mock("../../services/storage", () => ({
  settingsStorage: {
    getString: jest.fn((k: string) => mockStorage.get(k)),
    set: jest.fn((k: string, v: string) => { mockStorage.set(k, v); }),
  },
}));
jest.mock("../../utils/format", () => ({ formatAmount: (n: number) => `₹${Math.round(n)}` }));

import {
  PortfolioSearchSort,
  PortfolioSection,
  PortfolioSummary,
  usePortfolioView,
} from "../../components/portfolio/PortfolioList";
import type { PortfolioRow } from "../../services/portfolio-rows";

const rows: PortfolioRow[] = [
  { key: "a", title: "Mirae ELSS", details: ["443.603 units · avg ₹34"], value: 25230, pnl: { amount: 10231, pct: 68.2 } },
  { key: "b", title: "HDFC Nifty 50", details: ["132.688 units · avg ₹238"], value: 30410, pnl: { amount: -1187, pct: -3.75 } },
  { key: "c", title: "ICICI ELSS", details: ["5.189 units · avg ₹1060"], value: 5353, pnl: { amount: -147, pct: -2.7 } },
];

function Harness() {
  const { query, setQuery, sort, changeSort, view } = usePortfolioView("test");
  return (
    <>
      <PortfolioSearchSort query={query} onQuery={setQuery} sort={sort} onSort={changeSort} />
      <PortfolioSection title="Mutual funds" rows={view(rows)} total={rows.length} />
    </>
  );
}

function titles(getAllByText: (t: RegExp) => any[]) {
  return getAllByText(/ELSS|Nifty/).map((n) => n.props.children);
}

beforeEach(() => mockStorage.clear());

describe("PortfolioList", () => {
  it("renders rows in one section, sorted by value by default, with P&L and %", () => {
    const { getByText, getAllByText } = render(<Harness />);
    expect(getByText("Mutual funds (3)")).toBeTruthy();
    expect(titles(getAllByText)).toEqual(["HDFC Nifty 50", "Mirae ELSS", "ICICI ELSS"]);
    expect(getByText("+₹10231 (+68.20%)")).toBeTruthy();
    expect(getByText("-₹1187 (-3.75%)")).toBeTruthy();
  });

  it("filters by search and shows the matched count", () => {
    const { getByPlaceholderText, getByText, getAllByText } = render(<Harness />);
    fireEvent.changeText(getByPlaceholderText("Search by name or symbol"), "elss");
    expect(getByText("Mutual funds (2 of 3)")).toBeTruthy();
    expect(titles(getAllByText)).toEqual(["Mirae ELSS", "ICICI ELSS"]);
  });

  it("sorts by P&L % and flips on a second tap, remembering the choice", () => {
    const { getByText, getAllByText } = render(<Harness />);
    fireEvent.press(getByText("P&L %"));
    expect(titles(getAllByText)).toEqual(["Mirae ELSS", "ICICI ELSS", "HDFC Nifty 50"]);
    fireEvent.press(getByText("P&L % ↓"));
    expect(titles(getAllByText)).toEqual(["HDFC Nifty 50", "ICICI ELSS", "Mirae ELSS"]);
    expect(JSON.parse(mockStorage.get("portfolio_sort:test")!)).toEqual({ key: "pnlPct", dir: "asc" });
  });

  it("summary shows current, invested, P&L and funds, and hides what is missing", () => {
    const { getByText, queryByText, rerender } = render(
      <PortfolioSummary current={60993} invested={52000} funds={1200} onSaveSnapshot={() => {}} saving={false} />,
    );
    expect(getByText("Current value")).toBeTruthy();
    expect(getByText("Invested")).toBeTruthy();
    expect(getByText("+₹8993 (+17.29%)")).toBeTruthy();
    expect(getByText("Available funds")).toBeTruthy();

    rerender(<PortfolioSummary current={7400} onSaveSnapshot={() => {}} saving={false} />);
    expect(queryByText("Invested")).toBeNull();
    expect(queryByText("P&L")).toBeNull();
    expect(queryByText("Available funds")).toBeNull();
  });
});
