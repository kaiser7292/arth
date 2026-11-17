import { renderHook, act } from "@testing-library/react-native";
import { useGroupDrawers } from "../../hooks/use-group-drawers";

type Row = { type: "heading"; key: string } | { type: "item"; id: string };
const rows: Row[] = [
  { type: "heading", key: "a" },
  { type: "item", id: "1" },
  { type: "item", id: "2" },
  { type: "heading", key: "b" },
  { type: "item", id: "3" },
];
const opts = { isHeading: (r: Row) => r.type === "heading", keyOf: (r: Row) => (r.type === "heading" ? r.key : ""), resetKey: "x" };

describe("useGroupDrawers", () => {
  it("opens the first group, leaves the rest closed, marks the last row", () => {
    const { result } = renderHook(() => useGroupDrawers(rows, opts));
    const out = result.current;
    expect(out.map((r) => (r.type === "heading" ? `h:${r.key}:${r.open}` : `i:${r.id}:${r.last}`))).toEqual([
      "h:a:true",
      "i:1:false",
      "i:2:true",
      "h:b:false",
    ]);
  });

  it("a tap opens or closes a group", () => {
    const { result } = renderHook(() => useGroupDrawers(rows, opts));
    act(() => result.current[3].onToggle!());
    expect(result.current.some((r) => r.type === "item" && r.id === "3")).toBe(true);
    act(() => result.current[0].onToggle!());
    expect(result.current.some((r) => r.type === "item" && r.id === "1")).toBe(false);
  });

  it("leaves a list without headings as it is", () => {
    const flat: Row[] = [{ type: "item", id: "1" }];
    const { result } = renderHook(() => useGroupDrawers(flat, opts));
    expect(result.current).toBe(flat);
  });
});
