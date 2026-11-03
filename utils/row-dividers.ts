import { Children, Fragment, cloneElement, isValidElement, type ComponentType, type ReactElement, type ReactNode } from "react";

/**
 * Lines go between rows, never above the first or below the last. Rows draw their own line with
 * `border-b border-border`, which also puts one under the last row, and which rows are first and
 * last changes with what's showing. So the container takes the edges off: Card does this for what's
 * in it, and Rows does it for any other box of rows.
 */

const TOP = /\s*\bborder-t border-border(\/\d+)?/;
const BOTTOM = /\s*\bborder-b border-border(\/\d+)?/;

type Props = { className?: unknown; children?: ReactNode; onChangeText?: unknown; lastRow?: boolean };
type Row = ReactElement<Props>;

/** A row component that draws its own line opts in by reading `lastRow`. */
export function drawsOwnDivider<C>(component: C): C {
  (component as { drawsOwnDivider?: boolean }).drawsOwnDivider = true;
  return component;
}
const usesLastRow = (el: Row) => !!(el.type as ComponentType & { drawsOwnDivider?: boolean })?.drawsOwnDivider;

function lastElementIndex(list: ReactNode[]): number {
  for (let i = list.length - 1; i >= 0; i--) if (isValidElement(list[i])) return i;
  return -1;
}

function flatten(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child) || child.type !== Fragment) return [child];
    const inner = flatten((child as Row).props.children);
    return inner.map((c) => (isValidElement(c) ? cloneElement(c, { key: `${child.key}/${c.key}` }) : c));
  });
}

function trimEdge(el: Row, edge: "first" | "last"): Row {
  const { className, children } = el.props;
  // An input's underline isn't a divider.
  if (el.props.onChangeText !== undefined) return el;
  const line = edge === "first" ? TOP : BOTTOM;
  if (typeof className === "string" && line.test(className)) {
    return cloneElement(el, { className: className.replace(line, "") });
  }
  if (edge === "last" && usesLastRow(el)) return cloneElement(el, { lastRow: true });
  // Into a plain wrapper around rows. Side by side, its last child isn't the last row.
  if (typeof className === "string" && className.includes("flex-row")) return el;
  if (children === undefined || typeof children === "function") return el;
  const inner = flatten(children);
  const index = edge === "first" ? inner.findIndex((c) => isValidElement(c)) : lastElementIndex(inner);
  if (index < 0) return el;
  const trimmed = trimEdge(inner[index] as Row, edge);
  if (trimmed === inner[index]) return el;
  inner[index] = trimmed;
  return cloneElement(el, undefined, ...inner);
}

/** The same children with any line above the first row and below the last taken off. */
export function trimEdgeDividers(children: ReactNode): ReactNode {
  const list = flatten(children);
  const first = list.findIndex((c) => isValidElement(c));
  if (first < 0) return children;
  list[first] = trimEdge(list[first] as Row, "first");
  const last = lastElementIndex(list);
  list[last] = trimEdge(list[last] as Row, "last");
  return list;
}
