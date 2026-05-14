# Artha v16.0.0 — Cash-flow Simulator ("What-if")

**Status:** In-flight
**Target release:** 2026-05-xx (session shipping)
**Scope:** 1 major new feature — "What-if" simulator for planned cash flows
**Version bump:** 15.13.1 → 16.0.0 (MAJOR — first whole-new user-surface since v15.2)

---

## 1. Problem statement

> "Before the month starts — or mid-month — I want to see: if all my planned expenses and incomes go as expected, what will my account balances look like? Can I afford that big purchase? Will I breach any minimum balance?"

Today, Artha shows **current balances** and **historical spend**. It doesn't answer the **forward-looking** question. The Budget tab projects average-based spend-to-month-end, but that's an aggregate and doesn't model individual events. Reminders tell you what repeats, but don't roll up to "you'll be left with ₹X on the 30th."

The simulator closes that gap. You say what you expect to happen; Artha rolls it forward.

---

## 2. Personas

### Primary — Sourav (solo user, monthly planner)

- Wants to plan cash flow each month, especially around salary + rent + EMIs.
- Considers a big purchase (phone, trip) and wants to check affordability.
- Wants early warnings if any savings account will dip below threshold.
- Expects the tool to remember active reminders and CC bills without re-typing them.

### Secondary — shared-finance household

- Plans a month factoring in a spouse's contribution or a shared expense.
- Uses the simulator as a conversation aid ("on the 15th, here's where we'll be").

---

## 3. Goals & non-goals

### Goals
1. Give users a **visual, narrative overview** of their near-future cash position.
2. Pre-fill the most obvious planned entries (reminders + CC forecasts) so setup takes seconds.
3. Keep simulator state fully separate from real data — no risk of corrupting the ledger.
4. Keep the simulator **alive** — as new real transactions come in, past-dated planned entries get reconciled automatically.
5. Respect the Privacy & offline-first charter — no cloud, no sync.

### Non-goals (v16.0.0)
- **Multi-currency scenarios** — a scenario uses the device's single locale currency (v16.x or later).
- **Market-movement simulation** — portfolio values held constant at today's snapshot.
- **Stress tests / Monte Carlo** — no random-variance modelling.
- **Goal-based simulation** — "how much can I save?" is a separate feature.
- **Scenarios shared across users or devices** — local only.
- **Changing budgets within a scenario** — budgets are read-only inputs in the simulator. Hit the Budget tab to change caps.
- **Salary / recurring-credit auto-detection from SMS history** — v16.0.0 only seeds from explicit reminders + open CC forecasts. Pattern detection is deferred.

---

## 4. User-visible surface

### Home tab entry

New **"Explore & Tools"** section on the Home tab (consistent with existing People & Money section). First card:

- **Title:** "What-if simulator"
- **Subtitle:** "Plan this month. See where you'll land."
- **Right-aligned stat:** live from the default scenario — e.g. "₹2,45,000 on 31 May" when horizon = end of month, or a subtle "Tap to set up" on first use.

Tap → `/simulator` (scenario list).

### Screen 1 — Scenario list (`/simulator`)

- Header: "Cash-flow simulator"
- Active scenarios (cards):
  - **This month** — always present, auto-rolled forward each month. Default.
  - Any user-saved scenarios (e.g. "With Goa trip", "Tight month", "Bonus received").
- Past / archived scenarios (expandable section, last 90 days) — read-only retrospect, for "how good was I at planning?" reviews.
- **+ New scenario** button.
- Each card row shows:
  - Name
  - Horizon date
  - Net worth at horizon (summary number)
  - Delta vs today (↑/↓ with amount)
  - Warning dot if the scenario surfaces any breach

### Screen 2 — Scenario detail (`/simulator/[id]`)

**Header section**
- Scenario name (tap to rename)
- Horizon picker — "End of this month" (default) · "30 days" · "90 days" · "End of FY" · "Custom…"
- Overflow menu: Rename · Reset seeded · Duplicate · Archive · Delete

**Overview card** (top of screen, Hero style)
- "Today: ₹X,XX,XXX → [horizon date]: ₹Y,YY,YYY" with delta pill (+Δ or −Δ in accent/danger).
- Warnings bar — soft-tinted badges:
  - 🔴 "HDFC Savings falls below ₹10,000 on 22 May"
  - 🔴 "ICICI CC crosses limit on 18 May"
  - 🟡 "3 stale entries — did they happen?" (tap → filter to stale list)

