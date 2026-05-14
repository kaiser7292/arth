# Artha v16.0.0 — Technical Design Document

**PRD:** [PRD_V16.md](./PRD_V16.md)
**MASTER_PLAN:** [MASTER_PLAN_V16.md](./MASTER_PLAN_V16.md)

---

## 1. Architecture overview

```
┌──────────────────────────────────────────────┐
│           app/simulator/*.tsx                │
│   (scenario list, detail, add-entry sheet)   │
└───────────┬──────────────────────────────────┘
            │ reads/writes via
            ↓
┌──────────────────────────────────────────────┐
│        services/simulator.ts                  │
│  CRUD + fulfillment reconcile + retention    │
└───────────┬───────────────────┬──────────────┘
            │                   │
            ↓                   ↓
    simulation_*           services/simulator-engine.ts
    tables (DB)            (pure simulation logic)
            │                   ↑
            │                   │ input: snapshot + entries
            │                   │
┌───────────┴───────────────────┴──────────────┐
│  Existing: balance-sheet.ts, recurring-rules │
│  .ts, expense-forecasts.ts, financial-       │
│  account.ts                                   │
└──────────────────────────────────────────────┘
```

- Engine is pure (no DB access, no side-effects). Easy to unit-test in isolation.
- Service wraps the engine and reads baseline from existing balance-sheet service + relevant reminder / forecast services.
- UI reads computed output from the service, renders, and writes user edits back through the service.

---

## 2. Schema — migration 025

```sql
CREATE TABLE IF NOT EXISTS simulation_scenarios (
  id            TEXT PRIMARY KEY NOT NULL,
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  horizon_date  TEXT NOT NULL,
  is_default    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sim_scen_user ON simulation_scenarios(user_id, archived_at);

CREATE TABLE IF NOT EXISTS simulation_entries (
  id                      TEXT PRIMARY KEY NOT NULL,
  scenario_id             TEXT NOT NULL REFERENCES simulation_scenarios(id) ON DELETE CASCADE,
  direction               TEXT NOT NULL CHECK (direction IN ('out','in')),
  amount                  REAL NOT NULL,
  date                    TEXT NOT NULL,
  originally_planned_for  TEXT,
  account_id              TEXT,
  category_id             TEXT,
  merchant_name           TEXT,
  description             TEXT,
  source                  TEXT NOT NULL CHECK (source IN ('manual','seeded_reminder','seeded_forecast')),
  seed_source_id          TEXT,
  fulfilled_expense_id    TEXT,
  status                  TEXT NOT NULL DEFAULT 'upcoming'
                          CHECK (status IN ('upcoming','fulfilled','stale','dismissed')),
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sim_entries_scenario ON simulation_entries(scenario_id, status);
CREATE INDEX IF NOT EXISTS idx_sim_entries_date ON simulation_entries(scenario_id, date);
```

**Rationale notes:**
- `ON DELETE CASCADE` on `scenario_id` — deleting a scenario removes all its entries. Test.
- No FK on `account_id` / `category_id` / `fulfilled_expense_id` — these are "loose refs" so deleting an underlying row doesn't cascade the simulator away. Consistent with `recurring_expense_rules.source_expense_id` pattern (though that one does have FK + cascade). Simulator entries are ephemeral enough that loose refs are fine.
- `originally_planned_for` is for audit only; optional.
- `status` CHECK constraint — enforces only the 4 valid values.

**Idempotency:**
- `CREATE TABLE IF NOT EXISTS` handles re-run.
- `CREATE INDEX IF NOT EXISTS` handles re-run.
- Migration does not alter existing tables.

---

## 3. Engine API

### Types

```ts
export type AccountKind = 'savings' | 'credit_card' | 'wallet' | 'loan' | 'demat';

export interface BaselineAccount {
  id: string;
  label: string;
  type: AccountKind;
  balance: number;       // computed current value. For CC, this is UTILIZED (not available).
  minBalance?: number;   // only savings
  creditLimit?: number;  // only CC
}

export interface SimulationInput {
  startBalances: BaselineAccount[];
  entries: SimulationEntry[];  // only upcoming status
  horizonDate: string;         // YYYY-MM-DD
  todayDate: string;           // YYYY-MM-DD
}

export interface BalanceSnapshot {
  date: string;
  netWorth: number;
  byAccount: Record<string, number>;
}

export type WarningKind = 'min_balance_breach' | 'cc_over_limit' | 'negative_balance';

export interface SimulationWarning {
  accountId: string;
  accountLabel: string;
  kind: WarningKind;
  firstTriggerDate: string;
  amount: number;   // balance at trigger
}

export interface SimulationOutput {
  netWorthStart: number;
  netWorthEnd: number;
  endBalances: Record<string, number>;
  trajectory: BalanceSnapshot[];
  warnings: SimulationWarning[];
}
```

