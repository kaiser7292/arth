import { CATEGORY_ICON_RULES, iconForCategoryName } from "../../constants/category-icons";
import Ionicons from "@expo/vector-icons/Ionicons";

describe("iconForCategoryName", () => {
  it.each([
    ["Travel", "airplane-outline"],
    ["Health", "medkit-outline"],
    ["Transport & Fuel", "speedometer-outline"],
    ["Transfers", "swap-horizontal-outline"],
    ["Investments", "trending-up-outline"],
    ["Pets", "paw-outline"],
    ["Pet care", "paw-outline"],
    ["Mobile & Internet", "phone-portrait-outline"],
    ["Education", "school-outline"],
  ])("%s → %s", (name, icon) => expect(iconForCategoryName(name)?.icon).toBe(icon));

  it("uses only icons that exist", () => {
    const glyphs = (Ionicons as unknown as { glyphMap: Record<string, number> }).glyphMap;
    for (const r of CATEGORY_ICON_RULES) expect(glyphs[r.icon]).toBeDefined();
  });

  it("doesn't guess for names it doesn't know", () => {
    expect(iconForCategoryName("Miscellaneous")).toBeNull();
    expect(iconForCategoryName("Xyz")).toBeNull();
  });
});
