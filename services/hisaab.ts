/**
 * Hisaab (Family Ledger) Service — Task 15.0
 *
 * Manages family/friend running accounts. Each person has a ledger
 * of debits (you paid for them) and credits (they paid you back).
 *
 * Running balance = initial_balance + SUM(debits) - SUM(credits) - SUM(settlements)
 * Positive = they owe you, Negative = you owe them.
 */

import { getDatabase } from "@/database";
import { bumpDataVersion } from "@/services/settings";
import { generateUUID } from "@/utils/uuid";

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

export interface HisaabPerson {
  id: string;
  owner_user_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  initial_balance: number;
  notes: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface HisaabEntry {
  id: string;
  hisaab_person_id: string;
  amount: number;
  description: string | null;
  date: string;
  type: "debit" | "credit" | "settlement";
  status: "confirmed" | "pending" | "disputed";
  linked_expense_id: string | null;
  category_id: string | null;
  merchant_name: string | null;
  linked_account_credit_id: string | null;
  /**
   * Provenance for settlement entries:
   *   'created' — settlement was created first via recordSettlement(); if it
   *               created a linked credit, deleting this entry cascades to
   *               that credit.
   *   'linked'  — settlement was stamped onto a pre-existing real credit via
   *               linkCreditAsSettlement(). Deleting this entry only unlinks;
   *               the underlying credit stays.
   * Only meaningful for type='settlement'.
   */
  settlement_source: "created" | "linked";
  created_at: string;
  updated_at: string;
}

export interface HisaabPersonWithBalance extends HisaabPerson {
  /** Running balance: positive = they owe you */
  balance: number;
  /** Count of entries */
  entryCount: number;
  /** Date of most recent entry */
  lastEntryDate: string | null;
}

export interface CreatePersonInput {
  owner_user_id: string;
  name: string;
  phone?: string;
  email?: string;
  initial_balance?: number;
  notes?: string;
}

export interface CreateEntryInput {
  hisaab_person_id: string;
  amount: number;
  description?: string;
  date: string;
  type: "debit" | "credit" | "settlement";
  linked_expense_id?: string;
}

// ═══════════════════════════════════════════════
// Person CRUD
// ═══════════════════════════════════════════════

/**
 * Create a new hisaab person (family member/friend).
 */
export async function createPerson(input: CreatePersonInput): Promise<string> {
  const db = getDatabase();
  const id = generateUUID();

  await db.runAsync(
    `INSERT INTO hisaab_persons (id, owner_user_id, name, phone, email, initial_balance, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    id,
    input.owner_user_id,
    input.name,
    input.phone ?? null,
    input.email ?? null,
    input.initial_balance ?? 0,
    input.notes ?? null,
  );

  bumpDataVersion();
  return id;
}

/**
 * Update a hisaab person's details.
 */
export async function updatePerson(
  id: string,
  updates: Partial<Pick<HisaabPerson, "name" | "phone" | "email" | "initial_balance" | "notes">>,
): Promise<void> {
  const db = getDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.name !== undefined) { fields.push("name = ?"); values.push(updates.name); }
  if (updates.phone !== undefined) { fields.push("phone = ?"); values.push(updates.phone); }
  if (updates.email !== undefined) { fields.push("email = ?"); values.push(updates.email); }
  if (updates.initial_balance !== undefined) { fields.push("initial_balance = ?"); values.push(updates.initial_balance); }
  if (updates.notes !== undefined) { fields.push("notes = ?"); values.push(updates.notes); }

  if (fields.length === 0) return;

  const now = new Date().toISOString(); // Local time in ISO format
  fields.push("updated_at = ?");
  values.push(now);
  values.push(id);

  await db.runAsync(
    `UPDATE hisaab_persons SET ${fields.join(", ")} WHERE id = ?;`,
    ...values,
  );

  bumpDataVersion();
}

/**
 * Deactivate a person (soft delete).
 */
export async function deactivateHisaabPerson(id: string): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString(); // Local time in ISO format
  await db.runAsync(
    `UPDATE hisaab_persons SET is_active = 0, updated_at = ? WHERE id = ?;`,
    now,
    id,
  );

  bumpDataVersion();
}

/**
 * Get all inactive (soft-deleted) persons for the recycle bin.
 */
export async function getInactivePersons(userId: string): Promise<HisaabPerson[]> {
  const db = getDatabase();
  return db.getAllAsync<HisaabPerson>(
    "SELECT * FROM hisaab_persons WHERE owner_user_id = ? AND is_active = 0 ORDER BY name ASC;",
    userId,
  );
}

/**
 * Restore a deactivated person.
 */
export async function restorePerson(id: string): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString(); // Local time in ISO format
  await db.runAsync(
    "UPDATE hisaab_persons SET is_active = 1, updated_at = ? WHERE id = ?;",
    now,
    id,
  );
  bumpDataVersion();
}

/**
 * Restore all inactive persons for a user.
 */
export async function restoreAllPersons(userId: string): Promise<number> {
  const db = getDatabase();
  const now = new Date().toISOString(); // Local time in ISO format
  const result = await db.runAsync(
    "UPDATE hisaab_persons SET is_active = 1, updated_at = ? WHERE owner_user_id = ? AND is_active = 0;",
    now,
    userId,
  );
  if (result.changes > 0) bumpDataVersion();
  return result.changes;
}

/**
 * Permanently delete an inactive person and all their entries.
 */
export async function hardDeletePerson(id: string): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    // Delete hisaab entries created by multi-splits for this person (before deleting splits)
    await db.runAsync(
      "DELETE FROM hisaab_entries WHERE id IN (SELECT hisaab_entry_id FROM expense_splits WHERE hisaab_person_id = ? AND hisaab_entry_id IS NOT NULL);",
      id,
    );
    // Delete expense_splits referencing this person
    await db.runAsync("DELETE FROM expense_splits WHERE hisaab_person_id = ?;", id);
    // Delete all remaining hisaab entries for this person
    await db.runAsync("DELETE FROM hisaab_entries WHERE hisaab_person_id = ?;", id);
    // Clear split references in expenses
    await db.runAsync(
      "UPDATE expenses SET split_person_id = NULL, split_pct = NULL, split_original_amount = NULL, split_hisaab_entry_id = NULL WHERE split_person_id = ?;",
      id,
    );
    await db.runAsync("DELETE FROM hisaab_persons WHERE id = ? AND is_active = 0;", id);
  });
  bumpDataVersion();
}

/**
 * Permanently delete all inactive persons for a user.
 */
export async function purgeAllInactivePersons(userId: string): Promise<number> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM hisaab_persons WHERE owner_user_id = ? AND is_active = 0;",
    userId,
  );
  for (const row of rows) {
    await hardDeletePerson(row.id);
  }
  return rows.length;
}

/**
 * Get a single person by ID.
 */
export async function getPerson(id: string): Promise<HisaabPerson | null> {
  const db = getDatabase();
  return db.getFirstAsync<HisaabPerson>(
    `SELECT * FROM hisaab_persons WHERE id = ?;`,
    id,
  );
}

/**
 * Batch-load multiple people by ID. Returns a Map keyed by person id. Used
 * by list screens (account-ledger, hisaab summaries) to avoid per-row
 * getPerson() round-trips — 8 split partners = 1 query instead of 8.
 */
export async function getPersonsByIds(
  ids: string[],
): Promise<Map<string, HisaabPerson>> {
  const result = new Map<string, HisaabPerson>();
  if (ids.length === 0) return result;
  const db = getDatabase();
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.getAllAsync<HisaabPerson>(
    `SELECT * FROM hisaab_persons WHERE id IN (${placeholders});`,
    ...ids,
  );
  for (const r of rows) result.set(r.id, r);
  return result;
}

/**
 * Get all active persons with their running balances.
 *
 * Balance = initial_balance + SUM(debits) - SUM(credits) - SUM(settlements)
 */
export async function getPersonsWithBalances(
  userId: string,
): Promise<HisaabPersonWithBalance[]> {
  const db = getDatabase();

  // Exclude hisaab entries whose linked expense has been soft-deleted — those
  // entries should not contribute to the balance once the underlying expense
  // is in the recycle bin. (linked_expense_id IS NULL entries are always kept.)
  return db.getAllAsync<HisaabPersonWithBalance>(
    `SELECT p.*,
            COALESCE(p.initial_balance, 0) +
              COALESCE(SUM(CASE WHEN e.type = 'debit' THEN e.amount ELSE 0 END), 0) -
              COALESCE(SUM(CASE WHEN e.type IN ('credit', 'settlement') THEN e.amount ELSE 0 END), 0)
            as balance,
            COUNT(e.id) as entryCount,
            MAX(e.date) as lastEntryDate
     FROM hisaab_persons p
     LEFT JOIN hisaab_entries e ON p.id = e.hisaab_person_id
       AND (e.linked_expense_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM expenses x WHERE x.id = e.linked_expense_id AND x.deleted_at IS NOT NULL
       ))
     WHERE p.owner_user_id = ? AND p.is_active = 1
     GROUP BY p.id
     ORDER BY ABS(
       COALESCE(p.initial_balance, 0) +
         COALESCE(SUM(CASE WHEN e.type = 'debit' THEN e.amount ELSE 0 END), 0) -
         COALESCE(SUM(CASE WHEN e.type IN ('credit', 'settlement') THEN e.amount ELSE 0 END), 0)
     ) DESC;`,
    userId,
  );
}

/**
 * Calculate running balance for a single person.
 */
export async function getPersonBalance(personId: string): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{
    initial_balance: number;
    debits: number | null;
    credits: number | null;
  }>(
    `SELECT p.initial_balance,
            SUM(CASE WHEN e.type = 'debit' THEN e.amount ELSE 0 END) as debits,
            SUM(CASE WHEN e.type IN ('credit', 'settlement') THEN e.amount ELSE 0 END) as credits
     FROM hisaab_persons p
     LEFT JOIN hisaab_entries e ON p.id = e.hisaab_person_id
       AND (e.linked_expense_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM expenses x WHERE x.id = e.linked_expense_id AND x.deleted_at IS NOT NULL
       ))
     WHERE p.id = ?
     GROUP BY p.id;`,
    personId,
  );

  if (!row) return 0;
  return (row.initial_balance ?? 0) + (row.debits ?? 0) - (row.credits ?? 0);
}

/**
 * Calculate the balance as of a given date (exclusive — entries before this date only).
 * Used to compute opening balance for date-range statements.
 *
 * balance = initial_balance + SUM(debits before date) - SUM(credits+settlements before date)
 */
export async function getBalanceAsOfDate(
  personId: string,
  beforeDate: string,
): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{
    initial_balance: number;
    debits: number | null;
    credits: number | null;
  }>(
    `SELECT p.initial_balance,
            SUM(CASE WHEN e.type = 'debit' THEN e.amount ELSE 0 END) as debits,
            SUM(CASE WHEN e.type IN ('credit', 'settlement') THEN e.amount ELSE 0 END) as credits
     FROM hisaab_persons p
     LEFT JOIN hisaab_entries e ON p.id = e.hisaab_person_id AND e.date < ?
       AND (e.linked_expense_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM expenses x WHERE x.id = e.linked_expense_id AND x.deleted_at IS NOT NULL
       ))
     WHERE p.id = ?
     GROUP BY p.id;`,
    beforeDate,
    personId,
  );

  if (!row) return 0;
  return (row.initial_balance ?? 0) + (row.debits ?? 0) - (row.credits ?? 0);
}

/**
 * Get entries for a person in a date range, ordered chronologically (ASC).
 * Used by bank-statement-style exports.
 */
export async function getEntriesByDateRangeAsc(
  personId: string,
  startDate: string,
  endDate: string,
): Promise<HisaabEntry[]> {
  const db = getDatabase();
  return db.getAllAsync<HisaabEntry>(
    `SELECT * FROM hisaab_entries
     WHERE hisaab_person_id = ? AND date >= ? AND date <= ?
     ORDER BY date ASC, created_at ASC;`,
    personId,
    startDate,
    endDate,
  );
}

// ═══════════════════════════════════════════════
// Entry CRUD
// ═══════════════════════════════════════════════

/**
 * Create a hisaab entry (debit, credit, or settlement).
 */
export async function createEntry(input: CreateEntryInput): Promise<string> {
  const db = getDatabase();
  const id = generateUUID();
  const now = new Date().toISOString(); // Local time in ISO format

  await db.runAsync(
    `INSERT INTO hisaab_entries (id, hisaab_person_id, amount, description, date, type, linked_expense_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    id,
    input.hisaab_person_id,
    input.amount,
    input.description ?? null,
    input.date,
    input.type,
    input.linked_expense_id ?? null,
    now,
  );

  bumpDataVersion();
  return id;
}

