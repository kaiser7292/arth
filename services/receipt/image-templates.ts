/**
 * Smart image templates: a payment picture layout the user taught Arth by tapping its text - "this
 * is the amount", "this is who was paid" - the picture equivalent of Smart SMS templates. The next
 * picture with the same layout is read with the template, and what it finds wins over the general
 * reader (read-receipt.ts), which keeps filling anything the template doesn't cover.
 *
 * A layout is recognised by its fixed text (the anchors: headings and labels like "Paid
 * successfully!", "POWERED BY UPI" - text without digits that the user didn't tap as a value).
 * Each field remembers three ways to find its value, tried in order:
 *   1. the label written before the value on the same piece of text ("Tr. ID:" 110947642074),
 *   2. the nearest anchor above it and how many pieces further down it sits,
 *   3. where it sits on the picture.
 * Then the value is taken out of that piece by its type (a number for the amount, a date, an id...).
 *
 * The matching is pure (buildTemplate / matchTemplate / applyTemplate); storage is image_templates
 * (migration 084).
 */

import type { TextBox, TextLine } from "../../modules/arth-text-reader";
import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { bumpDataVersion } from "@/services/settings";
import { generateUUID } from "@/utils/uuid";
import {
  accountFrom,
  money,
  parseDate,
  parseTime,
  pictureRows,
  tidyName,
  VPA,
  type AccountHint,
  type ReceiptGuess,
  type ReceiptKind,
} from "@/services/receipt/read-receipt";

export type TemplateField = "amount" | "party" | "date" | "ref" | "vpa" | "ownVpa" | "account" | "note";

export const TEMPLATE_FIELDS: { field: TemplateField; label: string; creditLabel?: string }[] = [
  { field: "amount", label: "Amount" },
  { field: "party", label: "Paid to", creditLabel: "Received from" },
  { field: "date", label: "Date / time" },
  { field: "account", label: "Paid from account", creditLabel: "Into account" },
  { field: "ownVpa", label: "Your UPI ID" },
  { field: "vpa", label: "Their UPI ID" },
  { field: "ref", label: "Reference / UTR" },
  { field: "note", label: "Note" },
];

export interface FieldRule {
  /** The label before the value on the same piece ("tr. id:"), when there is one. */
  prefix: string | null;
  /** The nearest fixed text above, and how many pieces below it the value sits. */
  anchor: string | null;
  offset: number;
  /** Where the value sat on the picture (fractions, 0..1). */
  x: number;
  y: number;
  /**
   * Only some words of the piece ("Fresh_Mart_RD_12 ₹345": the name is all but the last word, the
   * amount the last). Each end counts from the piece's start or end, whichever it was nearest, so
   * a longer or shorter name next time still splits the same way. Absent: the whole piece.
   */
  words?: { start: WordEnd; stop: WordEnd };
}

/** A word position counted from the start of the piece, or back from its end. */
export interface WordEnd {
  fromEnd: boolean;
  k: number;
}

/** What the user linked to a field: a piece of text, or some of its words (inclusive). */
export interface TextPick {
  i: number;
  from?: number;
  to?: number;
}

export interface ImageTemplate {
  id: string;
  name: string;
  kind: ReceiptKind;
  anchors: string[];
  fields: Partial<Record<TemplateField, FieldRule>>;
  sampleText: string | null;
  /** What it was taught on, for editing (085); null for templates saved before that. */
  sample: TemplateSample | null;
  useCount: number;
  updatedAt: string;
}

/** The sample picture's text pieces (not the picture) and which piece is each field. */
export interface TemplateSample {
  pieces: TextLine[];
  picks: Partial<Record<TemplateField, TextPick>>;
}

/** What a template read off a picture. */
export interface TemplateValues {
  amount?: number;
  party?: string;
  date?: string;
  time?: string | null;
  ref?: string;
  vpa?: string;
  ownVpa?: string;
  account?: AccountHint;
  note?: string;
}

/** The picture's pieces of text in reading order (what the user taps, what templates index). */
export function picturePieces(lines: TextLine[]): TextLine[] {
  return pictureRows(lines).flat();
}

/**
 * A piece's words with their boxes: as the reader gave them, or - when it didn't (iPhone, older
 * samples) - split on spaces with each word's share of the width by its length.
 */
