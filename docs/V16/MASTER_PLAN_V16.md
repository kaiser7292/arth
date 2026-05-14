# Artha v16.0.0 — Master Plan

**Scope:** Cash-flow simulator ("What-if")
**PRD:** [PRD_V16.md](./PRD_V16.md)
**TDD:** [TDD_V16.md](./TDD_V16.md)

---

## Mandatory behaviors for this session

1. **One task at a time. Mark complete immediately on finish. No batching.**
2. **Read the PRD + TDD before coding any new file.** Don't improvise the feature.
3. **Test per phase.** No "I'll write tests at the end."
4. **No FK writes into expenses.** Simulator state is fully isolated.
5. **Every simulator entry/scenario has `created_at` + `updated_at` written on every mutation.** Critical for retention.
6. **Migrations are idempotent.** PRAGMA guards for column adds, `IF NOT EXISTS` for tables + indexes.

---

## Phased task list

### Phase 1 — Docs
- [x] Write PRD_V16.md (scope, lifecycle, data model, acceptance criteria)
- [x] Write MASTER_PLAN_V16.md (this file)
- [ ] Write TDD_V16.md (schema, engine algorithm, service API, test plan)

### Phase 2 — Data layer
- [ ] Migration 025: create `simulation_scenarios` + `simulation_entries` + indexes
- [ ] Register migration in `database/migrations/index.ts`
- [ ] Add both tables to `database/TABLE_SCHEMAS.ts` whitelist
- [ ] Add both tables to `services/backup.ts` BACKUP_TABLES in correct dependency order
- [ ] Add FK cleanup to `services/data-cleanup.ts` cleanupData for wipe-all path

### Phase 3 — Engine (pure functions)
- [ ] `services/simulator-engine.ts`:
  - [ ] `runSimulation(input)` — main function
  - [ ] `findFulfillmentCandidate(entry, realTransactions)` — fuzzy matcher
  - [ ] `checkWarnings(state, date)` — returns warning list
  - [ ] `cloneBalanceState(state)` — helpers
- [ ] Tests: `__tests__/unit/simulator-engine.test.ts` (≥15 tests)
  - [ ] Empty entries → trajectory = [today, horizon]
  - [ ] Single expense applied on date
  - [ ] Multiple entries in date-asc order
  - [ ] Entries out of order still sorted
  - [ ] Min-balance breach on savings fires warning
  - [ ] CC over-limit fires warning
  - [ ] Negative balance fires warning
  - [ ] Fulfillment candidate match — exact amount + account + date
  - [ ] Fulfillment candidate no-match — amount out of tolerance
  - [ ] Fulfillment candidate no-match — date out of window
  - [ ] Fulfillment candidate no-match — account mismatch
  - [ ] NetWorth start/end correctly computed across asset / liability types
  - [ ] Warnings dedupe per account per kind
  - [ ] Out entries reduce balance, In entries increase
  - [ ] CC expenses correctly increase utilized

### Phase 4 — DB service
- [ ] `services/simulator.ts`:
  - [ ] Types: `SimulationScenario`, `SimulationEntry`, inputs
  - [ ] `getOrCreateDefaultScenario(userId)` + auto-roll-forward
  - [ ] `listActiveScenarios(userId)`
  - [ ] `listArchivedScenarios(userId, days = 90)`
  - [ ] `getScenarioWithEntries(id)`
  - [ ] `createScenario(userId, input)`
  - [ ] `updateScenario(id, patch)`
  - [ ] `duplicateScenario(id)`
  - [ ] `archiveScenario(id)`
  - [ ] `deleteScenario(id)` — cascades to entries via FK
  - [ ] `createEntry(scenarioId, input)`
  - [ ] `updateEntry(entryId, patch)`
  - [ ] `duplicateEntry(entryId)`
  - [ ] `rescheduleEntry(entryId, newDate)`
  - [ ] `fulfillEntry(entryId, expenseId)`
  - [ ] `dismissEntry(entryId)`
  - [ ] `deleteEntry(entryId)`
  - [ ] `seedScenarioFromReminders(scenarioId)` — pulls reminders + CC forecasts into horizon
  - [ ] `reconcileStale(scenarioId)` — fulfillment scan, marks stale
  - [ ] `purgeRetention(userId)` — 30d past horizon for entries, 90d archive, 180d hard-delete
  - [ ] `computeBaselineBalances(userId)` — wraps existing balance-sheet service
