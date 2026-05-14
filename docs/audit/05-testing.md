# Testing Audit

## Quick Wins (Low Effort, High Impact)

### 🟡 HIGH — `deactivateHisaabPerson` test is commented out with a TODO
**File:** `__tests__/integration/hisaab.test.ts` line 108  
```ts
// TODO: Fix deactivateHisaabPerson import issue
// await deactivateHisaabPerson("person-1");
```
**Issue:** A core hisaab soft-delete operation has no test coverage. The import issue should be resolved and the test enabled.  
**User / UX Impact:** If `deactivateHisaabPerson` has a silent bug (e.g. fails to set `deleted_at`, or deletes the wrong rows), the user who deactivates a hisaab contact would either still see them listed (soft delete didn't work), or lose all their associated hisaab entries permanently (hard delete instead of soft). Either outcome corrupts the hisaab ledger with no warning. Without a test, this regression is undetectable until a user reports it.  
**Fix:** Resolve the import, uncomment and fix the test.

---

### 🟡 HIGH — Migration 042 is never exercised by tests (uses `getDatabase()` not param)
**File:** `database/migrations/042_simulator_transfers.ts`  
**Issue:** Because migration 042 ignores the `db` parameter and calls `getDatabase()`, any test that creates a mock/in-memory DB and passes it to `runMigrations()` will silently skip the actual schema change in migration 042. No test currently covers this migration's effect.  
**User / UX Impact:** A broken migration 042 means the Simulator's transfer entry columns never get added. Users who create a Cash Flow Simulator scenario with account-to-account transfers would see those entries saved but immediately show blank/null account fields — or the insert would fail silently. The simulator would appear to work but transfer data would be lost or malformed, with no error shown to the user.  
**Fix:** Fix the migration signature (see DB schema audit), then add a test that verifies `from_account_id` and `to_account_id` columns exist on `simulation_entries` post-migration.

---

### 🟡 HIGH — No test for backup/restore round-trip of `simulation_entries` with transfer columns
**File:** `__tests__/` (no existing test)  
**Issue:** Given that `simulation_entries.from_account_id` and `to_account_id` are missing from `TABLE_SCHEMAS`, there's also no test verifying these columns survive a backup/restore cycle.  
**User / UX Impact:** A user who builds simulator scenarios with transfer entries, takes a backup, then restores (e.g. switching phones or recovering from data loss) will find all their transfer entries have lost account associations. The simulator shows unattributed cash flows, net-worth projections are wrong, and the user has no way to know the restore was incomplete — the backup appeared to succeed and the restore showed no errors.  
**Fix:** Add a unit test in `backup.test.ts` or a new `simulator-backup.test.ts` that writes a simulation entry with account columns and verifies they are present after restore.

---

### 🟡 HIGH — No test for `settings` table backup
**File:** `__tests__/` (no existing test)  
**Issue:** Migration 043 creates the `settings` table but it's absent from `TABLE_SCHEMAS` and `BACKUP_TABLES`. No test catches this regression.  
**User / UX Impact:** Any settings stored in the DB `settings` table (current or future) silently vanish after a restore. The user restores their backup expecting everything to be exactly as it was, but certain preferences reset to defaults. Without a test flagging this gap, the issue won't be caught until a real user reports it — by which time their original settings are gone.  
**Fix:** Add a test that creates a `settings` row and verifies it survives backup/restore.

---

### 🟡 MEDIUM — `notification-scheduler.test.ts` doesn't test monthly summary day-1 deduplication
**File:** `__tests__/unit/notification-scheduler.test.ts`  
**Issue:** The monthly summary fires every time the app opens on day 1 (see functional audit). No test covers this scenario.  
**User / UX Impact:** Without this test, the duplicate-notification bug on the 1st of each month (see Functional audit) will keep shipping undetected. Users receive multiple identical "May: ₹42,500 spent" notifications and may disable the monthly summary feature entirely to stop the duplicates, losing a genuinely useful financial recap.  
**Fix:** Add a test that calls `runDailyNotificationCheck` twice on a mocked day-1 date and asserts the summary notification is only sent once.

---

### 🟡 MEDIUM — `v14-regression.test.ts` and `v4-payment-mode-inference.test.ts` were just modified
**File:** `__tests__/unit/v14-regression.test.ts`, `__tests__/unit/v4-payment-mode-inference.test.ts`  
**Issue:** These were modified in the last commit (notification collector removal). Worth verifying they all pass and the changes didn't inadvertently relax assertions.  
**User / UX Impact:** If assertions were relaxed to fix a failing test rather than fixing the underlying code, SMS parsing or payment mode inference regressions would go undetected. Users who rely on automatic SMS categorization could see expenses parsed with wrong amounts, wrong merchants, or wrong payment modes — silently incorrect data that they may not notice until reviewing their monthly budget.  
**Action:** Run `npm test -- --testPathPattern="v14-regression|v4-payment-mode"` and review any changes.

---

### 🟡 MEDIUM — No integration test for cold-start DB init sequence
**File:** `__tests__/integration/`  
**Issue:** `initDatabase()` runs migrations → seed → seedMerchantMappings → seedPublicData in sequence. No integration test covers the full startup path. A regression in migration ordering or seed logic would only be caught at runtime.  
**User / UX Impact:** A broken DB init sequence means the app fails to launch for new installs or post-upgrade. The user would see the splash screen freeze on "Preparing database..." and then either white-screen or show a generic init error with no recovery path. This is the most severe possible user experience failure — a complete inability to open the app — and without an integration test it could ship undetected in a release.  
**Fix:** Add an integration test that calls `initDatabase()` on a fresh in-memory DB and asserts all expected tables exist with correct columns.

---

### 🟡 MEDIUM — SMS parser tests use hardcoded date strings with "26" year suffix
**File:** `__tests__/unit/sms-parser.test.ts` lines 698, 712, 739  
**Issue:** Test SMS strings contain dates like `12-04-26` (April 12, 2026). When the calendar moves past 2026, these tests may fail or produce wrong results if the SMS parser does relative date interpretation.  
**User / UX Impact:** No current user impact. After 2026, if the parser does relative-year interpretation, SBI and other bank SMS messages with 2-digit years could be parsed with the wrong year (e.g. "12-04-27" interpreted as 2027 or 1927 depending on the pivot logic). This would cause imported expenses to appear on the wrong date — a subtle data corruption that users only notice when reviewing historical spending and finding transactions dated years in the future or past.  
**Fix:** Use clearly synthetic/future dates (e.g., `12-04-30`) or add a comment explaining they're intentionally year-anchored.

---

### 🟢 LOW — `uuid.test.ts` is a single 491-byte file
**File:** `__tests__/unit/uuid.test.ts`  
**Issue:** UUID test is likely just a smoke test. It should verify: (a) valid UUID v4 format, (b) uniqueness across N calls, (c) uses CSPRNG path when available (mock `globalThis.crypto` as undefined to test fallback).  
**User / UX Impact:** If the `Math.random()` fallback path generates non-unique UUIDs in a degenerate case (seeded PRNG collision), two expenses or hisaab entries could end up with the same primary key. SQLite would throw a UNIQUE constraint violation on insert, the expense save would fail with an unhandled error, and the user would lose the transaction they just entered with no meaningful error message.  
**Fix:** Expand to cover the fallback path explicitly.

---

### 🟢 LOW — `components.test.tsx` is only 2992 bytes
**File:** `__tests__/unit/components.test.tsx`  
**Issue:** A single test file for all UI components is likely very shallow coverage.  
**User / UX Impact:** UI component regressions (broken rendering, missing props, accessibility failures) go undetected. A broken `DonutChart`, `TrendBarChart`, or core UI component could ship without any test failing, only becoming visible to users after a release. Given these components appear on high-traffic screens (Home, Budget, Insights), a render crash here affects most users immediately.  
**Fix:** Audit what's covered and expand or split into per-component test files.

---

## Coverage Gaps Summary

| Missing Coverage | Suggested Test Location | Effort |
|-----------------|------------------------|--------|
| `deactivateHisaabPerson` | hisaab.test.ts (integration) | 30 min |
| Migration 042 effect | new migration.test.ts | 30 min |
| Backup/restore of simulator transfer cols | backup.test.ts | 1h |
| Backup/restore of settings table | backup.test.ts | 30 min |
| Monthly summary deduplication | notification-scheduler.test.ts | 30 min |
| Full cold-start DB init sequence | integration/ | 2h |
| UUID fallback path | uuid.test.ts | 15 min |

## Summary Table

| Severity | Issue | File | Effort |
|----------|-------|------|--------|
| 🟡 High | Hisaab deactivation test commented out | hisaab.test.ts | 30 min |
| 🟡 High | Migration 042 not tested (wrong db pattern) | 042_simulator_transfers.ts | 30 min |
| 🟡 High | Simulator transfer cols not in backup test | backup.test.ts | 1h |
| 🟡 High | Settings table backup not tested | backup.test.ts | 30 min |
| 🟡 Medium | Monthly summary day-1 dedup not tested | notification-scheduler.test.ts | 30 min |
| 🟡 Medium | v14/v4 regression tests changed — verify | unit/ | 15 min |
| 🟡 Medium | No full DB init integration test | integration/ | 2h |
| 🟡 Medium | SMS test dates may age out | sms-parser.test.ts | 15 min |
| 🟢 Low | UUID fallback path untested | uuid.test.ts | 15 min |
| 🟢 Low | Component tests very shallow | components.test.tsx | 2h |
