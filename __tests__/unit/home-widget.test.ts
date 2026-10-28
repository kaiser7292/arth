/**
 * Home-screen widgets: the month's pace, due-date labels, what gets masked with the app lock on,
 * and what the review widget's Approve / Reject buttons do.
 */

const mockLockEnabled = jest.fn(() => false);
const mockAmountsHidden = jest.fn(() => false);
const mockHandleAlertAction = jest.fn(async (_a: string, _d: unknown) => true);
const mockGetFirst = jest.fn(async (): Promise<unknown> => ({ total: 30000 }));
const mockGetAll = jest.fn(async (_sql: string): Promise<unknown[]> => []);

jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock("react-native-android-widget", () => ({ requestWidgetUpdate: jest.fn(async () => {}) }));
// The layouts need NativeWind's JSX runtime; these tests only look at what they're given.
jest.mock("../../components/widget/ArthWidgets", () => ({
  WIDGET_APPROVE: "APPROVE",
  WIDGET_REJECT: "REJECT",
  CatchUpWidget: () => null,
  MonthWidget: () => null,
  ReviewWidget: () => null,
}));
jest.mock("../../constants/app", () => ({ DEFAULT_USER_ID: "user-1" }));
jest.mock("../../database", () => ({ initDatabase: async () => ({ getFirstAsync: mockGetFirst, getAllAsync: mockGetAll }) }));
jest.mock("../../services/biometric-lock", () => ({ isLockEnabled: () => mockLockEnabled() }));
jest.mock("../../services/privacy-mode", () => ({ isAmountsHidden: () => mockAmountsHidden() }));
jest.mock("../../services/locale-preferences", () => ({ getCurrency: () => "INR" }));
jest.mock("../../utils/format", () => ({ formatAmount: (n: number) => `₹${Math.round(n)}` }));
jest.mock("../../services/budget", () => ({ getCurrentMonth: () => "2026-10" }));
jest.mock("../../services/expense", () => ({
  getPendingExpenseCount: jest.fn(async () => 2),
  getUncategorizedCount: jest.fn(async () => 1),
  getExpenseTotal: jest.fn(async () => 25150),
}));
jest.mock("../../services/transaction-alerts", () => ({
  handleAlertAction: (a: string, d: unknown) => mockHandleAlertAction(a, d),
}));

import { accountShort, dueLabel, loadWidgetData, monthPace, renderWidget, WIDGET_NAMES } from "../../services/home-widget";
import { widgetTaskHandler } from "../../services/home-widget-task";
import { WIDGET_APPROVE, WIDGET_REJECT } from "../../components/widget/ArthWidgets";

const reviewRow = {
  id: "e1",
  amount: 420,
  nature: "realized",
  merchant_name: "Swiggy",
  description: null,
  category: "Food",
  bank_name: "HDFC",
  account_identifier: "XX4417",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLockEnabled.mockReturnValue(false);
  mockAmountsHidden.mockReturnValue(false);
  mockGetAll.mockImplementation(async (sql: string) =>
    sql.includes("pending_review") ? [reviewRow] : [{ amount: 12340, due_date: "2026-10-31", merchant_name: "HDFC card bill", description: null }],
  );
});

describe("monthPace", () => {
  it("is on pace when spend tracks the month", () => {
    const p = monthPace(15000, 30000, "2026-10-15");
    expect(p.pace).toBe("on");
    expect(p.daysLeft).toBe(17);
    expect(Math.round(p.perDay)).toBe(882);
  });

  it("is over pace when spend runs ahead of the month, and exceeded past the budget", () => {
    expect(monthPace(20000, 30000, "2026-10-10").pace).toBe("over");
    expect(monthPace(31000, 30000, "2026-10-20").pace).toBe("exceeded");
    expect(monthPace(31000, 30000, "2026-10-20").perDay).toBe(0);
  });

  it("is under pace early in a quiet month", () => {
    expect(monthPace(2000, 30000, "2026-10-20").pace).toBe("under");
  });

  it("has no pace without a budget", () => {
    expect(monthPace(5000, 0, "2026-10-20")).toMatchObject({ pace: "none", used: 0 });
  });

  it("counts today among the days left", () => {
    expect(monthPace(0, 1000, "2026-10-31").daysLeft).toBe(1);
  });
});

