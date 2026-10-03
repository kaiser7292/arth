/**
 * v15.5.0 — User SMS template compiler.
 *
 * Pure function: given a sample SMS body and a list of {field, startOffset,
 * endOffset} spans that the user has tagged, produce a runnable regex that
 * will extract the same values from future SMS that match the surrounding
 * "anchor" text.
 *
 * Design:
 *   - Anchor text (between/around tagged spans) is escaped verbatim —
 *     keeps the template specific enough to not over-match arbitrary SMS.
 *   - Runs of whitespace in the anchor become \s+ so banks sending the
 *     same template with variable padding still match.
 *   - Each tagged field is replaced by a named capture group with a
 *     field-specific regex (see FIELD_REGEX below).
 *   - Merchant is non-greedy so trailing anchor text can stop the capture.
 *   - Validation: after build, the regex is compiled + re-run on the sample
 *     SMS; extracted groups must match the originally tagged substrings.
 *     If not, compileTemplate returns an error — caller refuses to save.
 *
 * Fields supported:
 *   amount   — required (can't have a transaction template without amount)
 *   account  — optional (last 3–6 digits of card/acct)
 *   merchant — optional (text, multi-word supported)
 *   date     — optional (user picks format; matcher currently parses opportunistically)
 *   balance  — optional
 *   ref      — optional (UPI/NEFT/IMPS transaction id, alnum)
 *
 * The transaction type (expense / credit / refund) is NOT tagged from the
 * SMS — it's a separate user choice in the UI that becomes tx_type on the
 * template row.
 */

import { normalizeSms, mapOriginalSpanToNormalized } from "./sms-normalize";

export type TaggedField =
  | "amount"
  | "account"
  | "merchant"
  | "date"
  | "balance"
  | "ref"
  /** Other party's name — "transfer from Mr. SOURAVBAID". Feeds own-account transfer detection. */
  | "counterparty"
  /** The other account's digits — "To A/c xxxx0006". Feeds transfer pairing. */
  | "other_account";

export const ALL_TAGGED_FIELDS: TaggedField[] = [
  "amount",
  "account",
  "merchant",
  "date",
  "balance",
  "ref",
  "counterparty",
  "other_account",
];

/**
 * How strictly a template matches the words around its fields.
 *   exact    — every word between fields must appear as in the sample (the original behaviour)
 *   flexible — only key words must appear (the 2 words before each field, the word after a
 *              name/merchant, words common to all examples, words the user marked required);
 *              the rest may change
 */
export type MatchStyle = "exact" | "flexible";

/** User overrides on top of the automatic word choice (flexible only). Normalised words. */
export interface WordRules {
  required: string[];
  optional: string[];
}

/** One word of the sample's surrounding text and whether the flexible pattern keeps it. */
export interface WordState {
  /** Offsets in the ORIGINAL sample body. */
  start: number;
  end: number;
  /** Normalised form — what WordRules store. */
  word: string;
  state: "auto" | "common" | "required" | "free";
}

export interface TaggedSpan {
  field: TaggedField;
  /** Inclusive start offset in the raw SMS body (UTF-16 code units). */
  start: number;
  /** Exclusive end offset. */
  end: number;
}

export interface CompileInput {
  smsBody: string;
  spans: TaggedSpan[];
  /** For validation: require these fields are all present. */
  requiredFields?: TaggedField[];
  /** Default "exact" — existing templates and callers keep today's behaviour. */
  style?: MatchStyle;
  /** Flexible only: words the user made required / optional. */
  wordRules?: WordRules;
  /** More examples of the same format, each tagged with the same fields in the same order. */
  extraSamples?: { smsBody: string; spans: TaggedSpan[] }[];
}

export interface CompileSuccess {
  ok: true;
  /** Runnable regex string (no flags — caller compiles with `i`). */
  patternRegex: string;
  /** Fields that ended up in the regex, in order of appearance. */
  capturedFields: TaggedField[];
  /** Values extracted from the sample — useful for "preview" before save. */
  extracted: Partial<Record<TaggedField, string>>;
  /** Flexible only: which words of the first sample the pattern keeps. */
  wordStates?: WordState[];
}

export interface CompileError {
  ok: false;
  reason:
    | "no_spans"
    | "overlapping_spans"
    | "duplicate_field"
    | "missing_required_field"
    | "empty_span"
    | "invalid_regex"
    | "roundtrip_mismatch"
    /** Flexible pattern kept no real word — it would match far too much. */
    | "too_loose"
    /** An extra example has different fields or a different field order. */
    | "different_format"
    /** The pattern doesn't read an extra example the way it was tagged. */
    | "extra_sample_mismatch";
  detail?: string;
  /** Flexible only: the word states, so the screen can still let the user fix the words. */
  wordStates?: WordState[];
}

export type CompileResult = CompileSuccess | CompileError;

