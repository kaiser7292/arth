/**
 * Reads amounts the way people in India say them (docs/SPEED_AND_VOICE_PROPOSAL.md §2.2 B1).
 *
 * English: "two fifty", "fifteen hundred", "1.5k", "2k", "5 lakh", "1.2 crore", "two thousand five hundred".
 * Hinglish: ek, do, teen … sau, hazaar, lakh; dedh (1.5), dhai (2.5), saade (+½), sava (+¼), paune (−¼).
 *
 * `normaliseSpokenNumbers` rewrites the words as digits so the rest of the reading sees "250";
 * `findAmount` then picks the number most likely to be the amount: one next to ₹, rupees or
 * bucks first, never a date ("5th", "5 November", "2 days ago") or card digits ("ending 4321").
 * Pure, no app imports; tested in __tests__/unit/voice-parser.test.ts.
 */

const EN_UNITS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};
/** Hindi number words: only read as numbers next to a Hindi scale or fraction ("do" is also English). */
const HI_UNITS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chhah: 6, saat: 7, aath: 8, nau: 9,
  das: 10, gyarah: 11, barah: 12, baarah: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16, satrah: 17,
  atharah: 18, unnis: 19, bees: 20, pachees: 25, pachchis: 25, tees: 30, chalis: 40, chaalis: 40,
  pachas: 50, pachaas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90,
};
const SCALES: Record<string, number> = {
  hundred: 100, sau: 100,
  thousand: 1000, hazaar: 1000, hazar: 1000, hajar: 1000, hajaar: 1000,
  lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, lakhs_: 1e5,
  million: 1e6,
  crore: 1e7, crores: 1e7, karod: 1e7, karor: 1e7, karore: 1e7,
};
const HI_SCALES = new Set(["sau", "hazaar", "hazar", "hajar", "hajaar", "lakh", "lakhs", "lac", "lacs", "crore", "crores", "karod", "karor", "karore"]);
/** Numbers on their own: dedh = 1½, dhai = 2½. */
const HI_FRACTION_VALUES: Record<string, number> = { dedh: 1.5, derh: 1.5, dhai: 2.5, dhaai: 2.5, adhai: 2.5, dhaee: 2.5 };
/** Changes the number after them: saade teen = 3½, sava do = 2¼, paune teen = 2¾. Alone ("sava sau"): of one. */
const HI_MODIFIERS: Record<string, (n: number) => number> = {
  saade: (n) => n + 0.5, sadhe: (n) => n + 0.5, saadhe: (n) => n + 0.5, sade: (n) => n + 0.5,
  sava: (n) => n + 0.25, sawa: (n) => n + 0.25,
  paune: (n) => n - 0.25, pone: (n) => n - 0.25,
};

type Tok = { text: string; word: string };

function tokenize(s: string): Tok[] {
  return (s.match(/\d+(?:\.\d+)?|[A-Za-z]+|[^A-Za-z0-9]+/g) ?? []).map((text) => ({ text, word: text.toLowerCase() }));
}
const isSpace = (t: Tok | undefined) => !!t && /^[ \t]+$/.test(t.text);
const isDigits = (w: string) => /^\d+(\.\d+)?$/.test(w);

type Piece = { kind: "n"; v: number } | { kind: "s"; v: number } | { kind: "mod"; f: (n: number) => number } | { kind: "and" };

/** The word as a number piece, or null. `hindi` says whether Hindi words count in this run. */
function pieceOf(w: string, hindi: boolean): Piece | null {
  if (w in EN_UNITS) return { kind: "n", v: EN_UNITS[w] };
  if (w in SCALES) return { kind: "s", v: SCALES[w] };
  if (w in HI_FRACTION_VALUES) return { kind: "n", v: HI_FRACTION_VALUES[w] };
  if (hindi && w in HI_UNITS) return { kind: "n", v: HI_UNITS[w] };
  if (hindi && w in HI_MODIFIERS) return { kind: "mod", f: HI_MODIFIERS[w] };
  if (w === "and") return { kind: "and" };
  return null;
}

