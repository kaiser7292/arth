/**
 * Reads an AI assistant's reply to an Export for AI Insights file and applies what the user ticks.
 *
 * The reply is untrusted text pasted from a chat app. Three things follow from that:
 *
 *  1. READING IS FORGIVING. The JSON is dug out of whatever surrounds it (prose, code fences,
 *     curly quotes, a trailing comma, a reply cut off half way). Each suggestion is read on its
 *     own, so one bad line never loses the rest.
 *  2. ACCEPTING IS STRICT. Only the suggestion types in services/ai-reply-format.ts exist. Every
 *     reference must point at a real row and repeat its date and amount, every category must
 *     exist or be added in the same reply, and rules cannot carry regular expressions. There is
 *     no type that deletes anything or edits an amount or date.
 *  3. NOTHING HAPPENS ON READ. `readAiReply` only looks things up. Changes are made by
 *     `applySuggestions`, on the items the user left ticked.
 */

import { getDatabase } from "@/database";
import {
  MAX_SUGGESTIONS,
  RULE_FIELDS,
  RULE_OPERATORS,
  shortRef,
  SMS_TEMPLATE_FIELDS,
} from "@/services/ai-reply-format";
import { getBudget, upsertBudget } from "@/services/budget";
import { createCategory } from "@/services/category";
import { createExpense, updateExpense } from "@/services/expense-crud";
import { learnMerchantAlias, propagateMerchantRename } from "@/services/merchant-alias";
import {
  applyRuleToPastTransactions,
  listMerchantRules,
  normalizeKeyword,
  pickRule,
  setMerchantRule,
  type MerchantRule,
} from "@/services/merchant-categories";
import { getFYStartMonth } from "@/services/settings";
import { createRule, listRules, type ConditionOperator, type RuleCondition } from "@/services/smart-rules";
import { applyTemplateToBacklog, findBacklogMatches } from "@/services/sms/template-backlog";
import {
  compileTemplate,
  type TaggedField,
  type TaggedSpan,
} from "@/services/sms/template-compiler";
import { createUserTemplate, listUnrecognisedSms, type UserTxType } from "@/services/sms/user-sms-templates";
import { toIsoDate } from "@/utils/date";
import { monthsToFYEnd } from "@/utils/fiscal-year";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SuggestionType =
  | "add_category"
  | "fix_merchant"
  | "merchant_category"
  | "recategorise"
  | "add_rule"
  | "set_budget"
  | "sms_template"
  | "add_transaction";

interface Base {
  /** Position in the accepted list; stable for the life of the review screen. */
  key: number;
  /** What will change, in plain words. */
  title: string;
  /** A second line: the detail of the change. */
  detail: string | null;
  /** The assistant's reason, shown to the user. */
  why: string | null;
}

export type Suggestion = Base &
  (
    | { type: "add_category"; name: string }
    | { type: "fix_merchant"; from: string; to: string }
    | { type: "merchant_category"; keyword: string; category: string }
    | { type: "recategorise"; expenseId: string; category: string }
    | { type: "add_rule"; name: string; conditions: RuleCondition[]; category: string }
    | { type: "set_budget"; category: string; amount: number }
    | {
        type: "sms_template";
        smsId: string;
        body: string;
        bank: string;
        kind: UserTxType;
        spans: TaggedSpan[];
        senderPattern: string;
        /** The compiled pattern - what makes two template suggestions the same one. */
        pattern: string;
        reads: number;
      }
    | {
        type: "add_transaction";
        date: string;
        amount: number;
        kind: "spend" | "income";
        category: string | null;
        merchant: string | null;
        accountId: string | null;
      }
  );

export interface RejectedSuggestion {
  /** Why Arth can't use it, in plain words. */
  reason: string;
  /** The start of the item, so the user can tell which one. */
  text: string;
}

export interface AiReply {
  /** False when the text holds nothing that looks like an Arth suggestions reply. */
  recognised: boolean;
  /** The reply stopped in the middle of an item (the assistant ran out of room). */
  cutOff: boolean;
  accepted: Suggestion[];
  /** Left out because they are wrong. */
  rejected: RejectedSuggestion[];
  /** Left out because they are already true (a category that exists, a budget already set). */
  alreadySet: number;
}

