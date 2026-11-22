/**
 * A short list of the user's accounts for on-device AI prompts ("money map"), so the model can
 * tell an FD closing from a spend, or a transfer between the user's own accounts from a payment.
 *
 * Only what an SMS can name goes in: type, bank or label, and the digits banks show. Never
 * balances or transactions. Accounts get short ids (A1, A2...) so the prompt stays small and
 * the model can only point at accounts that exist. Gemini Nano takes about 4,000 tokens per
 * prompt, so the map is capped. Stays on the phone like everything else here.
 */

import { getDatabase } from "@/database";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getIgnoredAccounts } from "@/services/account-ignore";

export interface MapAccount {
  /** Short id used in the prompt: "A1". */
  ref: string;
  accountId: string;
  /** "savings", "credit card", "FD"... as the prompt says it. */
  kind: string;
  name: string;
  /** Digits banks show (last 4 of the identifier), or null. */
  digits: string | null;
  /** For an FD: the ref of the account that funds it and gets the money back. */
  fundedFrom: string | null;
  closed: boolean;
  /** The user chose to ignore it (Settings → account → Ignore): its messages never become transactions. */
  ignored: boolean;
}

export interface MoneyMap {
  accounts: MapAccount[];
  byRef: Map<string, MapAccount>;
}

export const MAX_MAP_ACCOUNTS = 25;

/** Deposit-like products an SMS talks about. Funds and shares live in broker statements, not SMS. */
const SMS_INSTRUMENTS = new Set(["fd", "bond", "ppf", "epf", "nps"]);

const KIND: Record<string, string> = {
  savings: "savings",
  bank: "savings",
  credit_card: "credit card",
  loan: "loan",
  wallet: "wallet",
  pension: "EPF/pension",
  demat: "demat",
  ignored: "account",
};

export interface AccountRow {
  id: string;
  /** Only read by loadMoneyMap. */
  is_active?: number;
  account_type: string;
  bank_name: string | null;
  account_label: string | null;
  account_identifier: string | null;
  closed_at: string | null;
  instrument: string | null;
  source_account_id: string | null;
  product_status: string | null;
}

function lastDigits(identifier: string | null): string | null {
  const d = (identifier ?? "").replace(/\D/g, "");
  return d.length >= 3 ? d.slice(-4) : null;
}

/**
 * Pure: rows -> map. Open accounts first, then closed ones, then ignored ones, capped. Ignored
 * accounts are in it so "XX702" is recognised as the account the user ignored, not guessed at.
 */
export function buildMoneyMap(rows: AccountRow[], max: number = MAX_MAP_ACCOUNTS, ignoredIds: ReadonlySet<string> = new Set()): MoneyMap {
  const usable = rows.filter((r) => r.account_type !== "investment" || SMS_INSTRUMENTS.has(r.instrument ?? ""));
  const isClosed = (r: AccountRow) => r.closed_at != null || r.product_status === "closed" || r.product_status === "matured";
  const isIgnored = (r: AccountRow) => ignoredIds.has(r.id);
  const ordered = [
    ...usable.filter((r) => !isIgnored(r) && !isClosed(r)),
    ...usable.filter((r) => !isIgnored(r) && isClosed(r)),
    ...usable.filter(isIgnored),
  ].slice(0, max);

  const refOf = new Map<string, string>();
  ordered.forEach((r, i) => refOf.set(r.id, `A${i + 1}`));

  const accounts = ordered.map((r): MapAccount => {
    const kind = r.account_type === "investment" ? (r.instrument ?? "deposit").toUpperCase() : (KIND[r.account_type] ?? r.account_type);
    return {
      ref: refOf.get(r.id)!,
      accountId: r.id,
      kind,
      name: (r.bank_name || r.account_label || "Unknown").trim(),
      digits: lastDigits(r.account_identifier),
      fundedFrom: r.source_account_id ? (refOf.get(r.source_account_id) ?? null) : null,
      closed: isClosed(r),
      ignored: isIgnored(r),
    };
  });
  return { accounts, byRef: new Map(accounts.map((a) => [a.ref, a])) };
}

