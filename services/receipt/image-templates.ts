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

import type { TextLine } from "../../modules/arth-text-reader";
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
}

export interface ImageTemplate {
  id: string;
  name: string;
  kind: ReceiptKind;
  anchors: string[];
  fields: Partial<Record<TemplateField, FieldRule>>;
  sampleText: string | null;
  useCount: number;
  updatedAt: string;
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

/** Learn a layout from the pieces the user tapped: field -> index into picturePieces(). */
export function buildTemplate(
  pieces: TextLine[],
  picks: Partial<Record<TemplateField, number>>,
): { anchors: string[]; fields: Partial<Record<TemplateField, FieldRule>> } {
  const picked = new Set(Object.values(picks));
  const fixedAt = pieces.map((p, i) => !picked.has(i) && isFixed(p.text));
  const anchors = [...new Set(pieces.filter((_, i) => fixedAt[i]).map((p) => norm(p.text)))].slice(0, 20);
  const fields: Partial<Record<TemplateField, FieldRule>> = {};
  for (const [field, i] of Object.entries(picks) as [TemplateField, number][]) {
    const p = pieces[i];
    if (!p) continue;
    const found = extractField(field, p.text);
    const before = found ? norm(p.text.slice(0, found.start)) : "";
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
    const tryAt = (i: number) => (i >= 0 && i < pieces.length ? extractField(field, pieces[i].text) : null);
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
  use_count: number;
  updated_at: string;
}

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
      useCount: r.use_count,
      updatedAt: r.updated_at,
    };
  } catch {
    return null;
  }
}

export async function listImageTemplates(userId: string = DEFAULT_USER_ID): Promise<ImageTemplate[]> {
  const rows = await getDatabase().getAllAsync<Row>(
    `SELECT id, name, kind, anchors, fields, sample_text, use_count, updated_at FROM image_templates
      WHERE user_id = ? ORDER BY updated_at DESC;`,
    userId,
  );
  return rows.map(fromRow).filter((t): t is ImageTemplate => !!t);
}

/** Save a new template, or replace the one given (re-teaching the same layout). */
export async function saveImageTemplate(
  t: { id?: string; name: string; kind: ReceiptKind; anchors: string[]; fields: Partial<Record<TemplateField, FieldRule>>; sampleText: string },
  userId: string = DEFAULT_USER_ID,
): Promise<string> {
  const id = t.id ?? generateUUID();
  await getDatabase().runAsync(
    `INSERT INTO image_templates (id, user_id, name, kind, anchors, fields, sample_text, use_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, anchors = excluded.anchors,
       fields = excluded.fields, sample_text = excluded.sample_text, updated_at = datetime('now');`,
    id,
    userId,
    t.name.trim().slice(0, 60) || "Picture template",
    t.kind,
    JSON.stringify(t.anchors),
    JSON.stringify(t.fields),
    t.sampleText.slice(0, 2000),
  );
  await bumpDataVersion();
  return id;
}

export async function markImageTemplateUsed(id: string): Promise<void> {
  await getDatabase().runAsync(`UPDATE image_templates SET use_count = use_count + 1 WHERE id = ?;`, id);
}

export async function deleteImageTemplate(id: string): Promise<void> {
  await getDatabase().runAsync(`DELETE FROM image_templates WHERE id = ?;`, id);
  await bumpDataVersion();
}