// Field-specific capture regex — chosen to be tight enough to not
// over-match but loose enough to tolerate variance banks throw at us.
//
// NOTE: merchant uses a non-greedy char-class. The compiler appends a
// lookahead for the next anchor character so the merchant capture stops
// correctly even when the surrounding anchor is short.
const FIELD_REGEX: Record<TaggedField, string> = {
  amount: "[\\d,]+(?:\\.\\d{1,2})?",
  // v15.10.0: account accepts either last 3-6 digits of a card/savings
  // (existing behavior) OR a multi-word nickname for a wallet-style account
  // (e.g. "Amazon Pay Wallet", "TataNeu Coins"). The digit alternation is
  // listed first so "1234" stays a 4-digit account, not matched as text.
  // The text branch caps at 50 chars so a runaway merchant-like capture
  // can't swallow the rest of the SMS.
  account: "(?:\\d{3,6}|[A-Za-z][A-Za-z0-9 &.'\\-]{1,49})",
  merchant: "[A-Za-z0-9 &.,'*\\-\\/]+?",
  // Date: alternatives in specificity order so the engine commits to the
  // longest match first. Formats handled:
  //   YYYY-MM-DD (ISO, with optional T/space + HH:MM[:SS])
  //   DD[-/.]MMM[-/.]YYYY or DD[-/.]MM[-/.]YYYY (with optional time)
  //   DDMmmYY / DDMmmYYYY (compact, no separator, e.g. 14Jun25)
  //   DDth/st/nd/rd MMM YYYY (ordinal suffix, e.g. 10th Apr 2026)
  //   DD MMM YYYY (space-separated, e.g. 25 Apr 2026)
  //   MMM[-/ ]YYYY or MMM-YY (month-year only, e.g. JAN 2026)
  date: "(?:\\d{4}-\\d{2}-\\d{2}(?:[T: ]\\d{2}:\\d{2}(?::\\d{2})?)?|\\d{1,2}[-/.](?:[A-Za-z]{3}|\\d{2})[-/.]\\d{2,4}(?:\\s+\\d{2}:\\d{2}(?::\\d{2})?)?|\\d{1,2}[A-Za-z]{3}\\d{2,4}|\\d{1,2}(?:st|nd|rd|th)\\s+[A-Za-z]{3}\\s+\\d{4}|\\d{1,2}\\s+[A-Za-z]{3}\\s+\\d{4}|[A-Za-z]{3}(?:[-/\\s]\\d{2,4}))",
  balance: "[\\d,]+(?:\\.\\d{1,2})?",
  // ref is the free-text "remarks / description" field — may be a UPI/NEFT
  // id, a multi-word remark, or a slash-separated payload. Non-greedy so
  // trailing anchor text can terminate it; same last-field-greedy fallback
  // as merchant is applied in the compile step.
  // v15.13.0: made more restrictive to avoid matching long passbook IDs.
  // Passbook IDs should be left in anchor text (not tagged as ref) so they
  // get wildcarded by the passbook ID wildcarding logic.
  ref: "[A-Za-z0-9 &.,'*\\-\\/:#]{1,30}?",
  // Person / business name. Non-greedy so the word after it ends the capture.
  counterparty: "[A-Za-z][A-Za-z .]{1,40}?",
  // Masked other account: "xxxxxxxxxx0006", "**1234", "1234".
  other_account: "[Xx*]{0,12}\\d{3,6}",
};

/** Fields that capture free text and stop at the next anchor (non-greedy). */
const LAZY_FIELDS = new Set<TaggedField>(["merchant", "ref", "counterparty"]);

/** Greedy version of a lazy field's regex — used when nothing follows it to stop on. */
function greedy(field: TaggedField): string {
  return FIELD_REGEX[field].replace(/\+\?$/, "+").replace(/\}\?$/, "}");
}

/**
 * Transform "URL" segments in anchor text into a regex fragment that
 * matches any URL of the same domain, not the literal per-message slug.
 *
 * v15.10.1 fix: transactional SMSes routinely include shortener links with
 * per-message unique tokens (e.g. "m.tneu.in/MYTNEU/joogO2l"). Escaping
 * them verbatim bakes the token into the template and defeats matching
 * on the next SMS (which has a different token). Replace the path/query
 * after the domain with a permissive `\S*` so the template matches any
 * URL with the same scheme+domain structure.
 */
const URL_REGEX = /https?:\/\/[^\s]+/gi;

/**
 * Detect passbook IDs and similar long account identifiers.
 * These are alphanumeric strings (8+ chars) that look like:
 * - EPFO passbook IDs: APHYD00641440000014984
 * - Account numbers: 1234567890123
 * - UAN numbers: 101234567890
 *
 * Pattern: 8+ alphanumeric characters, mix of letters and numbers.
 * Avoid matching regular words by requiring at least 2 digits.
 * Also require at least 2 letters to avoid matching pure numbers.
 */
const PASSBOOK_ID_REGEX = /[A-Za-z0-9]{12,}/g;

function wildcardizePassbookIds(text: string): { out: string; passbookPlaceholders: string[] } {
  // Swap each passbook ID for a sentinel placeholder so the subsequent
  // escapeLiteral whitespace/regex-special handling doesn't touch it.
  // Then we swap the placeholders back with a compiled passbook ID regex.
  const passbookPlaceholders: string[] = [];
  const out = text.replace(PASSBOOK_ID_REGEX, (match) => {
    // Only wildcardize if it looks like a real account identifier:
    // - Contains at least 2 digits (to avoid matching regular words)
    // - Contains at least 2 letters (to avoid matching pure numbers)
    const digitCount = (match.match(/\d/g) || []).length;
    const letterCount = (match.match(/[A-Za-z]/g) || []).length;
    if (digitCount < 2 || letterCount < 2) {
      // Not a passbook ID - leave as-is (will be escaped as literal)
      return match;
    }
    // Replace with pattern that matches any similar alphanumeric ID
    const placeholder = `\x00PBK${passbookPlaceholders.length}\x00`;
    passbookPlaceholders.push("[A-Z0-9]{8,}");
    return placeholder;
  });
  return { out, passbookPlaceholders };
}

