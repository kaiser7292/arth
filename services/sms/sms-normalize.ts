/**
 * v15.10.1 — SMS normalization pipeline.
 *
 * Applied symmetrically at:
 *   - Compile time (sample SMS + user tap offsets)
 *   - Match time (every incoming SMS)
 *
 * Both sides producing the same normalized string is what makes templates
 * survive real-world variance (different URL slugs, different amount
 * prefixes, different whitespace). See docs above for the 9 pitfalls this
 * pipeline defuses.
 *
 * This is a clean-room implementation. Patterns are derived from
 * observations in our own services/sms/bank-patterns.ts + publicly
 * documented Indian bank SMS formats. No third-party code is copied.
 *
 * Key design rule: every step has to be lossless-WRT-offset-mapping — we
 * can't just drop characters, we have to track a parallel
 * normalized → original offset array so the tagger UI (which operates on
 * the raw SMS) can compile spans at normalized offsets and the round-trip
 * validation still works.
 */

/** A normalization pass — operates on (text, offsetMap) in lockstep. */
type Pass = (text: string, offsets: number[]) => { text: string; offsets: number[] };

/**
 * Replace the first regex match with `replacement`. Shrinks/grows the text
 * and keeps the offset array in sync.
 */
function replaceFirst(text: string, offsets: number[], re: RegExp, replacement: string): { text: string; offsets: number[] } {
  const m = re.exec(text);
  if (!m) return { text, offsets };
  const start = m.index;
  const end = start + m[0].length;
  // Characters from `replacement` don't correspond to any original index;
  // we set them to the offset of the first char of the match, which lets
  // the regex's anchor text still "hit" near the original location.
  const replacementOffsets = new Array(replacement.length).fill(offsets[start] ?? 0);
  const nextText = text.slice(0, start) + replacement + text.slice(end);
  const nextOffsets = [
    ...offsets.slice(0, start),
    ...replacementOffsets,
    ...offsets.slice(end),
  ];
  return { text: nextText, offsets: nextOffsets };
}

/** Replace ALL regex matches with `replacement`. */
function replaceAll(text: string, offsets: number[], re: RegExp, replacement: string | ((match: string) => string)): { text: string; offsets: number[] } {
  let cur = { text, offsets };
  // Rebuild the regex as global if it isn't already.
  const gRe = re.global ? re : new RegExp(re.source, re.flags + "g");
  let guard = 0;
  while (guard++ < 100) {
    const m = gRe.exec(cur.text);
    if (!m) break;
    const rep = typeof replacement === "string" ? replacement : replacement(m[0]);
    const before = cur.text.slice(0, m.index);
    const after = cur.text.slice(m.index + m[0].length);
    const newOffsets = [
      ...cur.offsets.slice(0, m.index),
      ...new Array(rep.length).fill(cur.offsets[m.index] ?? 0),
      ...cur.offsets.slice(m.index + m[0].length),
    ];
    cur = { text: before + rep + after, offsets: newOffsets };
    // Reset gRe index because we've mutated the string.
    gRe.lastIndex = m.index + rep.length;
  }
  return cur;
}

/** Step 1: lowercase (preserves length + offsets). */
const passLowercase: Pass = (text, offsets) => ({ text: text.toLowerCase(), offsets });

/** Step 2: currency prefixes → canonical "rs." with no trailing whitespace
 * before the digit. Normalizes "Rs. 500", "Rs.500", "₹ 500", "₹500",
 * "INR 500", "INR.500" all to the same form "rs.500". */
const passCurrency: Pass = (text, offsets) => {
  let cur = { text, offsets };
  // Step A: replace all currency-prefix variants with a shared "rs." token.
  cur = replaceAll(cur.text, cur.offsets, /₹/g, "rs.");
  cur = replaceAll(cur.text, cur.offsets, /\binr\b\.?/gi, "rs.");
  // Step B: if "rs." / "rs" is immediately followed by optional space + digits,
  // collapse the gap so "rs. 500" and "rs.500" become one canonical token.
  cur = replaceAll(cur.text, cur.offsets, /\brs\.?\s*(?=\d)/gi, "rs.");
  return cur;
};

/** Step 3: strip Indian-lakh thousands commas between digits (1,23,456 → 123456).
 * Uses a dedicated offset-preserving removal instead of the generic replaceAll,
 * because removing a comma from "1,34" must map "134" → [orig_of_1, orig_of_3, orig_of_4],
 * not [orig_of_1, orig_of_1, orig_of_1]. */
