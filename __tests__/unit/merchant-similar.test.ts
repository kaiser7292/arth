jest.mock("@/components/ui", () => ({}));
jest.mock("@/hooks/use-alert", () => ({ useAlert: () => () => {} }));
jest.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
import { looksSimilar } from "../../components/merchants/MerchantMergeSheet";

describe("looksSimilar (merge picker's Similar filter)", () => {
  it.each([
    ["Zomato", "ZOMATO LTD"],
    ["Zomato", "Zomato Limited"],
    ["Swiggy", "SWIGGY INSTAMART"],
    ["Amazon", "AMAZONPAY"],
    ["Big Basket", "BIGBASKET"],
  ])("%s ~ %s", (a, b) => expect(looksSimilar(a, b)).toBe(true));

  it.each([
    ["Zomato", "Uber"],
    ["Amazon Pay", "PhonePe Pay"],
    ["India Gate", "Indian Oil"],
  ])("%s ≁ %s", (a, b) => expect(looksSimilar(a, b)).toBe(false));
});
