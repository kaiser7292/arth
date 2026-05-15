/**
 * v15 Phase 2 — DB-backed SMS template fallback.
 *
 * This service kicks in ONLY when the hardcoded BANK_PATTERNS in
 * services/sms/bank-patterns.ts fail to match. It consults the
 * sms_template_patterns table (seeded from assets/data/sms-templates.json),
 * scopes to the sender-resolved bank when possible, and extracts a best-
 * effort ParsedSMS using named capture groups.
 *
 * Precedence (enforced by caller in sms-parser.ts):
 *   1. SKIP_PATTERNS (OTP, etc.)
 *   2. BANK_PATTERNS (hardcoded — v12 through v14 reality)
 *   3. tryTemplateMatch() — this file — flag-gated on v15_sms_template_fallback
 *   4. null (unrecognized)
 *
 * Key safety rules:
 *   - Templates with `bank_name` matching the sender-resolved bank are tried
 *     first. Only after those miss do we try `bank_name = '__generic__'`
 *     templates. This prevents, e.g., a Canara template matching a PNB SMS
 *     just because the regex happens to fit.
 *   - Confidence is fixed at 0.7 for template matches (vs 1.0 for hardcoded)
 *     so downstream code can distinguish.
 *   - reminder_hint matches are returned with skip=true so the parser keeps
 *     them out of the expense path — reminder-hints.ts owns the staging flow.
 */

import { getDatabase } from "@/database";
import { resolveBankFromSender } from "./lookup";
import { identifyBank } from "@/services/sms/bank-senders";
import type { ParsedSMS, TransactionType } from "@/services/sms/bank-patterns";
import { normalizeSms } from "@/services/sms/sms-normalize";
import { logger } from "@/utils/logger";

interface TemplateRow {
  id: string;
  bank_name: string;
  template_id: string | null;
  pattern_regex: string;
  tx_type: string;
  priority: number;
  /** v15.5: 'system' (seeded from JSON) or 'user' (authored via Settings). */
  source: string | null;
  /** v15.11.0: sender-based routing. */
  sender_match_mode: string | null;
  sender_pattern: string | null;
}

/**
 * v15.11.0 — does an incoming SMS sender match the template's sender pattern?
 * The template's `sender_pattern` is stored upper-cased; we normalise the
 * incoming address the same way before comparing.
 */
function senderMatches(
  row: TemplateRow,
  senderAddress: string,
  codeFromSender: string | null,
): boolean {
  if (!row.sender_match_mode || !row.sender_pattern) return false;
  const senderUp = senderAddress.toUpperCase();
  const pat = row.sender_pattern.toUpperCase();
  switch (row.sender_match_mode) {
    case "exact":
      return senderUp === pat;
    case "contains":
      return senderUp.includes(pat);
    case "code":
    default:
      return codeFromSender != null && codeFromSender === pat;
  }
}

const TX_TYPE_ALIASES: Record<string, TransactionType> = {
  debit: "debit",
  credit: "credit",
  upi_debit: "upi_debit",
  upi_credit: "upi_credit",
  cc_debit: "debit",
  cc_credit: "credit",
  refund: "refund",
  balance_inquiry: "balance_inquiry",
  reminder_hint: "amount_due_reminder",
};

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normaliseMerchant(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\s+/g, " ").replace(/[.,-]+$/, "");
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  return trimmed;
}

async function resolveSenderBank(senderAddress: string): Promise<string | null> {
  const hardcoded = identifyBank(senderAddress);
  if (hardcoded) return hardcoded.bank;
  const codeMatch = senderAddress.toUpperCase().match(/[A-Z]{4,}/);
  if (!codeMatch) return null;
  return resolveBankFromSender(codeMatch[0]);
}

/**
 * Try to match an SMS body against bank-scoped and generic templates in
 * sms_template_patterns. Returns a ParsedSMS on match, null otherwise.
 */