function wildcardizeUrls(text: string): { out: string; urlPlaceholders: string[] } {
  // Swap each URL for a sentinel placeholder so the subsequent
  // escapeLiteral whitespace/regex-special handling doesn't touch it.
  // Then we swap the placeholders back with a compiled URL regex.
  const urlPlaceholders: string[] = [];
  const out = text.replace(URL_REGEX, (match) => {
    // Preserve scheme + host as a literal prefix (gives the template
    // enough specificity to not collide with other URLs); wildcard the
    // path/query so per-message unique tokens don't break matching.
    // Best-effort parse — if it doesn't look like a well-formed URL,
    // fall back to a broad pattern.
    const hostMatch = match.match(/^(https?:\/\/[^\s/?#]+)([/?#].*)?$/i);
    let re: string;
    if (hostMatch) {
      const host = hostMatch[1];
      // Escape the scheme+host literal; allow any non-whitespace tail.
      re = escapeRegexSpecials(host) + "\\S*";
    } else {
      re = "https?:\\/\\/\\S+";
    }
    const placeholder = `\x00URL${urlPlaceholders.length}\x00`;
    urlPlaceholders.push(re);
    return placeholder;
  });
  return { out, urlPlaceholders };
}

function escapeRegexSpecials(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeLiteral(text: string): string {
  // Escape regex specials, then collapse any whitespace run into \s+ so
  // banks with trailing spaces / tabs / newlines still match the template.
  //
  // v15.10.1: additionally replace URL literals with a scheme+host prefix
  // + `\S*` so per-message unique path tokens (shortener slugs) don't
  // defeat matching on subsequent SMSes.
  //
  // v15.13.0: additionally replace passbook ID literals with a wildcard
  // pattern so account-specific identifiers don't break matching across
  // different accounts (e.g., EPFO passbook IDs like APHYD00641440000014984).
  //
  // Pipeline: passbook-wildcard → URL-wildcard → whitespace sentinel →
  // escape → swap sentinels back. Order matters — passbook/URL placeholders
  // must survive both the whitespace and the escape passes, and their
  // regexes must NOT be escaped.
  const URL_SENTINEL_RE = /\x00URL(\d+)\x00/g;
  const PBK_SENTINEL_RE = /\x00PBK(\d+)\x00/g;
  
  const { out: pbkMasked, passbookPlaceholders } = wildcardizePassbookIds(text);
  const { out: urlMasked, urlPlaceholders } = wildcardizeUrls(pbkMasked);

  const WS_SENTINEL = "\x00WS\x00";
  const wsMasked = urlMasked.replace(/\s+/g, WS_SENTINEL);

  const escaped = escapeRegexSpecials(wsMasked);

  const withWs = escaped.replace(new RegExp(WS_SENTINEL, "g"), "\\s+");

  // Swap passbook sentinels back FIRST (before URLs) to avoid any
  // potential collision if a passbook ID somehow appears in a URL.
  const withPbk = withWs.replace(PBK_SENTINEL_RE, (_, idx) => passbookPlaceholders[Number(idx)] ?? "[A-Z0-9]{8,}");
  
  // Swap URL sentinels back LAST, using their already-compiled regex
  // fragments (which include the needed escapes on the scheme+host
  // portion but leave \S* raw).
  return withPbk.replace(URL_SENTINEL_RE, (_, idx) => urlPlaceholders[Number(idx)] ?? "\\S+");
}

function sortSpans(spans: TaggedSpan[]): TaggedSpan[] {
  return [...spans].sort((a, b) => a.start - b.start);
}

interface PreparedSample {
  body: string;
  normBody: string;
  normToOrig: number[];
  /** Tagged spans sorted by position, original offsets. */
  sorted: TaggedSpan[];
  /** Same spans in normalised offsets. */
  normSpans: TaggedSpan[];
}

function prepareSample(smsBody: string, spans: TaggedSpan[]): PreparedSample | CompileError {
  const sorted = sortSpans(spans);
  const norm = normalizeSms(smsBody);
  const normSpans: TaggedSpan[] = [];
  for (const s of sorted) {
    const mapped = mapOriginalSpanToNormalized(s, norm.normalizedToOriginal);
    if (!mapped) {
      return {
        ok: false,
        reason: "empty_span",
        detail: `${s.field} — tagged text was removed by normalization (e.g. URL). Re-tag elsewhere.`,
      };
    }
    normSpans.push({ field: s.field, start: mapped.start, end: mapped.end });
  }
  return { body: smsBody, normBody: norm.text, normToOrig: norm.normalizedToOriginal, sorted, normSpans };
}

const isError = (x: PreparedSample | CompileError): x is CompileError => "ok" in x;

interface GapWord {
  word: string;
  start: number;
  end: number;
}

/** Whitespace-separated words of normBody[from, to), normalised offsets. */
function wordsIn(normBody: string, from: number, to: number): GapWord[] {
  const out: GapWord[] = [];
  const re = /\S+/g;
  const text = normBody.slice(from, to);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ word: m[0], start: from + m.index, end: from + m.index + m[0].length });
  }
  return out;
}

/** Gap k = text before field k; gap n = text after the last field. */
function gapBounds(sample: PreparedSample, k: number): [number, number] {
  const n = sample.normSpans.length;
  const from = k === 0 ? 0 : sample.normSpans[k - 1].end;
  const to = k < n ? sample.normSpans[k].start : sample.normBody.length;
  return [from, to];
}

/** Indexes into `a` of a longest common subsequence of a and b (by word text). */
function lcsIndexes(a: string[], b: string[]): Set<number> {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const keep = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      keep.add(i);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return keep;
}

/** Words before a field that tell the pattern where the field starts. */
export const LEAD_IN_WORDS = 2;
/** Most characters a "can change" stretch may span. */
const FLEX_GAP = "[\\s\\S]{0,120}?";
const CURRENCY_WORD = /^(?:rs\.?|inr|₹)$/;

/**
 * Direction verbs are interchangeable in a flexible pattern, so one template reads a bank's
 * "credited" and "debited" messages alike ("Auto" type tells them apart at match time). The
 * small word banks put after them ("credited with", "debited for") becomes optional.
 */
const DIRECTION_WORD = /^(?:credited|debited|received|deposited|spent|sent|paid|withdrawn|refunded|reversed)[.,:]?$/;
const DIRECTION_ALT = "(?:credited|debited|received|deposited|spent|sent|paid|withdrawn|refunded|reversed)[.,:]?";
const FILLER_WORD = /^(?:with|for|of|by)$/;
const OPTIONAL_FILLER = "(?:\\s+(?:with|for|of|by))?";

/** Word as compared between examples: all direction verbs count as the same word. */
const compareForm = (w: string) => (DIRECTION_WORD.test(w) ? "§direction" : w);

/** Does the kept set include at least one real word (3+ letters, not a currency word)? */
function hasAnchorWord(words: string[]): boolean {
  return words.some((w) => !CURRENCY_WORD.test(w) && (w.match(/[a-z]/gi) ?? []).length >= 3);
}

/**
 * Flexible pattern for the first sample. For each stretch of text around the fields, keeps:
 *   - the last LEAD_IN_WORDS words before each field
 *   - the first word after a free-text field (so its capture knows where to stop)
 *   - words common to every example (when there are extra examples)
 *   - words the user made required
 * minus words the user made optional; everything else becomes a bounded "anything" gap.
 * With extra examples, automatic words are only kept if every example has them.
 */
function buildFlexible(
  first: PreparedSample,
  extras: PreparedSample[],
  rules: WordRules,
): { pattern: string; wordStates: WordState[]; keptWords: string[] } {
  const n = first.normSpans.length;
  const required = new Set(rules.required);
  const optional = new Set(rules.optional);
  let pattern = "";
  const wordStates: WordState[] = [];
  const keptWords: string[] = [];

  for (let k = 0; k <= n; k++) {
    const [from, to] = gapBounds(first, k);
    const words = wordsIn(first.normBody, from, to);
    const texts = words.map((w) => w.word);

    let common: Set<number> | null = null;
    for (const ex of extras) {
      const [ef, et] = gapBounds(ex, k);
      const theirs = wordsIn(ex.normBody, ef, et).map((w) => compareForm(w.word));
      const shared = lcsIndexes(texts.map(compareForm), theirs);
      const prev: Set<number> | null = common;
      common = prev ? new Set<number>([...prev].filter((i: number) => shared.has(i))) : shared;
    }

    const states: WordState["state"][] = words.map((w, i) => {
      if (required.has(w.word)) return "required";
      if (optional.has(w.word)) return "free";
      const isLeadIn =
        k < n &&
        (i >= words.length - LEAD_IN_WORDS ||
          // "credited with rs." — the verb before a joining word in the lead-in comes along
          (i === words.length - LEAD_IN_WORDS - 1 &&
            DIRECTION_WORD.test(w.word) &&
            FILLER_WORD.test(words[i + 1]?.word ?? "")));
      const isTerminator = k > 0 && i === 0 && LAZY_FIELDS.has(first.normSpans[k - 1].field);
      if (common) {
        if (common.has(i)) return "common";
        return "free";
      }
      return isLeadIn || isTerminator ? "auto" : "free";
    });

    let out = "";
    let started = k > 0;
    let dropping = false;
    let cursor = from;
    let afterDirection = false;
    words.forEach((w, i) => {
      const kept = states[i] !== "free";
      // End = where the next normalised character starts in the original (normalisation can
      // shorten a word — "INR " becomes "rs."), minus any whitespace before it.
      const origStart = first.normToOrig[w.start];
      let origEnd = w.end < first.normToOrig.length ? first.normToOrig[w.end] : first.body.length;
      while (origEnd > origStart + 1 && /\s/.test(first.body[origEnd - 1])) origEnd--;
      wordStates.push({
        start: origStart,
        end: origEnd,
        word: w.word,
        state: states[i],
      });
      if (!kept) {
        dropping = true;
        return;
      }
      keptWords.push(w.word);
      // "with/for/of/by" right after a direction verb is already covered by its optional group.
      if (afterDirection && !dropping && FILLER_WORD.test(w.word)) {
        cursor = w.end;
        afterDirection = false;
        return;
      }
      if (dropping) {
        if (started) out += FLEX_GAP;
      } else if (started) {
        out += escapeLiteral(first.normBody.slice(cursor, w.start));
      }
      if (DIRECTION_WORD.test(w.word)) {
        out += DIRECTION_ALT + OPTIONAL_FILLER;
        afterDirection = true;
      } else {
        out += escapeLiteral(w.word);
        afterDirection = false;
      }
      started = true;
      dropping = false;
      cursor = w.end;
    });
    if (k < n) {
      if (dropping) {
        if (started) out += FLEX_GAP;
      } else if (started) {
        out += escapeLiteral(first.normBody.slice(cursor, to));
      }
      const field = first.normSpans[k].field;
      pattern += out + `(?<${field}>${FIELD_REGEX[field]})`;
    } else {
      pattern += out;
    }
  }

  // A lazy field that ends the pattern (nothing kept after it) would capture one character.
  const lastField = first.normSpans[n - 1]?.field;
  if (lastField && LAZY_FIELDS.has(lastField) && pattern.endsWith(`(?<${lastField}>${FIELD_REGEX[lastField]})`)) {
    pattern = pattern.slice(0, pattern.length - FIELD_REGEX[lastField].length - 1) + greedy(lastField) + ")";
  }
  return { pattern, wordStates, keptWords };
}

/** Run the compiled pattern on a prepared sample and check every field reads as tagged. */
function roundTrip(re: RegExp, sample: PreparedSample): string | null {
  const m = re.exec(sample.normBody);
  if (!m || !m.groups) return "Compiled regex didn't match the sample SMS";
  for (const s of sample.normSpans) {
    const got = m.groups[s.field];
    const want = sample.normBody.slice(s.start, s.end);
    if (got == null || got.trim() !== want.trim()) return `Field ${s.field}: expected "${want}", got "${got}"`;
  }
  return null;
}

export function compileTemplate(input: CompileInput): CompileResult {
  if ((input.style ?? "exact") === "flexible" || (input.extraSamples?.length ?? 0) > 0) {
    return compileFlexible(input);
  }
  const { smsBody, spans, requiredFields = ["amount"] } = input;

  if (spans.length === 0) {
    return { ok: false, reason: "no_spans" };
  }

  const sorted = sortSpans(spans);

  // Overlap check — spans must be strictly disjoint.
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      return {
        ok: false,
        reason: "overlapping_spans",
        detail: `${sorted[i - 1].field} overlaps ${sorted[i].field}`,
      };
    }
  }

  // Empty span check + duplicate field check.
  const seen = new Set<TaggedField>();
  for (const s of sorted) {
    if (s.end <= s.start) {
      return { ok: false, reason: "empty_span", detail: s.field };
    }
    if (seen.has(s.field)) {
      return { ok: false, reason: "duplicate_field", detail: s.field };
    }
    seen.add(s.field);
  }

  // Required-field check.
  for (const req of requiredFields) {
    if (!seen.has(req)) {
      return { ok: false, reason: "missing_required_field", detail: req };
    }
  }

  // v15.10.1: normalize the sample + remap tap offsets onto the normalized
  // body. The compiled regex operates in normalized-space from here on;
  // match-side runs incoming SMSes through the same pipeline before
  // applying the regex. This kills ~8 of the 17 known pitfalls in one
  // sweep (case variance, ₹/INR/Rs prefixes, thousands commas, whitespace
  // drift, DLT headers, URL slugs, ZW/RTL marks, trailing boilerplate).
  const norm = normalizeSms(smsBody);
  const normBody = norm.text;
  const normSpans: TaggedSpan[] = [];
  for (const s of sorted) {
    const mapped = mapOriginalSpanToNormalized(s, norm.normalizedToOriginal);
    if (!mapped) {
      return {
        ok: false,
        reason: "empty_span",
        detail: `${s.field} — tagged text was removed by normalization (e.g. URL). Re-tag elsewhere.`,
      };
    }
    normSpans.push({ field: s.field, start: mapped.start, end: mapped.end });
  }

  // Build: alternating anchor literals + named capture groups, all in
  // normalized space.
  let pattern = "";
  const extracted: Partial<Record<TaggedField, string>> = {};
  // Separate map for round-trip validation — uses the NORMALIZED slice
  // so the compiled-regex-captured value (which is also normalized)
  // compares correctly. `extracted` keeps the pretty original-case form
  // for UI preview.
  const extractedNormalized: Partial<Record<TaggedField, string>> = {};
  const capturedFields: TaggedField[] = [];
  let cursor = 0;
  for (let idx = 0; idx < normSpans.length; idx++) {
    const s = normSpans[idx];
    const anchor = normBody.slice(cursor, s.start);
    if (anchor.length > 0) pattern += escapeLiteral(anchor);

    // Merchant + ref use non-greedy `+?` so trailing anchor can stop the
    // capture. But if THIS is the last span AND there's no trailing tail
    // text to stop on, `+?` collapses to 1 character — wrong. Switch to
    // greedy so the field grabs everything to end of string.
    let fieldRegex = FIELD_REGEX[s.field];
    if (LAZY_FIELDS.has(s.field)) {
      const isLast = idx === normSpans.length - 1;
      const hasTail = normBody.slice(s.end).trim().length > 0;
      if (isLast && !hasTail) {
        fieldRegex = greedy(s.field);
      }
    }
    pattern += `(?<${s.field}>${fieldRegex})`;
    capturedFields.push(s.field);
    // Preview on the UI shows what the user actually tagged in the
    // ORIGINAL (original-case, original-punctuation). Use the pre-normalize
    // span offsets from `sorted`, not the normalized ones.
    extracted[s.field] = smsBody.slice(sorted[idx].start, sorted[idx].end);
    extractedNormalized[s.field] = normBody.slice(s.start, s.end);
    cursor = s.end;
  }
  // Trailing anchor — keep a short tail only (up to 20 chars) to avoid
  // anchoring on transient text like trailing URLs or "View updated
  // balance here: ..." that banks vary between messages.
  const tail = normBody.slice(cursor);
  if (tail.length > 0) {
    const tailTrimmed = tail.slice(0, 20);
    pattern += escapeLiteral(tailTrimmed);
  }

  // Validate: compile the regex and round-trip it against the normalized sample.
  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch (e) {
    return {
      ok: false,
      reason: "invalid_regex",
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  const m = re.exec(normBody);
  if (!m || !m.groups) {
    return {
      ok: false,
      reason: "roundtrip_mismatch",
      detail: "Compiled regex didn't match the sample SMS",
    };
  }
  for (const field of capturedFields) {
    const got = m.groups[field];
    const want = extractedNormalized[field];
    if (got == null || want == null || got.trim() !== want.trim()) {
      return {
        ok: false,
        reason: "roundtrip_mismatch",
        detail: `Field ${field}: expected "${want}", got "${got}"`,
      };
    }
  }

  return {
    ok: true,
    patternRegex: pattern,
    capturedFields,
    extracted,
  };
}

function validateSpans(spans: TaggedSpan[], requiredFields: TaggedField[]): CompileError | null {
  if (spans.length === 0) return { ok: false, reason: "no_spans" };
  const sorted = sortSpans(spans);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      return { ok: false, reason: "overlapping_spans", detail: `${sorted[i - 1].field} overlaps ${sorted[i].field}` };
    }
  }
  const seen = new Set<TaggedField>();
  for (const s of sorted) {
    if (s.end <= s.start) return { ok: false, reason: "empty_span", detail: s.field };
    if (seen.has(s.field)) return { ok: false, reason: "duplicate_field", detail: s.field };
    seen.add(s.field);
  }
  for (const req of requiredFields) {
    if (!seen.has(req)) return { ok: false, reason: "missing_required_field", detail: req };
  }
  return null;
}