/** Work out the value of a run of number pieces ("two thousand five hundred" → 2500). */
function evaluate(pieces: Piece[]): number | null {
  let total = 0;
  let current: number | null = null;
  let lastWasScale = false;
  let mod: ((n: number) => number) | null = null;
  for (const p of pieces) {
    if (p.kind === "and") continue;
    if (p.kind === "mod") {
      mod = p.f;
      continue;
    }
    if (p.kind === "n") {
      let n = p.v;
      if (mod) {
        n = mod(n);
        mod = null;
      }
      if (current == null) current = n;
      else if (!lastWasScale && n >= 20 && n % 10 === 0 && n < 100 && current < 20) current = current * 100 + n; // "two fifty", "twelve fifty"
      else current += n; // "fifty five", "nine hundred fifty"
      lastWasScale = false;
    } else {
      let base: number = current ?? 1;
      if (mod) {
        base = mod(current ?? 1);
        mod = null;
      }
      if (p.v >= 1000) {
        total += base * p.v;
        current = null;
      } else {
        current = base * p.v;
      }
      lastWasScale = true;
    }
  }
  const v = total + (current ?? 0);
  return v > 0 ? Math.round(v * 100) / 100 : null;
}

/**
 * Turn spoken number words into digits: "spent two fifty at dmart" → "spent 250 at dmart",
 * "5 lakh" → "500000", "1.5k" → "1500", "dedh sau" → "150". Everything else stays as it was.
 * A lone "one" stays a word ("the one near home"), and a bare digit stays as said ("2:50", "5th").
 */
export function normaliseSpokenNumbers(text: string): string {
  // "1.5k", "2 k", "1.2cr", "5L" with the digits.
  // No bare "l": "5 l milk" is litres. "5 lakh" is read with the words below.
  let s = text.replace(/(\d+(?:\.\d+)?)\s?(k|cr)\b/gi, (_m, n: string, u: string) => {
    const mult = u.toLowerCase() === "k" ? 1000 : 1e7;
    return String(Math.round(parseFloat(n) * mult * 100) / 100);
  });
  // Thousands separators: "1,200", "1,20,000".
  s = s.replace(/\d{1,3}(?:,\d{2,3})+\b/g, (m) => m.replace(/,/g, ""));

  const toks = tokenize(s);
  const out: string[] = [];
  let i = 0;
  while (i < toks.length) {
    const run = readRun(toks, i);
    if (run) {
      out.push(String(run.value));
      i = run.next;
    } else {
      out.push(toks[i].text);
      i++;
    }
  }
  return out.join("");
}

