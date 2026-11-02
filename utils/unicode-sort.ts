/**
 * Orders names by Unicode code point, ignoring case: digits come before letters, and signs, symbols
 * and other languages fall where Unicode puts them. Not localeCompare, whose order changes with the
 * phone's language.
 */
export function compareUnicode(a: string, b: string): number {
  const x = Array.from(a.trim().toLowerCase());
  const y = Array.from(b.trim().toLowerCase());
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}