/**
 * Flexible (and multi-example) compile. Same spans/round-trip rules as exact; the words around
 * the fields are reduced to the key ones (see buildFlexible).
 */
function compileFlexible(input: CompileInput): CompileResult {
  const { smsBody, spans, requiredFields = ["amount"], wordRules = { required: [], optional: [] } } = input;
  const bad = validateSpans(spans, requiredFields);
  if (bad) return bad;

  const first = prepareSample(smsBody, spans);
  if (isError(first)) return first;
  const extras: PreparedSample[] = [];
  const order = first.sorted.map((s) => s.field).join(",");
  for (const [i, ex] of (input.extraSamples ?? []).entries()) {
    const exBad = validateSpans(ex.spans, requiredFields);
    if (exBad) return { ...exBad, detail: `Example ${i + 2}: ${exBad.detail ?? exBad.reason}` };
    const prepared = prepareSample(ex.smsBody, ex.spans);
    if (isError(prepared)) return { ...prepared, detail: `Example ${i + 2}: ${prepared.detail ?? ""}` };
    if (prepared.sorted.map((s) => s.field).join(",") !== order) {
      return { ok: false, reason: "different_format", detail: `Example ${i + 2}` };
    }
    extras.push(prepared);
  }

  const { pattern, wordStates, keptWords } = buildFlexible(first, extras, wordRules);
  if (!hasAnchorWord(keptWords)) return { ok: false, reason: "too_loose", wordStates };

  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch (e) {
    return { ok: false, reason: "invalid_regex", detail: e instanceof Error ? e.message : String(e) };
  }
  const firstErr = roundTrip(re, first);
  if (firstErr) return { ok: false, reason: "roundtrip_mismatch", detail: firstErr, wordStates };
  for (const [i, ex] of extras.entries()) {
    const err = roundTrip(re, ex);
    if (err) return { ok: false, reason: "extra_sample_mismatch", detail: `Example ${i + 2}: ${err}`, wordStates };
  }

  const extracted: Partial<Record<TaggedField, string>> = {};
  for (const s of first.sorted) extracted[s.field] = smsBody.slice(s.start, s.end);
  return {
    ok: true,
    patternRegex: pattern,
    capturedFields: first.sorted.map((s) => s.field),
    extracted,
    wordStates,
  };
}

