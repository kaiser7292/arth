import { getDatabase } from "@/database";
import { readAiReply, type Suggestion } from "@/services/ai-suggestions";
import { CREDIT_KINDS, type CreditKind } from "@/services/expense-types";
import { todayIso } from "@/utils/date";
import {
  APPLY_ORDER,
  FIX_TYPE_ALIASES,
  MAX_CORRECTIONS,
  SHARED_TYPES,
  type FixType,
  type SharedType,
} from "./format";

/**
 * Reads a Fix my data reply (docs/AI_CORRECTIONS_DESIGN.md). The reply is untrusted text pasted
 * from a chat app: it is read item by item, every item is checked against the data, and nothing is
 * changed here. Corrections of the kinds the setup suggestions already know are handed to that
 * reader (readAiReply), so both read them the same way.
 */

interface Base {
  /** Position in the accepted list. */
  key: number;
  title: string;
  detail: string | null;
  why: string | null;
}

export type Fix = Base &
  (
    | { type: SharedType; suggestion: Suggestion }
    | { type: "set_account_type"; accountId: string; accountType: "savings" | "credit_card" | "wallet" | "loan" }
    | { type: "mark_duplicate"; expenseId: string; keepId: string }
    | { type: "mark_transfer"; expenseId: string; isCredit: boolean; otherAccountId: string }
    | { type: "link_refund"; creditId: string; purchaseId: string }
    | { type: "move_account"; expenseId: string; accountId: string }
    | { type: "set_merchant"; expenseId: string; merchant: string }
    | { type: "set_payment_mode"; expenseId: string; modeId: string }
    | { type: "set_spend_type"; expenseId: string; unavoidable: boolean }
    | { type: "set_income_type"; expenseId: string; incomeType: CreditKind }
    | { type: "mark_redemption"; expenseId: string }
    | { type: "link_to_bucket"; expenseId: string; bucketId: string }
    | { type: "adjust_balance"; accountId: string; balance: number }
    | { type: "update_goal"; milestoneId: string; targetAmount: number | null; targetDate: string | null }
  );

export interface CorrectionsReply {
  recognised: boolean;
  cutOff: boolean;
  accepted: Fix[];
  rejected: { reason: string; text: string }[];
  /** Correct, but already true. */
  alreadySet: number;
}

type Raw = Record<string, unknown>;

interface Row {
  id: string;
  date: string;
  amount: number;
  nature: string;
  status: string;
  account_id: string | null;
  merchant_name: string | null;
  payment_mode_id: string | null;
  is_right_spend: number | null;
  credit_kind: string | null;
  money_event: string | null;
  refund_of_expense_id: string | null;
  reclassified_as_transfer: number | null;
}

interface Ctx {
  byRef: Map<string, Row[]>;
  accounts: Map<string, { id: string; name: string; type: string }>;
  modes: Map<string, { id: string; name: string }>;
  buckets: Map<string, { id: string; name: string }>;
  goals: Map<string, { id: string; name: string; target_amount: number; target_date: string | null }>;
  linked: Set<string>;
  today: string;
  /** Rows a structural correction already claimed: a second one on the same row is refused. */
  claimed: Set<string>;
}

class Reject extends Error {}
class AlreadySet extends Error {}

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const refKey = (id: string) => id.replace(/[^0-9a-zA-Z]/g, "").slice(0, 8).toLowerCase();

/** Short, stable reference for an account, made from its id the way transaction refs are. */
export function accountFixRef(id: string): string {
  return `k${refKey(id)}`;
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const s = String(value).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[,\s₹]|rs\.?|inr/gi, "");
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