/**
 * Update a hisaab entry.
 */
export async function updateEntry(
  id: string,
  updates: Partial<Pick<HisaabEntry, "amount" | "description" | "date" | "type" | "status">>,
): Promise<void> {
  const db = getDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.amount !== undefined) { fields.push("amount = ?"); values.push(updates.amount); }
  if (updates.description !== undefined) { fields.push("description = ?"); values.push(updates.description); }
  if (updates.date !== undefined) { fields.push("date = ?"); values.push(updates.date); }
  if (updates.type !== undefined) { fields.push("type = ?"); values.push(updates.type); }
  if (updates.status !== undefined) { fields.push("status = ?"); values.push(updates.status); }

  if (fields.length === 0) return;

  const now = new Date().toISOString(); // Local time in ISO format
  fields.push("updated_at = ?");
  values.push(now);
  values.push(id);

  await db.runAsync(
    `UPDATE hisaab_entries SET ${fields.join(", ")} WHERE id = ?;`,
    ...values,
  );

  bumpDataVersion();
}

/**
 * Delete a hisaab entry permanently.
 *
 * Settlement cascades depend on provenance (see HisaabEntry.settlement_source):
 *   - settlement_source = 'created' → the credit was generated alongside the
 *     settlement by recordSettlement(); delete both.
 *   - settlement_source = 'linked'  → the credit pre-existed as a real bank
 *     transaction; only unlink, never delete the credit.
 *
 * Debits/credits ignore settlement_source.
 */
