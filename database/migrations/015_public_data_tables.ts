import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 015: Public-data scaffolding for v15 Phase 1.
 *
 * Adds seven additive tables that will, in Phase 2, be populated from
 * bundled JSON assets (assets/data/*.json) so any Indian user's SMS,
 * bank, and merchant recognition works out of the box — not just the
 * app owner's. Phase 1 ships the rails only; tables stay empty until
 * the Tier-1 data bundles land.
 *
 * Design guarantees:
 *   - Fully additive. No touch to expenses, recurring_expense_rules,
 *     reminder_fulfillments, merchant_aliases, or any existing table.
 *   - Precedence at lookup time (implemented in services/public-data/lookup.ts):
 *       user alias > learned correction (>=3) > public-rule > hardcoded default
 *   - Seeds use INSERT OR IGNORE; never stomp user rows.
 *
 * Tables:
 *   1. ifsc_bank_registry — 4-char IFSC prefix → bank name (e.g. HDFC → HDFC Bank).
 *      Seeded from github.com/razorpay/ifsc (MIT).
 *   2. sms_sender_registry — SMS sender codes → bank (e.g. HDFCBK → HDFC Bank).
 *      Artha-curated since TRAI does not publish a bulk DLT list.
 *   3. sms_template_patterns — regex templates with tx_type. Phase 2 fallback
 *      only fires on SMS that existing hardcoded BANK_PATTERNS missed, so a
 *      broken new template can never regress an existing user's parsing.
 *   4. mcc_codes — ISO 18245 Merchant Category Codes (981 rows). Seeded from
 *      greggles/mcc-codes (Unlicense / public domain).
 *   5. merchant_brand_registry — aliases like "SWGGY*BLR" → Swiggy, with MCC
 *      and our default category. Artha-curated from the owner's SMS corpus.
 *   6. data_bundle_versions — tracks which bundle version is seeded on device,
 *      so re-seeding is idempotent and deltas can be applied in a future
 *      online-refresh feature (Phase 3, deferred).
 *   7. reminder_suggestions — staging area for "reminder_hint" SMS matches
 *      (Standing Instructions, EMI pre-notices, UPI mandates). Phase 2
 *      populates it; a later release builds the Accept/Dismiss UI that
 *      hands rows into v14.7.0's recurring_expense_rules. No FK — keeps
 *      v15 decoupled from v14.7.0 schema.
 */
export default {
  version: 15,
  name: "public_data_tables",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS ifsc_bank_registry (
        ifsc_prefix TEXT PRIMARY KEY NOT NULL,
        bank_name TEXT NOT NULL,
        bank_short_code TEXT,
        source_version TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sms_sender_registry (
        sender_code TEXT PRIMARY KEY NOT NULL,
        bank_name TEXT NOT NULL,
        bank_type TEXT,
        confidence REAL NOT NULL DEFAULT 0.9,
        source_version TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sms_template_patterns (
        id TEXT PRIMARY KEY NOT NULL,
        bank_name TEXT NOT NULL,
        template_id TEXT,
        pattern_regex TEXT NOT NULL,
        tx_type TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 100,
        source_version TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sms_templates_type_priority
        ON sms_template_patterns(tx_type, priority DESC);

      CREATE TABLE IF NOT EXISTS mcc_codes (
        code TEXT PRIMARY KEY NOT NULL,
        description TEXT NOT NULL,
        category_name TEXT,
        source_version TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS merchant_brand_registry (
        id TEXT PRIMARY KEY NOT NULL,
        brand_canonical TEXT NOT NULL,
        alias TEXT NOT NULL UNIQUE,
        category_name TEXT,
        mcc_code TEXT,
        source_version TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_merchant_brand_alias
        ON merchant_brand_registry(alias);

      CREATE TABLE IF NOT EXISTS data_bundle_versions (
        bundle_name TEXT PRIMARY KEY NOT NULL,
        seeded_version TEXT NOT NULL,
        seeded_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS reminder_suggestions (
        id TEXT PRIMARY KEY NOT NULL,
        matched_pattern_id TEXT NOT NULL,
        sms_body TEXT NOT NULL,
        extracted_fields_json TEXT NOT NULL,
        seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_reminder_suggestions_unresolved
        ON reminder_suggestions(seen_at DESC) WHERE resolved = 0;
    `);
  },
};
