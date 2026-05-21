/**
 * Cash-flow simulator service (v16.0.0).
 *
 * DB-bound wrapper around the pure engine at services/simulator-engine.ts.
 * Handles:
 *   - Scenario CRUD (create, rename, duplicate, archive, delete)
 *   - Entry CRUD (add, edit, reschedule, duplicate, delete, fulfill, dismiss)
 *   - Default-scenario roll-forward (horizon advances when the month flips)
 *   - Seeding from active reminders + open CC repayment forecasts
 *   - Fulfillment reconciliation (past-date upcoming → stale or auto-linked)
 *   - Retention (30d entry purge, 90d scenario archive, 180d scenario delete)
 *   - Baseline-balance computation (reuses existing account-balance + demat
 *     snapshot helpers)
 *   - `getScenarioOverview` — one-shot fetch for the detail screen
 *
 * Nothing here writes into the `expenses` / `account_transfers` tables.
 * Simulator state is fully isolated.
 */

import { getDatabase } from "@/database";
import type { FinancialAccount } from "@/services/financial-account";
import { getActiveAccounts } from "@/services/financial-account";
import { bumpDataVersion } from "@/services/settings";
import { addDays, todayIso } from "@/utils/date";
import { generateUUID } from "@/utils/uuid";
import {
    findFulfillmentCandidate,
    runSimulation,
    type BaselineAccount,
    type EngineEntry,
    type FulfillmentCandidate,
    type SimulationOutput,
} from "./simulator-engine";

export type {
    BaselineAccount,
    EngineEntry,
    SimulationOutput
} from "./simulator-engine";

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

export type EntryDirection = "out" | "in";
export type EntrySource = "manual" | "seeded_reminder" | "seeded_forecast";
export type EntryStatus = "upcoming" | "fulfilled" | "stale" | "dismissed";
/** v16.0.5 — hisaab planned entries. `collect` = direction 'in', money
 *  comes from a person who owes you. `payback` = direction 'out', money
 *  goes to a person you owe. Both are tagged so the UI can render
 * "Collect from X" / "Pay back to Y" labels. */
export type HisaabKind = "collect" | "payback";

