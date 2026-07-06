/**
 * v15.5.0 — CRUD for user-authored SMS templates.
 *
 * Thin layer over the shared sms_template_patterns table (migration 015,
 * extended by migration 018). Rows written here always have
 *   source = 'user'
 *   user_id = DEFAULT_USER_ID
 *   sample_sms = the raw SMS text used to build the regex
 *   created_from_sms_id = optional pending_sms.id if the template was
 *     spawned from a row in the Unrecognised SMS browser
 *
 * The matcher (sms-template-matcher.ts) reads these rows transparently
 * alongside system rows, with system rows ordered first. So nothing in
 * the parser needs a special case — a template is a template.
 */

import { getDatabase } from "@/database";
import { generateUUID } from "@/utils/uuid";
import { bumpDataVersion } from "@/services/settings";
import { logger } from "@/utils/logger";
import { DEFAULT_USER_ID } from "@/constants/app";
import { compileTemplate, type TaggedSpan } from "./template-compiler";
import { normalizeSms } from "./sms-normalize";
import { looksLikeTransaction } from "./bank-senders";

export type UserTxType = "debit" | "credit" | "refund";

/**
 * v15.11.0 — how to match a template's saved sender against an incoming SMS's
 * sender address.
 *   - 'code'     : extract the [A-Z]{4,} run from the incoming sender and
 *                  compare equal (default, resilient to telco-prefix changes)
 *   - 'exact'    : case-insensitive exact-string match on the full address
 *   - 'contains' : case-insensitive substring match
 */
export type SenderMatchMode = "code" | "exact" | "contains";

export interface UserSmsTemplate {
  id: string;
  user_id: string | null;
  bank_name: string;
  template_id: string | null;
  pattern_regex: string;
  tx_type: UserTxType;
  priority: number;
  source: "user";
  sample_sms: string | null;
  created_from_sms_id: string | null;
  source_version: string;
  /** v15.11.0 */
  sender_match_mode: SenderMatchMode | null;
  sender_pattern: string | null;
  /** migration 055 */
  default_payment_mode_id: string | null;
}

export interface CreateUserTemplateInput {
  bankName: string;
  txType: UserTxType;
  sampleSms: string;
  spans: TaggedSpan[];
  /** Optional user-facing label, e.g. "Kotak UPI Debit". */
  label?: string;
  /** Optional link back to the pending_sms row that inspired this template. */
  createdFromSmsId?: string;
  /** Default 100 — leave alone unless user explicitly prioritises. */
  priority?: number;
  /** v15.11.0 — sender-based routing. Required for new templates. */
  senderPattern: string;
  senderMatchMode: SenderMatchMode;
  /** v15.13.0 — optional pre-compiled regex to override auto-generated one. */
  patternRegex?: string;
  /** migration 055 — payment mode ID to apply when SMS parse doesn't detect one. */
  defaultPaymentModeId?: string | null;
}

export interface UpdateUserTemplateInput {
  bankName?: string;
  txType?: UserTxType;
  sampleSms?: string;
  spans?: TaggedSpan[];
  label?: string;
  priority?: number;
  senderPattern?: string;
  senderMatchMode?: SenderMatchMode;
  /** v15.13.0 — optional pre-compiled regex to override auto-generated one. */
  patternRegex?: string;
  /** migration 055 — payment mode ID to apply when SMS parse doesn't detect one. */
  defaultPaymentModeId?: string | null;
}

export class UserTemplateCompileError extends Error {
  reason: string;
  detail?: string;
  constructor(reason: string, detail?: string) {
    super(`Template compile failed: ${reason}${detail ? " — " + detail : ""}`);
    this.reason = reason;
    this.detail = detail;
  }
}

// ─── Reads ───

export async function listUserTemplates(): Promise<UserSmsTemplate[]> {
  const db = getDatabase();
  return db.getAllAsync<UserSmsTemplate>(
    `SELECT id, user_id, bank_name, template_id, pattern_regex, tx_type,
            priority, source, sample_sms, created_from_sms_id, source_version,
            sender_match_mode, sender_pattern, deleted_at, default_payment_mode_id
     FROM sms_template_patterns
     WHERE source = 'user' AND deleted_at IS NULL
     ORDER BY bank_name ASC, priority ASC;`,
  );
}