/** Display order: the order things are set up in, and the order they are applied in. */
export const SUGGESTION_GROUPS: { type: SuggestionType; label: string }[] = [
  { type: "add_category", label: "New categories" },
  { type: "fix_merchant", label: "Merchant names" },
  { type: "merchant_category", label: "Merchant categories" },
  { type: "recategorise", label: "Single entries" },
  { type: "add_rule", label: "Rules for exceptions" },
  { type: "set_budget", label: "Budgets" },
  { type: "sms_template", label: "SMS templates" },
  { type: "add_transaction", label: "Missing transactions" },
];

const MAX_REPLY_CHARS = 1024 * 1024;
const MAX_LEN = { name: 50, merchant: 100, why: 160, ruleName: 60 } as const;

// ─── Reading: find the suggestion objects in whatever was pasted ──────────────

/** Things chat apps and keyboards do to text that break JSON. */
function cleanPastedText(text: string): string {
  return text
    .slice(0, MAX_REPLY_CHARS)
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[   ]/g, " ")
    .replace(/[​-‍﻿]/g, "");
}

function parseLoose(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    // The one repair worth making: a comma before a closing bracket.
    return JSON.parse(json.replace(/,\s*([}\]])/g, "$1"));
  }
}

/**
 * Every complete `{...}` object in the suggestions list, as text. Walks the characters itself
 * (minding strings and escapes) instead of parsing the whole reply, so prose around the JSON,
 * a missing closing bracket or a reply cut off mid-item all still yield the items that are whole.
 */
export function findSuggestionObjects(pasted: string): { objects: string[]; recognised: boolean; cutOff: boolean } {
  const text = cleanPastedText(pasted);
  const marker = /"suggestions"\s*:\s*\[/.exec(text);
  // No "suggestions" key: accept a bare list of objects, as long as they look like ours.
  const start = marker ? marker.index + marker[0].length : 0;
  const objects: string[] = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let cutOff = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) objectStart = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0 && --depth === 0 && objectStart >= 0) {
        objects.push(text.slice(objectStart, i + 1));
        objectStart = -1;
      }
    } else if (ch === "]" && depth === 0 && marker) {
      break; // end of the suggestions list
    }
  }
  if (depth > 0 || inString) cutOff = true;

  const ours = marker ? objects : objects.filter((o) => /"type"\s*:/.test(o));
  return { objects: ours, recognised: Boolean(marker) || ours.length > 0, cutOff };
}

// ─── Reading: field helpers ───────────────────────────────────────────────────

type Raw = Record<string, unknown>;

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const s = String(value).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