export async function deleteEntry(id: string): Promise<void> {
  const db = getDatabase();

  const entry = await db.getFirstAsync<{
    type: string;
    linked_account_credit_id: string | null;
    linked_expense_id: string | null;
    settlement_source: string | null;
  }>(
    `SELECT type, linked_account_credit_id, linked_expense_id, settlement_source FROM hisaab_entries WHERE id = ?;`,
    id,
  );

  // Credits now live in the expenses table. Prefer linked_expense_id (post-migration
  // 005, that's where the credit id resides); fall back to legacy linked_account_credit_id.
  const creditId = entry?.linked_expense_id ?? entry?.linked_account_credit_id ?? null;
  const isSettlement = entry?.type === "settlement";
  const source = entry?.settlement_source ?? "created";

  if (creditId && (!isSettlement || source === "created")) {
    // Non-settlement linked credit, OR settlement that CREATED its credit —
    // cascade delete.
    const { deleteCredit } = await import("@/services/account-credit");
    await deleteCredit(creditId);
  }
  // Settlement with source='linked' — just drop the hisaab row, credit stays.

  await db.runAsync(`DELETE FROM hisaab_entries WHERE id = ?;`, id);

  bumpDataVersion();
}

/**
 * Enrich entries that have a linked_expense_id: fill missing category_id/merchant_name
 * from the expense, and return an accountMap (entryId → account label) for display.
 * Mutates entries in-place for category_id/merchant_name.
 */