const passThousandsCommas: Pass = (text, offsets) => {
  let cur = { text, offsets };
  for (let i = 0; i < 5; i++) {
    const re = /(\d),(\d{2,3}(?!\d))/g;
    let m: RegExpExecArray | null;
    let newText = "";
    let newOffsets: number[] = [];
    let lastEnd = 0;
    let changed = false;
    while ((m = re.exec(cur.text)) !== null) {
      changed = true;
      // Copy everything before the match unchanged
      for (let j = lastEnd; j < m.index; j++) {
        newText += cur.text[j];
        newOffsets.push(cur.offsets[j]);
      }
      // Copy the match characters EXCEPT the comma, preserving their original offsets
      for (let j = m.index; j < m.index + m[0].length; j++) {
        if (cur.text[j] !== ",") {
          newText += cur.text[j];
          newOffsets.push(cur.offsets[j]);
        }
      }
      lastEnd = m.index + m[0].length;
    }
    if (!changed) break;
    // Copy remainder
    for (let j = lastEnd; j < cur.text.length; j++) {
      newText += cur.text[j];
      newOffsets.push(cur.offsets[j]);
    }
    cur = { text: newText, offsets: newOffsets };
  }
  return cur;
};

/** Step 4: collapse all whitespace runs to a single space. */
const passWhitespace: Pass = (text, offsets) => {
  return replaceAll(text, offsets, /\s+/g, " ");
};

/** Step 5: strip leading DLT sender-ID header (e.g. "AX-HDFCBK-S "). */
const passDltHeader: Pass = (text, offsets) => {
  return replaceAll(text, offsets, /^[a-z]{2}-[a-z]{4,6}(?:-[stpg])?\s*/i, "");
};

/** Step 6: replace URLs with a stable placeholder so the path tokens don't leak. */
const passUrls: Pass = (text, offsets) => {
  return replaceAll(text, offsets, /https?:\/\/\S+/gi, "<url>");
};

/** Step 7: strip RTL / zero-width characters (ZWSP/ZWNJ/ZWJ/LRM/RLM/BOM). */
const passRtlMarks: Pass = (text, offsets) => {
  // U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+200E LRM, U+200F RLM, U+FEFF BOM.
  const re = new RegExp("[\\u200B-\\u200F\\uFEFF]", "g");
  return replaceAll(text, offsets, re, "");
};

/** Step 8: strip common trailing boilerplate. */
const passTrailingBoilerplate: Pass = (text, offsets) => {
  return replaceAll(
    text,
    offsets,
    /\s*(?:not\s*you\?.*|t&c\s*apply.*|sms\s*block.*|call\s+\d+.*)$/i,
    "",
  );
};

/** Step 9: strip trailing DLT template ID (e.g. "-1001234567890123456"). */
const passTrailingTemplateId: Pass = (text, offsets) => {
  return replaceAll(text, offsets, /\s*-\d{15,25}\s*$/g, "");
};

const PIPELINE: Pass[] = [
  passLowercase,
  passCurrency,
  passThousandsCommas,
  passWhitespace,
  passDltHeader,
  passUrls,
  passRtlMarks,
  passTrailingBoilerplate,
  passTrailingTemplateId,
];

export interface NormalizeResult {
  /** The normalized text. Use this for regex compilation + matching. */
  text: string;
  /**
   * For each character in `text`, the corresponding offset in the original
   * input (may repeat when a multi-char original collapsed to one
   * character, e.g. whitespace). Length === text.length.
   */
  normalizedToOriginal: number[];
}

/**
 * Normalize `input` through the 9-step pipeline.
 *
 * Returns both the normalized text and an offset-mapping array so callers
 * can translate offsets between coordinate systems.
 */
export function normalizeSms(input: string): NormalizeResult {
  let text = input;
  let offsets = Array.from({ length: input.length }, (_, i) => i);
  for (const pass of PIPELINE) {
    const next = pass(text, offsets);
    text = next.text;
    offsets = next.offsets;
  }
  return { text, normalizedToOriginal: offsets };
}

/**
 * Translate an original-offset span (start, end) into the equivalent
 * normalized-offset span. Used by the compiler to turn the user's taps on
 * the raw SMS into tags on the normalized SMS.
 *
 * Returns null if the original span falls entirely inside characters that
 * got stripped by normalization (e.g. user tagged a URL; we stripped it).
 * The compiler should refuse to compile in that case and tell the user.
 */
export function mapOriginalSpanToNormalized(
  original: { start: number; end: number },
  normalizedToOriginal: number[],
): { start: number; end: number } | null {
  // The first normalized index whose original-offset is >= original.start.
  // The last normalized index whose original-offset is < original.end.
  let normStart = -1;
  let normEnd = -1;
  for (let i = 0; i < normalizedToOriginal.length; i++) {
    const o = normalizedToOriginal[i];
    if (normStart < 0 && o >= original.start && o < original.end) {
      normStart = i;
    }
    if (o >= original.start && o < original.end) {
      normEnd = i + 1;
    }
  }
  if (normStart < 0 || normEnd <= normStart) return null;
  return { start: normStart, end: normEnd };
}