export function wordsOf(piece: TextLine): TextBox[] {
  if (piece.words?.length) return piece.words;
  const parts = piece.text.split(/\s+/).filter(Boolean);
  const total = parts.reduce((n, w) => n + w.length, 0) + Math.max(0, parts.length - 1);
  let at = 0;
  return parts.map((w) => {
    const box = {
      text: w,
      x: piece.x + (piece.width * at) / Math.max(1, total),
      y: piece.y,
      width: (piece.width * w.length) / Math.max(1, total),
      height: piece.height,
    };
    at += w.length + 1;
    return box;
  });
}

/** Old samples stored a piece's index; now a pick. */
export function toPick(v: TextPick | number | undefined | null): TextPick | null {
  if (v == null) return null;
  return typeof v === "number" ? { i: v } : v;
}

/** The text of a pick: the whole piece, or the chosen words. */
export function pickText(pieces: TextLine[], pick: TextPick): string | null {
  const p = pieces[pick.i];
  if (!p) return null;
  if (pick.from == null || pick.to == null) return p.text;
  const words = wordsOf(p);
  const chosen = words.slice(Math.max(0, pick.from), Math.min(words.length, pick.to + 1));
  return chosen.length ? chosen.map((w) => w.text).join(" ") : null;
}

/** The box around a pick (the chosen words, or the whole piece). */
export function pickBox(pieces: TextLine[], pick: TextPick): TextBox | null {
  const p = pieces[pick.i];
  if (!p) return null;
  if (pick.from == null || pick.to == null) return p;
  const chosen = wordsOf(p).slice(pick.from, pick.to + 1);
  if (!chosen.length) return p;
  const x = Math.min(...chosen.map((w) => w.x));
  const y = Math.min(...chosen.map((w) => w.y));
  return {
    text: chosen.map((w) => w.text).join(" "),
    x,
    y,
    width: Math.max(...chosen.map((w) => w.x + w.width)) - x,
    height: Math.max(...chosen.map((w) => w.y + w.height)) - y,
  };
}

/** Words from..to of n, as positions from whichever end each is nearer to. */
function wordRule(from: number, to: number, n: number): FieldRule["words"] {
  if (from <= 0 && to >= n - 1) return undefined;
  const end = (k: number): WordEnd => (k > n - 1 - k ? { fromEnd: true, k: n - 1 - k } : { fromEnd: false, k });
  // Touching an end ties that side to it: "all but the last" stays so for any number of words.
  const start = from === 0 ? { fromEnd: false, k: 0 } : to === n - 1 ? { fromEnd: true, k: n - 1 - from } : end(from);
  const stop = to === n - 1 ? { fromEnd: true, k: 0 } : from === 0 ? { fromEnd: true, k: n - 1 - to } : end(to);
  return { start, stop };
}

/** The words a rule picks from a piece; null when the piece hasn't that many. */
function applyWordRule(piece: TextLine, rule: FieldRule["words"]): string | null {
  if (!rule) return piece.text;
  const words = wordsOf(piece);
  const n = words.length;
  const at = (e: WordEnd) => (e.fromEnd ? n - 1 - e.k : e.k);
  const from = at(rule.start);
  const to = at(rule.stop);
  if (from < 0 || to >= n || from > to) return null;
  return words.slice(from, to + 1).map((w) => w.text).join(" ");
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[\s.!:,;-]+$/, "")
    .trim();

/** Fixed text: has letters, no digits, isn't a UPI ID, not too short or long. */
const isFixed = (t: string) => /[a-z]{2}/i.test(t) && !/\d/.test(t) && !VPA.test(t) && t.trim().length >= 3 && t.length <= 60;

const PARTY_PREFIX = /^(?:paid\s+to|sent\s+to|payment\s+to|transferred\s+to|received\s+from|money\s+received\s+from|to|from|payee|merchant|sender)\b\s*:?\s*/i;