### Algorithm — `runSimulation(input): SimulationOutput`

```ts
1. Clone startBalances → state
2. Sort entries by date ascending
3. push snapshot(today, state) to trajectory
4. for each entry in sorted entries:
     if entry.date > horizonDate: skip
     apply(entry, state)
     checkWarnings(state, entry.date)
     push snapshot(entry.date, state)
5. if last trajectory date < horizon: push snapshot(horizon, state)
6. return { netWorthStart: sumNetWorth(startBalances),
            netWorthEnd: sumNetWorth(state),
            endBalances: toRecord(state),
            trajectory, warnings }
```

**`apply(entry, state)`:**

```ts
const acct = state[entry.accountId]
if (!acct) return  // entry with missing account — ignore, don't throw
if (entry.direction === 'out'):
  acct.balance +=
    acct.type === 'credit_card' ? entry.amount : -entry.amount
    // For CC, out = spend = increase utilized
if (entry.direction === 'in'):
  acct.balance +=
    acct.type === 'credit_card' ? -entry.amount : entry.amount
    // For CC, in = bill payment = decrease utilized
```

**`checkWarnings(state, date, warnings)`:**

```ts
for each account in state:
  if account.type === 'savings' && account.minBalance != null
     && account.balance < account.minBalance:
    pushWarning(accountId, 'min_balance_breach', date, balance)
  if account.type === 'credit_card' && account.creditLimit != null
     && account.balance > account.creditLimit:
    pushWarning(accountId, 'cc_over_limit', date, balance)
  if account.type !== 'credit_card' && account.balance < 0:
    pushWarning(accountId, 'negative_balance', date, balance)

// dedupe: one warning per (accountId, kind) — only record first trigger date
```

**`sumNetWorth(accounts)`:**

```ts
For each account:
  assetAccountTypes = ['savings', 'wallet', 'demat'] → add balance
  liabilityAccountTypes = ['credit_card', 'loan'] → subtract balance (since balance = utilized / principal)
```

### `findFulfillmentCandidate(entry, realTransactions): Transaction | null`

```ts
For each tx in realTransactions:
  if tx.account_id !== entry.account_id && entry.account_id: continue
  if abs(tx.amount - entry.amount) / entry.amount > 0.05: continue
  if abs(daysBetween(tx.date, entry.date)) > 3: continue
  return tx  // first match
return null
```

If entry has no account_id → match across all accounts (looser but still useful).

---

## 4. Service layer

### `services/simulator.ts` — function list

```ts
// Scenarios
export async function getOrCreateDefaultScenario(userId: string): Promise<SimulationScenario>;
export async function listActiveScenarios(userId: string): Promise<SimulationScenario[]>;
export async function listArchivedScenarios(userId: string, sincDays = 90): Promise<SimulationScenario[]>;
export async function getScenario(id: string): Promise<SimulationScenario | null>;
export async function createScenario(userId: string, input: CreateScenarioInput): Promise<string>;
export async function updateScenario(id: string, patch: Partial<Pick<SimulationScenario, 'name' | 'horizon_date'>>): Promise<void>;
export async function duplicateScenario(id: string): Promise<string>;
export async function archiveScenario(id: string): Promise<void>;
export async function deleteScenario(id: string): Promise<void>;

// Entries
export async function getEntriesForScenario(scenarioId: string): Promise<SimulationEntry[]>;
export async function createEntry(scenarioId: string, input: CreateEntryInput): Promise<string>;
export async function updateEntry(entryId: string, patch: UpdateEntryInput): Promise<void>;
export async function duplicateEntry(entryId: string): Promise<string>;
export async function rescheduleEntry(entryId: string, newDate: string): Promise<void>;
export async function fulfillEntry(entryId: string, expenseId: string): Promise<void>;
export async function dismissEntry(entryId: string): Promise<void>;
export async function deleteEntry(entryId: string): Promise<void>;

// Seeding + reconcile + retention
export async function seedScenarioFromReminders(scenarioId: string, userId: string): Promise<number>; // returns count seeded
export async function reconcileStaleEntries(scenarioId: string, userId: string): Promise<{ fulfilled: number; stale: number }>;
export async function purgeRetention(userId: string): Promise<void>;

// Baseline
export async function computeBaselineBalances(userId: string): Promise<BaselineAccount[]>;

// Live overview compile — one-shot for the detail screen
export async function getScenarioOverview(scenarioId: string, userId: string): Promise<ScenarioOverview>;
```

