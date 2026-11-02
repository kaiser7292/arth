import { compareUnicode } from "../../utils/unicode-sort";

const sorted = (names: string[]) => [...names].sort(compareUnicode);

describe("compareUnicode", () => {
  it("puts numbers before letters, ignoring case", () => {
    expect(sorted(["zomato", "Amazon", "7 Eleven", "BigBasket", "1mg"])).toEqual(["1mg", "7 Eleven", "Amazon", "BigBasket", "zomato"]);
  });
  it("orders signs and other languages by Unicode", () => {
    expect(sorted(["अमूल", "Zepto", "&Co", "1mg"])).toEqual(["&Co", "1mg", "Zepto", "अमूल"]);
  });
  it("a shorter name comes before a longer one that starts with it", () => {
    expect(sorted(["Swiggy Instamart", "Swiggy"])).toEqual(["Swiggy", "Swiggy Instamart"]);
  });
});