/** The value of a field in a piece of text, and where in the text it starts. Null when it has none. */
export function extractField(field: TemplateField, text: string): { value: string | number | AccountHint; start: number; time?: string | null } | null {
  const t = text.replace(/\s+/g, " ").trim();
  switch (field) {
    case "amount": {
      const re = /(?:₹|rs\.?|inr|[%zZfF*])?\s*(\d[\d,]*(?:\.\d{1,2})?)/gi;
      let best: { value: number; start: number } | null = null;
      for (let m = re.exec(t); m; m = re.exec(t)) {
        const v = money(m[1]);
        // A symbol or separators make it an amount; a bare long digit run is an id.
        if (v && (m[0].trim() !== m[1] || /[,.]/.test(m[1]) || m[1].length <= 6)) {
          best = { value: v, start: m.index };
          break;
        }
      }
      return best;
    }
    case "date": {
      const d = parseDate(t);
      if (!d) return null;
      const start = t.search(/\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|today|yesterday/i);
      return { value: d, start: Math.max(0, start), time: parseTime(t) };
    }
    case "ref": {
      const ids = [...t.matchAll(/[A-Za-z0-9-]{6,}/g)].filter((m) => /\d/.test(m[0]));
      if (!ids.length) return null;
      const m = ids.sort((a, b) => b[0].length - a[0].length)[0];
      return { value: m[0], start: m.index ?? 0 };
    }
    case "vpa":
    case "ownVpa": {
      const m = t.match(VPA);
      return m ? { value: m[1].toLowerCase(), start: m.index ?? 0 } : null;
    }
    case "account": {
      const a = accountFrom(t);
      return { value: a ?? { label: t.slice(0, 40), last4: t.match(/(\d{3,4})\D*$/)?.[1] ?? null, wallet: false }, start: 0 };
    }
    case "party": {
      const p = t.match(PARTY_PREFIX);
      const v = t.slice(p ? p[0].length : 0).trim();
      return /[a-z]/i.test(v) ? { value: tidyName(v).slice(0, 60), start: p ? p[0].length : 0 } : null;
    }
    case "note":
      return t ? { value: t.slice(0, 80), start: 0 } : null;
  }
}

/** Learn a layout from what the user linked: field -> a piece of picturePieces(), or its words. */
export function buildTemplate(
  pieces: TextLine[],
  rawPicks: Partial<Record<TemplateField, TextPick | number>>,
): { anchors: string[]; fields: Partial<Record<TemplateField, FieldRule>> } {
  const picks = Object.entries(rawPicks)
    .map(([f, v]) => [f, toPick(v)] as const)
    .filter((e): e is readonly [string, TextPick] => !!e[1]) as [TemplateField, TextPick][];
  const picked = new Set(picks.map(([, pk]) => pk.i));
  const fixedAt = pieces.map((p, i) => !picked.has(i) && isFixed(p.text));
  const anchors = [...new Set(pieces.filter((_, i) => fixedAt[i]).map((p) => norm(p.text)))].slice(0, 20);
  const fields: Partial<Record<TemplateField, FieldRule>> = {};
  for (const [field, pick] of picks) {
    const i = pick.i;
    const p = pieces[i];
    if (!p) continue;
    const n = wordsOf(p).length;
    const words = pick.from != null && pick.to != null ? wordRule(pick.from, pick.to, n) : undefined;
    // The label before the value: before the chosen words, or before the value in the whole piece.
    let before = "";
    if (words && pick.from != null) {
      before = norm(wordsOf(p).slice(0, pick.from).map((w) => w.text).join(" "));
    } else {
      const found = extractField(field, p.text);
      before = found ? norm(p.text.slice(0, found.start)) : "";
    }
    let anchorAt = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (fixedAt[j]) {
        anchorAt = j;
        break;
      }
    }
    fields[field] = {
      prefix: before && isFixed(before) ? before : null,
      anchor: anchorAt >= 0 ? norm(pieces[anchorAt].text) : null,
      offset: anchorAt >= 0 ? i - anchorAt : 0,
      x: p.x,
      y: p.y,
      ...(words ? { words } : {}),
    };
  }
  return { anchors, fields };
}

/** How well a picture fits a template: the share of its fixed text present (0..1). */
export function templateScore(pieces: TextLine[], anchors: string[]): number {
  if (anchors.length === 0) return 0;
  const have = new Set(pieces.map((p) => norm(p.text)));
  return anchors.filter((a) => have.has(a)).length / anchors.length;
}

/** The template this picture fits best, if any fits well enough. */
export function matchTemplate<T extends Pick<ImageTemplate, "anchors">>(pieces: TextLine[], templates: T[]): T | null {
  let best: { t: T; score: number } | null = null;
  for (const t of templates) {
    const score = templateScore(pieces, t.anchors);
    const enough = t.anchors.length >= 3 ? score >= 0.6 : score === 1;
    if (enough && (!best || score > best.score)) best = { t, score };
  }
  return best?.t ?? null;
}

