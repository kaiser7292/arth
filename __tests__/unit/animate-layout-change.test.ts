import { LayoutAnimation } from "react-native";
import { renderHook, act } from "@testing-library/react-native";
import { animateLayoutChange } from "../../components/motion/motion";
import { useGroupDrawers } from "../../hooks/use-group-drawers";

describe("smooth drawers", () => {
  it("asks for a fade-and-glide on the next layout change", () => {
    const spy = jest.spyOn(LayoutAnimation, "configureNext").mockImplementation(() => {});
    animateLayoutChange();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 220, create: expect.objectContaining({ property: "opacity" }), delete: expect.objectContaining({ property: "opacity" }) }),
    );
    spy.mockRestore();
  });

  it("opening or closing a grouped list's drawer animates", () => {
    const spy = jest.spyOn(LayoutAnimation, "configureNext").mockImplementation(() => {});
    type Row = { type: "heading"; key: string } | { type: "item"; id: string };
    const rows: Row[] = [{ type: "heading", key: "a" }, { type: "item", id: "1" }];
    const { result } = renderHook(() =>
      useGroupDrawers(rows, { isHeading: (r) => r.type === "heading", keyOf: (r) => (r.type === "heading" ? r.key : ""), resetKey: 1 }),
    );
    act(() => result.current[0].onToggle!());
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
