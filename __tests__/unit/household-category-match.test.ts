jest.mock("../../database", () => ({ getDatabase: () => ({}) }));

import { bestCategoryMatch, categoryMatchScore } from "../../services/household/store";

/** Loose category matching between two people's phones (household categories, "Paid by" shares). */
const DEFAULTS = [
  "Car & Vehicles",
  "Health & Medicine",
  "Travel & Going Out",
  "Rent & Utilities",
  "Subscriptions",
  "Grocery & Supplies",
  "Food",
  "Shopping & Gifts",
  "Family",
  "Miscellaneous",
  "Insurance",
  "EMIs",
].map((name) => ({ name }));

const match = (name: string) => bestCategoryMatch(name, DEFAULTS)?.name;

test("same name, any case or punctuation", () => {
  expect(match("grocery and supplies")).toBe("Grocery & Supplies");
  expect(categoryMatchScore("Rent & Utilities", "rent / utilities")).toBe(3);
});

test("a word in common, singular or plural, or one the start of the other", () => {
  expect(match("Groceries")).toBe("Grocery & Supplies");
  expect(match("Rent")).toBe("Rent & Utilities");
  expect(match("Medicines")).toBe("Health & Medicine");
  expect(match("Cars")).toBe("Car & Vehicles");
  expect(match("Subscription")).toBe("Subscriptions");
});

test("the same kind of spending, named differently", () => {
  expect(match("Electricity")).toBe("Rent & Utilities");
  expect(match("Petrol")).toBe("Car & Vehicles");
  expect(match("Dining out")).toBe("Food");
  expect(match("Pharmacy")).toBe("Health & Medicine");
  expect(match("Netflix")).toBe("Subscriptions");
  expect(match("Kids")).toBe("Family");
  expect(match("Maid")).toBe("Rent & Utilities");
});

test("no match is no match", () => {
  expect(match("Zzz")).toBeUndefined();
  expect(categoryMatchScore("", "Food")).toBe(0);
});

describe("the icon on a shared transaction", () => {
  const { categoryLook } = require("../../services/household/category-look");
  const author = { icon: "medkit-outline", color: "#EF4444" };
  const mine = [{ name: "Grocery & Supplies", icon: "basket-outline", color: "#111111" }];

  test("whoever added it wins over my own category", () => {
    expect(categoryLook(author, "Grocery & Supplies", mine)).toEqual(author);
  });

  test("without theirs: my category of that name or a close one, then a fitting icon, then none", () => {
    expect(categoryLook(null, "Grocery & Supplies", mine)?.icon).toBe("basket-outline");
    expect(categoryLook(null, "Groceries", mine)?.icon).toBe("basket-outline");
    expect(categoryLook(null, "Health and medicine", mine)?.icon).toBe("medkit-outline");
    expect(categoryLook(null, "Zzz", mine)).toBeNull();
    expect(categoryLook(null, null, mine)).toBeNull();
  });
});