### `ScenarioOverview`

```ts
export interface ScenarioOverview {
  scenario: SimulationScenario;
  baseline: BaselineAccount[];
  entries: {
    upcoming: SimulationEntry[];
    stale: SimulationEntry[];
    fulfilled: SimulationEntry[];
    dismissed: SimulationEntry[];  // only if recent (within 7d)
  };
  simulation: SimulationOutput;
}
```

One function, one read, everything the UI needs. Reconcile + retention runs before this fires so the shape is fresh.

---

## 5. Default scenario roll-forward

```ts
async function getOrCreateDefaultScenario(userId: string): Promise<SimulationScenario> {
  const db = getDatabase();
  const today = todayIso();

  let row = await db.getFirstAsync<SimulationScenario>(
    "SELECT * FROM simulation_scenarios WHERE user_id = ? AND is_default = 1 AND archived_at IS NULL;",
    userId,
  );

  if (!row) {
    // First-time user: create
    return createDefault(userId);
  }

  // Roll forward if horizon has passed
  if (row.horizon_date < today) {
    const newHorizon = endOfMonth(today);
    await db.runAsync(
      "UPDATE simulation_scenarios SET horizon_date = ?, updated_at = datetime('now') WHERE id = ?;",
      newHorizon,
      row.id,
    );
    // Drop stale/fulfilled/dismissed entries — keep upcoming-future only
    await db.runAsync(
      `DELETE FROM simulation_entries
       WHERE scenario_id = ? AND (status != 'upcoming' OR date < ?);`,
      row.id,
      today,
    );
    // Re-seed from current reminders + forecasts
    await seedScenarioFromReminders(row.id, userId);
    row = await getScenario(row.id);
  }

  return row!;
}
```

---

## 6. Retention — `purgeRetention(userId)`

Runs on every simulator open. Cheap (indexed). Three passes:

```ts
// Pass 1: hard-delete old entries (30d past scenario horizon)
DELETE FROM simulation_entries
WHERE id IN (
  SELECT se.id FROM simulation_entries se
  INNER JOIN simulation_scenarios ss ON ss.id = se.scenario_id
  WHERE se.status IN ('fulfilled', 'dismissed')
    AND ss.horizon_date < date('now', '-30 days')
);

// Pass 2: archive scenarios 90d past horizon (if not already archived)
UPDATE simulation_scenarios
SET archived_at = datetime('now')
WHERE user_id = ?
  AND is_default = 0
  AND archived_at IS NULL
  AND horizon_date < date('now', '-90 days');

// Pass 3: hard-delete scenarios 180d past horizon (cascade entries)
DELETE FROM simulation_scenarios
WHERE user_id = ?
  AND is_default = 0
  AND horizon_date < date('now', '-180 days');
```

Default scenario never touched by passes 2 & 3 (guarded by `is_default = 0`).

---

## 7. Seeding from reminders / CC forecasts