export async function getDeletedUserTemplates(): Promise<UserSmsTemplate[]> {
  const db = getDatabase();
  return db.getAllAsync<UserSmsTemplate>(
    `SELECT id, user_id, bank_name, template_id, pattern_regex, tx_type,
            priority, source, sample_sms, created_from_sms_id, source_version,
            sender_match_mode, sender_pattern, deleted_at, default_payment_mode_id
     FROM sms_template_patterns
     WHERE source = 'user' AND user_id = ? AND deleted_at IS NOT NULL
     ORDER BY deleted_at DESC;`,
    DEFAULT_USER_ID,
  );
}

export async function getUserTemplate(id: string): Promise<UserSmsTemplate | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<UserSmsTemplate>(
    `SELECT id, user_id, bank_name, template_id, pattern_regex, tx_type,
            priority, source, sample_sms, created_from_sms_id, source_version,
            sender_match_mode, sender_pattern, deleted_at, default_payment_mode_id
     FROM sms_template_patterns
     WHERE id = ? AND source = 'user' AND deleted_at IS NULL;`,
    id,
  );
  return row ?? null;
}

// ─── Writes ───

export async function createUserTemplate(
  input: CreateUserTemplateInput,
): Promise<UserSmsTemplate> {
  // v15.13.0: if manual regex is provided, validate it instead of compiling
  let patternRegex: string;
  if (input.patternRegex) {
    // Validate the manual regex
    try {
      new RegExp(input.patternRegex, "i");
      patternRegex = input.patternRegex;
    } catch (e) {
      throw new UserTemplateCompileError("invalid_regex", e instanceof Error ? e.message : String(e));
    }
  } else {
    // Compile from spans
    const compiled = compileTemplate({
      smsBody: input.sampleSms,
      spans: input.spans,
    });
    if (!compiled.ok) {
      throw new UserTemplateCompileError(compiled.reason, compiled.detail);
    }
    patternRegex = compiled.patternRegex;
  }

  const db = getDatabase();
  const id = generateUUID();
  // v15.11.1: auto-label now uses the sender pattern (the actual routing
  // key) rather than "<bank_name> <tx_type>". Keeps the template list
  // self-describing — "MYTNEU" is more useful than "TataNeu debit" when
  // the user has multiple templates for the same wallet.
  const label =
    input.label?.trim() ||
    input.senderPattern.trim().toUpperCase() ||
    `${input.bankName} ${input.txType}`;

  await db.runAsync(
    `INSERT INTO sms_template_patterns
       (id, bank_name, template_id, pattern_regex, tx_type, priority,
        source_version, source, user_id, sample_sms, created_from_sms_id,
        sender_match_mode, sender_pattern, default_payment_mode_id)
     VALUES (?, ?, ?, ?, ?, ?, 'user-authored', 'user', ?, ?, ?, ?, ?, ?);`,
    id,
    input.bankName.trim(),
    label,
    patternRegex,
    input.txType,
    input.priority ?? 100,
    DEFAULT_USER_ID,
    input.sampleSms,
    input.createdFromSmsId ?? null,
    input.senderMatchMode,
    input.senderPattern.trim().toUpperCase(),
    input.defaultPaymentModeId ?? null,
  );

  // v15.7.0: when the template was spawned from an Unrecognised SMS row,
  // register the SMS's sender code → bank mapping in sms_sender_registry
  // so the parser's widened matcher gate picks up future SMS from the same
  // sender. Extracts the first uppercase letter-run of 4+ chars from the
  // sender address (e.g. "VM-NEWPAY" → "NEWPAY"), which is the DLT code shape.
  if (input.createdFromSmsId) {
    try {
      const sms = await db.getFirstAsync<{ address: string }>(
        `SELECT address FROM pending_sms WHERE id = ?;`,
        input.createdFromSmsId,
      );
      if (sms?.address) {
        const codeMatch = sms.address.toUpperCase().match(/[A-Z]{4,}/);
        if (codeMatch) {
          await db.runAsync(
            `INSERT INTO sms_sender_registry (sender_code, bank_name, confidence, source_version)
             VALUES (?, ?, 0.5, 'user-authored')
             ON CONFLICT(sender_code) DO UPDATE SET
               bank_name = excluded.bank_name,
               source_version = excluded.source_version
             WHERE sms_sender_registry.source_version = 'user-authored';`,
            codeMatch[0],
            input.bankName.trim(),
          );
        }
      }
    } catch (e) {
      logger.warn(`Failed to register sender for template ${id} (non-fatal):`, e);
    }
  }

  await bumpDataVersion();

  const row = await getUserTemplate(id);
  if (!row) {
    // Shouldn't happen — INSERT succeeded.
    throw new Error("Failed to read back newly-created template");
  }
  return row;
}