**Stale entries section** (only shown if any exist)
- Card with title "Planned entries that may have passed"
- One row per stale entry:
  - Description (merchant, amount, date planned)
  - Three-button row: **It happened** · **Reschedule** · **Remove**

**Planned entries list**
- Grouped by date: Today · Tomorrow · This week · Later.
- Each row:
  - Amount pill (red for out, green for in)
  - Description / merchant
  - Account label
  - Category (when set)
  - Seeded-source tag (small icon) — `reminder` / `cc forecast` / `manual`
  - Fulfilled tag (green ✓) when linked to a real transaction
  - Tap row → edit form
  - Swipe / long-press → Duplicate / Delete
- **FAB + Add** — opens Add Planned Entry sheet.

**Account trajectory section** (deep-dive, tap to expand)
- One card per affected account.
- Line chart: x-axis = date (today → horizon), y-axis = balance.
- Current balance marker + horizon-balance marker.
- Red shaded region below min-balance (for savings accounts).
- Red shaded region above credit limit (for credit cards).

**Budget impact section** (optional expand)
- Same layout as the Budget tab's current month.
- Each category shows: current realized spend + planned simulated spend + budget cap.
- Over-cap categories surface in red.

### Screen 3 — Add / edit planned entry (bottom sheet)

- **Direction toggle**: Outgoing / Incoming
- **Amount** (required)
- **Date** (default: today, calendar picker)
- **Account** (required, list of active accounts — filtered by direction semantics)
- **Category** (optional, expenses only)
- **Merchant / description** (optional)
- **Save** / **Cancel** buttons

### Screen 4 — Stale entry reconcile sheet

Triggered by tapping a stale entry's "It happened" button.

- Fuzzy-matched candidate transactions from the last ±3 days, ±5% amount, same account (if set).
- Each candidate: tap to link.
- **"Pick from all transactions"** fallback — opens a full search.

---

## 5. Lifecycle & evolution (the "living simulator")

### Baseline re-pivot (automatic)

- Baseline = current realized balances, computed via existing balance-sheet service.
- Re-computed on every scenario open + on every `useDataRefresh` signal.
- No user action needed — when fresh SMS data arrives, simulator re-runs from the updated state.

### Planned entry states

Each `simulation_entries` row has a `status`:

| Status | Condition | Counts in simulation? | UI affordance |
|--------|-----------|------------------------|---------------|
| `upcoming` | date ≥ today, no match yet | Yes | Normal row, editable |
| `fulfilled` | Linked (auto or manual) to a real transaction | No (reality replaces it) | Green ✓ row, shows linked expense |
| `stale` | date < today, no match after fulfillment scan | No | Surfaced in top warning card, 3 actions |
| `dismissed` | User explicitly removed | No | Not shown; soft-deleted for 30 days |

### Fulfillment detection

Runs on scenario open + on data-refresh. For each `upcoming` entry with date < today:

1. Search `expenses` (or `account_transfers` for inflow-credit) for a row matching:
   - Same `account_id` (if entry has one; else any account)
   - Amount within ±5%
   - Date within ±3 days of planned date
   - `deleted_at IS NULL`
2. If exactly one candidate: auto-link → status becomes `fulfilled`, `fulfilled_expense_id` stamped.
3. If multiple: status becomes `stale`, user resolves via sheet.
4. If zero: status becomes `stale`, user picks Reschedule / It happened / Remove.

### Stale entry actions

- **Reschedule** — user picks a new future date. `date` updated, `originally_planned_for` preserved, status back to `upcoming`.
- **It happened** — reconcile sheet opens; user links to a real transaction. Status becomes `fulfilled`.
- **Remove** — status becomes `dismissed`. Soft-deleted; hard-purged after 30 days.

### Retention policy

- `fulfilled` + `dismissed` entries: hard-deleted 30 days past the scenario's horizon date.
- Expired scenarios (today > horizon): move to "Archived" section; read-only.
- Scenarios auto-archived after 90 days past horizon.
- Scenarios hard-deleted after 180 days past horizon.
- **Default scenario** — never archived; horizon auto-rolls forward on day 1 of each month. Rolled-forward default starts fresh (seeded entries re-loaded; user's manual entries carry over ONLY if they're still upcoming/future-dated).

### Default scenario roll-forward

On every simulator open:

