# Backup & Restore

[← back to Feature Map](../FEATURE_MAP.md)

## In plain English

Backup exports your *entire* database into one encrypted file. Restore is destructive — it wipes the tables it knows about and rewrites them from the backup file. This is the only way your data ever leaves the device.

If something is missing or reset to a default value *specifically after a restore* (and was fine before), the most likely cause isn't a bug in your data — it's that whichever column held that information wasn't on the list of columns the restore process knows how to write back. The fix in that case is always: find the missing column → add it to the restore whitelist (`TABLE_SCHEMAS.ts`) → re-test.

## Technical

**File:** `services/backup.ts` — AES-256-GCM encrypted `.arth` files (the older `.artha` extension is still accepted on restore, for files backed up before the Arth rename).

**Restore mechanics:**
1. `PRAGMA foreign_keys = OFF` (otherwise FK cascades would delete rows mid-restore), DELETE all rows in `BACKUP_TABLES` in reverse order, INSERT in forward order using `INSERT OR REPLACE`, `PRAGMA foreign_keys = ON` after.
2. **Column whitelist**: only columns listed in `TABLE_SCHEMAS[table]` get inserted — even if the backup *file* has data for a column, if that column isn't in the whitelist, it's silently dropped. This is the #1 cause of "data went missing after restore."
3. **`INSERT OR REPLACE` = DELETE + INSERT.** Any column not included in a given INSERT resets to its schema default (usually `NULL`) — so the whitelist has to be the *complete* column list for that table, not just "whatever changed."
4. **Post-restore repair** (runs inside the same transaction, because migrations already ran on an empty DB *before* the restore — any migration that "promotes" existing data has to be redone here as an explicit step):
   - Promote legacy `account_credits` rows into `expenses` with `nature='credit'`.
   - Force `nature='credit'` on any row with `refund_of_expense_id` set that came back as `'realized'`.
   - Re-link `hisaab_entries.linked_expense_id` from legacy `linked_account_credit_id`.
   - Re-link `hisaab_entries.linked_expense_id` from `expense_splits.expense_id` when null but the bridge row exists (see `.context/features/hisaab.md` — this is the durable recovery path).

**The checklist that prevents the whole class of bug** (this is `CLAUDE.md`'s "Database Changes Checklist" — read it in full before adding any column): every new column needs (1) a migration, (2) a `TABLE_SCHEMAS.ts` entry, (3) a `BACKUP_TABLES` entry if it's user data, (4) cascade-path updates, (5) updated test mocks, (6) every SQL query that should now select it. Missing step 2 is what silently corrupts data on restore; it's the easiest one to forget because the column works perfectly fine right up until someone restores a backup.