export async function updateUserTemplate(
  id: string,
  input: UpdateUserTemplateInput,
): Promise<UserSmsTemplate> {
  const existing = await getUserTemplate(id);
  if (!existing) {
    throw new Error(`User template ${id} not found`);
  }

  // v15.13.0: if manual regex is provided, validate it instead of compiling
  let patternRegex = existing.pattern_regex;
  let sampleSms = existing.sample_sms ?? "";
  
  if (input.patternRegex !== undefined) {
    // Validate the manual regex
    try {
      new RegExp(input.patternRegex, "i");
      patternRegex = input.patternRegex;
    } catch (e) {
      throw new UserTemplateCompileError("invalid_regex", e instanceof Error ? e.message : String(e));
    }
    if (input.sampleSms !== undefined) sampleSms = input.sampleSms;
  } else if (input.sampleSms !== undefined || input.spans !== undefined) {
    // Recompile if sample or spans changed. If only bankName/txType/label
    // changed, keep the existing regex.
    const newBody = input.sampleSms ?? existing.sample_sms ?? "";
    const newSpans = input.spans ?? []; // caller must provide; absent spans = error
    if (newSpans.length === 0) {
      throw new UserTemplateCompileError(
        "no_spans",
        "Editing the sample requires re-tagging the fields",
      );
    }
    const compiled = compileTemplate({ smsBody: newBody, spans: newSpans });
    if (!compiled.ok) {
      throw new UserTemplateCompileError(compiled.reason, compiled.detail);
    }
    patternRegex = compiled.patternRegex;
    sampleSms = newBody;
  }

  // v15.11.1: same auto-label preference as create — sender pattern wins
  // over the generic "<bank> <type>" fallback when user left it blank.
  const effectiveSender = (input.senderPattern ?? existing.sender_pattern ?? "").trim().toUpperCase();
  const label =
    input.label?.trim() ||
    existing.template_id ||
    effectiveSender ||
    `${input.bankName ?? existing.bank_name} ${input.txType ?? existing.tx_type}`;

  const db = getDatabase();
  await db.runAsync(
    `UPDATE sms_template_patterns
     SET bank_name = ?,
         template_id = ?,
         pattern_regex = ?,
         tx_type = ?,
         priority = ?,
         sample_sms = ?,
         sender_match_mode = ?,
         sender_pattern = ?,
         default_payment_mode_id = ?
     WHERE id = ? AND source = 'user';`,
    (input.bankName ?? existing.bank_name).trim(),
    label,
    patternRegex,
    input.txType ?? existing.tx_type,
    input.priority ?? existing.priority,
    sampleSms,
    input.senderMatchMode ?? existing.sender_match_mode,
    (input.senderPattern ?? existing.sender_pattern ?? "").trim().toUpperCase() || null,
    "defaultPaymentModeId" in input
      ? (input.defaultPaymentModeId ?? null)
      : existing.default_payment_mode_id,
    id,
  );
  await bumpDataVersion();

  const row = await getUserTemplate(id);
  if (!row) throw new Error("Failed to read back updated template");
  return row;
}