- If the default scenario's `horizon_date` is in the past, auto-update it to end of current month.
- Drop stale/fulfilled entries from the old horizon.
- Re-seed from current reminders + open CC forecasts.
- User's own future-dated manual entries survive.

---

## 6. Data model

### New tables (migration 025)

```sql
-- Named what-if scenarios
CREATE TABLE simulation_scenarios (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  horizon_date  TEXT NOT NULL,                -- YYYY-MM-DD
  is_default    INTEGER NOT NULL DEFAULT 0,   -- 1 for the auto-rolling default
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at   TEXT                          -- NULL = active
);
CREATE INDEX idx_sim_scen_user ON simulation_scenarios(user_id, archived_at);

-- Planned entries within a scenario
CREATE TABLE simulation_entries (
  id                      TEXT PRIMARY KEY,
  scenario_id             TEXT NOT NULL REFERENCES simulation_scenarios(id) ON DELETE CASCADE,
  direction               TEXT NOT NULL CHECK (direction IN ('out','in')),
  amount                  REAL NOT NULL,
  date                    TEXT NOT NULL,       -- YYYY-MM-DD (current planned date)
  originally_planned_for  TEXT,                -- populated on reschedule
  account_id              TEXT,                -- loose ref; no FK
  category_id             TEXT,                -- loose ref
  merchant_name           TEXT,
  description             TEXT,
  source                  TEXT NOT NULL CHECK (source IN ('manual','seeded_reminder','seeded_forecast')),
  seed_source_id          TEXT,                -- reminder_id or forecast_id if seeded
  fulfilled_expense_id    TEXT,                -- populated when linked to a real expense / transfer
  status                  TEXT NOT NULL DEFAULT 'upcoming'
                          CHECK (status IN ('upcoming','fulfilled','stale','dismissed')),
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sim_entries_scenario ON simulation_entries(scenario_id, status);
CREATE INDEX idx_sim_entries_date ON simulation_entries(scenario_id, date);
```

Both tables added to `BACKUP_TABLES` + `TABLE_SCHEMAS` — scenarios + entries round-trip via backup file.

### No changes to existing tables. No FK writes into `expenses`.

---

## 7. Simulation engine

Pure function: `services/simulator-engine.ts`. Testable without DB.

**Input:**
```ts
{
  startBalances: Map<accountId, {
    balance: number;
    type: AccountType;
    minBalance?: number;
    creditLimit?: number;
  }>,
  entries: SimulationEntry[],   // only upcoming, date-ascending
  horizonDate: string,
}
```

**Output:**
```ts
{
  endBalances: Map<accountId, number>,
  trajectory: Array<{
    date: string;
    balances: Map<accountId, number>;
  }>,
  warnings: Array<{
    accountId: string;
    accountLabel: string;
    kind: 'min_balance_breach' | 'cc_over_limit' | 'negative_balance';
    date: string;
    amount: number;
  }>,
  netWorthStart: number,
  netWorthEnd: number,
}
```

**Algorithm:**

```
state = cloneMap(startBalances)
trajectory = [{ date: today, balances: cloneMap(state) }]
warnings = []

for entry in entries.sortByDate:
  if entry.direction == 'out':
    state[entry.accountId].balance -= entry.amount
  else:
    state[entry.accountId].balance += entry.amount
  checkWarnings(state, entry.date, warnings)
  trajectory.push({ date: entry.date, balances: cloneMap(state) })

trajectory.push({ date: horizon, balances: cloneMap(state) })
return { endBalances, trajectory, warnings, netWorth{Start,End} }
```

**Warnings:**

- `min_balance_breach` — savings / wallet account.balance < account.minBalance
- `cc_over_limit` — CC account.balance > account.creditLimit (balance = utilized)
- `negative_balance` — any non-CC account.balance < 0

Complexity O(N × A). Sub-millisecond for N=100 entries, A=20 accounts.

---

## 8. Service surface

### `services/simulator.ts` — DB-backed CRUD + orchestration