```ts
async function seedScenarioFromReminders(scenarioId: string, userId: string): Promise<number> {
  const scenario = await getScenario(scenarioId);
  if (!scenario) return 0;
  const today = todayIso();

  // Reminders with next_due_date in [today, horizon_date]
  const reminders = await db.getAllAsync<{
    id: string; source_expense_id: string; next_due_date: string;
    source_amount: number; source_merchant: string | null;
    source_account_id: string | null; source_category_id: string | null;
  }>(
    `SELECT r.id, r.source_expense_id, r.next_due_date,
            e.amount as source_amount, e.merchant_name as source_merchant,
            e.account_id as source_account_id, e.category_id as source_category_id
     FROM recurring_expense_rules r
     INNER JOIN expenses e ON e.id = r.source_expense_id
     WHERE r.user_id = ? AND r.is_active = 1
       AND r.next_due_date IS NOT NULL
       AND r.next_due_date >= ? AND r.next_due_date <= ?;`,
    userId, today, scenario.horizon_date,
  );

  // Upsert: skip if entry for the same seed_source_id already exists on this scenario
  let added = 0;
  for (const r of reminders) {
    const existing = await db.getFirstAsync(
      "SELECT id FROM simulation_entries WHERE scenario_id = ? AND seed_source_id = ?;",
      scenarioId, r.id,
    );
    if (existing) continue;
    await createEntry(scenarioId, {
      direction: 'out',
      amount: r.source_amount,
      date: r.next_due_date,
      account_id: r.source_account_id ?? undefined,
      category_id: r.source_category_id ?? undefined,
      merchant_name: r.source_merchant ?? undefined,
      description: 'Planned from reminder',
      source: 'seeded_reminder',
      seed_source_id: r.id,
    });
    added++;
  }

  // Open CC repayment forecasts in [today, horizon]
  const forecasts = await db.getAllAsync<{
    id: string; amount: number; due_date: string; account_id: string; merchant_name: string | null;
  }>(
    `SELECT id, amount, due_date, account_id, merchant_name
     FROM expenses
     WHERE user_id = ? AND nature = 'forecast' AND forecast_type = 'repayment'
       AND status != 'rejected' AND deleted_at IS NULL
       AND due_date >= ? AND due_date <= ?;`,
    userId, today, scenario.horizon_date,
  );
  for (const f of forecasts) {
    const existing = await db.getFirstAsync(
      "SELECT id FROM simulation_entries WHERE scenario_id = ? AND seed_source_id = ?;",
      scenarioId, f.id,
    );
    if (existing) continue;
    await createEntry(scenarioId, {
      direction: 'out',
      amount: f.amount,
      date: f.due_date,
      account_id: f.account_id,
      description: `CC bill payment${f.merchant_name ? ' — ' + f.merchant_name : ''}`,
      source: 'seeded_forecast',
      seed_source_id: f.id,
    });
    added++;
  }

  return added;
}
```

---

## 8. Reconcile stale entries

```ts
async function reconcileStaleEntries(scenarioId: string, userId: string) {
  const today = todayIso();
  // Past-date upcoming entries
  const candidates = await db.getAllAsync<SimulationEntry>(
    `SELECT * FROM simulation_entries
     WHERE scenario_id = ? AND status = 'upcoming' AND date < ?;`,
    scenarioId, today,
  );

  let fulfilled = 0, stale = 0;
  for (const entry of candidates) {
    // Query candidate real transactions: expenses + credits + transfers, last 7 days
    const realTxns = await getRealTransactionsInWindow(userId, entry.date, 3);
    const match = findFulfillmentCandidate(entry, realTxns);
    if (match) {
      await fulfillEntry(entry.id, match.id);
      fulfilled++;
    } else {
      await db.runAsync(
        "UPDATE simulation_entries SET status = 'stale', updated_at = datetime('now') WHERE id = ?;",
        entry.id,
      );
      stale++;
    }
  }
  return { fulfilled, stale };
}
```

---

## 9. UI state flow

```
[mount scenario/[id]]
  → purgeRetention(userId)           // cheap
  → reconcileStaleEntries(scenarioId, userId)
  → getScenarioOverview(scenarioId, userId)
  → render

[user adds / edits / deletes entry]
  → service call
  → re-fetch getScenarioOverview
  → re-render

[data-refresh signal (new SMS, etc.)]
  → reconcileStaleEntries (may auto-fulfill)
  → re-fetch
  → re-render

[user taps stale row → "Reschedule"]
  → rescheduleEntry(entryId, newDate)
  → re-fetch + re-render

[user taps stale row → "It happened"]
  → open StaleEntryResolveSheet
  → user picks real tx
  → fulfillEntry(entryId, realTxId)
  → re-fetch + re-render

[user taps stale row → "Remove"]
  → dismissEntry(entryId)
  → re-fetch + re-render
```

---

## 10. Test plan

### Engine tests — `__tests__/unit/simulator-engine.test.ts`