/** Numbers, including the ones assistants write as "12,000" or "₹12000". */
function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[,\s₹]|rs\.?|inr/gi, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00`);
  return !Number.isNaN(d.getTime()) && toIsoDate(d) === value;
}

/** Spellings assistants reach for. Anything else is not a suggestion type. */
const TYPE_ALIASES: Record<string, SuggestionType> = {
  add_category: "add_category",
  new_category: "add_category",
  fix_merchant: "fix_merchant",
  rename_merchant: "fix_merchant",
  merchant_category: "merchant_category",
  set_merchant_category: "merchant_category",
  recategorise: "recategorise",
  recategorize: "recategorise",
  add_rule: "add_rule",
  set_budget: "set_budget",
  sms_template: "sms_template",
  add_transaction: "add_transaction",
};

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

class Reject extends Error {}
/** Thrown for a suggestion that is correct but changes nothing. */
class AlreadySet extends Error {}

// ─── Reading: what the reply is checked against ───────────────────────────────

interface Context {
  userId: string;
  /** lowercase name -> the category's real name. Includes categories this reply adds. */
  categories: Map<string, string>;
  /** Names of categories that exist now (not the ones being added). */
  existingCategories: Map<string, string>;
  categoryIds: Map<string, string>;
  /** lowercase merchant name -> { name as stored, number of entries }. */
  merchants: Map<string, { name: string; count: number }>;
  merchantKeywords: string[];
  merchantRules: MerchantRule[];
  /** Merchant categories this reply sets (keyword -> category), so each one's reach allows for the others. */
  replyMerchantCategories: Map<string, string>;
  /** Entries a merchant category could move: spends with a merchant that no Smart Rule filed. */
  movable: { merchant_name: string; category_id: string | null }[];
  ruleNames: Set<string>;
  accounts: { id: string; name: string }[];
  unreadMessages: Map<string, { id: string; address: string; body: string }>;
  today: string;
  month: string;
}

async function loadContext(userId: string, today: Date): Promise<Context> {
  const db = getDatabase();
  const [categories, merchants, rules, smartRules, accounts, unread, movable] = await Promise.all([
    db.getAllAsync<{ id: string; name: string }>(
      "SELECT id, name FROM categories WHERE user_id = ? AND is_active = 1;",
      userId,
    ),
    db.getAllAsync<{ name: string; count: number }>(
      `SELECT merchant_name as name, COUNT(*) as count FROM expenses
       WHERE user_id = ? AND deleted_at IS NULL AND merchant_name IS NOT NULL AND merchant_name != ''
       GROUP BY LOWER(merchant_name);`,
      userId,
    ),
    listMerchantRules(userId),
    listRules(),
    db.getAllAsync<{ id: string; account_label: string | null; bank_name: string }>(
      "SELECT id, account_label, bank_name FROM financial_accounts WHERE user_id = ? AND is_active = 1;",
      userId,
    ),
    listUnrecognisedSms(2000),
    db.getAllAsync<{ merchant_name: string; category_id: string | null }>(
      `SELECT merchant_name, category_id FROM expenses
       WHERE user_id = ? AND deleted_at IS NULL AND nature = 'realized' AND merchant_name IS NOT NULL
         AND applied_rule_id IS NULL;`,
      userId,
    ),
  ]);
  const existing = new Map(categories.map((c) => [c.name.toLowerCase(), c.name]));
  const todayIso = toIsoDate(today);
  return {
    userId,
    categories: new Map(existing),
    existingCategories: existing,
    categoryIds: new Map(categories.map((c) => [c.name, c.id])),
    merchants: new Map(merchants.map((m) => [m.name.toLowerCase(), m])),
    merchantKeywords: merchants.map((m) => normalizeKeyword(m.name)),
    merchantRules: rules,
    replyMerchantCategories: new Map(),
    movable,
    ruleNames: new Set(smartRules.map((r) => r.name.toLowerCase())),
    accounts: accounts.map((a) => ({ id: a.id, name: a.account_label || a.bank_name })),
    unreadMessages: new Map(unread.map((m) => [shortRef("s", m.id), m])),
    today: todayIso,
    month: todayIso.substring(0, 7),
  };
}

/**
 * How many entries this merchant category would move if it were set. Same test the app applies
 * afterwards (applyRuleToPastTransactions): the longest matching keyword wins, so "swiggy" never
 * drags Swiggy Instamart along when that has its own rule.
 */
function entriesItWouldMove(ctx: Context, keyword: string, categoryName: string): number {
  // The rules as they will stand once this whole reply is applied.
  const fromReply = new Map(ctx.replyMerchantCategories).set(keyword, categoryName);
  const rules: MerchantRule[] = [
    ...ctx.merchantRules.filter((r) => r.isActive && !fromReply.has(r.keyword)),
    ...[...fromReply].map(([k, c]) => ({
      keyword: k,
      matchMode: ctx.merchantRules.find((r) => r.keyword === k)?.matchMode ?? ("contains" as const),
      categoryName: c,
      isActive: true,
      source: "custom" as const,
      builtInCategory: null,
      categoryMissing: false,
    })),
  ];
  // A category this reply adds has no id yet, and nothing can be in it already.
  const targetId = ctx.categoryIds.get(categoryName);
  return ctx.movable.filter(
    (row) =>
      (targetId === undefined || row.category_id !== targetId) &&
      pickRule(rules, row.merchant_name)?.keyword === keyword,
  ).length;
}

function category(ctx: Context, value: unknown): string {
  const name = str(value, MAX_LEN.name);
  if (!name) throw new Reject("No category given");
  const real = ctx.categories.get(name.toLowerCase());
  if (!real) throw new Reject(`"${name}" is not one of your categories`);
  return real;
}

// ─── Reading: one checker per suggestion type ─────────────────────────────────

type Draft = Suggestion extends infer S ? (S extends Suggestion ? Omit<S, "key" | "why"> : never) : never;

function readAddCategory(ctx: Context, raw: Raw): Draft {
  const name = str(raw.name, MAX_LEN.name);
  if (!name) throw new Reject("No category name given");
  if (ctx.existingCategories.has(name.toLowerCase())) throw new AlreadySet();
  return { type: "add_category", name, title: name, detail: null };
}

function readFixMerchant(ctx: Context, raw: Raw): Draft {
  const from = str(raw.from, MAX_LEN.merchant);
  const to = str(raw.to, MAX_LEN.merchant);
  if (!from || !to) throw new Reject("Needs both the old and the new merchant name");
  const known = ctx.merchants.get(from.toLowerCase());
  if (!known) throw new Reject(`No transaction has the merchant "${from}"`);
  if (known.name === to) throw new AlreadySet();
  return {
    type: "fix_merchant",
    from: known.name,
    to,
    title: `${known.name} → ${to}`,
    detail: `${known.count} ${known.count === 1 ? "entry" : "entries"}`,
  };
}

function readMerchantCategory(ctx: Context, raw: Raw, renamedTo: string[]): Draft {
  const keyword = normalizeKeyword(str(raw.merchant, MAX_LEN.merchant) ?? "");
  if (keyword.length < 2) throw new Reject("No merchant given");
  const categoryName = category(ctx, raw.category);
  // The keyword must be part of a merchant the user really has (or is renaming to in this reply).
  const real = [...ctx.merchantKeywords, ...renamedTo].some((m) => m.includes(keyword));
  if (!real) throw new Reject(`None of your merchants contain "${keyword}"`);
  const past = entriesItWouldMove(ctx, keyword, categoryName);
  const set = ctx.merchantRules.some((r) => r.isActive && r.keyword === keyword && r.categoryName === categoryName);
  if (set && past === 0) throw new AlreadySet();
  return {
    type: "merchant_category",
    keyword,
    category: categoryName,
    title: `${keyword} → ${categoryName}`,
    detail:
      past === 0
        ? "Files future entries (past ones are already there)"
        : `Moves ${past} past ${past === 1 ? "entry" : "entries"}, and files future ones`,
  };
}

async function readRecategorise(ctx: Context, raw: Raw): Promise<Draft> {
  const ref = str(raw.ref, 12)?.toLowerCase() ?? "";
  if (!/^t[0-9a-z]{8}$/.test(ref)) throw new Reject("Has no valid transaction reference");
  const categoryName = category(ctx, raw.category);
  const amount = num(raw.amount);
  const rows = await getDatabase().getAllAsync<{
    id: string;
    date: string;
    amount: number;
    merchant_name: string | null;
    category_id: string | null;
  }>(
    `SELECT id, date, amount, merchant_name, category_id FROM expenses
     WHERE user_id = ? AND deleted_at IS NULL AND LOWER(REPLACE(id, '-', '')) LIKE ?;`,
    ctx.userId,
    `${ref.slice(1)}%`,
  );
  // The reference alone is not enough: the reply must also repeat the row's date and amount.
  const row = rows.find((r) => r.date === raw.date && amount !== null && Math.abs(r.amount - amount) < 0.01);
  if (!row) throw new Reject("Names a transaction that doesn't match any of yours");
  const current = [...ctx.categoryIds.entries()].find(([, id]) => id === row.category_id)?.[0] ?? null;
  if (current === categoryName) throw new AlreadySet();
  return {
    type: "recategorise",
    expenseId: row.id,
    category: categoryName,
    title: `${row.merchant_name || "Entry"} · ${money(row.amount)} · ${row.date}`,
    detail: `${current ?? "No category"} → ${categoryName}`,
  };
}

const TEXT_TESTS = new Set(["contains", "equals", "starts_with", "ends_with"]);
const TEST_WORDS: Record<string, string> = {
  contains: "contains",
  equals: "is",
  starts_with: "starts with",
  ends_with: "ends with",
  greater_than: "over",
  less_than: "under",
};

function readAddRule(ctx: Context, raw: Raw): Draft {
  const name = str(raw.name, MAX_LEN.ruleName);
  if (!name) throw new Reject("The rule has no name");
  if (ctx.ruleNames.has(name.toLowerCase())) throw new AlreadySet();
  const categoryName = category(ctx, raw.category ?? (raw.then as Raw | undefined)?.category);
  const when = Array.isArray(raw.when) ? (raw.when as Raw[]) : [];
  if (when.length === 0 || when.length > 4) throw new Reject("A rule needs between 1 and 4 conditions");

  const conditions: RuleCondition[] = when.map((c) => {
    const field = str(c?.field, 20) ?? "";
    const test = str(c?.is ?? c?.operator, 20) ?? "";
    if (!(RULE_FIELDS as readonly string[]).includes(field)) throw new Reject(`Rules can't test "${field}"`);
    if (!(RULE_OPERATORS as readonly string[]).includes(test)) {
      throw new Reject(test === "regex" ? "Rules from an assistant can't use patterns" : `Rules can't use "${test}"`);
    }
    if (field === "amount") {
      const value = num(c.value);
      if (TEXT_TESTS.has(test) && test !== "equals") throw new Reject("An amount can only be equal, over or under");
      if (value === null || value < 0) throw new Reject("The rule's amount is not a number");
      return { field: "amount", operator: test as ConditionOperator, value };
    }
    const value = str(c.value, MAX_LEN.merchant);
    if (!TEXT_TESTS.has(test)) throw new Reject("Text can't be over or under a value");
    if (!value || value.length < 2) throw new Reject("The rule's text is too short");
    return { field: field as RuleCondition["field"], operator: test as ConditionOperator, value };
  });

  const words = conditions.map((c) =>
    c.field === "amount"
      ? `amount ${TEST_WORDS[c.operator]} ${money(c.value as number)}`
      : `${c.field} ${TEST_WORDS[c.operator]} "${c.value}"`,
  );
  return {
    type: "add_rule",
    name,
    conditions,
    category: categoryName,
    title: name,
    detail: `When ${words.join(" and ")} → ${categoryName}. New entries only.`,
  };
}

