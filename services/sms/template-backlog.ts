/**
 * Reading the Unrecognised backlog with a template.
 *
 * Bank SMS Arth couldn't read are kept in pending_sms (status 'failed' / 'pending', no expense).
 * When the user teaches a template, these functions:
 *   - find which of those messages it would read (live count + preview list on the tag screen)
 *   - turn the chosen ones into transactions for review — through the same path as a fresh SMS
 *     (enrichment, FD / own-account / SIP signals, createExpenseFromSms)
 *
 * How far back to look is a setting (Smart SMS Templates screen): 30 / 90 / 180 / 365 days.
 */

import { DEFAULT_USER_ID } from "@/constants/app";
import { getDatabase } from "@/database";
import { matchTemplateRow, resolveSenderBank, senderMatches, type TemplateRow } from "@/services/public-data/sms-template-matcher";
import { bumpDataVersion } from "@/services/settings";
import { backlogSinceMs, getBacklogDays } from "./backlog-days";
import { logger } from "@/utils/logger";
import type { ParsedSMS } from "./bank-patterns";
import { normalizeSms } from "./sms-normalize";
import { enrichParsedSms } from "./sms-parser";
import { createExpenseFromSms } from "./sms-to-expense";

export { BACKLOG_DAY_OPTIONS, DEFAULT_BACKLOG_DAYS, getBacklogDays, setBacklogDays } from "./backlog-days";

/** What a template would make of one backlog message. */
export interface BacklogMatch {
  /** pending_sms.id */
  id: string;
  body: string;
  address: string;
  smsDate: number;
  parsed: ParsedSMS;
}

/** The template being tried — a saved row, or the one being tagged right now. */
export interface TemplateUnderTest {
  id?: string;
  patternRegex: string;
  txType: string;
  bankName: string;
  senderMatchMode: string | null;
  senderPattern: string | null;
}

export interface BacklogRow {
  id: string;
  body: string;
  address: string;
  sms_date: number;
}

/** Unread bank SMS within the look-back window, newest first. */
async function backlogRows(days: number): Promise<BacklogRow[]> {
  const db = getDatabase();
  const since = backlogSinceMs(days);
  return db.getAllAsync<BacklogRow>(
    `SELECT id, body, address, sms_date FROM pending_sms
      WHERE status IN ('pending', 'failed') AND expense_id IS NULL AND sms_date >= ?
      ORDER BY sms_date DESC
      LIMIT 2000;`,
    since,
  );
}

function asRow(t: TemplateUnderTest): TemplateRow {
  return {
    id: t.id ?? "draft",
    bank_name: t.bankName,
    template_id: null,
    pattern_regex: t.patternRegex,
    tx_type: t.txType,
    priority: 100,
    source: "user",
    sender_match_mode: t.senderMatchMode,
    sender_pattern: t.senderPattern ? t.senderPattern.toUpperCase() : null,
  };
}

/** Is this message from the sender the template is for? Falls back to the bank-name prefix. */
function fromTemplateSender(row: TemplateRow, address: string): boolean {
  if (row.sender_match_mode && row.sender_pattern) {
    const code = address.toUpperCase().match(/[A-Z]{4,}/)?.[0] ?? null;
    return senderMatches(row, address, code);
  }
  const prefix = row.bank_name.trim().split(" ")[0].substring(0, 4).toUpperCase();
  return prefix.length > 0 && address.toUpperCase().includes(prefix);
}

/**
 * Which backlog messages from the template's sender it reads, and how. `total` is how many
 * unread messages that sender has in the window — for "Reads 11 of 12".
 */
/**
 * Shared between many findBacklogMatches calls in a row (an AI reply can hold dozens of message
 * formats): the backlog read once, each message normalised once, each sender's bank resolved once.
 */
export interface BacklogScan {
  rows?: BacklogRow[];
  normalised: Map<string, string>;
  banks: Map<string, string | null>;
}

export function newBacklogScan(): BacklogScan {
  return { normalised: new Map(), banks: new Map() };
}

export async function findBacklogMatches(
  template: TemplateUnderTest,
  days: number = getBacklogDays(),
  scan: BacklogScan = newBacklogScan(),
): Promise<{ total: number; matches: BacklogMatch[] }> {
  const row = asRow(template);
  try {
    new RegExp(row.pattern_regex, "i");
  } catch {
    return { total: 0, matches: [] };
  }
  if (!scan.rows) scan.rows = await backlogRows(days);
  const rows = scan.rows.filter((r) => fromTemplateSender(row, r.address));
  const matches: BacklogMatch[] = [];
  for (const r of rows) {
    if (!scan.banks.has(r.address)) scan.banks.set(r.address, await resolveSenderBank(r.address).catch(() => null));
    let text = scan.normalised.get(r.id);
    if (text === undefined) {
      text = normalizeSms(r.body).text;
      scan.normalised.set(r.id, text);
    }
    const parsed = matchTemplateRow(row, text, scan.banks.get(r.address) ?? null);
    if (!parsed || parsed.skip) continue;
    enrichParsedSms(parsed, r.body);
    matches.push({ id: r.id, body: r.body, address: r.address, smsDate: r.sms_date, parsed });
  }
  return { total: rows.length, matches };
}

/**
 * Turn backlog messages a saved template reads into transactions for review, skipping the ones
 * the user unticked. Same path as a freshly arrived SMS. Returns how many were created.
 */
export async function applyTemplateToBacklog(
  template: TemplateUnderTest & { id: string },
  excludedSmsIds: readonly string[] = [],
  onProgress?: (done: number, total: number) => void,
  scan?: BacklogScan,
): Promise<number> {
  const db = getDatabase();
  const { matches } = await findBacklogMatches(template, undefined, scan);
  // A shared scan must not offer these messages to the next template: they're read now.
  if (scan?.rows) {
    const used = new Set(matches.map((m) => m.id));
    scan.rows = scan.rows.filter((r) => !used.has(r.id));
  }
  const todo = matches.filter((m) => !excludedSmsIds.includes(m.id));
  let created = 0;
  for (const [i, m] of todo.entries()) {
    try {
      // The row was marked failed/unrecognised; it's being read now.
      await db.runAsync(`UPDATE pending_sms SET status = 'pending', error_message = NULL WHERE id = ?;`, m.id);
      const res = await createExpenseFromSms(DEFAULT_USER_ID, m.id, m.parsed, m.body, m.smsDate);
      if (res.success && res.expenseId) created++;
    } catch (e) {
      logger.warn(`Backlog read failed for SMS ${m.id} (non-fatal):`, e);
    }
    if (onProgress && (i % 10 === 9 || i === todo.length - 1)) onProgress(i + 1, todo.length);
  }
  if (created > 0) bumpDataVersion();
  return created;
}