- **empty entries** — trajectory has 2 snapshots (today + horizon), same balance.
- **single out expense reduces savings** — balance drops by amount.
- **single out expense increases CC utilized** — CC balance goes up (utilized).
- **single in credit increases savings** — balance up.
- **single in credit reduces CC utilized** — CC balance down (bill payment).
- **multiple entries sorted** — out-of-order input is sorted.
- **entries beyond horizon skipped** — not included in snapshots.
- **min-balance breach detected on savings** — warning fires at first trigger date.
- **CC over-limit detected** — warning fires.
- **negative balance on savings detected** — warning fires.
- **net worth start/end** — assets sum − liabilities sum.
- **warnings dedup** — one per (account, kind).
- **unknown account entry ignored** — no throw.
- **loan account treated as liability** — net worth subtracts.
- **wallet treated as asset** — net worth adds.

### Fulfillment matcher tests

- **exact match** — amount + account + within 3 days → match.
- **amount tolerance** — 4% diff → match; 6% → no match.
- **date window** — 3 days → match; 4 → no match.
- **account mismatch** — different account → no match.
- **no account on entry** — matches across accounts.
- **multiple candidates** — picks closest by amount then date.

### Service integration tests — `__tests__/integration/simulator.test.ts`

- **getOrCreateDefaultScenario** creates on first call.
- **default scenario rolls forward** when horizon < today.
- **createEntry** writes row + bumps scenario updated_at.
- **duplicateEntry** returns new id, same fields.
- **rescheduleEntry** sets originally_planned_for, updates date, status back to upcoming.
- **fulfillEntry** sets status + fulfilled_expense_id.
- **dismissEntry** sets status='dismissed'.
- **deleteScenario cascades** — entries gone.
- **seedScenarioFromReminders** pulls current reminders.
- **reseeding idempotent** — same reminder not re-added.
- **reconcileStale marks past-date entries** stale when no match.
- **reconcileStale auto-fulfills matched real expense**.
- **purgeRetention** deletes old fulfilled + old archived scenarios.
- **purgeRetention never touches default scenario**.
- **backup round-trip** — scenarios + entries survive export / import (covered via TABLE_SCHEMAS coverage test in backup.test.ts — already checks all BACKUP_TABLES have schemas).

### UI smoke

Not extensive RTL tests (following existing codebase pattern — UI is tested manually). Minimum: no crash on mount.

---

## 11. Backup coverage

Add to `services/backup.ts` BACKUP_TABLES, in dependency order (scenarios before entries):

```ts
"simulation_scenarios",
"simulation_entries",
```

Existing restore logic uses TABLE_SCHEMAS whitelist to project rows — as long as both tables are in TABLE_SCHEMAS, restore works.

---

## 12. Migration count test update

`__tests__/integration/database.test.ts`:

- `executedSQL.length` 35 → current + 4 (migration 025: 2 CREATE TABLE + 4 CREATE INDEX = 6 execAsyncs, but they go into a single execAsync block with multiple statements separated by semicolons — count as 1 execAsync per file since migration pattern uses single `db.execAsync(multi-line-SQL)`). Actually check pattern: migration 013 used 2 execAsyncs for TABLE + INDEX. Will match pattern.
- `inserts.length` 24 → 25 (one new `INSERT INTO schema_migrations`).
- Add `[25, "simulation_tables"]` at index 24.
- Already-applied arrays +1.

Final numbers depend on exact migration file structure; will adjust once written.

---

## 13. TypeScript types

No new root-level types needed beyond what engine + service export. All internal to `services/simulator*.ts`. `Expense` type unchanged.

---

## 14. Risks & mitigations (technical)

| Risk | Mitigation |
|------|------------|
| `date` column TEXT format drift | Same convention as rest of codebase: always YYYY-MM-DD, enforced at service entry points. |
| Entry with account_id pointing at deleted account | Engine ignores unknown account. UI shows "(account removed)" label. |
| Two users open simulator concurrently writing same scenario | N/A — local-first, single user. |
| Simulator recomputes O(entries × accounts) on every input change | Sub-ms. Debouncing not needed. |
| Reminders with no source expense (deleted) | Query inner-joins `expenses`; NULL source → not seeded. |
| Backup schema drift | TABLE_SCHEMAS whitelist + round-trip test ensures column-level compat. |
