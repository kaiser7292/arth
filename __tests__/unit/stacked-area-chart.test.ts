jest.mock("react-native-svg", () => ({}));
jest.mock("@/components/ui", () => ({}));
jest.mock("@/hooks/use-theme", () => ({}));

import { chartHit } from "../../components/charts/StackedAreaChart";

const months = ["2026-08", "2026-09", "2026-10"];
const layers = [
  { key: "fd", label: "FD", color: "#000", values: [100, 100, 100] },
  { key: "market", label: "Market", color: "#000", values: [300, 300, 300] },
];
// width 208 -> x of month i = 4 + i * 100; height 150 -> value 400 at y = 10, 0 at y = 146.
describe("chartHit", () => {
  it("finds the band under the tap", () => {
    expect(chartHit(months, layers, 208, 150, 104, 140)).toEqual({ index: 1, layerKey: "fd" });
    expect(chartHit(months, layers, 208, 150, 204, 40)).toEqual({ index: 2, layerKey: "market" });
  });

  it("above the stack is no band", () => {
    const thin = [{ key: "fd", label: "FD", color: "#000", values: [100, 100, 400] }];
    expect(chartHit(months, thin, 208, 150, 4, 20)).toEqual({ index: 0, layerKey: null });
  });

  it("ignores a tap without a position (no crash)", () => {
    expect(chartHit(months, layers, 208, 150, NaN, 40)).toBeNull();
    expect(chartHit(months, layers, 0, 150, 10, 40)).toBeNull();
  });
});
