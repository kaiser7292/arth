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

export type TaggedField = "amount" | "account" | "merchant" | "date" | "balance" | "ref";

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
}

export interface CompileSuccess {
  ok: true;
  /** Runnable regex string (no flags — caller compiles with `i`). */
  patternRegex: string;
  /** Fields that ended up in the regex, in order of appearance. */
  capturedFields: TaggedField[];
  /** Values extracted from the sample — useful for "preview" before save. */
  extracted: Partial<Record<TaggedField, string>>;
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
    | "roundtrip_mismatch";
  detail?: string;
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
  // Date matches D-M-Y in multiple formats OR month-year formats (JAN 2026, JAN-26, SEP-25).
  // For month-year formats, the parser converts to end-of-month date.
  // The matcher infers the year from context for 2-digit years.
  date: "(?:\\d{1,2}[-/][A-Za-z0-9]{2,4}[-/]\\d{2,4}(?:\\s+\\d{2}:\\d{2}(?::\\d{2})?)?|[A-Za-z]{3}(?:[-/\\s]\\d{2,4}))",
  balance: "[\\d,]+(?:\\.\\d{1,2})?",
  // ref is the free-text "remarks / description" field — may be a UPI/NEFT
  // id, a multi-word remark, or a slash-separated payload. Non-greedy so
  // trailing anchor text can terminate it; same last-field-greedy fallback
  // as merchant is applied in the compile step.
  ref: "[A-Za-z0-9 &.,'*\\-\\/:#]+?",
};

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
  // Pipeline: URL-wildcard (first, before escape), then whitespace
  // sentinel, then escape, then swap sentinels back. Order matters —
  // URL placeholders must survive both the whitespace and the escape
  // passes, and the URL's own regex must NOT be escaped.
  const URL_SENTINEL_RE = /\x00URL(\d+)\x00/g;
  const { out: urlMasked, urlPlaceholders } = wildcardizeUrls(text);

  const WS_SENTINEL = "\x00WS\x00";
  const wsMasked = urlMasked.replace(/\s+/g, WS_SENTINEL);

  const escaped = escapeRegexSpecials(wsMasked);

  const withWs = escaped.replace(new RegExp(WS_SENTINEL, "g"), "\\s+");

  // Swap URL sentinels back LAST, using their already-compiled regex
  // fragments (which include the needed escapes on the scheme+host
  // portion but leave \S* raw).
  return withWs.replace(URL_SENTINEL_RE, (_, idx) => urlPlaceholders[Number(idx)] ?? "\\S+");
}

function sortSpans(spans: TaggedSpan[]): TaggedSpan[] {
  return [...spans].sort((a, b) => a.start - b.start);
}

export function compileTemplate(input: CompileInput): CompileResult {
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
    if (s.field === "merchant" || s.field === "ref") {
      const isLast = idx === normSpans.length - 1;
      const hasTail = normBody.slice(s.end).trim().length > 0;
      if (isLast && !hasTail) {
        fieldRegex = fieldRegex.replace(/\+\?$/, "+");
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

  // DATE: "10-04-26" / "10/04/2026" / "10-APR-2026" / "JAN 2026" / "JAN-26" / "SEP-25"
  pushFirst(
    "date",
    /\b(?:\d{1,2}[-\/][A-Za-z0-9]{2,4}[-\/]\d{2,4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?|[A-Za-z]{3}(?:[-/\s]\d{2,4})?)\b/,
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
  const fieldOrder: TaggedField[] = ["amount", "account", "merchant", "date", "balance", "ref"];
  const orderInPattern: TaggedField[] = [];
  const namedRe = /\(\?<(amount|account|merchant|date|balance|ref)>/g;
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
  const fieldOrder: TaggedField[] = ["amount", "account", "merchant", "date", "balance", "ref"];
  const orderInPattern: TaggedField[] = [];
  const namedRe = /\(\?<(amount|account|merchant|date|balance|ref)>/g;
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
export const __test__ = { escapeLiteral, FIELD_REGEX };