async function readSetBudget(ctx: Context, raw: Raw): Promise<Draft> {
  const categoryName = category(ctx, raw.category);
  const amount = num(raw.amount);
  if (amount === null || amount <= 0 || amount > 1e9) throw new Reject("The budget amount is not a sensible number");
  const id = ctx.categoryIds.get(categoryName);
  if (id && (await getBudget(ctx.userId, id, ctx.month))?.amount === amount) throw new AlreadySet();
  return {
    type: "set_budget",
    category: categoryName,
    amount: Math.round(amount),
    title: `${categoryName} · ${money(amount)} a month`,
    detail: "From this month to the end of the financial year",
  };
}

function readAddTransaction(ctx: Context, raw: Raw): Draft {
  if (!isIsoDate(raw.date) || raw.date > ctx.today) throw new Reject("The date is missing, wrong or in the future");
  const amount = num(raw.amount);
  if (amount === null || amount <= 0 || amount > 1e9) throw new Reject("The amount is not a sensible number");
  const kind = raw.kind === "income" ? "income" : "spend";
  const merchant = str(raw.merchant, MAX_LEN.merchant);
  const categoryName = ctx.categories.get((str(raw.category, MAX_LEN.name) ?? "").toLowerCase()) ?? null;
  const accountName = (str(raw.account, MAX_LEN.merchant) ?? "").toLowerCase();
  const matches = accountName ? ctx.accounts.filter((a) => a.name.toLowerCase() === accountName) : [];
  return {
    type: "add_transaction",
    date: raw.date,
    amount,
    kind,
    category: categoryName,
    merchant,
    accountId: matches.length === 1 ? matches[0].id : null,
    title: `${merchant || (kind === "income" ? "Income" : "Spend")} · ${money(amount)} · ${raw.date}`,
    detail: `Goes to your review queue${categoryName ? ` under ${categoryName}` : ""}`,
  };
}

