import type { SQLiteDatabase } from "expo-sqlite";
import type { Migration } from "./index";

/**
 * Migration 081 — flexible SMS templates.
 *
 * sms_template_patterns gains:
 *   match_style  'flexible' | 'exact' — how strictly the words around the fields must match.
 *                NULL = exact (every template saved before this migration).
 *   word_rules   JSON {"required": [...], "optional": [...]} — normalised words the user made
 *                required or optional on top of the automatic choice (flexible only).
 *   samples      JSON [{"body": "...", "spans": [...]}] — every example and its taps, so a
 *                template can be re-tagged, made flexible, or given more examples later
 *                (before this, taps weren't kept).
 *
 * Idempotent via PRAGMA table_info guard.
 */
export const migration: Migration = {
  version: 81,
  name: "template_flexible_matching",
  up: async (db: SQLiteDatabase) => {
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(sms_template_patterns);`);
    const has = (c: string) => columns.some((x) => x.name === c);
    if (!has("match_style")) await db.execAsync(`ALTER TABLE sms_template_patterns ADD COLUMN match_style TEXT;`);
    if (!has("word_rules")) await db.execAsync(`ALTER TABLE sms_template_patterns ADD COLUMN word_rules TEXT;`);
    if (!has("samples")) await db.execAsync(`ALTER TABLE sms_template_patterns ADD COLUMN samples TEXT;`);
  },
};

export default migration;
