import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Migration 026 — v16.0.5 hisaab integration for the Cash-flow Simulator.
 *
 * Two additive changes. Both optional; absence = feature off, which is
 * the behavior that shipped in v16.0.0–16.0.4.
 *
 * 1. New table `simulation_hisaab_inclusions` — per-scenario opt-in
 *    for each hisaab person. Lets the user say "include Manoj's ₹65k
 *    as money available in THIS scenario, but not others". Stored as
 *    a rupee amount; the UI may compute it from a percentage but the
 *    DB only carries the absolute value.
 *
 *      scenario_id / person_id composite PK — one row per pairing.
 *      included       0/1 — master on/off for the row; set to 0 to
 *                     keep the user's typed amount without applying.
 *      amount_sign    'positive' | 'negative' — which side of the
 *                     baseline this pairing contributes to. Captured
 *                     at write-time from the person's hisaab balance
 *                     so that a later sign flip on the real hisaab
 *                     ledger doesn't silently re-classify the inclusion
 *                     from asset to liability (or vice versa).
 *      amount         REAL. Always positive; direction carried by
 *                     amount_sign.
 *
 * 2. New columns on `simulation_entries`:
 *      hisaab_person_id TEXT — when set, this planned entry is a
 *                     "collect from" or "pay back to" a specific
 *                     hisaab person. Direction column still governs
 *                     in/out; hisaab_person_id is metadata only.
 *      hisaab_kind    TEXT CHECK ('collect' | 'payback' | NULL) — the
 *                     semantic flavor so the UI can render "Collect
 *                     from Manoj" vs "Pay back to Raj".
 *
 * Idempotent. Safe to re-run.
 */
export default {
  version: 26,
  name: "simulator_hisaab",
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS simulation_hisaab_inclusions (
        scenario_id   TEXT NOT NULL REFERENCES simulation_scenarios(id) ON DELETE CASCADE,
        person_id     TEXT NOT NULL,
        included      INTEGER NOT NULL DEFAULT 1,
        amount        REAL NOT NULL,
        amount_sign   TEXT NOT NULL CHECK (amount_sign IN ('positive','negative')),
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (scenario_id, person_id)
      );
      CREATE INDEX IF NOT EXISTS idx_sim_hisaab_inclusions_person
        ON simulation_hisaab_inclusions(person_id);
    `);

    const entryCols = (await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(simulation_entries);",
    )) as Array<{ name: string }>;
    const hasPerson = entryCols.some((c) => c.name === "hisaab_person_id");
    const hasKind = entryCols.some((c) => c.name === "hisaab_kind");
    if (!hasPerson) {
      await db.execAsync(
        "ALTER TABLE simulation_entries ADD COLUMN hisaab_person_id TEXT;",
      );
    }
    if (!hasKind) {
      // No CHECK constraint via ALTER ADD COLUMN (SQLite quirk); we validate
      // at service write time.
      await db.execAsync(
        "ALTER TABLE simulation_entries ADD COLUMN hisaab_kind TEXT;",
      );
    }
  },
};