- [ ] Tests: `__tests__/integration/simulator.test.ts` (≥15 tests)
  - [ ] Default scenario auto-created on first open
  - [ ] Default scenario rolls forward past horizon
  - [ ] Seed from reminders pulls current-horizon reminders
  - [ ] Seed from CC forecasts pulls open repayments
  - [ ] createEntry → scenario updated_at bumped
  - [ ] updateEntry amount / date / account
  - [ ] duplicateEntry returns new id
  - [ ] rescheduleEntry sets originally_planned_for
  - [ ] fulfillEntry links to real expense
  - [ ] dismissEntry sets status='dismissed'
  - [ ] deleteScenario cascades to entries
  - [ ] Retention: fulfilled entries 30d past horizon → purged
  - [ ] Retention: archived scenarios 90d past horizon → archived_at set
  - [ ] Retention: archived scenarios 180d past horizon → hard-deleted
  - [ ] reconcileStale marks past-date unmatched entries as stale

### Phase 5 — UI
- [ ] `app/simulator/_layout.tsx` — stack layout
- [ ] `app/simulator/index.tsx` — scenario list
  - [ ] Active scenarios section
  - [ ] Archived scenarios (collapsible)
  - [ ] + New scenario button
  - [ ] Tap card → /simulator/[id]
- [ ] `app/simulator/[id].tsx` — scenario detail
  - [ ] Header (name, horizon, menu)
  - [ ] Overview card (today → horizon, delta, warnings pills)
  - [ ] Stale entries card (when count > 0)
  - [ ] Planned entries list (grouped by date)
  - [ ] Account trajectory section (tap to expand)
  - [ ] Budget impact section (tap to expand)
  - [ ] FAB: + Add entry
- [ ] `components/simulator/EntryEditSheet.tsx` — add/edit bottom sheet
- [ ] `components/simulator/StaleEntryResolveSheet.tsx` — "It happened" reconcile
- [ ] `components/simulator/TrajectoryChart.tsx` — per-account line chart
- [ ] Register screens in `constants/routes.ts`
- [ ] Register stack in `app/_layout.tsx` if needed

### Phase 6 — Home entry
- [ ] `app/(tabs)/index.tsx` — new "Explore & Tools" section
- [ ] Card: "What-if simulator · Plan this month · ₹Y,YY,YYY on [horizon]"
- [ ] Tap → /simulator

### Phase 7 — Help + docs
- [ ] `assets/docs/articles/simulator.md` — full help article
- [ ] Link cross-refs from reminders.md + refunds.md
- [ ] Regen `assets/docs/index.json` (27 → 28)

### Phase 8 — Testing + cleanup
- [ ] Update `__tests__/integration/database.test.ts` — migration 025 expectation
- [ ] Run `npx tsc --noEmit` — zero new source-file errors
- [ ] Run `npx jest` — all pass (≥30 new tests added this release)
- [ ] Update CLAUDE.md with v16.0.0 session block

### Phase 9 — Release
- [ ] Version bump: `app.json` 15.13.1 → 16.0.0, versionCode 151301 → 160000
- [ ] git add + commit
- [ ] git push
- [ ] gh release create v16.0.0 with release notes
- [ ] `./bin/build-apk.sh`
- [ ] gh release upload

---

## Session log

| Task | Status | Notes |
|------|--------|-------|
| PRD + MASTER_PLAN + TDD | [x] | In progress |
| Migration 025 | [ ] | |
| Engine | [ ] | |
| Service | [ ] | |
| UI screens | [ ] | |
| Home card | [ ] | |
| Help docs | [ ] | |
| Tests | [ ] | |
| Build + release | [ ] | |

---

## Current state

Version: **15.13.1 (shipped) → 16.0.0 (in-flight)**

All fixes from v15.13.1 are live. Starting fresh with the simulator feature. Docs first, then build down-stack-up.
