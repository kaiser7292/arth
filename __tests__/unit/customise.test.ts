const mockStore = new Map<string, unknown>();
jest.mock("../../services/storage", () => ({
  settingsStorage: {
    getBoolean: (k: string) => mockStore.get(k) as boolean | undefined,
    getString: (k: string) => mockStore.get(k) as string | undefined,
    set: (k: string, v: unknown) => mockStore.set(k, v),
    delete: (k: string) => mockStore.delete(k),
  },
}));

import { customiseVersion, isPartOn, isPathOn, setPartOn, subscribeCustomise } from "../../services/customise";
import {
  HOME_CARD_DEFAULT_ORDER,
  getHomeCardOrder,
  isDefaultHomeCardOrder,
  isHomeCardVisible,
  moveHomeCard,
  resetCustomisation,
  setHomeCardVisible,
} from "../../services/home-card-preferences";
import { availableCatalog } from "../../services/search-catalog";

beforeEach(() => mockStore.clear());

describe("switching things off", () => {
  it("everything starts on", () => {
    expect(isPartOn("vault")).toBe(true);
    expect(isHomeCardVisible("hisaab")).toBe(true);
  });

  it("a feature takes its Home card with it, and brings it back", () => {
    setPartOn("hisaab", false);
    expect(isHomeCardVisible("hisaab")).toBe(false);
    setPartOn("hisaab", true);
    expect(isHomeCardVisible("hisaab")).toBe(true);
  });

  it("a card switched off stays off when its feature comes back", () => {
    setHomeCardVisible("loans", false);
    setPartOn("loans", false);
    setPartOn("loans", true);
    expect(isHomeCardVisible("loans")).toBe(false);
  });

  it("the Budget tab takes the budget part of My Month", () => {
    setPartOn("budget", false);
    expect(isHomeCardVisible("total_spent")).toBe(false);
    expect(isHomeCardVisible("my_month")).toBe(true);
  });

  it("screens and search follow", () => {
    setPartOn("vault", false);
    setPartOn("investments", false);
    expect(isPathOn("/vault")).toBe(false);
    expect(isPathOn("/vault/add")).toBe(false);
    expect(isPathOn("/settings/kite-connect")).toBe(false);
    expect(isPathOn("/settings/kite-connect-api-key")).toBe(false);
    expect(isPathOn("/settings/security")).toBe(true);
    const routes = availableCatalog().map((e) => e.target?.pathname ?? "");
    expect(routes.some((r) => r.startsWith("/vault"))).toBe(false);
    expect(routes.some((r) => r.startsWith("/investments"))).toBe(false);
    expect(routes.some((r) => r.startsWith("/hisaab"))).toBe(true);
  });

  it("loans can stay on with Goals off, but not the other way round", () => {
    setPartOn("loans", false);
    expect(isPathOn("/goals/loans")).toBe(false);
    expect(isPathOn("/goals/milestones")).toBe(true);
    setPartOn("loans", true);
    setPartOn("goals", false);
    expect(isPathOn("/goals/milestones")).toBe(false);
    expect(isPathOn("/loans/add")).toBe(true);
  });

  it("tells screens when something changes", () => {
    const seen = jest.fn();
    const stop = subscribeCustomise(seen);
    const before = customiseVersion();
    setPartOn("vault", false);
    moveHomeCard("loans", -1);
    stop();
    setPartOn("vault", true);
    expect(seen).toHaveBeenCalledTimes(2);
    expect(customiseVersion()).toBe(before + 3);
  });
});

describe("the order of Home cards", () => {
  it("starts as Home has always been", () => {
    expect(getHomeCardOrder()).toEqual(HOME_CARD_DEFAULT_ORDER);
    expect(isDefaultHomeCardOrder()).toBe(true);
  });

  it("moves one place at a time and stops at the ends", () => {
    moveHomeCard("my_month", -1);
    expect(getHomeCardOrder().slice(0, 2)).toEqual(["my_month", "check_ins"]);
    expect(isDefaultHomeCardOrder()).toBe(false);
    moveHomeCard("my_month", -1);
    expect(getHomeCardOrder()[0]).toBe("my_month");
    const last = HOME_CARD_DEFAULT_ORDER[HOME_CARD_DEFAULT_ORDER.length - 1];
    moveHomeCard(last, 1);
    expect(getHomeCardOrder().at(-1)).toBe(last);
  });

  it("a saved order survives cards being added or dropped in a later version", () => {
    mockStore.set("home_card_order", JSON.stringify(["loans", "gone_card", "wallets"]));
    const order = getHomeCardOrder();
    expect(order.slice(0, 2)).toEqual(["loans", "wallets"]);
    expect(order).not.toContain("gone_card");
    expect([...order].sort()).toEqual([...HOME_CARD_DEFAULT_ORDER].sort());
  });

  it("a damaged saved order falls back to the default", () => {
    mockStore.set("home_card_order", "{not json");
    expect(getHomeCardOrder()).toEqual(HOME_CARD_DEFAULT_ORDER);
  });

  it("reset puts everything back", () => {
    setPartOn("vault", false);
    setHomeCardVisible("wallets", false);
    moveHomeCard("loans", -1);
    resetCustomisation();
    expect(isPartOn("vault")).toBe(true);
    expect(isHomeCardVisible("wallets")).toBe(true);
    expect(getHomeCardOrder()).toEqual(HOME_CARD_DEFAULT_ORDER);
  });
});