/**
 * Assistants often quote a little too much: "Rs.482.00" for the amount, "X4521" for the account.
 * Keep only the value itself, which is what a template field has to cover.
 */
function justTheValue(field: string, quoted: string | null): string | null {
  if (!quoted) return null;
  if (field === "amount" || field === "balance") return /\d[\d,]*(\.\d+)?/.exec(quoted)?.[0] ?? null;
  if (field === "account" || field === "other_account") return /\d+$/.exec(quoted)?.[0] ?? quoted;
  return quoted;
}

/**
 * The assistant never writes a pattern. It quotes the text of each part of one message; Arth
 * finds those quotes in the message it still holds, builds the template with its own compiler,
 * and then tries it on the user's unread messages. A template that reads nothing is not offered.
 */
async function readSmsTemplate(ctx: Context, raw: Raw): Promise<Draft> {
  const sms = ctx.unreadMessages.get((str(raw.sms, 12) ?? "").toLowerCase());
  if (!sms) throw new Reject("Names a bank message that isn't one of your unread ones");
  const fields = raw.fields && typeof raw.fields === "object" ? (raw.fields as Raw) : {};

  const spans: TaggedSpan[] = [];
  const overlaps = (start: number, end: number) => spans.some((s) => start < s.end && end > s.start);
  for (const field of SMS_TEMPLATE_FIELDS) {
    const quoted = justTheValue(field, str(fields[field], 200));
    if (!quoted) continue;
    // First place the quote appears that no other field has already taken.
    let at = sms.body.indexOf(quoted);
    while (at >= 0 && overlaps(at, at + quoted.length)) at = sms.body.indexOf(quoted, at + 1);
    if (at < 0) {
      if (field === "amount") throw new Reject("The amount it quotes isn't in the message");
      continue; // an optional part it got wrong: leave that part out
    }
    spans.push({ field: field as TaggedField, start: at, end: at + quoted.length });
  }
  if (!spans.some((s) => s.field === "amount")) throw new Reject("Doesn't say where the amount is");
  spans.sort((a, b) => a.start - b.start);

  const compiled = compileTemplate({ smsBody: sms.body, spans, style: "flexible" });
  if (!compiled.ok) {
    // The compiler's own explanations are written for the tagging screen; say it plainly here.
    throw new Reject(
      compiled.reason === "too_loose"
        ? "Would read almost any message, so it was left out"
        : "Arth couldn't build a working format from the parts it pointed out",
    );
  }

  const kind: UserTxType = raw.kind === "credit" || raw.kind === "refund" || raw.kind === "debit" ? raw.kind : "auto";
  const senderPattern = sms.address.toUpperCase().match(/[A-Z]{4,}/)?.[0] ?? sms.address.toUpperCase();
  const bank = str(raw.bank, MAX_LEN.name) ?? senderPattern;
  const { total, matches } = await findBacklogMatches({
    patternRegex: compiled.patternRegex,
    txType: kind,
    bankName: bank,
    senderMatchMode: "code",
    senderPattern,
  });
  if (matches.length === 0) throw new Reject("Was tried on your unread messages and read none of them");

  return {
    type: "sms_template",
    smsId: sms.id,
    body: sms.body,
    bank,
    kind,
    spans,
    senderPattern,
    pattern: compiled.patternRegex,
    reads: matches.length,
    title: `${bank} ${kind === "auto" ? "alert" : kind}`,
    detail: `Reads ${matches.length} of ${total} unread messages from this sender`,
  };
}