/** Read a picture with a template. */
export function applyTemplate(pieces: TextLine[], fields: Partial<Record<TemplateField, FieldRule>>): TemplateValues {
  const out: TemplateValues = {};
  const norms = pieces.map((p) => norm(p.text));
  for (const [field, rule] of Object.entries(fields) as [TemplateField, FieldRule][]) {
    const tryAt = (i: number) => {
      if (i < 0 || i >= pieces.length) return null;
      const text = applyWordRule(pieces[i], rule.words);
      return text ? extractField(field, text) : null;
    };
    let hit: ReturnType<typeof extractField> = null;
    // 1. Its label on the same piece (nearest to where it was, if the label repeats).
    if (rule.prefix) {
      const at = norms
        .map((n, i) => (n.startsWith(rule.prefix!) ? i : -1))
        .filter((i) => i >= 0)
        .sort((a, b) => Math.abs(pieces[a].y - rule.y) - Math.abs(pieces[b].y - rule.y));
      for (const i of at) {
        hit = tryAt(i);
        if (hit) break;
      }
    }
    // 2. Below its anchor.
    if (!hit && rule.anchor) {
      const a = norms.indexOf(rule.anchor);
      if (a >= 0) hit = tryAt(a + rule.offset);
    }
    // 3. Where it sat.
    if (!hit) {
      const near = pieces
        .map((p, i) => ({ i, d: Math.abs(p.y - rule.y) + Math.abs(p.x - rule.x) * 0.25 }))
        .filter((c) => Math.abs(pieces[c.i].y - rule.y) < 0.03)
        .sort((a, b) => a.d - b.d);
      for (const c of near) {
        hit = tryAt(c.i);
        if (hit) break;
      }
    }
    if (!hit) continue;
    if (field === "amount") out.amount = hit.value as number;
    else if (field === "date") {
      out.date = hit.value as string;
      out.time = hit.time ?? null;
    } else if (field === "account") out.account = hit.value as AccountHint;
    else out[field] = hit.value as string;
  }
  return out;
}

/** The values of what the user linked (field -> a piece, or some of its words). */
export function valuesFromPicks(pieces: TextLine[], picks: Partial<Record<TemplateField, TextPick | number>>): TemplateValues {
  const out: TemplateValues = {};
  for (const [field, raw] of Object.entries(picks) as [TemplateField, TextPick | number][]) {
    const pick = toPick(raw);
    const text = pick ? pickText(pieces, pick) : null;
    const hit = text ? extractField(field, text) : null;
    if (!hit) continue;
    if (field === "amount") out.amount = hit.value as number;
    else if (field === "date") {
      out.date = hit.value as string;
      out.time = hit.time ?? null;
    } else if (field === "account") out.account = hit.value as AccountHint;
    else out[field] = hit.value as string;
  }
  return out;
}

/** The general reader's guess with the template's values on top. */
export function withTemplate(guess: ReceiptGuess, kind: ReceiptKind, v: TemplateValues): ReceiptGuess {
  return {
    ...guess,
    kind,
    amount: v.amount ?? guess.amount,
    party: v.party ?? guess.party,
    date: v.date ?? guess.date,
    time: v.date ? (v.time ?? guess.time) : guess.time,
    ref: v.ref ?? guess.ref,
    vpa: v.vpa ?? guess.vpa,
    ownVpa: v.ownVpa ?? guess.ownVpa,
    account: v.account ?? guess.account,
    note: v.note ?? guess.note,
  };
}

// ─── Storage ───

interface Row {
  id: string;
  name: string;
  kind: string;
  anchors: string;
  fields: string;
  sample_text: string | null;
  sample_lines: string | null;
  use_count: number;
  updated_at: string;
}

function parseSample(raw: string | null): TemplateSample | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v?.pieces) || typeof v?.picks !== "object" || !v.picks) return null;
    const pieces = v.pieces.filter(
      (p: unknown): p is TextLine =>
        !!p && typeof (p as TextLine).text === "string" && ["x", "y", "width", "height"].every((k) => typeof (p as Record<string, unknown>)[k] === "number"),
    );
    if (pieces.length !== v.pieces.length) return null;
    const picks: Partial<Record<TemplateField, TextPick>> = {};
    for (const [f, raw] of Object.entries(v.picks)) {
      const pk = toPick(raw as TextPick | number);
      if (pk && typeof pk.i === "number") picks[f as TemplateField] = pk;
    }
    return { pieces, picks };
  } catch {
    return null;
  }
}

const round = (n: number) => Math.round(n * 10000) / 10000;
const sampleJson = (s: TemplateSample) =>
  JSON.stringify({
    pieces: s.pieces.map((p) => ({
      text: p.text.slice(0, 120),
      x: round(p.x),
      y: round(p.y),
      width: round(p.width),
      height: round(p.height),
      ...(p.words?.length
        ? { words: p.words.map((w) => ({ text: w.text.slice(0, 60), x: round(w.x), y: round(w.y), width: round(w.width), height: round(w.height) })) }
        : {}),
    })),
    picks: s.picks,
  });