export interface SimulationScenario {
  id: string;
  user_id: string;
  name: string;
  horizon_date: string;
  is_default: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface SimulationEntry {
  id: string;
  scenario_id: string;
  direction: EntryDirection;
  amount: number;
  date: string;
  originally_planned_for: string | null;
  account_id: string | null;
  /** v16.0.9 — transfer entries have from and to accounts */
  from_account_id: string | null;
  to_account_id: string | null;
  category_id: string | null;
  merchant_name: string | null;
  description: string | null;
  source: EntrySource;
  seed_source_id: string | null;
  fulfilled_expense_id: string | null;
  status: EntryStatus;
  created_at: string;
  updated_at: string;
  /** v16.0.5 — hisaab planned entries */
  hisaab_person_id: string | null;
  hisaab_kind: HisaabKind | null;
}

/**
 * v16.0.5 — per-scenario hisaab inclusion.
 *
 * Represents "include Manoj's ₹32,500 as money-available in this scenario".
 * `amount` is always positive; direction carried by `amount_sign` so a
 * later sign flip on the underlying hisaab ledger doesn't reclassify the
 * inclusion between asset and liability.
 */
export interface SimulationHisaabInclusion {
  scenario_id: string;
  person_id: string;
  included: number; // 0 | 1
  amount: number;
  amount_sign: "positive" | "negative";
  created_at: string;
  updated_at: string;
}

/** Helper shape for the UI — inclusion + person context + full balance. */
export interface HisaabInclusionCandidate {
  personId: string;
  personName: string;
  /** Current hisaab balance. Positive = they owe you; negative = you owe them. */
  currentBalance: number;
  /** Existing inclusion row for this (scenario, person) pair, if any. */
  inclusion: SimulationHisaabInclusion | null;
}

export interface CreateScenarioInput {
  name: string;
  horizon_date: string;
  is_default?: boolean;
}

export interface CreateEntryInput {
  direction: EntryDirection;
  amount: number;
  date: string;
  account_id?: string | null;
  /** v16.0.9 — transfer entries have from and to accounts */
  from_account_id?: string | null;
  to_account_id?: string | null;
  category_id?: string | null;
  merchant_name?: string | null;
  description?: string | null;
  source?: EntrySource;
  seed_source_id?: string | null;
  /** v16.0.5 — hisaab entry. When set, `hisaab_kind` must also be set. */
  hisaab_person_id?: string | null;
  hisaab_kind?: HisaabKind | null;
}

export interface UpdateEntryInput {
  direction?: EntryDirection;
  amount?: number;
  date?: string;
  account_id?: string | null;
  /** v16.0.9 — transfer entries have from and to accounts */
  from_account_id?: string | null;
  to_account_id?: string | null;
  category_id?: string | null;
  merchant_name?: string | null;
  description?: string | null;
  hisaab_person_id?: string | null;
  hisaab_kind?: HisaabKind | null;
}

export interface ScenarioOverview {
  scenario: SimulationScenario;
  baseline: BaselineAccount[];
  entries: {
    upcoming: SimulationEntry[];
    stale: SimulationEntry[];
    fulfilled: SimulationEntry[];
    dismissed: SimulationEntry[];
  };
  simulation: SimulationOutput;
  /** v16.0.5 — active hisaab inclusions for this scenario. UI adds these
   *  to the starting-balance drawer and to the projected totals. */
  hisaabIncluded: SimulationHisaabInclusion[];
}

// ═══════════════════════════════════════════════════════════════════════
// Date helpers — v16.0.1 timezone hardening
//
// Everywhere in Artha uses local-wall-clock dates (YYYY-MM-DD as read by
// the user, not UTC). The simulator was mixing `new Date().toISOString()`
// (UTC-based) with `new Date(Date.UTC(...))` constructions, which could
// drift by a day near local midnight in timezones like IST (UTC+5:30).
// The helpers below read local date fields, ensuring "today" here always
// means the same thing the ledger pages call "today".
// ═══════════════════════════════════════════════════════════════════════

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function endOfMonthIso(ref: string = todayIso()): string {
  const [y, m] = ref.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return ref;
  // Day 0 of next month = last day of this month. Construct using local
  // Date so DST transitions don't shift us.
  const last = new Date(y, m, 0);
  return `${last.getFullYear()}-${pad2(last.getMonth() + 1)}-${pad2(last.getDate())}`;
}

function assertISODate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must be YYYY-MM-DD`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Scenario CRUD
// ═══════════════════════════════════════════════════════════════════════

/**
 * Load (or create) the default scenario. Rolls forward the horizon + wipes
 * stale/fulfilled/dismissed entries + re-seeds if the stored horizon has
 * passed. Always returns the freshest active default.
 */
export interface DefaultScenarioResult {
  scenario: SimulationScenario;
  /** True when the scenario was newly created on this call (or had its horizon rolled forward). */
  justSeeded: boolean;
}

export async function getOrCreateDefaultScenario(
  userId: string,
): Promise<DefaultScenarioResult> {
  const db = getDatabase();
  const today = todayIso();

  // v16.0.1 — fetch ALL default rows, not just one. Race-condition /
  // historic-bug cleanup: if more than one is_default row exists for this
  // user (v16.0.0 shipped without a uniqueness guard), keep the oldest and
  // demote the rest to is_default=0 so they become ordinary scenarios
  // (user can archive/delete from the UI). Works in place of a DB
  // constraint which would require a data migration.
  const allDefaults = await db.getAllAsync<SimulationScenario>(
    `SELECT * FROM simulation_scenarios
     WHERE user_id = ? AND is_default = 1 AND archived_at IS NULL
     ORDER BY created_at ASC;`,
    userId,
  );

  let row: SimulationScenario | null = null;
  if (allDefaults.length === 0) {
    row = null;
  } else {
    row = allDefaults[0];
    if (allDefaults.length > 1) {
      // Demote extras. They keep their entries but become plain named
      // scenarios the user can review + delete.
      const extraIds = allDefaults.slice(1).map((s) => s.id);
      const placeholders = extraIds.map(() => "?").join(",");
      await db.runAsync(
        `UPDATE simulation_scenarios
         SET is_default = 0,
             name = 'Duplicate default · ' || substr(id, 1, 8),
             updated_at = datetime('now')
         WHERE id IN (${placeholders});`,
        ...extraIds,
      );
      bumpDataVersion();
    }
  }

  let justSeeded = false;

  if (!row) {
    const id = generateUUID();
    const horizon = endOfMonthIso(today);
    await db.runAsync(
      `INSERT INTO simulation_scenarios (id, user_id, name, horizon_date, is_default)
       VALUES (?, ?, 'This month', ?, 1);`,
      id,
      userId,
      horizon,
    );
    row = await db.getFirstAsync<SimulationScenario>(
      `SELECT * FROM simulation_scenarios WHERE id = ?;`,
      id,
    );
    justSeeded = true;
    bumpDataVersion();
    return { scenario: row!, justSeeded };
  }

  // Roll forward if horizon has passed.
  if (row.horizon_date < today) {
    const newHorizon = endOfMonthIso(today);
    await db.runAsync(
      `UPDATE simulation_scenarios
       SET horizon_date = ?, updated_at = datetime('now')
       WHERE id = ?;`,
      newHorizon,
      row.id,
    );
    // Purge entries that are no longer relevant — anything non-upcoming,
    // or upcoming but dated before today (those become stale-on-reconcile
    // under the new horizon anyway, and there's no value carrying over
    // rescheduled-but-missed entries into a fresh month).
    await db.runAsync(
      `DELETE FROM simulation_entries
       WHERE scenario_id = ?
         AND (status IN ('fulfilled','dismissed','stale') OR date < ?);`,
      row.id,
      today,
    );
    row = await db.getFirstAsync<SimulationScenario>(
      `SELECT * FROM simulation_scenarios WHERE id = ?;`,
      row.id,
    );
    justSeeded = true;
    bumpDataVersion();
  }

  return { scenario: row!, justSeeded };
}

export async function listActiveScenarios(
  userId: string,
): Promise<SimulationScenario[]> {
  const db = getDatabase();
  return db.getAllAsync<SimulationScenario>(
    `SELECT * FROM simulation_scenarios
     WHERE user_id = ? AND archived_at IS NULL
     ORDER BY is_default DESC, created_at ASC;`,
    userId,
  );
}

export async function listArchivedScenarios(
  userId: string,
  withinDays: number = 90,
): Promise<SimulationScenario[]> {
  const db = getDatabase();
  return db.getAllAsync<SimulationScenario>(
    `SELECT * FROM simulation_scenarios
     WHERE user_id = ?
       AND archived_at IS NOT NULL
       AND archived_at >= datetime('now', ?)
     ORDER BY archived_at DESC;`,
    userId,
    `-${Math.max(1, withinDays)} days`,
  );
}

export async function getScenario(id: string): Promise<SimulationScenario | null> {
  const db = getDatabase();
  return db.getFirstAsync<SimulationScenario>(
    `SELECT * FROM simulation_scenarios WHERE id = ?;`,
    id,
  );
}

export async function createScenario(
  userId: string,
  input: CreateScenarioInput,
): Promise<string> {
  assertISODate(input.horizon_date, "horizon_date");
  if (!input.name.trim()) throw new Error("Scenario name is required");
  const db = getDatabase();
  const id = generateUUID();
  await db.runAsync(
    `INSERT INTO simulation_scenarios (id, user_id, name, horizon_date, is_default)
     VALUES (?, ?, ?, ?, ?);`,
    id,
    userId,
    input.name.trim(),
    input.horizon_date,
    input.is_default ? 1 : 0,
  );
  bumpDataVersion();
  return id;
}

export async function updateScenario(
  id: string,
  patch: { name?: string; horizon_date?: string },
): Promise<void> {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) throw new Error("Scenario name cannot be empty");
    sets.push("name = ?");
    values.push(trimmed);
  }
  if (patch.horizon_date !== undefined) {
    assertISODate(patch.horizon_date, "horizon_date");
    sets.push("horizon_date = ?");
    values.push(patch.horizon_date);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  values.push(id);
  const db = getDatabase();
  await db.runAsync(
    `UPDATE simulation_scenarios SET ${sets.join(", ")} WHERE id = ?;`,
    ...values,
  );
  bumpDataVersion();
}

export async function duplicateScenario(id: string): Promise<string> {
  const db = getDatabase();
  const src = await getScenario(id);
  if (!src) throw new Error("Scenario not found");
  const newId = generateUUID();
  await db.runAsync(
    `INSERT INTO simulation_scenarios (id, user_id, name, horizon_date, is_default)
     VALUES (?, ?, ?, ?, 0);`,
    newId,
    src.user_id,
    `${src.name} (copy)`,
    src.horizon_date,
  );
  // Copy upcoming entries only — no point carrying fulfilled/stale/dismissed
  // into a fresh scenario.
  const entries = await db.getAllAsync<SimulationEntry>(
    `SELECT * FROM simulation_entries
     WHERE scenario_id = ? AND status = 'upcoming';`,
    id,
  );
  for (const e of entries) {
    const eid = generateUUID();
    await db.runAsync(
      `INSERT INTO simulation_entries
         (id, scenario_id, direction, amount, date, originally_planned_for,
          account_id, category_id, merchant_name, description,
          source, seed_source_id, status, hisaab_person_id, hisaab_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, 'upcoming', ?, ?);`,
      eid,
      newId,
      e.direction,
      e.amount,
      e.date,
      e.originally_planned_for,
      e.account_id,
      e.category_id,
      e.merchant_name,
      e.description,
      e.hisaab_person_id,
      e.hisaab_kind,
    );
  }
  // v16.0.5 — carry hisaab inclusions over into the new scenario. Users
  // expect "duplicate" to produce a full clone, including who they'd
  // planned to include.
  const inclusions = await db.getAllAsync<SimulationHisaabInclusion>(
    `SELECT scenario_id, person_id, included, amount, amount_sign, created_at, updated_at
     FROM simulation_hisaab_inclusions WHERE scenario_id = ?;`,
    id,
  );
  for (const incl of inclusions) {
    await db.runAsync(
      `INSERT INTO simulation_hisaab_inclusions
         (scenario_id, person_id, included, amount, amount_sign)
       VALUES (?, ?, ?, ?, ?);`,
      newId,
      incl.person_id,
      incl.included,
      incl.amount,
      incl.amount_sign,
    );
  }
  bumpDataVersion();
  return newId;
}

export async function archiveScenario(id: string): Promise<void> {
  const db = getDatabase();
  // v16.0.5 — dropped the is_default guard. v16.0.0 auto-created a
  // default scenario that users now can't remove if we block archive/
  // delete by flag. No auto-creation happens anymore so legacy defaults
  // are fair game.
  await db.runAsync(
    `UPDATE simulation_scenarios
     SET archived_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?;`,
    id,
  );
  bumpDataVersion();
}

export async function deleteScenario(id: string): Promise<void> {
  const db = getDatabase();
  // CASCADE deletes entries. v16.0.5 — is_default guard dropped (see
  // archiveScenario note).
  await db.runAsync(
    `DELETE FROM simulation_scenarios WHERE id = ?;`,
    id,
  );
  bumpDataVersion();
}

// ═══════════════════════════════════════════════════════════════════════
// Entry CRUD
// ═══════════════════════════════════════════════════════════════════════

export async function getEntriesForScenario(
  scenarioId: string,
): Promise<SimulationEntry[]> {
  const db = getDatabase();
  return db.getAllAsync<SimulationEntry>(
    `SELECT * FROM simulation_entries
     WHERE scenario_id = ?
     ORDER BY date ASC, created_at ASC;`,
    scenarioId,
  );
}

export async function createEntry(
  scenarioId: string,
  input: CreateEntryInput,
): Promise<string> {
  assertISODate(input.date, "date");
  if (!(Number.isFinite(input.amount) && input.amount > 0)) {
    throw new Error("Entry amount must be a positive number");
  }
  // v16.0.5 — hisaab integrity: person + kind travel together.
  if (input.hisaab_kind != null && !input.hisaab_person_id) {
    throw new Error("hisaab_kind requires hisaab_person_id");
  }
  if (input.hisaab_person_id && !input.hisaab_kind) {
    throw new Error("hisaab_person_id requires hisaab_kind");
  }
  if (input.hisaab_kind && input.hisaab_kind !== "collect" && input.hisaab_kind !== "payback") {
    throw new Error("hisaab_kind must be 'collect' or 'payback'");
  }
  const db = getDatabase();
  const id = generateUUID();
  await db.runAsync(
    `INSERT INTO simulation_entries
       (id, scenario_id, direction, amount, date,
        account_id, from_account_id, to_account_id, category_id, merchant_name, description,
        source, seed_source_id, status, hisaab_person_id, hisaab_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming', ?, ?);`,
    id,
    scenarioId,
    input.direction,
    input.amount,
    input.date,
    input.account_id ?? null,
    input.from_account_id ?? null,
    input.to_account_id ?? null,
    input.category_id ?? null,
    input.merchant_name ?? null,
    input.description ?? null,
    input.source ?? "manual",
    input.seed_source_id ?? null,
    input.hisaab_person_id ?? null,
    input.hisaab_kind ?? null,
  );
  // Bump parent scenario's updated_at so "sort by recency" flows work.
  await db.runAsync(
    `UPDATE simulation_scenarios SET updated_at = datetime('now') WHERE id = ?;`,
    scenarioId,
  );
  bumpDataVersion();
  return id;
}

