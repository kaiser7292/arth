import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 021: Sender-based template matching for user SMS templates.
 *
 * Problem solved: pre-v15.11.0, user templates routed by `bank_name` which
 * required Artha to already know the bank (via hardcoded BANK_SENDERS or
 * the DB-backed sms_sender_registry). Wallets / new fintech brands /
 * obscure PSU banks didn't match, because their sender code (e.g.
 * "MYTNEU" from "VM-MYTNEU-S") wasn't mapped to a bank name.
 *
 * v15.11.0 routes by sender code directly. Users tell the tagger the
 * sender ID they saw (VM-MYTNEU-S), pick a match mode, and incoming
 * SMSes with the same sender get matched regardless of whether Artha
 * recognises the brand.
 *
 * New columns (nullable — legacy templates keep working):
 *   - sender_match_mode: 'code' | 'exact' | 'contains' | NULL
 *     NULL = legacy template, matcher falls through to bank_name path.
 *     'code' = default. Matches the 4+ letter [A-Z]+ run inside the
 *              sender address. e.g. pattern="MYTNEU" matches
 *              "VM-MYTNEU-S", "AD-MYTNEU-T", "JD-MYTNEU", etc. Survives
 *              telco prefix changes which are the #1 cause of breakage.
 *     'exact' = case-insensitive exact-string match on the full sender.
 *     'contains' = substring match (catch-all for non-standard DLT IDs).
 *   - sender_pattern: the actual string to match against (the code,
 *     exact ID, or substring — interpretation per mode).
 */
export default {
  version: 21,
  name: "sms_template_sender_pattern",
  up: async (db: SQLiteDatabase) => {
    const cols = (await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(sms_template_patterns);",
    )) as Array<{ name: string }>;
    const hasCol = (name: string) => cols.some((c) => c.name === name);

    if (!hasCol("sender_match_mode")) {
      await db.execAsync(
        "ALTER TABLE sms_template_patterns ADD COLUMN sender_match_mode TEXT;",
      );
    }
    if (!hasCol("sender_pattern")) {
      await db.execAsync(
        "ALTER TABLE sms_template_patterns ADD COLUMN sender_pattern TEXT;",
      );
    }

    // Partial index — only non-null sender-pattern rows need lookup. Keeps
    // the index tiny since legacy rows and system rows won't have it.
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_sms_templates_sender_pattern
         ON sms_template_patterns(sender_pattern)
         WHERE sender_pattern IS NOT NULL;`,
    );
  },
};