describe("dueLabel", () => {
  it("names the day", () => {
    expect(dueLabel("2026-10-28", "2026-10-28")).toEqual({ when: "today", overdue: false });
    expect(dueLabel("2026-10-29", "2026-10-28")).toEqual({ when: "tomorrow", overdue: false });
    expect(dueLabel("2026-11-01", "2026-10-28")).toEqual({ when: "in 4 days", overdue: false });
    expect(dueLabel("2026-10-20", "2026-10-28")).toEqual({ when: "overdue", overdue: true });
  });
});

describe("accountShort", () => {
  it("keeps the bank and the last four digits", () => {
    expect(accountShort("HDFC", "XXXX4417")).toBe("HDFC ••4417");
    expect(accountShort("SBI", null)).toBe("SBI");
    expect(accountShort(null, null)).toBe("");
  });
});

describe("loadWidgetData", () => {
  it("shows amounts, merchants and the budget when Arth isn't locked", async () => {
    const d = await loadWidgetData();
    expect(d).toMatchObject({ masked: false, locked: false, toCatchUp: 3, spent: "₹25150", left: "₹4850" });
    expect(d?.review[0]).toMatchObject({ id: "e1", title: "Swiggy", detail: "HDFC ••4417 · Food", amount: "₹420" });
    expect(d?.due[0]).toMatchObject({ title: "HDFC card bill", amount: "₹12340" });
  });

  it("keeps amounts showing with the app lock on, and marks it locked", async () => {
    mockLockEnabled.mockReturnValue(true);
    const d = await loadWidgetData();
    expect(d).toMatchObject({ masked: false, locked: true, spent: "₹25150" });
    expect(d?.review[0].amount).toBe("₹420");
  });

  it("masks every amount when they're hidden in Arth", async () => {
    mockAmountsHidden.mockReturnValue(true);
    const d = await loadWidgetData();
    expect(d).toMatchObject({ masked: true, locked: false, spent: "₹••••", left: "₹••••", budget: "₹••••" });
    expect(d?.review[0].amount).toBe("₹••••");
    expect(d?.due[0].amount).toBe("₹••••");
  });

  it("lists only what the count counts: no items reclassified as transfers", async () => {
    await loadWidgetData();
    const listSql = mockGetAll.mock.calls.map((c) => c[0]).find((sql) => sql.includes("pending_review")) ?? "";
    expect(listSql).toContain("reclassified_as_transfer");
  });

  it("returns null when the database can't be read", async () => {
    mockGetFirst.mockRejectedValueOnce(new Error("boom"));
    expect(await loadWidgetData()).toBeNull();
  });
});

describe("renderWidget", () => {
  it("draws the one-row layout for a summary widget placed one row high", () => {
    const out = renderWidget({ widgetName: WIDGET_NAMES.month, width: 250, height: 70 }, null);
    expect((out.light.props as { compact: boolean }).compact).toBe(true);
    const tall = renderWidget({ widgetName: WIDGET_NAMES.month, width: 250, height: 180 }, null);
    expect((tall.light.props as { compact: boolean }).compact).toBe(false);
  });
});

describe("widgetTaskHandler", () => {
  const base = {
    widgetInfo: { widgetName: WIDGET_NAMES.review, widgetId: 1, width: 300, height: 380, screenInfo: { screenHeightDp: 800, screenWidthDp: 400, density: 3, densityDpi: 480 } },
    renderWidget: jest.fn(),
  };

  it("approves and rejects through the notification path, then redraws", async () => {
    await widgetTaskHandler({ ...base, widgetAction: "WIDGET_CLICK", clickAction: WIDGET_APPROVE, clickActionData: { expenseId: "e1" } });
    expect(mockHandleAlertAction).toHaveBeenCalledWith("approve", { expenseId: "e1" });
    await widgetTaskHandler({ ...base, widgetAction: "WIDGET_CLICK", clickAction: WIDGET_REJECT, clickActionData: { expenseId: "e1" } });
    expect(mockHandleAlertAction).toHaveBeenCalledWith("reject", { expenseId: "e1" });
    expect(base.renderWidget).toHaveBeenCalledTimes(2);
  });

  it("ignores other clicks", async () => {
    await widgetTaskHandler({ ...base, widgetAction: "WIDGET_CLICK", clickAction: "SOMETHING", clickActionData: {} });
    expect(mockHandleAlertAction).not.toHaveBeenCalled();
  });
});