/** Every complete `{...}` inside the "corrections" list (or a bare list of typed objects). */
export function findCorrectionObjects(pasted: string): { objects: string[]; recognised: boolean; cutOff: boolean } {
  const text = pasted
    .slice(0, 4 * 1024 * 1024)
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[   ]/g, " ")
    .replace(/[​-‍﻿]/g, "");
  const marker = /"(corrections|suggestions)"\s*:\s*\[/.exec(text);
  const start = marker ? marker.index + marker[0].length : 0;
  const objects: string[] = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
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
    } else if (ch === "]" && depth === 0 && marker) break;
  }
  const ours = marker ? objects : objects.filter((o) => /"type"\s*:/.test(o));
  return { objects: ours, recognised: Boolean(marker) || ours.length > 0, cutOff: depth > 0 || inString };
}

function parseLoose(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return JSON.parse(json.replace(/,\s*([}\]])/g, "$1"));
  }
}

async function loadCtx(userId: string): Promise<Ctx> {
  const db = getDatabase();
  const [rows, accounts, modes, buckets, goals, linked] = await Promise.all([
    db.getAllAsync<Row>(
      `SELECT id, date, amount, nature, status, account_id, merchant_name, payment_mode_id, is_right_spend,
              credit_kind, money_event, refund_of_expense_id, reclassified_as_transfer
       FROM expenses WHERE user_id = ? AND deleted_at IS NULL AND nature IN ('realized', 'credit');`,
      userId,
    ),
    db.getAllAsync<{ id: string; account_label: string | null; bank_name: string; account_identifier: string | null; account_type: string }>(
      `SELECT id, account_label, bank_name, account_identifier, account_type FROM financial_accounts
       WHERE user_id = ? AND is_active = 1 AND closed_at IS NULL;`,
      userId,
    ),
    db.getAllAsync<{ id: string; name: string }>(`SELECT id, name FROM payment_modes WHERE user_id = ? AND is_active = 1;`, userId),
    db.getAllAsync<{ id: string; name: string }>(`SELECT id, name FROM investment_buckets WHERE user_id = ? AND is_active = 1;`, userId),
    db.getAllAsync<{ id: string; name: string; target_amount: number; target_date: string | null }>(
      `SELECT id, name, target_amount, target_date FROM life_milestones WHERE user_id = ? AND (is_completed IS NULL OR is_completed = 0);`,
      userId,
    ),
    db.getAllAsync<{ expense_id: string }>(`SELECT expense_id FROM expense_investment_links;`),
  ]);
  const byRef = new Map<string, Row[]>();
  for (const r of rows) byRef.set(refKey(r.id), [...(byRef.get(refKey(r.id)) ?? []), r]);
  return {
    byRef,
    accounts: new Map(
      accounts.map((a) => [
        accountFixRef(a.id),
        { id: a.id, name: `${a.account_label || a.bank_name}${a.account_identifier ? ` ··${a.account_identifier}` : ""}`, type: a.account_type },
      ]),
    ),
    modes: new Map(modes.map((m) => [m.name.toLowerCase(), m])),
    buckets: new Map(buckets.map((b) => [b.name.toLowerCase(), b])),
    goals: new Map(goals.map((g) => [g.name.toLowerCase(), g])),
    linked: new Set(linked.map((l) => l.expense_id)),
    today: todayIso(),
    claimed: new Set(),
  };
}

/** The transaction a correction names: its ref must match and the reply must repeat date and amount. */
function txn(ctx: Ctx, raw: Raw, prefix = ""): Row {
  const ref = (str(raw[`${prefix}ref`], 12) ?? "").toLowerCase();
  if (!/^t[0-9a-z]{8}$/.test(ref)) throw new Reject("Has no valid transaction reference");
  const amount = num(raw[`${prefix}amount`]);
  const date = raw[`${prefix}date`];
  const row = (ctx.byRef.get(ref.slice(1)) ?? []).find(
    (r) => r.date.slice(0, 10) === date && amount !== null && Math.abs(r.amount - amount) < 0.01,
  );
  if (!row) throw new Reject("Names a transaction that doesn't match any of yours");
  return row;
}

