jest.mock("@/components/ui", () => ({}));
jest.mock("@/components/ui/AccountTypeIcon", () => ({}));
jest.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));

import { balancedFlows } from "@/components/account/AccountCards";

describe("balancedFlows: opening + inflow - outflow is always the balance", () => {
  const adds = (o: number, c: number, f: { inflow: number; outflow: number }) => Math.round((o + f.inflow - f.outflow) * 100) / 100 === c;

  it("counts corrections by direction", () => {
    const f = balancedFlows(1000, 1700, 500, 300, { up: 600, down: 100 });
    expect(f).toEqual({ inflow: 1100, outflow: 400 });
    expect(adds(1000, 1700, f)).toBe(true);
  });
  it("puts anything left on the side it moved", () => {
    expect(balancedFlows(16134, 11794.29, 0, 11039.2, undefined)).toEqual({ inflow: 6699.49, outflow: 11039.2 });
    const down = balancedFlows(5000, 3000, 0, 1000, { up: 0, down: 0 });
    expect(down).toEqual({ inflow: 0, outflow: 2000 });
  });
  it("leaves flows that already add up alone", () => {
    expect(balancedFlows(100, 150, 80, 30, undefined)).toEqual({ inflow: 80, outflow: 30 });
  });
});