export async function deleteUserTemplate(id: string): Promise<void> {
  const db = getDatabase();
  try {
    await db.runAsync(
      `UPDATE sms_template_patterns SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND source = 'user';`,
      id,
    );
    await bumpDataVersion();
  } catch (e) {
    logger.warn(`deleteUserTemplate(${id}) failed:`, e);
    throw e;
  }
}

export async function restoreUserTemplate(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE sms_template_patterns SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?;`,
    id,
  );
  await bumpDataVersion();
}

export async function restoreAllUserTemplates(): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE sms_template_patterns SET deleted_at = NULL, updated_at = datetime('now') WHERE source = 'user' AND user_id = ? AND deleted_at IS NOT NULL;`,
    DEFAULT_USER_ID,
  );
  await bumpDataVersion();
}

export async function purgeDeletedUserTemplates(): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `DELETE FROM sms_template_patterns WHERE source = 'user' AND user_id = ? AND deleted_at IS NOT NULL;`,
    DEFAULT_USER_ID,
  );
  await bumpDataVersion();
}

// ─── v15.6.0 helpers ───

/**
 * Does the user already have a template with the same bank + tx_type?
 * Used to show a duplicate warning in the tag screen before save.
 * Returns the first matching template or null.
 */
export async function findDuplicateUserTemplate(
  bankName: string,
  txType: UserTxType,
  excludeId?: string,
): Promise<UserSmsTemplate | null> {
  const db = getDatabase();
  const rows = await db.getAllAsync<UserSmsTemplate>(
    `SELECT id, user_id, bank_name, template_id, pattern_regex, tx_type,
            priority, source, sample_sms, created_from_sms_id, source_version,
            sender_match_mode, sender_pattern, default_payment_mode_id
     FROM sms_template_patterns
     WHERE source = 'user' AND deleted_at IS NULL
       AND bank_name = ? COLLATE NOCASE
       AND tx_type = ?;`,
    bankName.trim(),
    txType,
  );
  const filtered = excludeId ? rows.filter((r) => r.id !== excludeId) : rows;
  return filtered[0] ?? null;
}

/**
 * Run a compiled regex against the recent unrecognised-SMS corpus for this
 * bank/sender and return how many would match. Lets the user preview
 * coverage before committing to the template.
 *
 * v15.11.2: accepts optional sender claim so wallet templates can filter
 * candidates by their actual sender code (MYTNEU, AMAZONPAY) rather than
 * the bank/wallet nickname — which often doesn't appear in the sender at
 * all (bank_name="TataNeu" has no overlap with sender "VM-MYTNEU-S").
 *
 * Scope: last 30 days, pending_sms rows with no expense.
 */
export async function testPatternAgainstUnrecognised(
  patternRegex: string,
  bankName: string,
  senderClaim?: UserSenderClaim,
): Promise<{ total: number; matched: number; samples: string[] }> {
  const db = getDatabase();
  const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  // SQL-side narrow filter: use the sender pattern's core substring when
  // we have one, else fall back to bank-name prefix (legacy). Safe for
  // both wallets (MYTNEU) and banks (HDFC).
  const sqlPrefix =
    senderClaim?.pattern.substring(0, Math.max(4, senderClaim.pattern.length - 2))
    ?? bankName.trim().split(" ")[0].substring(0, 4);
  const rows = await db.getAllAsync<{ body: string; address: string }>(
    `SELECT body, address FROM pending_sms
      WHERE status IN ('pending', 'failed')
        AND expense_id IS NULL
        AND sms_date >= ?
        AND (address LIKE ? OR address LIKE ?)
      ORDER BY sms_date DESC
      LIMIT 200;`,
    thirtyDaysAgoMs,
    `%${sqlPrefix}%`,
    `%${bankName.trim().split(" ")[0].substring(0, 4)}%`,
  );
  let re: RegExp;
  try {
    re = new RegExp(patternRegex, "i");
  } catch {
    return { total: rows.length, matched: 0, samples: [] };
  }
  let matched = 0;
  const samples: string[] = [];
  for (const r of rows) {
    // v15.11.1: compiled templates live in normalized-space — must
    // normalize the incoming body before regex.test, matching the
    // production matcher path.
    if (re.test(normalizeSms(r.body).text)) {
      matched++;
      if (samples.length < 3) samples.push(r.body.slice(0, 80));
    }
  }
  return { total: rows.length, matched, samples };
}

