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
};

export interface AccountRow {
  id: string;
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

/** Pure: rows -> map. Open accounts first, then recently closed ones, capped. */
export function buildMoneyMap(rows: AccountRow[], max: number = MAX_MAP_ACCOUNTS): MoneyMap {
  const usable = rows.filter((r) => r.account_type !== "investment" || SMS_INSTRUMENTS.has(r.instrument ?? ""));
  const isClosed = (r: AccountRow) => r.closed_at != null || r.product_status === "closed" || r.product_status === "matured";
  const ordered = [...usable.filter((r) => !isClosed(r)), ...usable.filter(isClosed)].slice(0, max);

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
    };
  });
  return { accounts, byRef: new Map(accounts.map((a) => [a.ref, a])) };
}

/** One prompt line per account: "A3 | FD | SBI | ••3667 | funded from A1". */
export function moneyMapLines(map: MoneyMap): string[] {
  return map.accounts.map((a) =>
    [a.ref, a.kind, a.name, a.digits ? `••${a.digits}` : "no digits", a.fundedFrom ? `funded from ${a.fundedFrom}` : null, a.closed ? "closed" : null]
      .filter(Boolean)
      .join(" | "),
  );
}

export async function loadMoneyMap(): Promise<MoneyMap> {
  const db = getDatabase();
  const rows = await db.getAllAsync<AccountRow>(
    `SELECT fa.id, fa.account_type, fa.bank_name, fa.account_label, fa.account_identifier, fa.closed_at,
            ip.instrument, ip.source_account_id, ip.status AS product_status
     FROM financial_accounts fa
     LEFT JOIN investment_products ip ON ip.financial_account_id = fa.id
     WHERE fa.user_id = ? AND fa.is_active = 1
     ORDER BY fa.updated_at DESC;`,
    DEFAULT_USER_ID,
  );
  return buildMoneyMap(rows);
}
