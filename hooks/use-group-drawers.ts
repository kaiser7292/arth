import { animateLayoutChange } from "@/components/motion/motion";
import { useEffect, useMemo, useState } from "react";

export interface DrawerFlags {
  /** On a heading: the drawer is open; tap onToggle to flip it. */
  open?: boolean;
  onToggle?: () => void;
  /** On a row: it sits inside its drawer; the last one closes the card. */
  inDrawer?: boolean;
  last?: boolean;
}

/**
 * Turns a grouped list (headings followed by their rows) into drawers, as on the Transactions tab:
 * the first group starts open, a tap flips one, a closed group's rows are left out. Flips reset
 * when `resetKey` (the grouping) changes. A list without headings comes back unchanged.
 */
export function useGroupDrawers<R extends object>(
  rows: readonly R[],
  { isHeading, keyOf, resetKey }: { isHeading: (r: R) => boolean; keyOf: (r: R) => string; resetKey: unknown },
): (R & DrawerFlags)[] {
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  useEffect(() => setFlipped(new Set()), [resetKey]);
  return useMemo(() => {
    const first = rows.find(isHeading);
    if (!first) return rows as (R & DrawerFlags)[];
    const firstKey = keyOf(first);
    const out: (R & DrawerFlags)[] = [];
    let open = false;
    let lastRow = -1;
    const closeCard = () => {
      if (lastRow >= 0) out[lastRow] = { ...out[lastRow], last: true };
      lastRow = -1;
    };
    for (const r of rows) {
      if (isHeading(r)) {
        closeCard();
        const key = keyOf(r);
        open = (key === firstKey) !== flipped.has(key);
        out.push({
          ...r,
          open,
          onToggle: () => {
            animateLayoutChange();
            setFlipped((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            });
          },
        });
      } else if (open) {
        out.push({ ...r, inDrawer: true, last: false });
        lastRow = out.length - 1;
      }
    }
    closeCard();
    return out;
    // isHeading / keyOf are pure at each call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, flipped]);
}