/**
 * v15.7.0 — Diagnose a user template against recent real SMS.
 *
 * Runs the template's regex against pending_sms rows from the last 30 days,
 * widening the address filter to any SMS (not just known-bank senders) so
 * templates for new/registered banks are included. Returns:
 *   - matched: SMS the regex would parse
 *   - scanned: total SMS considered
 *   - sampleMatches / sampleMisses: up to 3 each, for the user to preview
 *
 * Helps users verify a template is catching things — and if not, which SMS
 * look similar but don't match.
 */
export async function diagnoseUserTemplate(
  templateId: string,
): Promise<{
  matched: number;
  scanned: number;
  sampleMatches: string[];
  sampleMisses: string[];
} | null> {
  const t = await getUserTemplate(templateId);
  if (!t) return null;

  const db = getDatabase();
  const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const senderPrefix = t.bank_name.trim().split(" ")[0].substring(0, 4);
  const claimed: UserSenderClaim[] =
    t.sender_match_mode && t.sender_pattern
      ? [{ mode: t.sender_match_mode, pattern: t.sender_pattern.toUpperCase() }]
      : [];
  // Include ALL recent SMS (any status) so already-processed SMS also count
  // as matches — users want to verify the template is working, not just see
  // the unprocessed backlog.
  const rows = await db.getAllAsync<{ body: string; address: string }>(
    `SELECT body, address FROM pending_sms
      WHERE sms_date >= ?
      ORDER BY sms_date DESC
      LIMIT 500;`,
    thirtyDaysAgoMs,
  );

  let re: RegExp;
  try {
    re = new RegExp(t.pattern_regex, "i");
  } catch {
    return { matched: 0, scanned: rows.length, sampleMatches: [], sampleMisses: [] };
  }

  const sampleMatches: string[] = [];
  const sampleMisses: string[] = [];
  let matched = 0;
  let scanned = 0;
  for (const r of rows) {
    const looksRelated =
      (claimed.length > 0 && matchesAnyUserSenderPattern(r.address, claimed)) ||
      r.address.toUpperCase().includes(senderPrefix.toUpperCase()) ||
      looksLikeTransaction(r.body);
    if (!looksRelated) continue;
    scanned++;
    if (re.test(normalizeSms(r.body).text)) {
      matched++;
      if (sampleMatches.length < 3) sampleMatches.push(r.body.slice(0, 100));
    } else {
      if (sampleMisses.length < 3) sampleMisses.push(r.body.slice(0, 100));
    }
  }
  return { matched, scanned, sampleMatches, sampleMisses };
}

/**
 * v15.7.0 — Count of unparsed SMS in the last 30 days (status pending or
 * failed, no linked expense). Cheap COUNT used by the Settings and template
 * list headers.
 */