export async function tryTemplateMatch(
  body: string,
  senderAddress: string,
): Promise<ParsedSMS | null> {
  const db = getDatabase();
  const bank = await resolveSenderBank(senderAddress);

  // v15.10.1: compile-time patterns live in normalized-space (lowercased,
  // comma-stripped, URL-wildcarded, etc.), so match-side must run the
  // incoming SMS through the same pipeline before applying the regex.
  const normalizedBody = normalizeSms(body).text;

  // v15.11.0: extract the DLT code ONCE — reused for every candidate row's
  // `code`-mode senderMatches() check.
  const codeFromSender =
    senderAddress.toUpperCase().match(/[A-Z]{4,}/)?.[0] ?? null;

  let rows: TemplateRow[];
  try {
    // v15.11.0: widen the fetch — a user template may match by sender
    // pattern without matching `bank_name` at all (e.g. wallets where the
    // app doesn't know the brand). Fetch:
    //   - any row where bank_name matches the resolved bank OR __generic__
    //   - plus any user row with a non-null sender_pattern (we'll filter
    //     by sender in JS below)
    // Ordering: system first, then user; bank-scoped ahead of __generic__.
    rows = await db.getAllAsync<TemplateRow>(
      `SELECT id, bank_name, template_id, pattern_regex, tx_type, priority, source,
              sender_match_mode, sender_pattern
       FROM sms_template_patterns
       WHERE bank_name = ? OR bank_name = '__generic__'
          OR (sender_pattern IS NOT NULL AND source = 'user')
       ORDER BY
         CASE WHEN sender_pattern IS NOT NULL THEN 0 ELSE 1 END,
         CASE WHEN bank_name = '__generic__' THEN 1 ELSE 0 END,
         CASE WHEN COALESCE(source, 'system') = 'system' THEN 0 ELSE 1 END,
         priority ASC;`,
      bank ?? "",
    );
  } catch (e) {
    logger.warn("Template match: DB fetch failed (non-fatal):", e);
    return null;
  }

  for (const row of rows) {
    // v15.11.0: if this row is sender-scoped, it ONLY applies when the
    // incoming sender matches. Skip otherwise — prevents one user's
    // TataNeu template from accidentally matching an Axis SMS.
    if (row.sender_match_mode && row.sender_pattern) {
      if (!senderMatches(row, senderAddress, codeFromSender)) continue;
    }
    let regex: RegExp;
    try {
      regex = new RegExp(row.pattern_regex, "i");
    } catch {
      continue;
    }

    const match = regex.exec(normalizedBody);
    if (!match) continue;

    const groups = match.groups ?? {};
    const amountRaw = groups["amount"];
    const txType = TX_TYPE_ALIASES[row.tx_type] ?? "debit";
    // v15.5: user-authored templates get lower confidence than system ones
    // so downstream (review queue, smart rules) can treat them more
    // cautiously if needed.
    const confidence = row.source === "user" ? 0.5 : 0.7;

    // v15.10.0: account capture can be either last-3-6 digits of a card/
    // savings (populate cardLast4, existing behavior) OR a multi-word
    // nickname for a wallet (populate accountNickname, new). Downstream
    // linkExpenseToAccount decides which field to match against.
    const accountRaw = groups["account"];
    const isAllDigits = accountRaw != null && /^\d+$/.test(accountRaw);
    const cardLast4 = isAllDigits ? accountRaw.slice(-4) : null;
    const accountNickname = !isAllDigits && accountRaw ? accountRaw.trim() : null;

    // reminder_hint matches are staged by reminder-hints.ts; we still return
    // a ParsedSMS so the parser records the SMS in pending_sms, but mark it
    // skip so it doesn't flow into the expense path.
    if (row.tx_type === "reminder_hint") {
      return {
        amount: amountRaw ? parseAmount(amountRaw) : 0,
        merchant: normaliseMerchant(groups["merchant"]),
        cardLast4,
        accountNickname,
        date: null,
        // v15.11.0: sender-scoped templates may be for brands the app
        // doesn't recognise (wallets, new fintechs). Prefer the template's
        // own bank_name when sender routing matched, falling back to the
        // DLT-resolved bank for legacy bank-scoped matches.
        bank: (row.sender_match_mode && row.bank_name) ? row.bank_name : (bank ?? "Unknown"),
        type: txType,
        skip: true,
        confidence,
        dueDate: groups["dueDate"] ?? null,
        isForecast: false,
        upiRef: groups["ref"] ?? null,
      };
    }

    // Balance-only / merchant-only patterns that never carry an amount are
    // not expenses on their own — skip so they don't land in pending_sms as
    // a 0-rupee transaction.
    if (!amountRaw || parseAmount(amountRaw) === 0) {
      if (row.tx_type === "balance_inquiry") {
        continue;
      }
      continue;
    }

    const amount = parseAmount(amountRaw);
    if (amount <= 0) continue;

    return {
      amount,
      merchant: normaliseMerchant(groups["merchant"]),
      cardLast4,
      accountNickname,
      date: null,
      bank: bank ?? "Unknown",
      type: txType,
      skip: false,
      confidence,
      dueDate: null,
      isForecast: false,
      upiRef: groups["ref"] ?? null,
      availableBalance: groups["balance"] ? parseAmount(groups["balance"]) : null,
      _matchSource: "template" as const,
      _matchedTemplateId: row.id,
    };
  }

  return null;
}

// Exposed for unit tests.
export const __test__ = { senderMatches };