export async function updateEntry(
  entryId: string,
  patch: UpdateEntryInput,
): Promise<void> {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.direction !== undefined) {
    if (patch.direction !== "out" && patch.direction !== "in") {
      throw new Error("direction must be 'out' or 'in'");
    }
    sets.push("direction = ?");
    values.push(patch.direction);
  }
  if (patch.amount !== undefined) {
    if (!(Number.isFinite(patch.amount) && patch.amount > 0)) {
      throw new Error("Entry amount must be a positive number");
    }
    sets.push("amount = ?");
    values.push(patch.amount);
  }
  if (patch.date !== undefined) {
    assertISODate(patch.date, "date");
    sets.push("date = ?");
    values.push(patch.date);
  }
  if (patch.account_id !== undefined) {
    sets.push("account_id = ?");
    values.push(patch.account_id);
  }
  if (patch.from_account_id !== undefined) {
    sets.push("from_account_id = ?");
    values.push(patch.from_account_id);
  }
  if (patch.to_account_id !== undefined) {
    sets.push("to_account_id = ?");
    values.push(patch.to_account_id);
  }
  if (patch.category_id !== undefined) {
    sets.push("category_id = ?");
    values.push(patch.category_id);
  }
  if (patch.merchant_name !== undefined) {
    sets.push("merchant_name = ?");
    values.push(patch.merchant_name);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    values.push(patch.description);
  }
  // v16.0.5 — hisaab fields update together
  if (patch.hisaab_person_id !== undefined) {
    sets.push("hisaab_person_id = ?");
    values.push(patch.hisaab_person_id);
  }
  if (patch.hisaab_kind !== undefined) {
    if (patch.hisaab_kind !== null && patch.hisaab_kind !== "collect" && patch.hisaab_kind !== "payback") {
      throw new Error("hisaab_kind must be 'collect' | 'payback' | null");
    }
    sets.push("hisaab_kind = ?");
    values.push(patch.hisaab_kind);
  }
  if (sets.length === 0) return;
  // v16.0.1 — if the user edits the date or amount on a stale entry, it's
  // implicitly a "give this entry another chance" action. Flip back to
  // upcoming so the engine picks it up and reconcileStaleEntries
  // re-evaluates. Mirror of rescheduleEntry's status reset.
  if (patch.date !== undefined || patch.amount !== undefined) {
    sets.push("status = 'upcoming'");
    sets.push("fulfilled_expense_id = NULL");
  }
  sets.push("updated_at = datetime('now')");
  values.push(entryId);
  const db = getDatabase();
  await db.runAsync(
    `UPDATE simulation_entries SET ${sets.join(", ")} WHERE id = ?;`,
    ...values,
  );
  if (patch.date !== undefined || patch.amount !== undefined) {
    await db.runAsync(
      `DELETE FROM simulation_entry_fulfillments WHERE entry_id = ?;`,
      entryId,
    );
  }
  bumpDataVersion();
}

