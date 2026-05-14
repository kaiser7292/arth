# DB Schema Audit

## Quick Wins (Low Effort, High Impact)

### 🔴 CRITICAL — `simulation_entries` columns missing from TABLE_SCHEMAS
**File:** `database/TABLE_SCHEMAS.ts` → `simulation_entries`  
**Migration:** `042_simulator_transfers.ts` adds `from_account_id` and `to_account_id`  
**Impact:** Backup/restore silently drops these columns for all simulator transfer entries. Any transfer entry created after v16.0.9 loses its account linkage on restore.  
**User / UX Impact:** After a backup restore, any Cash Flow Simulator scenario that included transfer entries (money moving from one account to another) will show those entries with blank/null accounts. The "from" and "to" account labels disappear — transfers look like unattributed cash movements and the simulator's net-flow calculations will be wrong for those scenarios. The user sees no error; data is just silently corrupted.  
**Fix:** Add `"from_account_id"` and `"to_account_id"` to the `simulation_entries` array in `TABLE_SCHEMAS.ts`.

---

### 🔴 CRITICAL — `settings` table absent from TABLE_SCHEMAS and BACKUP_TABLES
**File:** `database/TABLE_SCHEMAS.ts`, `services/backup.ts` → `BACKUP_TABLES`  
**Migration:** `043_settings_table.ts` creates the `settings` table  
**Impact:** The `settings` table is never backed up. Any per-user config stored there (added in future features) will be lost on restore.  
**User / UX Impact:** Currently the table is empty so no visible user impact yet. However, as soon as any feature starts writing to the `settings` table (e.g. per-user notification preferences, fiscal year overrides stored in DB), those settings will be silently wiped on every backup restore. The user would need to manually reconfigure those settings after restoring — with no explanation why they changed.  
**Fix:** Add `settings` to both `TABLE_SCHEMAS` (with columns `user_id`, `key`, `value`, `updated_at`) and to `BACKUP_TABLES` in `backup.ts`.

---

### 🟡 HIGH — Migration 042 uses `getDatabase()` directly (wrong pattern)
**File:** `database/migrations/042_simulator_transfers.ts`  
**Issue:** All other migrations receive `db: SQLiteDatabase` as a parameter via the `Migration.up(db)` interface. Migration 042 ignores the parameter and calls `getDatabase()` internally. This breaks test isolation (tests mock the passed-in db) and contradicts the `Migration` interface.  
**User / UX Impact:** No direct visible impact in production (same DB instance is returned). However, because tests cannot intercept this migration, any regression in how migration 042 applies (e.g. a future ALTER TABLE conflict) will only be discovered at runtime on a user's device — not in CI. The user could see a crash or a DB init failure on upgrade if this migration breaks.  
**Fix:** Change signature to accept `db: SQLiteDatabase` and remove the `getDatabase()` import/call. Also remove the `down()` method — no other migrations implement `down` and it implies a guarantee that doesn't exist.

---

### 🟡 HIGH — Migration numbering gaps (037, 041)
**Files:** `database/migrations/index.ts`  
**Issue:** Migrations 037 and 041 are missing (deleted with the notification collector). The gaps are harmless for existing installs but create confusion and make the version sequence non-contiguous. Comments in the index explaining the gaps would prevent future developers from accidentally reusing those numbers.  
**User / UX Impact:** No current user impact. Future risk: if a developer accidentally adds a new migration as `037` or `041`, existing user devices that already ran a higher migration will skip it silently (the migration runner skips already-applied version numbers). The user's DB would be missing schema changes — causing runtime crashes or silent data loss with no warning shown.  
**Fix:** Add inline comments in `index.ts` noting the gaps (e.g. `// 037: removed in vX.X.X`, `// 041: removed in vX.X.X`).

---

### 🟡 MEDIUM — `expense_edit_history` missing FK constraint on `expense_id`
**File:** `database/migrations/040_expense_edit_history.ts`  
**Issue:** The `expense_id` column has no `REFERENCES expenses(id)` FK. With `PRAGMA foreign_keys = ON`, this means orphaned history rows accumulate if an expense is deleted.  
**User / UX Impact:** The Edit History screen (if navigated to for a deleted expense via a stale reference or deep link) may show ghost history entries for expenses that no longer exist. Over time, the `expense_edit_history` table bloats with orphaned rows, adding noise to DB size reports and slowing down any full-table scans. The user would not see an error but the data would be meaningless.  
**Fix:** Either add `REFERENCES expenses(id) ON DELETE CASCADE` in a new migration, or ensure `data-cleanup.ts` clears orphaned edit history when expenses are deleted.

---

### 🟡 MEDIUM — `settings` table has a redundant index
**File:** `database/migrations/043_settings_table.ts`  
**Issue:** The table has `PRIMARY KEY (user_id, key)` which SQLite already indexes. The additional `CREATE INDEX idx_settings_user_key ON settings(user_id, key)` is a duplicate index that wastes storage.  
**User / UX Impact:** No functional impact visible to the user. Slightly larger DB file size (a few KB) and marginally slower write operations on settings rows due to SQLite maintaining two identical indexes on every insert/update. No user-visible slowdown at current data volumes.  
**Fix:** Remove the `CREATE INDEX` statement from migration 043.

---

### 🟢 LOW — `expense_edit_history` name in migration 040 inconsistent
**File:** `database/migrations/040_expense_edit_history.ts`  
**Issue:** The migration name is `"040_expense_edit_history"` (with number prefix) while all others use plain names like `"expense_edit_history"`. This is cosmetic but inconsistent.  
**User / UX Impact:** None. This is a developer-only concern — the migration name is only used in internal logs and debugging.  
**Fix:** Change `name: "040_expense_edit_history"` to `name: "expense_edit_history"`.

---

### 🟢 LOW — `users.settings` column in TABLE_SCHEMAS has no corresponding migration column
**File:** `database/TABLE_SCHEMAS.ts` line 16  
**Issue:** `users` schema lists a `"settings"` column, but the consolidated schema migration (`001`) does not appear to add it. Worth verifying it exists in the actual table DDL.  
**User / UX Impact:** If the column doesn't actually exist in the DB, any future code that tries to read/write `users.settings` would throw a SQLite "no such column" error — which could crash the relevant screen or silently produce null data. At current code levels nothing reads this column so there is no visible impact yet.  
**Fix:** Verify with `PRAGMA table_info(users)` and remove if absent, or document which migration adds it.

---

## Summary Table

| Severity | Issue | File | Effort |
|----------|-------|------|--------|
| 🔴 Critical | `simulation_entries` missing new cols in TABLE_SCHEMAS | TABLE_SCHEMAS.ts | 5 min |
| 🔴 Critical | `settings` table not in backup | TABLE_SCHEMAS.ts + backup.ts | 10 min |
| 🟡 High | Migration 042 wrong db pattern | 042_simulator_transfers.ts | 15 min |
| 🟡 High | Migration gaps 037/041 undocumented | index.ts | 5 min |
| 🟡 Medium | expense_edit_history no FK | 040_expense_edit_history.ts | new migration |
| 🟡 Medium | settings table duplicate index | 043_settings_table.ts | 5 min |
| 🟢 Low | Inconsistent migration name | 040_expense_edit_history.ts | 2 min |
| 🟢 Low | users.settings column unverified | TABLE_SCHEMAS.ts | 10 min |
