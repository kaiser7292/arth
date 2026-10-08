jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));

import { countValue, splitLayoutClasses, staggerDelay } from "../../components/motion/motion";
import { MOTION } from "../../constants/design-tokens";

describe("splitLayoutClasses", () => {
  it("moves margins, flex sizing and width outward; keeps visual classes on the Pressable", () => {
    expect(splitLayoutClasses("mb-3")).toEqual({ layout: "mb-3", rest: "" });
    expect(splitLayoutClasses("flex-1 border border-border")).toEqual({ layout: "flex-1", rest: "border border-border" });
    expect(splitLayoutClasses("mt-2 -mx-1 w-full self-start rounded-xl bg-card")).toEqual({
      layout: "mt-2 -mx-1 w-full self-start",
      rest: "rounded-xl bg-card",
    });
  });

  it("keeps child-arranging flex classes inside", () => {
    expect(splitLayoutClasses("flex-row items-center flex-wrap")).toEqual({ layout: "", rest: "flex-row items-center flex-wrap" });
  });

  it("handles empty and extra spaces", () => {
    expect(splitLayoutClasses("")).toEqual({ layout: "", rest: "" });
    expect(splitLayoutClasses("  mb-3   px-4 ")).toEqual({ layout: "mb-3", rest: "px-4" });
  });
});

describe("countValue", () => {
  it("starts at from, ends exactly at to, eases out", () => {
    expect(countValue(0, 1000, 0)).toBe(0);
    expect(countValue(0, 1000, 1)).toBe(1000);
    expect(countValue(0, 1000, 0.5)).toBeGreaterThan(500); // ease-out: past halfway at half time
  });

  it("glides down as well as up and clamps progress", () => {
    expect(countValue(500, 200, 1)).toBe(200);
    expect(countValue(500, 200, 2)).toBe(200);
    expect(countValue(500, 200, -1)).toBe(500);
  });
});

describe("staggerDelay", () => {
  it("steps by the stagger token and caps long lists", () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(2)).toBe(2 * MOTION.stagger);
    expect(staggerDelay(50)).toBe(8 * MOTION.stagger);
  });
});