export async function duplicateEntry(entryId: string): Promise<string> {
  const db = getDatabase();
  const src = await db.getFirstAsync<SimulationEntry>(
    `SELECT * FROM simulation_entries WHERE id = ?;`,
    entryId,
  );
  if (!src) throw new Error("Entry not found");
  const id = generateUUID();
  await db.runAsync(
    `INSERT INTO simulation_entries
       (id, scenario_id, direction, amount, date,
        account_id, category_id, merchant_name, description,
        source, seed_source_id, status, hisaab_person_id, hisaab_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, 'upcoming', ?, ?);`,
    id,
    src.scenario_id,
    src.direction,
    src.amount,
    src.date,
    src.account_id,
    src.category_id,
    src.merchant_name,
    src.description,
    src.hisaab_person_id,
    src.hisaab_kind,
  );
  bumpDataVersion();
  return id;
}

/**
 * Move a stale entry to a new future date. Records the original date in
 * `originally_planned_for` (only on the first reschedule — subsequent
 * reschedules preserve the very first original). Status back to 'upcoming'.
 */
export async function rescheduleEntry(
  entryId: string,
  newDate: string,
): Promise<void> {
  assertISODate(newDate, "newDate");
  const db = getDatabase();
  const src = await db.getFirstAsync<SimulationEntry>(
    `SELECT date, originally_planned_for FROM simulation_entries WHERE id = ?;`,
    entryId,
  );
  if (!src) return;
  const origForAudit = src.originally_planned_for ?? src.date;
  await db.runAsync(
    `UPDATE simulation_entries
     SET date = ?,
         originally_planned_for = ?,
         status = 'upcoming',
         fulfilled_expense_id = NULL,
         updated_at = datetime('now')
     WHERE id = ?;`,
    newDate,
    origForAudit,
    entryId,
  );
  await db.runAsync(
    `DELETE FROM simulation_entry_fulfillments WHERE entry_id = ?;`,
    entryId,
  );
  bumpDataVersion();
}

export async function fulfillEntry(
  entryId: string,
  expenseId: string,
): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE simulation_entries
       SET status = 'fulfilled',
           fulfilled_expense_id = ?,
           updated_at = datetime('now')
       WHERE id = ?;`,
      expenseId,
      entryId,
    );
    const id = generateUUID();
    await db.runAsync(
      `INSERT OR IGNORE INTO simulation_entry_fulfillments (id, entry_id, expense_id)
       VALUES (?, ?, ?);`,
      id, entryId, expenseId,
    );
  });
  bumpDataVersion();
}

export async function fulfillEntryMulti(
  entryId: string,
  expenseIds: string[],
): Promise<void> {
  if (expenseIds.length === 0) return;
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    for (const expenseId of expenseIds) {
      const id = generateUUID();
      await db.runAsync(
        `INSERT OR IGNORE INTO simulation_entry_fulfillments (id, entry_id, expense_id)
         VALUES (?, ?, ?);`,
        id, entryId, expenseId,
      );
    }
    await db.runAsync(
      `UPDATE simulation_entries
       SET status = 'fulfilled',
           fulfilled_expense_id = ?,
           updated_at = datetime('now')
       WHERE id = ?;`,
      expenseIds[0],
      entryId,
    );
  });
  bumpDataVersion();
}

export interface EntryFulfillment {
  id: string;
  expense_id: string;
  amount: number;
  date: string;
  description: string | null;
  merchant_name: string | null;
}

export async function getEntryFulfillments(entryId: string): Promise<EntryFulfillment[]> {
  const db = getDatabase();
  const links = await db.getAllAsync<{ id: string; expense_id: string }>(
    `SELECT id, expense_id FROM simulation_entry_fulfillments WHERE entry_id = ?;`,
    entryId,
  );
  if (links.length === 0) {
    const entry = await db.getFirstAsync<{ fulfilled_expense_id: string | null }>(
      `SELECT fulfilled_expense_id FROM simulation_entries WHERE id = ?;`,
      entryId,
    );
    if (!entry?.fulfilled_expense_id) return [];
    const exp = await db.getFirstAsync<{ amount: number; date: string; description: string | null; merchant_name: string | null }>(
      `SELECT amount, date, description, merchant_name FROM expenses WHERE id = ? AND deleted_at IS NULL;`,
      entry.fulfilled_expense_id,
    );
    if (exp) return [{ id: "legacy", expense_id: entry.fulfilled_expense_id, ...exp }];
    return [];
  }
  const results: EntryFulfillment[] = [];
  for (const link of links) {
    const exp = await db.getFirstAsync<{ amount: number; date: string; description: string | null; merchant_name: string | null }>(
      `SELECT amount, date, description, merchant_name FROM expenses WHERE id = ? AND deleted_at IS NULL;`,
      link.expense_id,
    );
    if (exp) {
      results.push({ id: link.id, expense_id: link.expense_id, ...exp });
    }
  }
  return results;
}

export interface FulfilledSummary {
  totalPlanned: number;
  totalActual: number;
  variance: number;
  entries: Array<{
    entryId: string;
    planned: number;
    actual: number;
    variance: number;
    description: string | null;
    merchant_name: string | null;
  }>;
}

export async function getFulfilledSummary(scenarioId: string): Promise<FulfilledSummary> {
  const db = getDatabase();
  const fulfilled = await db.getAllAsync<SimulationEntry>(
    `SELECT * FROM simulation_entries WHERE scenario_id = ? AND status = 'fulfilled';`,
    scenarioId,
  );
  let totalPlanned = 0;
  let totalActual = 0;
  const entries: FulfilledSummary["entries"] = [];
  for (const entry of fulfilled) {
    const fulfillments = await getEntryFulfillments(entry.id);
    const actual = fulfillments.reduce((s, f) => s + f.amount, 0);
    totalPlanned += entry.amount;
    totalActual += actual;
    entries.push({
      entryId: entry.id,
      planned: entry.amount,
      actual,
      variance: actual - entry.amount,
      description: entry.description,
      merchant_name: entry.merchant_name,
    });
  }
  return { totalPlanned, totalActual, variance: totalActual - totalPlanned, entries };
}

export async function dismissEntry(entryId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE simulation_entries
     SET status = 'dismissed', updated_at = datetime('now')
     WHERE id = ?;`,
    entryId,
  );
  bumpDataVersion();
}

export async function deleteEntry(entryId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `DELETE FROM simulation_entries WHERE id = ?;`,
    entryId,
  );
  bumpDataVersion();
}