function account(ctx: Ctx, value: unknown): { id: string; name: string; type: string } {
  const ref = (str(value, 12) ?? "").toLowerCase();
  const a = ctx.accounts.get(ref);
  if (!a) throw new Reject("Names an account that isn't one of yours");
  return a;
}

const label = (r: Row) => `${r.merchant_name || (r.nature === "credit" ? "Money in" : "Payment")} · ${money(r.amount)} · ${r.date.slice(0, 10)}`;

function claim(ctx: Ctx, ...ids: string[]) {
  for (const id of ids) if (ctx.claimed.has(id)) throw new Reject("Changes a transaction another correction already changes");
  for (const id of ids) ctx.claimed.add(id);
}

/** Omit across each member of the union, so every kind keeps its own fields. */
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Draft = DistOmit<Fix, "key" | "why">;

const TYPE_NAMES: Record<string, string> = { savings: "Bank account", credit_card: "Credit card", wallet: "Wallet", loan: "Loan" };

function readFix(ctx: Ctx, type: FixType, raw: Raw): Draft {
  switch (type) {
    case "set_account_type": {
      const a = account(ctx, raw.account);
      const t = str(raw.account_type ?? raw.type_to ?? raw.new_type, 20) ?? "";
      if (!["savings", "credit_card", "wallet", "loan"].includes(t)) throw new Reject("Asks for an account type Arth doesn't have");
      if ((a.type === "bank" ? "savings" : a.type) === t) throw new AlreadySet();
      return { type, accountId: a.id, accountType: t as "savings", title: a.name, detail: `${TYPE_NAMES[a.type] ?? a.type} → ${TYPE_NAMES[t]}` };
    }
    case "mark_duplicate": {
      const copy = txn(ctx, raw);
      const keep = txn(ctx, raw, "same_as_");
      if (copy.id === keep.id) throw new Reject("Says a transaction is a duplicate of itself");
      if (Math.abs(copy.amount - keep.amount) >= 0.01 || copy.nature !== keep.nature) throw new Reject("The two aren't the same amount and kind");
      claim(ctx, copy.id, keep.id);
      return { type, expenseId: copy.id, keepId: keep.id, title: label(copy), detail: `Same as the one on ${keep.date.slice(0, 10)}: goes to the Recycle Bin` };
    }
    case "mark_transfer": {
      const r = txn(ctx, raw);
      if (r.reclassified_as_transfer === 1) throw new AlreadySet();
      if (!r.account_id) throw new Reject("Has no account, so it can't be a transfer from or to one");
      const other = account(ctx, raw.other_account ?? raw.account);
      if (other.id === r.account_id) throw new Reject("A transfer needs two different accounts");
      claim(ctx, r.id);
      const isCredit = r.nature === "credit";
      return {
        type,
        expenseId: r.id,
        isCredit,
        otherAccountId: other.id,
        title: label(r),
        detail: isCredit ? `Moved in from ${other.name}, not income` : `Moved to ${other.name}, not spending`,
      };
    }
    case "link_refund": {
      const credit = txn(ctx, raw);
      const purchase = txn(ctx, raw, "purchase_");
      if (credit.nature !== "credit") throw new Reject("A refund has to be money in");
      if (purchase.nature !== "realized") throw new Reject("What it refunds has to be a payment");
      if (credit.refund_of_expense_id === purchase.id) throw new AlreadySet();
      if (credit.refund_of_expense_id) throw new Reject("That refund is already linked to another purchase");
      if (credit.date < purchase.date) throw new Reject("The refund is dated before the purchase");
      claim(ctx, credit.id);
      return { type, creditId: credit.id, purchaseId: purchase.id, title: label(credit), detail: `Refund of ${label(purchase)}` };
    }
    case "move_account": {
      const r = txn(ctx, raw);
      const a = account(ctx, raw.account);
      if (r.account_id === a.id) throw new AlreadySet();
      if (r.reclassified_as_transfer === 1) throw new Reject("It's part of a transfer: undo the transfer first");
      return { type, expenseId: r.id, accountId: a.id, title: label(r), detail: `→ ${a.name}` };
    }
    case "set_merchant": {
      const r = txn(ctx, raw);
      const m = str(raw.merchant, 100);
      if (!m) throw new Reject("Has no merchant name");
      if ((r.merchant_name ?? "").trim() === m) throw new AlreadySet();
      return { type, expenseId: r.id, merchant: m, title: label(r), detail: `${r.merchant_name || "No merchant"} → ${m}` };
    }
    case "set_payment_mode": {
      const r = txn(ctx, raw);
      const mode = ctx.modes.get((str(raw.payment_mode ?? raw.mode, 60) ?? "").toLowerCase());
      if (!mode) throw new Reject("Names a payment mode you don't have");
      if (r.payment_mode_id === mode.id) throw new AlreadySet();
      return { type, expenseId: r.id, modeId: mode.id, title: label(r), detail: `Paid by ${mode.name}` };
    }
    case "set_spend_type": {
      const r = txn(ctx, raw);
      if (r.nature !== "realized") throw new Reject("Only spending is unavoidable or discretionary");
      const v = raw.unavoidable;
      const unavoidable = v === true || v === "true" || v === 1 ? true : v === false || v === "false" || v === 0 ? false : null;
      if (unavoidable === null) throw new Reject("Says neither unavoidable nor discretionary");
      if (r.is_right_spend === (unavoidable ? 1 : 0)) throw new AlreadySet();
      return { type, expenseId: r.id, unavoidable, title: label(r), detail: unavoidable ? "Unavoidable" : "Discretionary" };
    }
    case "set_income_type": {
      const r = txn(ctx, raw);
      if (r.nature !== "credit") throw new Reject("Only money in has an income type");
      const k = (str(raw.income_type, 20) ?? "").toLowerCase();
      if (!(CREDIT_KINDS as readonly string[]).includes(k)) throw new Reject("Asks for an income type Arth doesn't have");
      if (r.credit_kind === k) throw new AlreadySet();
      return { type, expenseId: r.id, incomeType: k as CreditKind, title: label(r), detail: `${r.credit_kind ?? "Not set"} → ${k}` };
    }
    case "mark_redemption": {
      const r = txn(ctx, raw);
      if (r.nature !== "credit") throw new Reject("Only money in can come back from an investment");
      if (r.money_event === "investment_withdrawal") throw new AlreadySet();
      if (r.reclassified_as_transfer === 1) throw new Reject("It's already recorded as a transfer");
      return { type, expenseId: r.id, title: label(r), detail: "Money back from an investment, not income" };
    }
    case "link_to_bucket": {
      const r = txn(ctx, raw);
      if (r.nature !== "realized") throw new Reject("Only money out can go into an investment");
      const b = ctx.buckets.get((str(raw.bucket, 60) ?? "").toLowerCase());
      if (!b) throw new Reject("Names an investment bucket you don't have");
      if (ctx.linked.has(r.id)) throw new AlreadySet();
      claim(ctx, r.id);
      return { type, expenseId: r.id, bucketId: b.id, title: label(r), detail: `Counts towards ${b.name}` };
    }
    case "adjust_balance": {
      const a = account(ctx, raw.account);
      const balance = num(raw.balance);
      if (balance === null) throw new Reject("Has no balance");
      if (a.type === "loan") throw new Reject("Loan balances come from the loan's schedule");
      if (a.type === "credit_card") throw new Reject("Card dues follow each month's spending; fix the transactions instead");
      return { type, accountId: a.id, balance, title: a.name, detail: `Set to ${money(balance)} today, with a visible adjustment` };
    }
    case "update_goal": {
      const g = ctx.goals.get((str(raw.goal ?? raw.name, 60) ?? "").toLowerCase());
      if (!g) throw new Reject("Names a goal you don't have");
      const amount = raw.target_amount === undefined ? null : num(raw.target_amount);
      if (raw.target_amount !== undefined && (amount === null || amount <= 0)) throw new Reject("The target amount isn't a positive number");
      const date = raw.target_date === undefined ? null : raw.target_date;
      if (date !== null && (!isIsoDate(date) || date <= ctx.today)) throw new Reject("The goal date has to be in the future");
      if (amount === null && date === null) throw new Reject("Changes nothing about the goal");
      if ((amount === null || Math.abs(amount - g.target_amount) < 1) && (date === null || date === g.target_date)) throw new AlreadySet();
      const parts = [
        amount !== null ? `target ${money(g.target_amount)} → ${money(amount)}` : null,
        date ? `date ${g.target_date ?? "none"} → ${date}` : null,
      ].filter(Boolean);
      return { type, milestoneId: g.id, targetAmount: amount, targetDate: date as string | null, title: g.name, detail: parts.join(", ") };
    }
  }
}