/** One prompt line per account: "A3 | FD | SBI | ••8142 | funded from A1". */
export function moneyMapLines(map: MoneyMap): string[] {
  return map.accounts.map((a) =>
    [a.ref, a.kind, a.name, a.digits ? `••${a.digits}` : "no digits", a.fundedFrom ? `funded from ${a.fundedFrom}` : null, a.closed ? "closed" : null, a.ignored ? "ignored" : null]
      .filter(Boolean)
      .join(" | "),
  );
}

/**
 * Account and card digits an SMS shows: masked ("XX702", "XXXXX708142", "**1234", "x7732") or
 * after a word that names an account ("card ending 7731", "A/c no. 1234"). Last 4 at most, in
 * the order written.
 */
export function accountDigitsIn(text: string): string[] {
  const found: string[] = [];
  const add = (d: string) => {
    const last = d.slice(-4);
    if (!found.includes(last)) found.push(last);
  };
  const rx =
    /[Xx*]{2,}(\d{3,})(?!\d)|\b(?:ending(?:\s+with)?|card|a\/c|acct|account)(?:\s+no\.?)?\s*[:#-]?\s*[Xx*]?(\d{3,6})(?!\d)/gi;
  for (const m of text.matchAll(rx)) add(m[1] ?? m[2]);
  return found;
}

/** Banks show 3 or 4 digits; Arth may hold more. "702" names an account stored as ••6702. */
export function digitsMatch(smsDigits: string, accountDigits: string | null): boolean {
  if (!accountDigits) return false;
  return accountDigits.endsWith(smsDigits) || smsDigits.endsWith(accountDigits);
}

export interface NamedAccount {
  /** As the SMS shows them. */
  digits: string;
  account: MapAccount;
}

/**
 * Which of the user's accounts the SMS names, worked out in code before the model is asked, so
 * it never has to guess that "XX702" is the ICICI account Arth holds as ••6702. Digits that match
 * more than one account are left out (ambiguous); open accounts win over closed ones.
 */
export function namedAccounts(text: string, map: MoneyMap): NamedAccount[] {
  const out: NamedAccount[] = [];
  for (const d of accountDigitsIn(text)) {
    const hits = map.accounts.filter((a) => digitsMatch(d, a.digits));
    const open = hits.filter((a) => !a.closed && !a.ignored);
    const pick = open.length === 1 ? open[0] : hits.length === 1 ? hits[0] : null;
    if (pick && !out.some((n) => n.account.ref === pick.ref)) out.push({ digits: d, account: pick });
  }
  return out;
}

export async function loadMoneyMap(): Promise<MoneyMap> {
  const db = getDatabase();
  const ignoredList = getIgnoredAccounts();
  const ignored = new Set(ignoredList.map((i) => i.accountId));
  const rows = await db.getAllAsync<AccountRow>(
    `SELECT fa.id, fa.is_active, fa.account_type, fa.bank_name, fa.account_label, fa.account_identifier, fa.closed_at,
            ip.instrument, ip.source_account_id, ip.status AS product_status
     FROM financial_accounts fa
     LEFT JOIN investment_products ip ON ip.financial_account_id = fa.id
     WHERE fa.user_id = ?
     ORDER BY fa.updated_at DESC;`,
    DEFAULT_USER_ID,
  );
  // Inactive rows are deleted or merged accounts, except the ones the user ignored (ignoring
  // marks the account inactive): those stay in, marked.
  const active = rows.filter((r) => r.is_active === 1 || ignored.has(r.id));
  // The ignored list remembers bank and digits on its own (the scan checks it, not the account
  // row), so an ignored account whose row is gone or merged is still recognised.
  for (const i of ignoredList) {
    if (active.some((r) => r.id === i.accountId)) continue;
    active.push({
      id: i.accountId,
      account_type: "ignored",
      bank_name: i.bank,
      account_label: null,
      account_identifier: i.digits,
      closed_at: null,
      instrument: null,
      source_account_id: null,
      product_status: null,
    });
  }
  return buildMoneyMap(active, MAX_MAP_ACCOUNTS, ignored);
}