// ═══════════════════════════════════════════════════════════════════════
// Seeding
// ═══════════════════════════════════════════════════════════════════════

/**
 * Populate a scenario with active reminders + open CC repayment forecasts
 * whose target date falls within [today, horizon]. Idempotent — entries
 * with the same (scenario_id, seed_source_id) are skipped.
 * Returns the count of newly-added entries.
 */
export async function seedScenarioFromReminders(
  scenarioId: string,
  userId: string,
): Promise<number> {
  const db = getDatabase();
  const scenario = await getScenario(scenarioId);
  if (!scenario) return 0;
  const today = todayIso();
  let added = 0;

  // 1. Active recurring reminders
  const reminders = await db.getAllAsync<{
    rule_id: string;
    due_date: string;
    amount: number;
    merchant: string | null;
    account_id: string | null;
    category_id: string | null;
  }>(
    `SELECT r.id as rule_id,
            r.next_due_date as due_date,
            e.amount as amount,
            e.merchant_name as merchant,
            e.account_id as account_id,
            e.category_id as category_id
     FROM recurring_expense_rules r
     INNER JOIN expenses e ON e.id = r.source_expense_id
     WHERE r.user_id = ?
       AND r.is_active = 1
       AND r.next_due_date IS NOT NULL
       AND r.next_due_date >= ?
       AND r.next_due_date <= ?
       AND e.deleted_at IS NULL;`,
    userId,
    today,
    scenario.horizon_date,
  );

  for (const r of reminders) {
    const existing = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM simulation_entries
       WHERE scenario_id = ? AND seed_source_id = ? AND source = 'seeded_reminder';`,
      scenarioId,
      r.rule_id,
    );
    if (existing) continue;
    await createEntry(scenarioId, {
      direction: "out",
      amount: r.amount,
      date: r.due_date,
      account_id: r.account_id,
      category_id: r.category_id,
      merchant_name: r.merchant,
      description: r.merchant ? `${r.merchant} · planned from reminder` : "Planned from reminder",
      source: "seeded_reminder",
      seed_source_id: r.rule_id,
    });
    added++;
  }

  // 2. Open CC repayment forecasts within horizon
  const forecasts = await db.getAllAsync<{
    id: string;
    amount: number;
    due_date: string;
    account_id: string | null;
    merchant: string | null;
  }>(
    `SELECT id, amount, due_date, account_id, merchant_name as merchant
     FROM expenses
     WHERE user_id = ?
       AND nature = 'forecast'
       AND forecast_type = 'repayment'
       AND status != 'rejected'
       AND deleted_at IS NULL
       AND due_date IS NOT NULL
       AND due_date >= ?
       AND due_date <= ?;`,
    userId,
    today,
    scenario.horizon_date,
  );

  for (const f of forecasts) {
    const existing = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM simulation_entries
       WHERE scenario_id = ? AND seed_source_id = ? AND source = 'seeded_forecast';`,
      scenarioId,
      f.id,
    );
    if (existing) continue;
    await createEntry(scenarioId, {
      direction: "out",
      amount: f.amount,
      date: f.due_date,
      account_id: f.account_id,
      description: f.merchant ? `CC bill · ${f.merchant}` : "CC bill payment",
      source: "seeded_forecast",
      seed_source_id: f.id,
    });
    added++;
  }

  return added;
}

// ═══════════════════════════════════════════════════════════════════════
// Fulfillment reconciliation
// ═══════════════════════════════════════════════════════════════════════

/**
 * For every past-date entry still in 'upcoming', try to match a real
 * expense / credit within ±3 days, ±5%. Matches → fulfilled with the link;
 * no-match → stale (user resolves via UI).
 */
export async function reconcileStaleEntries(
  scenarioId: string,
  userId: string,
): Promise<{ fulfilled: number; stale: number }> {
  const db = getDatabase();
  const today = todayIso();

  const upcoming = await db.getAllAsync<SimulationEntry>(
    `SELECT * FROM simulation_entries
     WHERE scenario_id = ? AND status = 'upcoming' AND date < ?;`,
    scenarioId,
    today,
  );

  if (upcoming.length === 0) return { fulfilled: 0, stale: 0 };

  // Candidate real transactions — broad fetch across the widest window
  // we'll need (oldest entry date − 3 days → today). Then filter in-memory
  // via findFulfillmentCandidate.
  const oldestDate = upcoming.reduce(
    (min, e) => (e.date < min ? e.date : min),
    upcoming[0].date,
  );
  // Expand window by 3 days on each side.
  const windowStart = addDays(oldestDate, -3);
  const windowEnd = addDays(today, 3);

  const realRows = await db.getAllAsync<{
    id: string;
    amount: number;
    date: string;
    account_id: string | null;
  }>(
    `SELECT id, amount, date, account_id
     FROM expenses
     WHERE user_id = ?
       AND nature IN ('realized','credit')
       AND deleted_at IS NULL
       AND date >= ?
       AND date <= ?;`,
    userId,
    windowStart,
    windowEnd,
  );
  const transferRows = await db.getAllAsync<{
    id: string;
    amount: number;
    date: string;
    to_account_id: string | null;
    from_account_id: string | null;
  }>(
    `SELECT id, amount, date, to_account_id, from_account_id
     FROM account_transfers
     WHERE user_id = ?
       AND deleted_at IS NULL
       AND date >= ?
       AND date <= ?;`,
    userId,
    windowStart,
    windowEnd,
  );

  // Transfer can serve as either side: from-account is outflow, to-account
  // is inflow. Encode both.
  const candidates: FulfillmentCandidate[] = [
    ...realRows.map((r) => ({
      id: r.id,
      amount: r.amount,
      date: r.date,
      account_id: r.account_id,
    })),
    ...transferRows.flatMap((t) => {
      const rows: FulfillmentCandidate[] = [];
      if (t.from_account_id) {
        rows.push({ id: t.id, amount: t.amount, date: t.date, account_id: t.from_account_id });
      }
      if (t.to_account_id) {
        rows.push({ id: t.id, amount: t.amount, date: t.date, account_id: t.to_account_id });
      }
      return rows;
    }),
  ];

  // v16.0.1 — a real transaction can only fulfill ONE simulator entry. Track
  // claimed ids so two planned entries can't both link to the same
  // transaction (common case: a transfer shows up twice in `candidates`,
  // once per account side; without this guard, both sides could fulfill
  // separate entries).
  const claimedRealIds = new Set<string>();

  let fulfilled = 0;
  let stale = 0;
  for (const entry of upcoming) {
    const eligible = candidates.filter((c) => !claimedRealIds.has(c.id));
    const match = findFulfillmentCandidate(
      {
        id: entry.id,
        direction: entry.direction,
        amount: entry.amount,
        date: entry.date,
        accountId: entry.account_id ?? undefined,
      },
      eligible,
    );
    if (match) {
      claimedRealIds.add(match.id);
      await fulfillEntry(entry.id, match.id);
      fulfilled++;
    } else {
      await db.runAsync(
        `UPDATE simulation_entries
         SET status = 'stale', updated_at = datetime('now')
         WHERE id = ?;`,
        entry.id,
      );
      stale++;
    }
  }

  if (fulfilled + stale > 0) bumpDataVersion();
  return { fulfilled, stale };
}