export async function readCorrections(userId: string, pasted: string): Promise<CorrectionsReply> {
  const { objects, recognised, cutOff } = findCorrectionObjects(pasted);
  const reply: CorrectionsReply = { recognised, cutOff, accepted: [], rejected: [], alreadySet: 0 };
  if (!recognised) return reply;

  const own: { raw: Raw; type: FixType; text: string }[] = [];
  const shared: string[] = [];
  for (const text of objects.slice(0, MAX_CORRECTIONS)) {
    const oneLine = text.replace(/\s+/g, " ");
    const short = oneLine.length > 90 ? `${oneLine.slice(0, 90)}…` : oneLine;
    try {
      const raw = parseLoose(text) as Raw;
      const name = String(raw?.type ?? "").toLowerCase().trim();
      const fix = FIX_TYPE_ALIASES[name];
      if (fix) own.push({ raw, type: fix, text: short });
      else shared.push(text); // the setup reader decides, and says so if it isn't a kind it knows
    } catch {
      reply.rejected.push({ reason: "Isn't written in a way Arth can read", text: short });
    }
  }
  if (objects.length > MAX_CORRECTIONS) {
    reply.rejected.push({ reason: `Only the first ${MAX_CORRECTIONS} corrections were read`, text: `${objects.length - MAX_CORRECTIONS} more` });
  }

  const drafts: (Draft & { why: string | null })[] = [];
  const ctx = await loadCtx(userId);
  // Structural fixes claim rows in apply order, so a conflict keeps the one applied first.
  const order = (t: FixType) => APPLY_ORDER.indexOf(t);
  for (const p of [...own].sort((a, b) => order(a.type) - order(b.type))) {
    try {
      drafts.push({ ...readFix(ctx, p.type, p.raw), why: str(p.raw.why, 160) });
    } catch (e) {
      if (e instanceof AlreadySet) reply.alreadySet++;
      else reply.rejected.push({ reason: e instanceof Reject ? e.message : "Couldn't be checked", text: p.text });
    }
  }

  if (shared.length > 0) {
    const setup = await readAiReply(userId, `{"suggestions": [${shared.join(",")}]}`);
    reply.alreadySet += setup.alreadySet;
    reply.rejected.push(...setup.rejected);
    for (const s of setup.accepted) {
      if (!(SHARED_TYPES as readonly string[]).includes(s.type)) {
        reply.rejected.push({ reason: "Is a setup change Fix my data doesn't make", text: s.title });
        continue;
      }
      drafts.push({ type: s.type as SharedType, suggestion: s, title: s.title, detail: s.detail, why: s.why });
    }
  }

  // One change twice is one change.
  const seen = new Set<string>();
  for (const d of drafts.sort((a, b) => APPLY_ORDER.indexOf(a.type) - APPLY_ORDER.indexOf(b.type))) {
    const identity = `${d.type}|${d.title}|${d.detail ?? ""}`.toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    reply.accepted.push({ ...d, key: reply.accepted.length } as Fix);
  }
  return reply;
}