export async function countUnrecognisedSms(): Promise<number> {
  const db = getDatabase();
  const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM pending_sms
      WHERE status IN ('pending', 'failed')
        AND expense_id IS NULL
        AND sms_date >= ?;`,
    thirtyDaysAgoMs,
  );
  return row?.n ?? 0;
}

/**
 * v15.11.2 — A single user-sender-claim row. Used by the sync-filter path
 * in sms-reader.ts which needs to check ownership during a native SMS
 * filter callback (can't be async). Callers pre-load the list via
 * loadUserSenderClaims() and pass it into matchesAnyUserSenderPattern().
 */
export interface UserSenderClaim {
  mode: "code" | "exact" | "contains";
  pattern: string; // already uppercased
}

export async function loadUserSenderClaims(): Promise<UserSenderClaim[]> {
  const db = getDatabase();
  try {
    const rows = await db.getAllAsync<{
      sender_match_mode: string | null;
      sender_pattern: string | null;
    }>(
      `SELECT sender_match_mode, sender_pattern
         FROM sms_template_patterns
        WHERE source = 'user' AND deleted_at IS NULL
          AND sender_pattern IS NOT NULL
          AND sender_match_mode IS NOT NULL;`,
    );
    const out: UserSenderClaim[] = [];
    for (const r of rows) {
      if (!r.sender_match_mode || !r.sender_pattern) continue;
      if (r.sender_match_mode === "code" || r.sender_match_mode === "exact" || r.sender_match_mode === "contains") {
        out.push({ mode: r.sender_match_mode, pattern: r.sender_pattern.toUpperCase() });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Synchronous 3-mode sender match against a pre-loaded claim list. */
export function matchesAnyUserSenderPattern(
  senderAddress: string,
  claims: UserSenderClaim[],
): boolean {
  if (!senderAddress || claims.length === 0) return false;
  const senderUp = senderAddress.toUpperCase();
  const code = senderUp.match(/[A-Z]{4,}/)?.[0] ?? null;
  for (const c of claims) {
    switch (c.mode) {
      case "exact":
        if (senderUp === c.pattern) return true;
        break;
      case "contains":
        if (senderUp.includes(c.pattern)) return true;
        break;
      case "code":
        if (code !== null && code === c.pattern) return true;
        break;
    }
  }
  return false;
}

/**
 * v15.11.1 — does any user template claim ownership of this sender address?
 * Called from the SMS parser BEFORE the keyword-based "looksLikeTransaction"
 * gate: if the user has explicitly authored a template saying "this sender
 * matters", we trust them and let the matcher run — otherwise wallet SMSes
 * (no transaction keywords in body) get rejected before the matcher ever
 * sees them.
 *
 * Mirrors the 3-mode matching logic in sms-template-matcher.ts so the
 * answers stay in sync.
 */
export async function hasSenderScopedUserTemplate(
  senderAddress: string,
): Promise<boolean> {
  if (!senderAddress) return false;
  const db = getDatabase();
  try {
    const rows = await db.getAllAsync<{
      sender_match_mode: string | null;
      sender_pattern: string | null;
    }>(
      `SELECT sender_match_mode, sender_pattern
         FROM sms_template_patterns
        WHERE source = 'user' AND deleted_at IS NULL
          AND sender_pattern IS NOT NULL
          AND sender_match_mode IS NOT NULL;`,
    );
    if (rows.length === 0) return false;
    const senderUp = senderAddress.toUpperCase();
    const codeFromSender = senderUp.match(/[A-Z]{4,}/)?.[0] ?? null;
    for (const row of rows) {
      if (!row.sender_match_mode || !row.sender_pattern) continue;
      const pat = row.sender_pattern.toUpperCase();
      switch (row.sender_match_mode) {
        case "exact":
          if (senderUp === pat) return true;
          break;
        case "contains":
          if (senderUp.includes(pat)) return true;
          break;
        case "code":
        default:
          if (codeFromSender != null && codeFromSender === pat) return true;
          break;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Helpers for the Unrecognised SMS browser ───

export interface UnrecognisedSmsRow {
  id: string;
  address: string;
  body: string;
  sms_date: number;
}

/**
 * List raw pending_sms rows that never became an expense. Scoped to the
 * last 30 days + 'pending' status + no linked expense_id. Newest first.
 */
export async function listUnrecognisedSms(limit = 50): Promise<UnrecognisedSmsRow[]> {
  const db = getDatabase();
  const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  // v15.6.0: include 'failed' rows too — these are SMS the parser saw but
  // couldn't extract values from. Users can teach a template that covers them.
  return db.getAllAsync<UnrecognisedSmsRow>(
    `SELECT id, address, body, sms_date
     FROM pending_sms
     WHERE status IN ('pending', 'failed')
       AND expense_id IS NULL
       AND sms_date >= ?
     ORDER BY sms_date DESC
     LIMIT ?;`,
    thirtyDaysAgoMs,
    limit,
  );
}
