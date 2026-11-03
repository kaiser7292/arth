import type { Expense, SplitConfig, SplitMode } from "./expense-types";
import type { MultiSplitConfig, MultiSplitSummary } from "./expense-multi-split";

/**
 * A split as people think of it: who paid, how it's divided, with whom. Splits are stored two ways
 * (one person on the expense, several in expense_splits); this reads both for the card and the edit
 * sheet, and turns what was edited back into the right one. No database here.
 */

export type DraftMode = "equal" | "percent" | "amount" | "full";

export interface DraftPerson {
  personId: string;
  /** Their share as typed: a percentage or an amount, depending on the mode. */
  value: string;
  description: string;
}

export interface SplitDraft {
  /** "me" or the one other person who paid. Several people only when I paid. */
  paidBy: "me" | string;
  mode: DraftMode;
  people: DraftPerson[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pctOf = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

export function emptyDraft(): SplitDraft {
  return { paidBy: "me", mode: "equal", people: [] };
}

/** What each person's share comes to, and what's wrong with it if it can't be saved. */
export function draftShares(total: number, draft: SplitDraft): { me: number; people: number[]; error: string | null } {
  const n = draft.people.length;
  const typed = draft.people.map((p) => parseFloat(p.value) || 0);
  let people: number[];
  switch (draft.mode) {
    case "equal": {
      const each = round2(total / (n + 1));
      people = draft.people.map(() => each);
      break;
    }
    case "percent":
      people = typed.map((v) => round2((total * v) / 100));
      break;
    case "amount":
      people = typed.map(round2);
      break;
    case "full": {
      if (draft.paidBy !== "me") {
        people = draft.people.map(() => 0);
        break;
      }
      const each = n > 0 ? round2(total / n) : 0;
      people = draft.people.map((_, i) => (i === n - 1 ? round2(total - each * (n - 1)) : each));
      break;
    }
  }
  const me = round2(total - people.reduce((sum, a) => sum + a, 0));

  let error: string | null = null;
  if (n === 0) error = "Add someone to split with";
  else if (draft.mode === "percent" && typed.reduce((sum, v) => sum + v, 0) > 100) error = "The shares add up to more than 100%";
  else if (draft.mode === "percent" && typed.some((v) => v < 0)) error = "A share can't be below zero";
  else if (me < -0.01) error = "The shares add up to more than the total";
  else if ((draft.mode === "percent" || draft.mode === "amount") && people.some((a) => a <= 0)) error = "Enter a share for everyone";
  return { me: Math.max(0, me), people, error };
}

/** What to save: one other person is stored on the expense, several in expense_splits. */
export function draftToSave(
  total: number,
  draft: SplitDraft,
): { kind: "single"; config: SplitConfig } | { kind: "multi"; config: MultiSplitConfig } {
  const { people } = draftShares(total, draft);
  if (draft.people.length > 1) {
    return {
      kind: "multi",
      config: {
        splits: draft.people.map((p, i) => ({ personId: p.personId, description: p.description, amount: people[i] })),
        feeAbsorbed: true,
      },
    };
  }
  const [person] = draft.people;
  const paidByMe = draft.paidBy === "me";
  const base = { paidBy: draft.paidBy, personId: person.personId };
  const typed = parseFloat(person.value) || 0;
  // When someone else paid, computeSplitAmounts takes my share; the sheet always edits theirs.
  const config: SplitConfig =
    draft.mode === "equal"
      ? { ...base, splitMode: "equal" }
      : draft.mode === "full"
        ? { ...base, splitMode: paidByMe ? "they_owe_full" : "i_owe_full" }
        : draft.mode === "percent"
          ? { ...base, splitMode: "percentage", percentage: paidByMe ? typed : 100 - typed }
          : { ...base, splitMode: "exact", exactAmount: paidByMe ? typed : round2(total - typed) };
  return { kind: "single", config };
}

export interface SplitViewPerson {
  personId: string;
  name: string;
  amount: number;
  pct: number;
  description: string | null;
}

/** A saved split, ready to show. */
export interface SplitView {
  total: number;
  paidBy: "me" | string;
  mode: DraftMode;
  modeLabel: string;
  me: { amount: number; pct: number };
  people: SplitViewPerson[];
  /** "Ravi owes you ₹960", without the amount formatted: the card adds it. */
  owes: { text: string; amount: number } | null;
}

const MODE_LABELS: Record<SplitMode, string> = {
  equal: "split equally",
  percentage: "by percentage",
  exact: "by amount",
  they_owe_full: "they owe all of it",
  i_owe_full: "you owe all of it",
};
const MODE_OF: Record<SplitMode, DraftMode> = {
  equal: "equal",
  percentage: "percent",
  exact: "amount",
  they_owe_full: "full",
  i_owe_full: "full",
};

/**
 * The split on an expense, or null. `entry` is the Hisaab entry of a one-person split: it holds the
 * amount owed (after any refund) and who paid. `refunded` scales my share the way the ledger does.
 */
export function splitViewOf(
  expense: Pick<Expense, "amount" | "split_person_id" | "split_pct" | "split_original_amount"> & { split_mode?: string | null },
  personName: string | null,
  entry: { type: string; amount: number } | null,
  multi: MultiSplitSummary | null,
  refunded: number = 0,
): SplitView | null {
  if (multi && multi.splits.length > 0) {
    const total = multi.originalAmount;
    const fee = !multi.feeAbsorbed && multi.convenienceFee > 0 ? round2(multi.convenienceFee / multi.splits.length) : 0;
    const people = multi.splits.map((s) => {
      const amount = round2(s.amount + fee);
      return { personId: s.hisaab_person_id, name: s.person_name, amount, pct: pctOf(amount, total), description: s.description };
    });
    const owed = round2(people.reduce((sum, p) => sum + p.amount, 0));
    const equal = people.every((p) => Math.abs(p.amount - multi.myShare) < 0.02);
    return {
      total,
      paidBy: "me",
      mode: equal ? "equal" : "amount",
      modeLabel: equal ? "split equally" : "by amount",
      me: { amount: multi.myShare, pct: pctOf(multi.myShare, total) },
      people,
      owes: { text: people.length === 1 ? `${people[0].name} owes you` : `${people.length} people owe you`, amount: owed },
    };
  }
  if (!expense.split_person_id) return null;

  const total = expense.split_original_amount ?? expense.amount;
  const myPct = expense.split_pct ?? 100;
  const stored = (expense.split_mode ?? "percentage") as SplitMode;
  const name = personName ?? "Unknown";
  const theyPaid = entry?.type === "credit";
  const me = refunded > 0 ? Math.max(0, round2(((total - refunded) * myPct) / 100)) : expense.amount;
  // A credit entry records what I owe them; a debit entry what they owe me.
  const theirs = theyPaid ? round2(total - (entry?.amount ?? me)) : (entry?.amount ?? round2(total - me));
  return {
    total,
    paidBy: theyPaid ? (expense.split_person_id as string) : "me",
    mode: MODE_OF[stored] ?? "percent",
    modeLabel: MODE_LABELS[stored] ?? "by percentage",
    me: { amount: me, pct: myPct },
    people: [{ personId: expense.split_person_id, name, amount: theirs, pct: 100 - myPct, description: null }],
    owes: theyPaid
      ? { text: `You owe ${name}`, amount: entry?.amount ?? me }
      : theirs > 0
        ? { text: `${name} owes you`, amount: theirs }
        : null,
  };
}

/** The edit sheet's starting point for a saved split. */
export function draftFromView(view: SplitView): SplitDraft {
  return {
    paidBy: view.paidBy,
    mode: view.mode,
    people: view.people.map((p) => ({
      personId: p.personId,
      description: p.description ?? "",
      value: view.mode === "percent" ? String(p.pct) : view.mode === "amount" ? String(p.amount) : "",
    })),
  };
}

/** The add form holds a SplitConfig until the expense exists; this reopens it in the sheet. */
export function draftFromConfig(total: number, config: SplitConfig): SplitDraft {
  const paidByMe = config.paidBy === "me";
  const person = (value: string): DraftPerson[] => [{ personId: config.personId, value, description: "" }];
  switch (config.splitMode) {
    case "equal":
      return { paidBy: config.paidBy, mode: "equal", people: person("") };
    case "they_owe_full":
    case "i_owe_full":
      return { paidBy: config.paidBy, mode: "full", people: person("") };
    case "percentage": {
      const p = config.percentage ?? 0;
      return { paidBy: config.paidBy, mode: "percent", people: person(String(paidByMe ? p : 100 - p)) };
    }
    case "exact": {
      const a = config.exactAmount ?? 0;
      return { paidBy: config.paidBy, mode: "amount", people: person(String(paidByMe ? a : round2(total - a))) };
    }
  }
}