// ═══════════════════════════════════════════════════════════════════════
// Retention — runs on simulator open
// ═══════════════════════════════════════════════════════════════════════

export async function purgeRetention(userId: string): Promise<void> {
  const db = getDatabase();
  let changes = 0;

  // Pass 1 — hard-delete fulfilled/dismissed entries whose scenario's
  // horizon passed > 30 days ago.
  const pass1 = await db.runAsync(
    `DELETE FROM simulation_entries
     WHERE id IN (
       SELECT se.id FROM simulation_entries se
       INNER JOIN simulation_scenarios ss ON ss.id = se.scenario_id
       WHERE ss.user_id = ?
         AND se.status IN ('fulfilled','dismissed')
         AND ss.horizon_date < date('now','-30 days')
     );`,
    userId,
  );
  changes += pass1.changes ?? 0;

  // Pass 2 — archive scenarios whose horizon is > 90 days old.
  // v16.0.5 — is_default guard dropped; no new defaults are created.
  const pass2 = await db.runAsync(
    `UPDATE simulation_scenarios
     SET archived_at = datetime('now'), updated_at = datetime('now')
     WHERE user_id = ?
       AND archived_at IS NULL
       AND horizon_date < date('now','-90 days');`,
    userId,
  );
  changes += pass2.changes ?? 0;

  // Pass 3 — hard-delete scenarios that have both crossed the
  // 180-day-horizon threshold AND sat in archived state for >= 90 days.
  const pass3 = await db.runAsync(
    `DELETE FROM simulation_scenarios
     WHERE user_id = ?
       AND horizon_date < date('now','-180 days')
       AND archived_at IS NOT NULL
       AND archived_at < datetime('now','-90 days');`,
    userId,
  );
  changes += pass3.changes ?? 0;

  // v16.0.1 — only cascade a data-version bump when something actually
  // changed. Before, this fired on every simulator open and churned every
  // `useDataRefresh` subscriber across the app.
  if (changes > 0) bumpDataVersion();
}

// ═══════════════════════════════════════════════════════════════════════
// Baseline balances
// ═══════════════════════════════════════════════════════════════════════

/**
 * Compute today's balance for every active account the simulator cares
 * about. v16.0.4 — narrowed further:
 *
 *  - savings / wallet / credit_card — month opening + month-to-date
 *    realized activity, stopped at TODAY so future-dated real entries
 *    don't falsely reduce the starting balance.
 *
 * DELIBERATELY EXCLUDED:
 *  - loan — principal doesn't move from cash-flow entries; user feedback
 *    said they don't want loans shaping the starting balance.
 *  - demat — investment asset, no entry-driven flow.
 *  - pension — passive asset.
 *  - hisaab — not an account; it's person-to-person owings.
 */
export async function computeBaselineBalances(
  userId: string,
): Promise<BaselineAccount[]> {
  const accounts = await getActiveAccounts(userId);
  if (accounts.length === 0) return [];

  // Only ask for balances on accounts we actually include. Keeps the query
  // small and avoids computing demat / loan balances we'd ignore anyway.
  const includedAccounts = accounts.filter(
    (a) => a.account_type === "savings"
      || a.account_type === "wallet"
      || a.account_type === "credit_card",
  );
  if (includedAccounts.length === 0) return [];

  const ids = includedAccounts.map((a) => a.id);
  // v16.0.4 — use an as-of-today balance, not the full month close. If the
  // user has a future-dated real expense in the ledger (e.g. a scheduled
  // transaction logged early), the old path counted it against the
  // starting balance even though it hasn't actually happened. Stop at
  // today so the starting balance matches what the Home tab shows.
  const balanceMap = await getComputedBalancesAsOfToday(ids);

  const baseline: BaselineAccount[] = [];

  for (const a of includedAccounts) {
    const label = a.account_label ?? `${a.bank_name} ••${a.account_identifier}`;
    const extra = extraFields(a);
    const bal = balanceMap[a.id];
    if (bal == null) continue; // unseeded (no month_balance yet)
    baseline.push({
      id: a.id,
      label,
      type: a.account_type,
      balance: Math.round(bal * 100) / 100,
      ...extra,
    });
  }

  return baseline;
}

/**
 * Like getComputedBalances but stops at today's date — excludes any
 * real-ledger entries dated later in the current month. v16.0.4.
 *
 * Performs the same opening + expenses + credits + transfers + adjustments
 * math as the shared helper, but scoped to [startOfMonth, today].
 */