// ─── Reading: the whole reply ─────────────────────────────────────────────────

/** Read a pasted reply. Looks things up; changes nothing. */
export async function readAiReply(userId: string, pasted: string, today: Date = new Date()): Promise<AiReply> {
  const { objects, recognised, cutOff } = findSuggestionObjects(pasted);
  const reply: AiReply = { recognised, cutOff, accepted: [], rejected: [], alreadySet: 0 };
  if (!recognised) return reply;

  const parsed: { raw: Raw; type: SuggestionType | null; text: string }[] = [];
  for (const text of objects.slice(0, MAX_SUGGESTIONS)) {
    const oneLine = text.replace(/\s+/g, " ");
    const short = oneLine.length > 90 ? `${oneLine.slice(0, 90)}…` : oneLine;
    try {
      const raw = parseLoose(text) as Raw;
      const type = TYPE_ALIASES[String(raw?.type ?? "").toLowerCase().trim()] ?? null;
      parsed.push({ raw, type, text: short });
    } catch {
      reply.rejected.push({ reason: "Isn't written in a way Arth can read", text: short });
    }
  }
  if (objects.length > MAX_SUGGESTIONS) {
    reply.rejected.push({
      reason: `Only the first ${MAX_SUGGESTIONS} suggestions were read`,
      text: `${objects.length - MAX_SUGGESTIONS} more`,
    });
  }

  const ctx = await loadContext(userId, today);
  // New categories and merchant renames count for the whole reply, wherever they sit in it.
  for (const p of parsed) {
    const name = p.type === "add_category" ? str(p.raw.name, MAX_LEN.name) : null;
    if (name && !ctx.categories.has(name.toLowerCase())) ctx.categories.set(name.toLowerCase(), name);
  }
  for (const p of parsed.filter((x) => x.type === "merchant_category")) {
    const keyword = normalizeKeyword(str(p.raw.merchant, MAX_LEN.merchant) ?? "");
    const name = ctx.categories.get((str(p.raw.category, MAX_LEN.name) ?? "").toLowerCase());
    if (keyword.length >= 2 && name) ctx.replyMerchantCategories.set(keyword, name);
  }
  const renamedTo = parsed
    .filter((p) => p.type === "fix_merchant")
    .map((p) => normalizeKeyword(str(p.raw.to, MAX_LEN.merchant) ?? ""));

  const seen = new Set<string>();
  for (const type of SUGGESTION_GROUPS.map((g) => g.type)) {
    for (const p of parsed.filter((x) => x.type === type)) {
      try {
        let draft: Draft;
        if (type === "add_category") draft = readAddCategory(ctx, p.raw);
        else if (type === "fix_merchant") draft = readFixMerchant(ctx, p.raw);
        else if (type === "merchant_category") draft = readMerchantCategory(ctx, p.raw, renamedTo);
        else if (type === "recategorise") draft = await readRecategorise(ctx, p.raw);
        else if (type === "add_rule") draft = readAddRule(ctx, p.raw);
        else if (type === "set_budget") draft = await readSetBudget(ctx, p.raw);
        else if (type === "sms_template") draft = await readSmsTemplate(ctx, p.raw);
        else draft = readAddTransaction(ctx, p.raw);

        // The same change twice in one reply is one change.
        const identity = (
          draft.type === "sms_template" ? `${draft.type}|${draft.pattern}` : `${draft.type}|${draft.title}`
        ).toLowerCase();
        if (seen.has(identity)) continue;
        seen.add(identity);
        reply.accepted.push({ ...draft, key: reply.accepted.length, why: str(p.raw.why, MAX_LEN.why) } as Suggestion);
      } catch (e) {
        if (e instanceof AlreadySet) reply.alreadySet++;
        else if (e instanceof Reject) reply.rejected.push({ reason: e.message, text: p.text });
        else reply.rejected.push({ reason: "Couldn't be checked", text: p.text });
      }
    }
  }
  for (const p of parsed.filter((x) => x.type === null)) {
    reply.rejected.push({ reason: "Is not a kind of change Arth accepts", text: p.text });
  }
  return reply;
}