const KINDS: ReceiptKind[] = ["expense", "credit", "transfer", "committed"];

function fromRow(r: Row): ImageTemplate | null {
  try {
    const anchors = JSON.parse(r.anchors);
    const fields = JSON.parse(r.fields);
    if (!Array.isArray(anchors) || typeof fields !== "object" || !fields) return null;
    return {
      id: r.id,
      name: r.name,
      kind: KINDS.includes(r.kind as ReceiptKind) ? (r.kind as ReceiptKind) : "expense",
      anchors: anchors.filter((a: unknown) => typeof a === "string"),
      fields,
      sampleText: r.sample_text,
      sample: parseSample(r.sample_lines),
      useCount: r.use_count,
      updatedAt: r.updated_at,
    };
  } catch {
    return null;
  }
}

export async function listImageTemplates(userId: string = DEFAULT_USER_ID): Promise<ImageTemplate[]> {
  const rows = await getDatabase().getAllAsync<Row>(
    `SELECT id, name, kind, anchors, fields, sample_text, sample_lines, use_count, updated_at FROM image_templates
      WHERE user_id = ? ORDER BY updated_at DESC;`,
    userId,
  );
  return rows.map(fromRow).filter((t): t is ImageTemplate => !!t);
}

export async function getImageTemplate(id: string): Promise<ImageTemplate | null> {
  const row = await getDatabase().getFirstAsync<Row>(
    `SELECT id, name, kind, anchors, fields, sample_text, sample_lines, use_count, updated_at FROM image_templates WHERE id = ?;`,
    id,
  );
  return row ? fromRow(row) : null;
}

/** Save a new template, or replace the one given (re-teaching the same layout). */
export async function saveImageTemplate(
  t: {
    id?: string;
    name: string;
    kind: ReceiptKind;
    anchors: string[];
    fields: Partial<Record<TemplateField, FieldRule>>;
    sampleText: string;
    sample?: TemplateSample | null;
  },
  userId: string = DEFAULT_USER_ID,
): Promise<string> {
  const id = t.id ?? generateUUID();
  await getDatabase().runAsync(
    `INSERT INTO image_templates (id, user_id, name, kind, anchors, fields, sample_text, sample_lines, use_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, anchors = excluded.anchors,
       fields = excluded.fields, sample_text = excluded.sample_text, sample_lines = excluded.sample_lines,
       updated_at = datetime('now');`,
    id,
    userId,
    t.name.trim().slice(0, 60) || "Picture template",
    t.kind,
    JSON.stringify(t.anchors),
    JSON.stringify(t.fields),
    t.sampleText.slice(0, 2000),
    t.sample ? sampleJson(t.sample) : null,
  );
  await bumpDataVersion();
  return id;
}

/**
 * Edit a saved template: its name and kind, and - when it kept its sample - which piece of the
 * sample is each field (re-learned from the sample). Without a sample, a field can only be removed.
 */
export async function updateImageTemplate(
  t: ImageTemplate,
  change: { name?: string; kind?: ReceiptKind; picks?: Partial<Record<TemplateField, TextPick>>; removeField?: TemplateField },
): Promise<void> {
  let anchors = t.anchors;
  let fields = { ...t.fields };
  let sample = t.sample;
  if (change.picks && sample) {
    const learned = buildTemplate(sample.pieces, change.picks);
    anchors = learned.anchors;
    fields = learned.fields;
    sample = { pieces: sample.pieces, picks: change.picks };
  } else if (change.removeField) {
    delete fields[change.removeField];
    if (sample) {
      const picks = { ...sample.picks };
      delete picks[change.removeField];
      sample = { pieces: sample.pieces, picks };
    }
  }
  await getDatabase().runAsync(
    `UPDATE image_templates SET name = ?, kind = ?, anchors = ?, fields = ?, sample_lines = ?, updated_at = datetime('now') WHERE id = ?;`,
    (change.name ?? t.name).trim().slice(0, 60) || t.name,
    change.kind ?? t.kind,
    JSON.stringify(anchors),
    JSON.stringify(fields),
    sample ? sampleJson(sample) : null,
    t.id,
  );
  await bumpDataVersion();
}

export async function markImageTemplateUsed(id: string): Promise<void> {
  await getDatabase().runAsync(`UPDATE image_templates SET use_count = use_count + 1 WHERE id = ?;`, id);
}

export async function deleteImageTemplate(id: string): Promise<void> {
  await getDatabase().runAsync(`DELETE FROM image_templates WHERE id = ?;`, id);
  await bumpDataVersion();
}