async function getComputedBalancesAsOfToday(
  accountIds: string[],
): Promise<Record<string, number | null>> {
  if (accountIds.length === 0) return {};
  const db = getDatabase();
  const today = todayIso();
  const monthStart = `${today.slice(0, 7)}-01`;
  const placeholders = accountIds.map(() => "?").join(",");

  // Opening balances for current month
  const openings = await db.getAllAsync<{ account_id: string; opening_balance: number }>(
    `SELECT account_id, opening_balance FROM account_month_balances
     WHERE month = ? AND account_id IN (${placeholders});`,
    today.slice(0, 7),
    ...accountIds,
  );
  const openingMap = new Map(openings.map((r) => [r.account_id, r.opening_balance]));

  // Realized expenses MTD (start of month → today)
  const expenseRows = await db.getAllAsync<{ account_id: string; total: number | null }>(
    `SELECT account_id, SUM(COALESCE(split_original_amount, amount)) as total FROM expenses
     WHERE account_id IN (${placeholders}) AND deleted_at IS NULL
       AND nature = 'realized' AND status = 'approved'
       AND date >= ? AND date <= ?
     GROUP BY account_id;`,
    ...accountIds,
    monthStart,
    today,
  );
  const expenseMap = new Map(expenseRows.map((r) => [r.account_id, r.total ?? 0]));

  const creditRows = await db.getAllAsync<{ account_id: string; total: number | null }>(
    `SELECT account_id, SUM(amount) as total FROM expenses
     WHERE account_id IN (${placeholders}) AND deleted_at IS NULL
       AND nature = 'credit' AND status = 'approved'
       AND date >= ? AND date <= ?
     GROUP BY account_id;`,
    ...accountIds,
    monthStart,
    today,
  );
  const creditMap = new Map(creditRows.map((r) => [r.account_id, r.total ?? 0]));

  const transfersOut = await db.getAllAsync<{ from_account_id: string; total: number | null }>(
    `SELECT from_account_id, SUM(amount) as total FROM account_transfers
     WHERE from_account_id IN (${placeholders}) AND deleted_at IS NULL
       AND date >= ? AND date <= ?
     GROUP BY from_account_id;`,
    ...accountIds,
    monthStart,
    today,
  );
  const transfersOutMap = new Map(transfersOut.map((r) => [r.from_account_id, r.total ?? 0]));

  const transfersIn = await db.getAllAsync<{ to_account_id: string; total: number | null }>(
    `SELECT to_account_id, SUM(amount) as total FROM account_transfers
     WHERE to_account_id IN (${placeholders}) AND deleted_at IS NULL
       AND date >= ? AND date <= ?
     GROUP BY to_account_id;`,
    ...accountIds,
    monthStart,
    today,
  );
  const transfersInMap = new Map(transfersIn.map((r) => [r.to_account_id, r.total ?? 0]));

  const adjustmentRows = await db.getAllAsync<{ account_id: string; amount: number; description: string | null }>(
    `SELECT account_id, amount, description FROM expenses
     WHERE account_id IN (${placeholders}) AND deleted_at IS NULL
       AND nature = 'ledger_adjustment' AND status = 'approved'
       AND date >= ? AND date <= ?;`,
    ...accountIds,
    monthStart,
    today,
  );
  const adjustmentMap = new Map<string, number>();
  for (const r of adjustmentRows) {
    const isNeg = (r.description ?? "").includes(" -]");
    const delta = isNeg ? -r.amount : r.amount;
    adjustmentMap.set(r.account_id, (adjustmentMap.get(r.account_id) ?? 0) + delta);
  }

  const types = await db.getAllAsync<{ id: string; account_type: string }>(
    `SELECT id, account_type FROM financial_accounts WHERE id IN (${placeholders});`,
    ...accountIds,
  );
  const typeMap = new Map(types.map((r) => [r.id, r.account_type]));

  const result: Record<string, number | null> = {};
  for (const id of accountIds) {
    const opening = openingMap.get(id);
    if (opening === undefined) {
      result[id] = null;
      continue;
    }
    const expenses = expenseMap.get(id) ?? 0;
    const credits = creditMap.get(id) ?? 0;
    const tOut = transfersOutMap.get(id) ?? 0;
    const tIn = transfersInMap.get(id) ?? 0;
    const adjNet = adjustmentMap.get(id) ?? 0;
    const isCC = typeMap.get(id) === "credit_card";
    // Mirror of computeClosing in services/account-balance.ts.
    // For CC (utilized model): opening + expenses − credits + tOut − tIn + adjNet
    // For others:              opening − expenses + credits − tOut + tIn + adjNet
    const closing = isCC
      ? opening + expenses - credits + tOut - tIn + adjNet
      : opening - expenses + credits - tOut + tIn + adjNet;
    result[id] = Math.round(closing * 100) / 100;
  }
  return result;
}

