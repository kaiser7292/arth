# Fix Missing Database Migrations

Add missing migrations 044 and 045 to the migration index to fix database initialization failure in v17.6.12.

## Problem
Migrations 044 (expense_edit_history_fk) and 045 (app_logs) exist as files but are not imported or registered in `database/migrations/index.ts`. The migrations array ends at 043, causing these migrations to never run during database initialization.

## Solution
Edit `database/migrations/index.ts` to:
1. Add import: `import migration044 from "./044_expense_edit_history_fk";`
2. Add import: `import migration045 from "./045_app_logs";`
3. Add `migration044` and `migration045` to the migrations array in order (after migration043)

## Files to Modify
- `database/migrations/index.ts` (add 2 imports and 2 array entries)
