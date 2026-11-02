/**
 * A search box entry read as an amount: "450" (450 and 450.xx), "450.50" (exactly), "450-500" or
 * "450 to 500", ">5000", "<=100", "above 5000", "under 500". Commas and a leading rupee sign or Rs
 * are fine. Null when it isn't an amount ("1mg", "swiggy").
 */
export interface AmountRange {
  min: number;
  max: number;
}

const NUM = "\\d+(?:\\.\\d{1,2})?";
const COMPARE = new RegExp(`^(>=|<=|>|<|above|over|more than|below|under|less than)\\s*(${NUM})$`);
const BETWEEN = new RegExp(`^(${NUM})\\s*(?:-|–|to)\\s*(${NUM})$`);
const SINGLE = new RegExp(`^(${NUM})$`);
/** Half a paisa either side, so stored amounts compare cleanly. */
const EDGE = 0.005;
const NO_LIMIT = 1e15;

export function parseAmountQuery(raw: string): AmountRange | null {
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/₹|\brs\.?(?=\s*\d)|\binr\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;

  const single = t.match(SINGLE);
  if (single) {
    const n = Number(single[1]);
    return single[1].includes(".") ? { min: n - EDGE, max: n + EDGE } : { min: n - EDGE, max: n + 1 - EDGE };
  }
  const between = t.match(BETWEEN);
  if (between) {
    const a = Number(between[1]);
    const b = Number(between[2]);
    return { min: Math.min(a, b) - EDGE, max: Math.max(a, b) + EDGE };
  }
  const compare = t.match(COMPARE);
  if (compare) {
    const n = Number(compare[2]);
    switch (compare[1]) {
      case ">=":
        return { min: n - EDGE, max: NO_LIMIT };
      case "<=":
        return { min: 0, max: n + EDGE };
      case "<":
      case "below":
      case "under":
      case "less than":
        return { min: 0, max: n - EDGE };
      default:
        return { min: n + EDGE, max: NO_LIMIT };
    }
  }
  return null;
}

/** For lists already in memory: does a row match this search, by any of its text or amounts? */
export function matchesSearch(query: string, texts: (string | null | undefined)[], amounts: (number | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (texts.some((t) => t?.toLowerCase().includes(q))) return true;
  const range = parseAmountQuery(q);
  return !!range && amounts.some((a) => a != null && a >= range.min && a <= range.max);
}