export async function enrichEntriesFromExpenses(
  entries: HisaabEntry[],
): Promise<Map<string, string>> {
  const accountMap = new Map<string, string>();
  const linked = entries.filter((e) => e.linked_expense_id);
  if (linked.length === 0) return accountMap;

  const db = getDatabase();
  const ids = linked.map((e) => e.linked_expense_id!);
  const placeholders = ids.map(() => "?").join(",");

  const rows = await db.getAllAsync<{
    id: string;
    category_id: string | null;
    merchant_name: string | null;
    account_id: string | null;
  }>(
    `SELECT id, category_id, merchant_name, account_id FROM expenses WHERE id IN (${placeholders}) AND deleted_at IS NULL;`,
    ...ids,
  );
  const expenseMap = new Map(rows.map((r) => [r.id, r]));

  const accountIds = new Set(rows.map((r) => r.account_id).filter(Boolean) as string[]);
  const acctNameMap = new Map<string, string>();
  if (accountIds.size > 0) {
    const acctPlaceholders = [...accountIds].map(() => "?").join(",");
    const accts = await db.getAllAsync<{ id: string; account_label: string | null; bank_name: string; account_identifier: string }>(
      `SELECT id, account_label, bank_name, account_identifier FROM financial_accounts WHERE id IN (${acctPlaceholders});`,
      ...[...accountIds],
    );
    for (const a of accts) {
      acctNameMap.set(a.id, a.account_label || `${a.bank_name} ****${a.account_identifier}`);
    }
  }

  for (const entry of linked) {
    const exp = expenseMap.get(entry.linked_expense_id!);
    if (!exp) continue;
    if (exp.category_id) entry.category_id = exp.category_id;
    if (exp.merchant_name) entry.merchant_name = exp.merchant_name;
    if (exp.account_id && acctNameMap.has(exp.account_id)) {
      accountMap.set(entry.id, acctNameMap.get(exp.account_id)!);
    }
  }

  return accountMap;
}

