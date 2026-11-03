import { createElement as h, Fragment, type ReactElement, type ReactNode } from "react";
import { drawsOwnDivider, trimEdgeDividers } from "../../utils/row-dividers";

const LINE = "py-2 border-b border-border";
const row = (id: string, className = LINE) => h("Row", { key: id, id, className });
const classes = (nodes: ReactNode) =>
  (nodes as ReactElement<{ id?: string; className?: string }>[]).map((n) => `${n.props.id}:${n.props.className}`);

describe("lines only go between rows", () => {
  it("takes the line off the last row and leaves the others", () => {
    expect(classes(trimEdgeDividers([row("a"), row("b"), row("c")]))).toEqual([`a:${LINE}`, `b:${LINE}`, "c:py-2"]);
  });
  it("takes the line off the top of the first row", () => {
    const out = trimEdgeDividers([row("a", "pt-2 border-t border-border"), row("b", "pt-2 border-t border-border")]);
    expect(classes(out)).toEqual(["a:pt-2", "b:pt-2 border-t border-border"]);
  });
  it("knows which row is last when some aren't showing", () => {
    expect(classes(trimEdgeDividers([row("a"), row("b"), false, null]))).toEqual([`a:${LINE}`, "b:py-2"]);
  });
  it("looks inside lists and fragments", () => {
    const out = trimEdgeDividers([h(Fragment, { key: "f" }, row("a"), [row("b"), row("c")])]);
    expect(classes(out).pop()).toBe("c:py-2");
  });
  it("goes into a plain wrapper around the rows", () => {
    const [box] = trimEdgeDividers([h("View", { key: "w", className: "mt-2", id: "w" }, row("a"), row("b"))]) as ReactElement<{ children: ReactNode }>[];
    expect(classes(box.props.children)).toEqual([`a:${LINE}`, "b:py-2"]);
  });
  it("leaves side-by-side children alone", () => {
    const wrapper = h("View", { key: "w", className: "flex-row" }, row("a"), row("b"));
    const [out] = trimEdgeDividers([wrapper]) as (typeof wrapper)[];
    expect(out.props).toBe(wrapper.props);
  });
  it("keeps the line under a text input, which is its underline", () => {
    const input = h("TextInput", { key: "i", className: LINE, value: "", onChangeText: () => {} });
    expect((trimEdgeDividers([input]) as ReactElement<{ className: string }>[])[0].props.className).toBe(LINE);
  });
  it("keeps a line that really is between things", () => {
    const out = trimEdgeDividers([row("a", "pb-2"), row("b", "mt-2 pt-2 border-t border-border")]);
    expect(classes(out)[1]).toBe("b:mt-2 pt-2 border-t border-border");
  });
  it("tells a row component that draws its own line that it's last", () => {
    const Own = drawsOwnDivider((_: { lastRow?: boolean }) => null);
    const out = trimEdgeDividers([h(Own, { key: "1" }), h(Own, { key: "2" })]) as ReactElement<{ lastRow?: boolean }>[];
    expect(out.map((e) => !!e.props.lastRow)).toEqual([false, true]);
  });
  it("leaves children with no rows as they are", () => {
    expect(trimEdgeDividers("Just words")).toBe("Just words");
  });
});