/**
 * v15.6.0 — auto-tag helper. Runs deterministic regexes over a raw SMS to
 * produce a best-guess span set. Returns the spans; caller merges with any
 * existing spans (or calls it for a blank draft). Patterns are intentionally
 * conservative: they skip when unsure rather than over-tag.
 */
export function autoTag(smsBody: string): TaggedSpan[] {
  const spans: TaggedSpan[] = [];
  const pushFirst = (field: TaggedField, re: RegExp, captureGroup = 0) => {
    const m = re.exec(smsBody);
    if (!m) return;
    const fullMatch = m[0];
    const groupMatch = captureGroup > 0 ? m[captureGroup] : fullMatch;
    if (groupMatch == null) return;
    // Find groupMatch inside fullMatch, then offset into smsBody.
    const groupOffsetInFull = captureGroup > 0 ? fullMatch.indexOf(groupMatch) : 0;
    const start = (m.index ?? 0) + groupOffsetInFull;
    const end = start + groupMatch.length;
    if (start < 0 || end > smsBody.length || end <= start) return;
    spans.push({ field, start, end });
  };

  // AMOUNT: "Rs.1,500.00" / "INR 200" / "₹ 1500" — capture the digit run.
  pushFirst(
    "amount",
    /(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
    1,
  );

  // ACCOUNT: "x1234", "XX1234", "****1234", "A/c ...1234" — last 3-6 digits
  // following a masked prefix.
  pushFirst(
    "account",
    /(?:(?:A\/?c|Acct|Card)[^0-9]*|x{1,}|\*{2,})(\d{3,6})\b/i,
    1,
  );

  // DATE: all formats handled by parseDateAny — ISO, DD-MMM-YY, DD/MM/YYYY,
  // dot-sep, compact DDMmmYY, ordinal "10th Apr 2026", spaced "25 Apr 2026",
  // month-year "JAN 2026". Most-specific alternatives first.
  pushFirst(
    "date",
    /\b(?:\d{4}-\d{2}-\d{2}(?:[T: ]\d{2}:\d{2}(?::\d{2})?)?|\d{1,2}[-\/.][A-Za-z0-9]{2,4}[-\/.]\d{2,4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?|\d{1,2}[A-Za-z]{3}\d{2,4}|\d{1,2}(?:st|nd|rd|th)\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|[A-Za-z]{3}(?:[-\/\s]\d{2,4})?)\b/i,
    0,
  );

  // REF: "UPI Ref no 123456789012" / "RRN 12345" / "IMPS ref 555"
  pushFirst(
    "ref",
    /(?:UPI\s*Ref(?:\s*no)?|RRN|IMPS\s*ref|Ref(?:erence)?\s*(?:no|#|:)?)[^\w]*([A-Za-z0-9]{6,})/i,
    1,
  );

  // BALANCE: "Avl Bal Rs 50,000" / "Available Balance: INR 100.00"
  pushFirst(
    "balance",
    /(?:Avl\.?\s*Bal|Available\s*Bal(?:ance)?|Bal\.?)[^0-9]*([\d,]+(?:\.\d{1,2})?)/i,
    1,
  );

  // OTHER ACCOUNT: "To A/c xxxxxxxxxx0006", "to a/c **1234" — the destination of a transfer.
  pushFirst("other_account", /\bto\s+a\/?c(?:\s+no\.?)?\s+([Xx*]{0,12}\d{3,6})\b/i, 1);

  // NAME: "transfer from Mr. SOURAVBAID", "Transferred to RAHUL VERMA", "linked to mobile 9XX-NAME".
  pushFirst(
    "counterparty",
    /(?:transfer(?:red)?\s+(?:from|to)|trf\s+(?:from|to)|linked\s+to\s+mobile\s+[\dX*x]+-)\s*(?:(?:Mr|Mrs|Ms)\.?\s*)?([A-Za-z][A-Za-z ]{1,40}?)(?=\s*[.(]|\s+(?:Ref|Avl|on)\b|$)/i,
    1,
  );

  // De-dupe field and remove overlaps (keep first occurrence).
  const seen = new Set<TaggedField>();
  const clean: TaggedSpan[] = [];
  spans.sort((a, b) => a.start - b.start);
  for (const s of spans) {
    if (seen.has(s.field)) continue;
    // Overlap check — skip if it crashes into an already-accepted span.
    const overlaps = clean.some((c) => !(s.end <= c.start || s.start >= c.end));
    if (overlaps) continue;
    seen.add(s.field);
    clean.push(s);
  }
  return clean;
}

/**
 * v15.6.0 — Human-friendly error message for a compile error. Used for inline
 * display on the tagger UI so users don't have to decipher internal reason codes.
 */
export function explainCompileError(err: CompileError): string {
  switch (err.reason) {
    case "no_spans":
      return "Tap a field on the left, then tap the matching word(s) in the SMS.";
    case "overlapping_spans":
      return `Two fields share the same words (${err.detail ?? ""}). Tap one of the affected words to re-assign it.`;
    case "duplicate_field":
      return `The "${err.detail ?? "same"}" field is tagged twice. Use the Clear button on the field row to reset it, then try again.`;
    case "missing_required_field":
      return `Amount is required. Select the Amount field and tap the number in the SMS.`;
    case "empty_span":
      return `An empty ${err.detail ?? "field"} span slipped through. Re-tag the field.`;
    case "invalid_regex":
      return `Couldn't build a matcher from this tagging. Try tagging fewer special characters. ${err.detail ? `(${err.detail})` : ""}`.trim();
    case "too_loose":
      return "This would read almost any message. With no field selected, tap a word that always appears (like \"credited\" or \"debited\") to make it required.";
    case "different_format":
      return `${err.detail ?? "The other example"} has different fields or a different order. Save it as its own template instead.`;
    case "extra_sample_mismatch":
      return `The pattern doesn't read ${err.detail?.split(":")[0] ?? "the other example"} the way it's tagged. Check its tags, or make fewer words required.`;
    case "roundtrip_mismatch":
      return `The generated pattern doesn't cleanly extract the tagged values. Often fixed by using long-press to tag only the number/digits, not "Rs." or "Bal:". ${err.detail ? `Details: ${err.detail}` : ""}`.trim();
    default:
      return "Couldn't compile the template. Try re-tagging the fields.";
  }
}

/**
 * v15.6.0 — Reverse-compile a previously-saved template. Given the sample SMS
 * and the stored regex, locate each named capture inside the body and return
 * the offsets. Used for the Edit flow so the user sees their previous tags.
 *
 * Returns null if the regex doesn't match the sample (shouldn't happen for a
 * valid template, but defensive).
 */
export function deriveSpansFromRegex(
  patternRegex: string,
  smsBody: string,
): TaggedSpan[] | null {
  let re: RegExp;
  try {
    re = new RegExp(patternRegex, "i");
  } catch {
    return null;
  }
  // v15.10.1: regex is normalized-space. Normalize the sample + match
  // there, then map the normalized hit positions BACK into original
  // offsets using the norm map.
  const norm = normalizeSms(smsBody);
  const m = re.exec(norm.text);
  if (!m || !m.groups) return null;

  const spans: TaggedSpan[] = [];
  const fieldOrder: TaggedField[] = ALL_TAGGED_FIELDS;
  const orderInPattern: TaggedField[] = [];
  const namedRe = /\(\?<(amount|account|merchant|date|balance|ref|counterparty|other_account)>/g;
  let nm: RegExpExecArray | null;
  while ((nm = namedRe.exec(patternRegex)) !== null) {
    orderInPattern.push(nm[1] as TaggedField);
  }
  const walkOrder = orderInPattern.length > 0 ? orderInPattern : fieldOrder;

  for (const field of walkOrder) {
    const value = m.groups[field];
    if (value == null) continue;
    
    // Search for the value in the normalized body without cursor constraint.
    // This handles cases where fields appear in different orders in the text.
    // Use lastIndexOf to handle duplicate values (e.g., same amount appears twice).
    const normIdx = norm.text.lastIndexOf(value);
    if (normIdx < 0) return null;
    const normEnd = normIdx + value.length;
    // Map normalized index range back into original-space so the tagger
    // UI can highlight the right tokens.
    const origStart = norm.normalizedToOriginal[normIdx];
    // End maps to the char AFTER the last normalized position.
    const origEnd = (norm.normalizedToOriginal[normEnd - 1] ?? origStart) + 1;
    if (origStart == null || origEnd <= origStart) return null;
    spans.push({ field, start: origStart, end: origEnd });
  }
  return spans.length > 0 ? spans : null;
}

/**
 * Test a compiled template against an arbitrary SMS. Returns extracted
 * fields if matched, null otherwise. Used by the "test with another
 * sample" step in the tagging UI AND the runtime SMS matcher.
 *
 * v15.10.1:
 *   - Normalizes `smsBody` through the shared pipeline so match-side
 *     sees the same canonical form the compiler worked from. Kills
 *     case / ₹INR / comma / whitespace / URL-slug variance in one sweep.
 *   - Maps each captured range back to the ORIGINAL SMS offsets and
 *     returns the original-cased slice. Downstream (expense detail,
 *     hisaab export) still sees "SWIGGY" / "TataNeu" even though the
 *     match logic lowercased everything internally. Case-insensitive
 *     lookups (account_label matching) are unaffected because they
 *     LOWER() both sides at the SQL level.
 */
export function testTemplate(
  patternRegex: string,
  smsBody: string,
): Partial<Record<TaggedField, string>> | null {
  const norm = normalizeSms(smsBody);
  let re: RegExp;
  try {
    re = new RegExp(patternRegex, "i");
  } catch {
    return null;
  }
  // Walk the regex over the normalized body so it sees the canonical form
  // the template was compiled against.
  const normBody = norm.text;
  const m = re.exec(normBody);
  if (!m || !m.groups) return null;

  const result: Partial<Record<TaggedField, string>> = {};
  const fieldOrder: TaggedField[] = ALL_TAGGED_FIELDS;
  const orderInPattern: TaggedField[] = [];
  const namedRe = /\(\?<(amount|account|merchant|date|balance|ref|counterparty|other_account)>/g;
  let nm: RegExpExecArray | null;
  while ((nm = namedRe.exec(patternRegex)) !== null) {
    orderInPattern.push(nm[1] as TaggedField);
  }
  const walkOrder = orderInPattern.length > 0 ? orderInPattern : fieldOrder;

  for (const field of walkOrder) {
    const value = m.groups[field];
    if (value == null) continue;
    
    // Search for the value in the normalized body without cursor constraint.
    // This handles cases where fields appear in different orders in the text.
    // Use lastIndexOf to handle duplicate values (e.g., same amount appears twice).
    const normIdx = normBody.lastIndexOf(value);
    if (normIdx < 0) {
      // Couldn't locate in normalized space — fall back to the raw lowercase
      // value. Only happens if the regex used complex alternatives that
      // don't produce a unique substring; very rare.
      result[field] = value;
      continue;
    }
    const normEnd = normIdx + value.length;
    const origStart = norm.normalizedToOriginal[normIdx];
    const origEnd = (norm.normalizedToOriginal[normEnd - 1] ?? origStart) + 1;
    if (origStart == null || origEnd <= origStart) {
      result[field] = value;
      continue;
    }
    result[field] = smsBody.slice(origStart, origEnd);
  }
  return result;
}

// Exposed for unit tests.
export const __test__ = { escapeLiteral, FIELD_REGEX, lcsIndexes };