/**
 * For each entry with a linked credit expense that has an account_id, return
 * the accountId so the caller can navigate to that account's ledger.
 */
export async function getLinkedAccountIdsForEntries(
  entries: HisaabEntry[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const linked = entries.filter((e) => e.linked_expense_id);
  if (linked.length === 0) return map;

  const db = getDatabase();
  const ids = linked.map((e) => e.linked_expense_id!);
  const placeholders = ids.map(() => "?").join(",");

  const rows = await db.getAllAsync<{ id: string; account_id: string | null }>(
    `SELECT id, account_id FROM expenses WHERE id IN (${placeholders}) AND deleted_at IS NULL;`,
    ...ids,
  );
  const expenseAcct = new Map(rows.map((r) => [r.id, r.account_id]));

  for (const entry of linked) {
    const accountId = expenseAcct.get(entry.linked_expense_id!);
    if (accountId) map.set(entry.id, accountId);
  }
  return map;
}

/**
 * Lookup a hisaab entry by its primary id. Used by the expense-edit flow
 * to reconstruct `paidBy` from the linked entry's type (debit = "me",
 * credit = "them") — v15.13.1.
 */
export async function getEntryById(
  entryId: string,
): Promise<HisaabEntry | null> {
  const db = getDatabase();
  return db.getFirstAsync<HisaabEntry>(
    `SELECT * FROM hisaab_entries WHERE id = ?;`,
    entryId,
  );
}

/**
 * Find a hisaab entry linked to a specific expense (for split display).
 */
export async function getEntryByLinkedExpense(
  expenseId: string,
): Promise<HisaabEntry | null> {
  const db = getDatabase();
  return db.getFirstAsync<HisaabEntry>(
    `SELECT * FROM hisaab_entries WHERE linked_expense_id = ?;`,
    expenseId,
  );
}

/**
 * Find the expense linked to a hisaab entry (reverse lookup for bidirectional nav).
 */
export async function getExpenseByLinkedEntry(
  entryId: string,
): Promise<{ id: string; description: string | null; amount: number; date: string } | null> {
  const db = getDatabase();
  return db.getFirstAsync<{ id: string; description: string | null; amount: number; date: string }>(
    `SELECT id, description, amount, date FROM expenses WHERE split_hisaab_entry_id = ? AND deleted_at IS NULL;`,
    entryId,
  );
}

/**
 * Get all entries for a person, ordered by date descending.
 */
export async function getEntries(
  personId: string,
): Promise<HisaabEntry[]> {
  const db = getDatabase();
  return db.getAllAsync<HisaabEntry>(
    `SELECT * FROM hisaab_entries
     WHERE hisaab_person_id = ?
     ORDER BY date DESC, created_at DESC;`,
    personId,
  );
}

/**
 * Get entries for a person in a date range.
 */
export async function getEntriesByDateRange(
  personId: string,
  startDate: string,
  endDate: string,
): Promise<HisaabEntry[]> {
  const db = getDatabase();
  return db.getAllAsync<HisaabEntry>(
    `SELECT * FROM hisaab_entries
     WHERE hisaab_person_id = ? AND date >= ? AND date <= ?
     ORDER BY date DESC, created_at DESC;`,
    personId,
    startDate,
    endDate,
  );
}

// ═══════════════════════════════════════════════
// Summary & Analytics
// ═══════════════════════════════════════════════

/**
 * Get total amounts owed to you and owed by you across all persons.
 */
export async function getHisaabSummary(
  userId: string,
): Promise<{ totalOwedToYou: number; totalYouOwe: number; netBalance: number }> {
  const persons = await getPersonsWithBalances(userId);

  let totalOwedToYou = 0;
  let totalYouOwe = 0;

  for (const p of persons) {
    if (p.balance > 0) totalOwedToYou += p.balance;
    else totalYouOwe += Math.abs(p.balance);
  }

  return {
    totalOwedToYou: Math.round(totalOwedToYou * 100) / 100,
    totalYouOwe: Math.round(totalYouOwe * 100) / 100,
    netBalance: Math.round((totalOwedToYou - totalYouOwe) * 100) / 100,
  };
}

/**
 * Record a settlement (partial or full).
 * Creates a settlement entry that reduces the balance.
 * If receivedInAccountId is provided, also creates an account credit
 * linked to this settlement entry.
 */
export async function recordSettlement(
  personId: string,
  amount: number,
  date: string,
  description?: string,
  receivedInAccountId?: string,
): Promise<string> {
  const db = getDatabase();
  const person = await getPerson(personId);
  const personName = person?.name ?? "Someone";
  const desc = description ?? "Settlement";

  let linkedCreditId: string | null = null;

  if (receivedInAccountId) {
    const { addCredit } = await import("@/services/account-credit");
    linkedCreditId = await addCredit({
      accountId: receivedInAccountId,
      userId: person?.owner_user_id ?? "",
      amount,
      description: `Settlement from ${personName}${desc !== "Settlement" ? ` — ${desc}` : ""}`,
      date,
      source: "manual",
    });
  }

  const id = generateUUID();
  // linked_expense_id is the new FK target for credits (post-migration 005 credits
  // are rows in the expenses table). Legacy linked_account_credit_id is left NULL
  // for new entries and will be removed in a later cleanup migration.
  // settlement_source='created' — this function creates BOTH the settlement
  // and the linked credit, so delete cascades should tear down both.
  const now = new Date().toISOString(); // Local time in ISO format
  await db.runAsync(
    `INSERT INTO hisaab_entries (id, hisaab_person_id, amount, description, date, type, linked_expense_id, settlement_source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'created', ?);`,
    id,
    personId,
    amount,
    desc,
    date,
    "settlement",
    linkedCreditId,
    now,
  );

  bumpDataVersion();
  return id;
}

/**
 * Mark a pre-existing account credit (real bank transaction) as a settlement
 * received from a hisaab person. Creates a settlement entry with
 * settlement_source='linked' so deletion only unlinks, never destroys the
 * underlying credit.
 *
 * The credit's account, amount, and date are preserved as-is; only the hisaab
 * linkage is new. Description is inherited from the credit if available.
 *
 * Returns the new hisaab entry id.
 */
export async function linkCreditAsSettlement(
  creditId: string,
  personId: string,
): Promise<string> {
  const db = getDatabase();

  // Reject double-linking: one credit can only fulfill one settlement.
  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM hisaab_entries WHERE linked_expense_id = ? AND type = 'settlement';`,
    creditId,
  );
  if (existing) {
    throw new Error("This credit is already linked to a settlement.");
  }

  const credit = await db.getFirstAsync<{
    id: string;
    nature: string;
    amount: number;
    date: string;
    description: string | null;
    merchant_name: string | null;
    deleted_at: string | null;
  }>(
    `SELECT id, nature, amount, date, description, merchant_name, deleted_at
     FROM expenses WHERE id = ?;`,
    creditId,
  );
  if (!credit) throw new Error("Credit not found");
  if (credit.nature !== "credit") throw new Error("Only credits can be marked as settlements");
  if (credit.deleted_at) throw new Error("Credit is deleted");

  const person = await getPerson(personId);
  const personName = person?.name ?? "Someone";
  const desc = credit.description || credit.merchant_name
    ? `Settlement from ${personName} — ${credit.description ?? credit.merchant_name}`
    : `Settlement from ${personName}`;

  const id = generateUUID();
  const now = new Date().toISOString(); // Local time in ISO format
  await db.runAsync(
    `INSERT INTO hisaab_entries (id, hisaab_person_id, amount, description, date, type, linked_expense_id, settlement_source, created_at)
     VALUES (?, ?, ?, ?, ?, 'settlement', ?, 'linked', ?);`,
    id,
    personId,
    credit.amount,
    desc,
    credit.date,
    creditId,
    now,
  );

  bumpDataVersion();

  const statusRow = await db.getFirstAsync<{ status: string }>(
    `SELECT status FROM expenses WHERE id = ?;`, creditId,
  );
  if (statusRow?.status === "pending_review") {
    const { approveExpense } = await import("@/services/expense-crud");
    await approveExpense(creditId);
  }

  return id;
}

/**
 * Remove the hisaab-settlement linkage for a credit, leaving the credit intact.
 * If no linked settlement exists, a no-op.
 */
export async function unlinkCreditSettlement(creditId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `DELETE FROM hisaab_entries
     WHERE linked_expense_id = ? AND type = 'settlement' AND settlement_source = 'linked';`,
    creditId,
  );
  bumpDataVersion();
}

/**
 * Batch variant of getSettlementForCredit — returns a map from credit id to
 * { personId, personName } for every credit that has a linked settlement.
 * Used by account-ledger to show a "Settlement" pill on credit rows.
 */
export async function getSettlementsForCredits(
  creditIds: string[],
): Promise<Map<string, { entryId: string; personId: string; personName: string }>> {
  const map = new Map<string, { entryId: string; personId: string; personName: string }>();
  if (creditIds.length === 0) return map;
  const db = getDatabase();
  const placeholders = creditIds.map(() => "?").join(",");
  const rows = await db.getAllAsync<{
    creditId: string;
    entryId: string;
    personId: string;
    personName: string;
  }>(
    `SELECT he.linked_expense_id as creditId, he.id as entryId,
            he.hisaab_person_id as personId, hp.name as personName
     FROM hisaab_entries he
     INNER JOIN hisaab_persons hp ON hp.id = he.hisaab_person_id
     WHERE he.type = 'settlement' AND he.linked_expense_id IN (${placeholders});`,
    ...creditIds,
  );
  for (const r of rows) {
    map.set(r.creditId, { entryId: r.entryId, personId: r.personId, personName: r.personName });
  }
  return map;
}

/**
 * Look up a settlement entry linked to a specific credit, with the person
 * name for display on the credit's expense-detail screen.
 */
export async function getSettlementForCredit(
  creditId: string,
): Promise<{ entryId: string; personId: string; personName: string; amount: number; date: string } | null> {
  const db = getDatabase();
  return db.getFirstAsync<{
    entryId: string;
    personId: string;
    personName: string;
    amount: number;
    date: string;
  }>(
    `SELECT he.id as entryId, he.hisaab_person_id as personId, hp.name as personName,
            he.amount as amount, he.date as date
     FROM hisaab_entries he
     INNER JOIN hisaab_persons hp ON hp.id = he.hisaab_person_id
     WHERE he.linked_expense_id = ? AND he.type = 'settlement';`,
    creditId,
  );
}
