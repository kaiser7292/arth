import { renderHook, act } from "@testing-library/react-native";
import { drawerEntering, markDrawerOpened } from "../../components/motion/drawer-motion";
import { useGroupDrawers } from "../../hooks/use-group-drawers";

describe("drawer motion (Reanimated, not LayoutAnimation)", () => {
  it("only a drawer opened a moment ago fades its rows in", () => {
    expect(drawerEntering("2026-11")).toBeUndefined();
    markDrawerOpened("2026-11");
    expect(drawerEntering("2026-11")).toBeDefined();
    expect(drawerEntering("2026-10")).toBeUndefined();
    expect(drawerEntering(undefined)).toBeUndefined();
  });

  it("opening a grouped list's drawer marks it, closing doesn't, and rows know their drawer", () => {
    type Row = { type: "heading"; key: string } | { type: "item"; id: string };
    const rows: Row[] = [{ type: "heading", key: "a" }, { type: "item", id: "1" }, { type: "heading", key: "b" }, { type: "item", id: "2" }];
    const { result } = renderHook(() =>
      useGroupDrawers(rows, { isHeading: (r) => r.type === "heading", keyOf: (r) => (r.type === "heading" ? r.key : ""), resetKey: 1 }),
    );
    expect(result.current[1]).toMatchObject({ groupKey: "a" });
    act(() => result.current[2].onToggle!()); // opens b
    expect(drawerEntering("b")).toBeDefined();
    const item2 = result.current.find((r) => r.type === "item" && r.id === "2");
    expect(item2).toMatchObject({ groupKey: "b", inDrawer: true });
  });
});