function extraFields(a: FinancialAccount): Partial<BaselineAccount> {
  const out: Partial<BaselineAccount> = {};
  if (a.account_type === "savings" && a.min_balance && a.min_balance > 0) {
    out.minBalance = a.min_balance;
  }
  if (a.account_type === "credit_card" && a.credit_limit && a.credit_limit > 0) {
    out.creditLimit = a.credit_limit;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// Overview — one-shot read for the detail screen
// ═══════════════════════════════════════════════════════════════════════

/**
 * Returns everything the scenario detail screen needs: the scenario row,
 * baseline balances, entries grouped by status, and the full simulation
 * output (trajectory + warnings). Runs `reconcileStaleEntries` first so
 * past-date entries are correctly categorised.
 */
/**
 * v17.5.3 — batch overviews for the scenario list. Computes baseline ONCE
 * (identical across all scenarios) and threads it into per-scenario
 * overview math. Drops fan-out from 4 queries × N scenarios to
 * (3 baseline queries + 2 queries × N scenarios) which is a meaningful
 * speedup once N ≥ 3.
 */
export async function getScenarioOverviewsBatch(
  scenarioIds: string[],
  userId: string,
  options: { skipReconcile?: boolean } = {},
): Promise<Map<string, ScenarioOverview>> {
  const map = new Map<string, ScenarioOverview>();
  if (scenarioIds.length === 0) return map;

  // Reconcile per-scenario first (unchanged behavior when skipReconcile=false)
  if (!options.skipReconcile) {
    await Promise.all(
      scenarioIds.map((id) => reconcileStaleEntries(id, userId)),
    );
  }

  // Shared baseline — same for every scenario.
  const baseline = await computeBaselineBalances(userId);

  // Per-scenario overview assembly in parallel.
  await Promise.all(
    scenarioIds.map(async (id) => {
      const scenario = await getScenario(id);
      if (!scenario) return;
      const [entries, hisaabIncluded] = await Promise.all([
        getEntriesForScenario(id),
        listHisaabInclusions(id),
      ]);
      const upcoming: SimulationEntry[] = [];
      const stale: SimulationEntry[] = [];
      const fulfilled: SimulationEntry[] = [];
      const dismissed: SimulationEntry[] = [];
      for (const e of entries) {
        if (e.status === "upcoming") upcoming.push(e);
        else if (e.status === "stale") stale.push(e);
        else if (e.status === "fulfilled") fulfilled.push(e);
        else dismissed.push(e);
      }
      const simulation = runSimulation({
        startBalances: baseline,
        entries: upcoming.map<EngineEntry>((e) => ({
          id: e.id,
          direction: e.direction,
          amount: e.amount,
          date: e.date,
          accountId: e.account_id ?? undefined,
        })),
        horizonDate: scenario.horizon_date,
        todayDate: todayIso(),
      });
      map.set(id, {
        scenario,
        baseline,
        entries: { upcoming, stale, fulfilled, dismissed },
        simulation,
        hisaabIncluded,
      });
    }),
  );
  return map;
}

export async function getScenarioOverview(
  scenarioId: string,
  userId: string,
  options: { skipReconcile?: boolean } = {},
): Promise<ScenarioOverview | null> {
  const scenario = await getScenario(scenarioId);
  if (!scenario) return null;

  // v16.0.1 — reconciliation is the expensive part (2 SQL scans over
  // expenses + account_transfers in a ~6-day window). The scenario LIST
  // pre-computes N overviews to render warning pills; forcing reconcile
  // each time means N × 2 scans every list load. For the list we skip it
  // and rely on whatever status each entry already has.
  if (!options.skipReconcile) {
    await reconcileStaleEntries(scenarioId, userId);
  }

  const [baseline, entries] = await Promise.all([
    computeBaselineBalances(userId),
    getEntriesForScenario(scenarioId),
  ]);

  const upcoming: SimulationEntry[] = [];
  const stale: SimulationEntry[] = [];
  const fulfilled: SimulationEntry[] = [];
  const dismissed: SimulationEntry[] = [];
  for (const e of entries) {
    if (e.status === "upcoming") upcoming.push(e);
    else if (e.status === "stale") stale.push(e);
    else if (e.status === "fulfilled") fulfilled.push(e);
    else dismissed.push(e);
  }

  const engineInput = {
    startBalances: baseline,
    entries: upcoming.map<EngineEntry>((e) => ({
      id: e.id,
      direction: e.direction,
      amount: e.amount,
      date: e.date,
      accountId: e.account_id ?? undefined,
      fromAccountId: e.from_account_id ?? undefined,
      toAccountId: e.to_account_id ?? undefined,
    })),
    horizonDate: scenario.horizon_date,
    todayDate: todayIso(),
  };
  const simulation = runSimulation(engineInput);

  // v16.0.5 — hisaab inclusions.
  const hisaabIncluded = await listHisaabInclusions(scenarioId);

  return {
    scenario,
    baseline,
    entries: { upcoming, stale, fulfilled, dismissed },
    simulation,
    hisaabIncluded,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Hisaab inclusions — v16.0.5
// ═══════════════════════════════════════════════════════════════════════

/**
 * Candidates for the Starting Balance drawer's hisaab section. Returns
 * every active hisaab person whose current balance is non-zero, paired
 * with the existing inclusion row (if any) for this scenario. The UI uses
 * `currentBalance` to cap the rupee input and to default new rows to the
 * full balance.
 */
export async function listHisaabInclusionCandidates(
  scenarioId: string,
  userId: string,
): Promise<HisaabInclusionCandidate[]> {
  const db = getDatabase();
  // Balance formula mirrors hisaab.ts:getPersonsWithBalances exactly —
  // initial_balance + debits − (credits + settlements), excluding entries
  // whose linked expense is soft-deleted.
  const rows = await db.getAllAsync<{
    person_id: string;
    person_name: string;
    balance: number;
    inclusion_included: number | null;
    inclusion_amount: number | null;
    inclusion_sign: string | null;
    inclusion_created: string | null;
    inclusion_updated: string | null;
  }>(
    `SELECT
       hp.id as person_id,
       hp.name as person_name,
       COALESCE(hp.initial_balance, 0)
         + COALESCE(SUM(CASE WHEN he.type = 'debit' THEN he.amount ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN he.type IN ('credit','settlement') THEN he.amount ELSE 0 END), 0)
         as balance,
       shi.included as inclusion_included,
       shi.amount as inclusion_amount,
       shi.amount_sign as inclusion_sign,
       shi.created_at as inclusion_created,
       shi.updated_at as inclusion_updated
     FROM hisaab_persons hp
     LEFT JOIN hisaab_entries he ON hp.id = he.hisaab_person_id
       AND (he.linked_expense_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM expenses x WHERE x.id = he.linked_expense_id AND x.deleted_at IS NOT NULL
       ))
     LEFT JOIN simulation_hisaab_inclusions shi
       ON shi.person_id = hp.id AND shi.scenario_id = ?
     WHERE hp.owner_user_id = ? AND hp.is_active = 1
     GROUP BY hp.id
     ORDER BY ABS(
       COALESCE(hp.initial_balance, 0)
         + COALESCE(SUM(CASE WHEN he.type = 'debit' THEN he.amount ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN he.type IN ('credit','settlement') THEN he.amount ELSE 0 END), 0)
     ) DESC, hp.name ASC;`,
    scenarioId,
    userId,
  );

  return rows
    .filter((r) => Math.abs(r.balance) > 0.01)
    .map<HisaabInclusionCandidate>((r) => ({
      personId: r.person_id,
      personName: r.person_name,
      currentBalance: Math.round(r.balance * 100) / 100,
      inclusion: r.inclusion_amount != null && r.inclusion_sign != null
        ? {
            scenario_id: scenarioId,
            person_id: r.person_id,
            included: r.inclusion_included ?? 1,
            amount: r.inclusion_amount,
            amount_sign: r.inclusion_sign === "negative" ? "negative" : "positive",
            created_at: r.inclusion_created ?? "",
            updated_at: r.inclusion_updated ?? "",
          }
        : null,
    }));
}

/** Fetch just the active (included=1) inclusions for a scenario. */
export async function listHisaabInclusions(
  scenarioId: string,
): Promise<SimulationHisaabInclusion[]> {
  const db = getDatabase();
  return db.getAllAsync<SimulationHisaabInclusion>(
    `SELECT scenario_id, person_id, included, amount, amount_sign, created_at, updated_at
     FROM simulation_hisaab_inclusions
     WHERE scenario_id = ? AND included = 1;`,
    scenarioId,
  );
}

/**
 * Upsert an inclusion row. `amount` is always positive; `sign` carries
 * direction. If `amount` is 0 or `included = false`, we keep the row but
 * mark it inactive so the user's last-entered value isn't lost when they
 * toggle.
 */
export async function upsertHisaabInclusion(input: {
  scenarioId: string;
  personId: string;
  included: boolean;
  amount: number;
  sign: "positive" | "negative";
}): Promise<void> {
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw new Error("Inclusion amount must be a non-negative number");
  }
  if (input.sign !== "positive" && input.sign !== "negative") {
    throw new Error("sign must be 'positive' or 'negative'");
  }
  const db = getDatabase();
  const existing = await db.getFirstAsync<{ scenario_id: string }>(
    `SELECT scenario_id FROM simulation_hisaab_inclusions
     WHERE scenario_id = ? AND person_id = ?;`,
    input.scenarioId,
    input.personId,
  );
  if (existing) {
    await db.runAsync(
      `UPDATE simulation_hisaab_inclusions
       SET included = ?, amount = ?, amount_sign = ?, updated_at = datetime('now')
       WHERE scenario_id = ? AND person_id = ?;`,
      input.included ? 1 : 0,
      Math.round(input.amount * 100) / 100,
      input.sign,
      input.scenarioId,
      input.personId,
    );
  } else {
    await db.runAsync(
      `INSERT INTO simulation_hisaab_inclusions
         (scenario_id, person_id, included, amount, amount_sign)
       VALUES (?, ?, ?, ?, ?);`,
      input.scenarioId,
      input.personId,
      input.included ? 1 : 0,
      Math.round(input.amount * 100) / 100,
      input.sign,
    );
  }
  bumpDataVersion();
}

export async function removeHisaabInclusion(
  scenarioId: string,
  personId: string,
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `DELETE FROM simulation_hisaab_inclusions
     WHERE scenario_id = ? AND person_id = ?;`,
    scenarioId,
    personId,
  );
  bumpDataVersion();
}