// ─── Applying ─────────────────────────────────────────────────────────────────

export interface ApplyResult {
  /** How many of each type were applied. */
  applied: Partial<Record<SuggestionType, number>>;
  /** Past entries moved to a new category by merchant categories. */
  entriesMoved: number;
  /** Transactions read from unread bank messages by the new templates (now in the review queue). */
  readFromMessages: number;
  /** Items that could not be applied, in plain words. */
  failed: string[];
}

async function categoryId(userId: string, name: string): Promise<string> {
  const row = await getDatabase().getFirstAsync<{ id: string }>(
    "SELECT id FROM categories WHERE user_id = ? AND name = ? AND is_active = 1;",
    userId,
    name,
  );
  if (!row) throw new Error(`The category "${name}" doesn't exist`);
  return row.id;
}

/**
 * Apply the suggestions the user left ticked, in setup order: categories first (later items
 * name them), merchant names before merchant categories (so the category catches the new
 * name), single entries after merchant categories (so the exception wins).
 */
export async function applySuggestions(
  userId: string,
  suggestions: Suggestion[],
  today: Date = new Date(),
): Promise<ApplyResult> {
  const result: ApplyResult = { applied: {}, entriesMoved: 0, readFromMessages: 0, failed: [] };
  const months = monthsToFYEnd(today, getFYStartMonth());

  // Set by the merchant_category pass; entries are moved once every category is in place, so
  // "swiggy" never moves Swiggy Instamart only for "swiggy instamart" to move it again.
  const merchantCategories: { keyword: string; category: string }[] = [];
  const moveEntries = async () => {
    for (const m of merchantCategories.splice(0)) {
      try {
        result.entriesMoved += await applyRuleToPastTransactions(m.keyword, m.category, userId);
      } catch (e) {
        result.failed.push(`${m.keyword}: ${e instanceof Error ? e.message : "past entries couldn't be moved"}`);
      }
    }
  };

  for (const type of SUGGESTION_GROUPS.map((g) => g.type)) {
    // Single-entry exceptions come right after merchant categories and must win over them.
    if (type === "recategorise") await moveEntries();
    for (const s of suggestions.filter((x) => x.type === type)) {
      try {
        if (s.type === "add_category") {
          await createCategory({ user_id: userId, name: s.name });
        } else if (s.type === "fix_merchant") {
          await learnMerchantAlias(userId, s.from, s.to);
          await propagateMerchantRename(userId, s.from, s.to);
        } else if (s.type === "merchant_category") {
          merchantCategories.push({ keyword: await setMerchantRule(s.keyword, s.category), category: s.category });
        } else if (s.type === "recategorise") {
          await updateExpense(s.expenseId, { category_id: await categoryId(userId, s.category) });
        } else if (s.type === "add_rule") {
          await createRule({
            name: s.name,
            match_mode: "all",
            applies_to: "expense",
            conditions: s.conditions,
            actions: [{ type: "category", category_id: await categoryId(userId, s.category) }],
          });
        } else if (s.type === "set_budget") {
          const id = await categoryId(userId, s.category);
          for (const month of months) await upsertBudget({ user_id: userId, category_id: id, month, amount: s.amount });
        } else if (s.type === "sms_template") {
          const saved = await createUserTemplate({
            bankName: s.bank,
            txType: s.kind,
            sampleSms: s.body,
            spans: s.spans,
            senderPattern: s.senderPattern,
            senderMatchMode: "code",
            createdFromSmsId: s.smsId,
            matchStyle: "flexible",
          });
          result.readFromMessages += await applyTemplateToBacklog({
            id: saved.id,
            patternRegex: saved.pattern_regex,
            txType: saved.tx_type,
            bankName: saved.bank_name,
            senderMatchMode: saved.sender_match_mode,
            senderPattern: saved.sender_pattern,
          });
        } else {
          const id = await createExpense({
            user_id: userId,
            amount: s.amount,
            date: s.date,
            nature: s.kind === "income" ? "credit" : "realized",
            merchant_name: s.merchant ?? undefined,
            category_id: s.category ? await categoryId(userId, s.category) : undefined,
            account_id: s.accountId,
            description: s.why ? `AI suggested: ${s.why}` : "AI suggested",
          });
          // Never straight into the books: it waits in the review queue like an SMS-detected entry.
          await getDatabase().runAsync(
            "UPDATE expenses SET status = 'pending_review', updated_at = datetime('now') WHERE id = ?;",
            id,
          );
        }
        result.applied[s.type] = (result.applied[s.type] ?? 0) + 1;
      } catch (e) {
        result.failed.push(`${s.title}: ${e instanceof Error ? e.message : "couldn't be applied"}`);
      }
    }
  }
  return result;
}