- `getOrCreateDefaultScenario(userId)` — returns active default, rolling forward if expired.
- `listActiveScenarios(userId)` — all active (not archived).
- `listArchivedScenarios(userId, limit)` — past scenarios, 90-day window.
- `createScenario(userId, input)` — new named scenario with optional seeded entries.
- `updateScenario(id, patch)` — name, horizon_date, archived_at.
- `duplicateScenario(id)` — copies entries over, fresh id + timestamps.
- `deleteScenario(id)` — hard delete (CASCADE to entries).
- `archiveScenario(id)` — soft archive.
- `getScenarioWithEntries(id)` — one-shot fetch.
- `createEntry(scenarioId, input)` — manual add.
- `updateEntry(entryId, patch)` — amount/date/account/category/description.
- `duplicateEntry(entryId)` — copy with new id.
- `deleteEntry(entryId)` — hard delete.
- `rescheduleEntry(entryId, newDate)` — moves to future, sets originally_planned_for.
- `fulfillEntry(entryId, expenseId)` — links to real transaction.
- `dismissEntry(entryId)` — status='dismissed'.
- `seedScenarioFromReminders(scenarioId)` — pull reminders + CC forecasts into horizon.
- `reconcileStale(scenarioId)` — runs fulfillment detector, marks stale.
- `purgeRetention(userId)` — runs on simulator open; deletes old stale/fulfilled + archives expired + hard-deletes aged scenarios.

### `services/simulator-engine.ts` — Pure sim

- `runSimulation(input)` — the main function.
- `findFulfillmentCandidate(entry, realTransactions)` — matcher.

---

## 9. UX consistency rules

- Cards use existing `<Card>` component.
- Colors from StatusColors + accent palette — no hardcoded hex.
- Warnings use `danger` / `warning` pills consistent with MinBalanceAlert / Upcoming Dues.
- Charts use existing SVG primitives (same as YoyComparisonRow / ForecastBreakdown).
- Bottom sheets follow RecurringRuleSheet / DematTransferTargetSheet pattern.
- Terminology: "Simulator", "scenario", "planned entry" — no "simulation event" / "forecast" jargon (reserved terms).

---

## 10. Acceptance criteria

- [ ] AC-1: User can open the simulator from Home tab → Explore & Tools card.
- [ ] AC-2: First-time open auto-creates the default scenario with current-month horizon.
- [ ] AC-3: Default scenario is auto-seeded with every reminder with `next_due_date` in the horizon + every open CC repayment forecast in the horizon.
- [ ] AC-4: User can add, edit, duplicate, delete a planned entry. No side-effect on real data.
- [ ] AC-5: Adding an entry immediately updates the overview (net worth, warnings, trajectory).
- [ ] AC-6: Horizon picker changes are persisted; simulation re-runs with new horizon.
- [ ] AC-7: User can create a named scenario, rename it, delete it.
- [ ] AC-8: Duplicating a scenario copies all entries with fresh IDs.
- [ ] AC-9: User can mark a stale entry as fulfilled, reschedule, or remove.
- [ ] AC-10: Fulfilled entries link to and open the real transaction.
- [ ] AC-11: Backup file includes scenarios + entries. Restore on a new install surfaces them.
- [ ] AC-12: Min-balance breach and CC over-limit warnings fire correctly.
- [ ] AC-13: Default scenario auto-rolls forward after its horizon passes.
- [ ] AC-14: Old scenarios auto-archive after 90d past horizon; hard-delete after 180d.
- [ ] AC-15: All new tests pass. TS clean.

---

## 11. Success metrics

- User uses the simulator at least once per month in each of the following 3 months.
- At least one user-created scenario (beyond the default) per month.
- Zero data-corruption reports.
- Zero crashes in the simulator flow.

---

## 12. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| User confuses simulator with real data | Visual separation (separate screen, separate icons, clear "Planned" / "What-if" labels throughout) |
| Fulfillment detector false-positives — links wrong expense | Require exact account match when entry has one; ±5% tolerance only; always let user unlink |
| Fulfillment detector false-negatives — leaves real fulfillments as stale | Acceptable — user can always tap "It happened" → pick manually |
| Large scenario / many entries slow the engine | Engine is O(N×A), pure JS — scales to thousands easily. No concern. |
| Schema migration 025 fails mid-run | PRAGMA table_info guards + idempotent index creation (same pattern as 022/023/024) |
| Default scenario auto-roll clobbers user-added entries | Only drop status=`stale`/`fulfilled`/`dismissed`; carry forward `upcoming` with future date |

---

## 13. Out-of-scope deferrals (future versions)

- Multi-currency per-scenario — v16.x
- SMS-based salary / recurring credit auto-detection — v16.1.0
- Monte Carlo / stress test — v17
- Goal-based simulation ("how much can I invest?") — separate feature
- Cross-device scenario sync — never (local-first charter)
- Budget simulation — Budget tab owns that
