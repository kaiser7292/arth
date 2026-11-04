import { act, renderHook } from "@testing-library/react-native";
import { useGuardedLoad } from "../../hooks/use-guarded-load";

jest.mock("../../utils/logger", () => ({ logger: { warn: jest.fn(), error: jest.fn() } }));

describe("useGuardedLoad", () => {
  it("doesn't flag a load that works", async () => {
    const load = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useGuardedLoad(load));
    await act(async () => { await result.current.load(); });
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.failed).toBe(false);
  });
  it("flags a load that throws, without throwing itself", async () => {
    const { result } = renderHook(() => useGuardedLoad(() => Promise.reject(new Error("no such column"))));
    await act(async () => { await result.current.load(); });
    expect(result.current.failed).toBe(true);
  });
  it("clears the flag when trying again works", async () => {
    const load = jest.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(undefined);
    const { result } = renderHook(() => useGuardedLoad(load));
    await act(async () => { await result.current.load(); });
    expect(result.current.failed).toBe(true);
    await act(async () => { await result.current.load(); });
    expect(result.current.failed).toBe(false);
  });
});