/** A run of number words starting at token i, joined only by spaces. */
function readRun(toks: Tok[], i: number): { value: number; next: number } | null {
  // Find how far the run could go, then decide whether Hindi words count in it.
  const words: { idx: number; word: string }[] = [];
  let k = i;
  const maybe = (w: string) =>
    w in EN_UNITS || w in SCALES || w in HI_UNITS || w in HI_FRACTION_VALUES || w in HI_MODIFIERS || w === "and" || isDigits(w);
  while (k < toks.length && maybe(toks[k].word)) {
    // Digits first ("5 lakh") or right after a scale ("2 lakh 50000", "2 thousand 500").
    if (isDigits(toks[k].word) && words.length > 0 && !(words[words.length - 1].word in SCALES)) break;
    words.push({ idx: k, word: toks[k].word });
    if (isSpace(toks[k + 1]) && k + 2 < toks.length) k += 2;
    else break;
  }
  // Trim trailing "and"s and words that can't end a number.
  while (words.length && words[words.length - 1].word === "and") words.pop();
  if (words.length === 0) return null;

  const lastIdx = words[words.length - 1].idx;
  const after = isSpace(toks[lastIdx + 1]) ? toks[lastIdx + 2]?.word : undefined;
  const hindi =
    words.some((w) => HI_SCALES.has(w.word) || w.word in HI_FRACTION_VALUES || w.word in HI_MODIFIERS) ||
    (after != null && /^(rupaye|rupay|rupiya|rupaiya|rupees?|rs)$/.test(after));
  const pieces: Piece[] = [];
  let used = 0;
  for (const w of words) {
    if (isDigits(w.word)) {
      pieces.push({ kind: "n", v: parseFloat(w.word) });
    } else {
      const p = pieceOf(w.word, hindi);
      if (!p) break;
      pieces.push(p);
    }
    used++;
  }
  while (used > 0 && pieces[used - 1].kind === "and") {
    pieces.pop();
    used--;
  }
  if (used === 0) return null;
  const first = words[0].word;
  // A bare digit with no scale after it stays as it was.
  if (isDigits(first) && !pieces.slice(1).some((p) => p.kind === "s")) return null;
  // "one" or "a"-like single words alone stay words; "do" without a scale was already excluded.
  if (used === 1 && (first === "one" || pieces[0].kind !== "n")) return null;
  const value = evaluate(pieces.slice(0, used));
  if (value == null) return null;
  return { value, next: words[used - 1].idx + 1 };
}

export interface FoundAmount {
  value: number;
  /** Where the number was in the text, so it can be taken out before the rest is read. */
  index: number;
  length: number;
}

/** Month names in full or their exact short forms, so "decathlon" and "marriott" aren't months. */
const MONTHS = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

/**
 * The amount in a sentence already through normaliseSpokenNumbers. Prefers a number next to
 * ₹ / rs / rupees / bucks, then the first other number that isn't a date, a count of days, or
 * card digits. A time-looking "2:50" counts as 250, since that's what the engine writes for "two fifty".
 */
export function findAmount(text: string): FoundAmount | undefined {
  type Cand = FoundAmount & { score: number };
  const cands: Cand[] = [];
  const re = /(₹\s*|\brs\.?\s*|\binr\s*)?(\d+(?::\d{2}|\.\d{1,2})?)(\s*(?:rupees?|rs\b\.?|bucks|rupaye|rupay|rupiya)\b)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[2];
    const before = text.slice(0, m.index).toLowerCase();
    const after = text.slice(m.index + m[0].length).toLowerCase();
    const value = raw.includes(":") ? parseInt(raw.replace(":", ""), 10) : parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0) continue;
    const marked = !!(m[1] || m[3]);
    if (!marked) {
      if (/^(st|nd|rd|th)\b/.test(after)) continue;
      if (new RegExp(`^\\s*(?:of\\s+)?${MONTHS}\\b`).test(after)) continue;
      if (new RegExp(`\\b${MONTHS}\\s*$`).test(before) && value <= 31) continue;
      if (/^\s*(days?|weeks?|months?|years?|din)\s*(ago|back|pehle|before)?\b/.test(after)) continue;
      if (/^[/-]\d/.test(after) || /\d[/-]$/.test(before)) continue;
      if (/\b(ending|ending in|ends in|ends with|card|account|a\/c|last|digits?|xx+)\s*$/.test(before)) continue;
      if (/\b(by|till|until|upto|up to|on|the)\s+(day\s+)?$/.test(before) && value <= 31) continue;
      if (/\bday\s*$/.test(before) && value <= 31) continue;
    }
    cands.push({ value, index: m.index, length: m[0].length, score: marked ? 10 : 1 });
  }
  if (cands.length === 0) return undefined;
  cands.sort((a, b) => b.score - a.score || a.index - b.index);
  const { value, index, length } = cands[0];
  return { value, index, length };
}

/** Normalise, then read the amount. */
export function readSpokenAmount(text: string): number | undefined {
  return findAmount(normaliseSpokenNumbers(text))?.value;
}
