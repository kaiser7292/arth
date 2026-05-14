# Artha (अर्थ) — Version 5 Technical Design Document

**Version:** 5.0 (Draft)
**Date:** 2026-04-15
**Status:** Ready to implement
**Predecessor:** V4 TDD at `docs/V4/TDD_V4.md`

---

## 1. Overview

V5 is an audit remediation release. It adds 1 new migration, 1 new dependency, removes 1 unused dependency, deletes 5 dead-code files, splits 2 large files into modules, deduplicates 4 utilities, rewrites the backup service, and fixes 80 audit findings. Architecture remains 100% local (SQLite + MMKV, no cloud).

**Schema version after V5:** 26 migrations (14 MVP + 3 V1 + 4 V2 + 1 V3 + 2 V4 + 1 V5)
**Tables:** 26 (unchanged)
**New files:** ~15 (split modules, shared components, utility extractions)
**Deleted files:** 5 (dead code) + associated test files
**Modified files:** ~65
**New dependency:** `react-native-aes-crypto`
**Removed dependency:** `zustand`

---

## 2. Schema Changes

### 2.1 Migration 026: `deleted_at` Index

**Purpose:** Optimize soft-delete filter. Nearly every expense query includes `AND deleted_at IS NULL`, but there's no index on this column. As the table grows, full table scans slow down.

**File:** `database/migrations/026_deleted_at_index.ts`

```sql
CREATE INDEX IF NOT EXISTS idx_expenses_deleted_at ON expenses(deleted_at);
```

**Impact:** Faster queries for expense list, budget totals, insights, and all aggregate functions. No data change.

### 2.2 No Other Schema Changes

All functional bug fixes correct code that references wrong column names — the schema itself is correct:
- `yearly_plans.total_planned_expenses` exists (code wrongly says `annual_planned_expenses`)
- `yearly_plans.financial_year` exists (code wrongly says `fiscal_year`)
- `categories.is_unavoidable` exists (code wrongly says `is_avoidable`)

The backup table expansion (FUNC-2) updates the `BACKUP_TABLES` array in code, not a migration.

---

## 3. Encryption Overhaul (`services/backup.ts`)

### 3.1 New Dependency: `react-native-aes-crypto`

**Install:** `npx expo install react-native-aes-crypto`

Provides:
- `AES.encrypt(text, key, iv)` — AES-256-GCM encryption
- `AES.decrypt(cipher, key, iv)` — AES-256-GCM decryption
- `PBKDF2.hash(password, salt, iterations, keyLength)` — proper key derivation
- `HMAC.hmac256(data, key)` — integrity verification

**Why this library:** Lightest native crypto library that covers all audit needs. App already uses Expo prebuild (EAS Build), so native modules are supported.

### 3.2 Key Derivation (replaces iterated SHA-256)

**Current (broken):**
```typescript
// Iterates SHA-256 100,000 times — NOT PBKDF2
let hash = password + salt;
for (let i = 0; i < 100000; i++) {
  hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, hash);
}
```

**New:**
```typescript
const key = await PBKDF2.hash(password, salt, 600000, 256);
// Real PBKDF2 with 600,000 iterations as documented
```

### 3.3 Encryption (replaces XOR cipher)

**Current (broken):**
```typescript
// XOR each byte with SHA-256-derived keystream
for (let i = 0; i < data.length; i++) {
  const blockIndex = Math.floor(i / 32);
  const keystream = SHA256(key + iv + blockIndex);
  encrypted[i] = data[i] ^ keystream[i % 32];
}
```

**New:**
```typescript
const encrypted = await AES.encrypt(plaintext, key, iv); // AES-256-GCM
const mac = await HMAC.hmac256(encrypted, key); // Integrity check
```

### 3.4 Backup File Format V2

**V1 format (current):**
```
[4 bytes: magic "ACCM"]
[32 bytes: salt]
[16 bytes: IV]
[N bytes: XOR-encrypted JSON blob]
```

**V2 format (new):**
```
[4 bytes: magic "ACM2"]
[1 byte: format version = 2]
[32 bytes: salt]
[16 bytes: IV]
[32 bytes: HMAC-SHA256 of encrypted payload]
[4 bytes: table count (uint32)]
For each table:
  [2 bytes: table name length]
  [N bytes: table name (UTF-8)]
  [4 bytes: chunk length (uint32)]
  [N bytes: AES-256-GCM encrypted JSON chunk]
  [32 bytes: per-chunk HMAC]
```

**Backward compatibility:** On restore, check magic bytes:
- `"ACCM"` → V1 format, use legacy XOR decryption (with deprecation warning)
- `"ACM2"` → V2 format, use AES-256-GCM

### 3.5 Password Validation

```typescript
function validateBackupPassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 8) return { valid: false, error: "Password must be at least 8 characters" };
  return { valid: true };
}
```

Applied on backup creation only. Restore accepts any password (to support old backups with short passwords).

---

## 4. Backup Table Expansion

### 4.1 Updated BACKUP_TABLES Array

**Current (13 tables):**
```typescript
const BACKUP_TABLES = [
  "users", "categories", "payment_modes", "expenses", "budgets",
  "budget_breakdowns", "templates", "yearly_plans", "investment_buckets",
  "investment_contributions", "life_milestones", "milestone_contributions",
  "unavoidable_baselines",
];
```

**New (26 tables):**
```typescript
const BACKUP_TABLES = [
  // Core (existing)
  "users", "categories", "payment_modes", "expenses", "budgets",
  "budget_breakdowns", "templates", "yearly_plans", "investment_buckets",
  "investment_contributions", "life_milestones", "milestone_contributions",
  "unavoidable_baselines",
  // Missing — added in V5
  "financial_accounts",
  "salary_profiles",
  "sms_rules",
  "pending_sms",
  "merchant_mappings",
  "merchant_corrections",
  "recurring_transactions",
  "hisaab_persons",
  "hisaab_entries",
  "household_expenses",
  "household_splits",
  "merchant_aliases",
  "tags",
  "expense_tags",
  "account_payment_modes",
];
```

**Dependency order matters for restore** — tables with foreign keys must be restored after the tables they reference. The order above respects FK dependencies.

### 4.2 Streaming Export

Instead of loading all data into one JSON string:

```typescript
// OLD: All at once (OOM risk)
const allData = {};
for (const table of BACKUP_TABLES) {
  allData[table] = await db.getAllAsync(`SELECT * FROM ${table}`);
}
const json = JSON.stringify(allData); // Could be 10+ MB

// NEW: Table by table (streaming)
for (const table of BACKUP_TABLES) {
  const rows = await db.getAllAsync(`SELECT * FROM ${table}`);
  const chunk = JSON.stringify(rows);
  const encrypted = await AES.encrypt(chunk, key, iv);
  const mac = await HMAC.hmac256(encrypted, key);
  writeChunkToFile(tableName, encrypted, mac);
}
```

### 4.3 Batch Restore

Instead of one INSERT per row:

```typescript
// OLD: One at a time
for (const row of rows) {
  await db.runAsync(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`, ...values);
}

// NEW: Batch of 50
const BATCH_SIZE = 50;
for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE);
  const multiPlaceholders = batch.map(() => `(${placeholders})`).join(", ");
  const allValues = batch.flatMap(row => Object.values(row));
  await db.runAsync(`INSERT OR REPLACE INTO ${table} (${cols}) VALUES ${multiPlaceholders}`, ...allValues);
}
```

---

## 5. SQL Injection Fixes

### 5.1 Backup Restore Column Whitelist (SEC-4)

```typescript
// Known columns per table (derived from migrations)
const TABLE_SCHEMAS: Record<string, string[]> = {
  expenses: ["id", "user_id", "amount", "description", "category_id", ...],
  categories: ["id", "user_id", "name", "icon", "color", ...],
  // ... all 26 tables
};

function validateColumns(table: string, columns: string[]): string[] {
  const allowed = TABLE_SCHEMAS[table];
  if (!allowed) throw new Error(`Unknown table: ${table}`);
  return columns.filter(col => allowed.includes(col));
}
```

### 5.2 Template Service Fix (SEC-8)

**File:** `services/template.ts` line 172

**Before:**
```typescript
await db.execAsync(
  `DELETE FROM budget_breakdowns WHERE budget_id IN (SELECT id FROM budgets WHERE user_id = '${userId}');`
);
```

**After:**
```typescript
await db.runAsync(
  "DELETE FROM budget_breakdowns WHERE budget_id IN (SELECT id FROM budgets WHERE user_id = ?);",
  userId,
);
```

---

## 6. New Utility Files

### 6.1 `constants/app.ts` (~5 lines)

```typescript
/** Default user ID — used until multi-user support is added */
export const DEFAULT_USER_ID = "default-user";
```

### 6.2 `utils/math.ts` (~10 lines)

```typescript
/** Round to 2 decimal places */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```

### 6.3 `utils/format.ts` (~30 lines)

Consolidated `formatAmount()` — handles INR formatting with proper grouping (lakhs/crores).

### 6.4 `utils/date.ts` (~20 lines)

Extracted `getLastDayOfMonth()` from `spending-insights.ts` and `comparison-insights.ts`.

### 6.5 `constants/icons.ts` (~25 lines)

Extracted `TYPE_ICONS` payment mode icon map.

### 6.6 `utils/logger.ts` (~30 lines)

```typescript
const isDev = __DEV__;

export const logger = {
  error: (msg: string, error?: unknown) => {
    if (isDev) console.error(`[Artha] ${msg}`, error);
  },
  warn: (msg: string) => {
    if (isDev) console.warn(`[Artha] ${msg}`);
  },
};
```

Replaces 35+ raw `console.error` calls throughout the codebase.

---

## 7. New Shared Components

### 7.1 `components/expense/ExpenseFormFields.tsx` (~300 lines)

Extracted from `app/expense/add.tsx` and `app/expense/[id].tsx`. Contains:
- Category picker (with search and selection)
- Payment mode picker
- Account picker (with "add account" CTA)
- Date selector
- Nature toggle (realized/forecast)
- Tags selector

Both add and edit screens import this component, passing mode-specific props.

### 7.2 `components/expense/AmountInput.tsx` (~50 lines)

Dedicated amount input with:
- Numeric keyboard
- Currency symbol prefix
- Auto-formatting on blur

---

## 8. New Hook

### 8.1 `hooks/use-forecast-actions.ts` (~80 lines)

Extracted from identical code in `app/(tabs)/index.tsx` and `app/(tabs)/budget.tsx`:

```typescript
export function useForecastActions(onRefresh: () => void) {
  const handleMarkPaid = async (forecastId: string) => { ... };
  const handleRealise = async (forecastId: string) => { ... };
  const handleDelete = async (forecastId: string) => { ... };
  return { handleMarkPaid, handleRealise, handleDelete };
}
```

---

## 9. File Splits

### 9.1 `services/expense.ts` → 4 modules

| New File | Functions Moved | Est. Lines |
|----------|----------------|------------|
| `services/expense-crud.ts` | `createExpense`, `updateExpense`, `deleteExpense`, `softDeleteExpense`, `restoreExpense`, `permanentDeleteExpense` | ~300 |
| `services/expense-queries.ts` | `getExpenses`, `getExpenseById`, `getRecentExpenses`, `searchExpenses`, `getExpensesByFilter` | ~350 |
| `services/expense-aggregations.ts` | `getMonthlyTotal`, `getCategoryTotals`, `getMerchantTotals`, `getDailyAverage` | ~250 |
| `services/expense-splits.ts` | `splitNewExpense`, `splitExistingExpense`, `removeSplit`, `deleteSplitExpense`, `computeSplitAmounts` | ~250 |
| `services/expense.ts` (barrel) | Re-exports from all 4 modules | ~20 |

### 9.2 `app/goals/salary-calculator.tsx` → subcomponents

| New File | What It Contains | Est. Lines |
|----------|-----------------|------------|
| `components/goals/SalaryInputForm.tsx` | CTC/direct input fields, HRA, EPF toggles | ~400 |
| `components/goals/TaxBreakdown.tsx` | Tax computation display, regime comparison | ~350 |
| `components/goals/DeductionsSection.tsx` | 80C, 80D, HRA exemption, home loan inputs | ~300 |
| `components/goals/SalarySummary.tsx` | Monthly in-hand, annual breakdown, copy-with-hike | ~250 |

---

## 10. Functional Bug Fixes (Code Changes)

### 10.1 Forecast Engine (FUNC-1)

**File:** `services/forecast-engine.ts` lines 139-143

```typescript
// BEFORE (wrong column names):
const plan = await db.getFirstAsync<{
  annual_salary_in_hand: number;
  annual_planned_expenses: number;
  savings_rate_target_pct: number;
}>(
  `SELECT annual_salary_in_hand, annual_planned_expenses, savings_rate_target_pct
   FROM yearly_plans WHERE user_id = ? ORDER BY fiscal_year DESC LIMIT 1;`,
  userId,
);

// AFTER (correct column names):
const plan = await db.getFirstAsync<{
  annual_salary_in_hand: number;
  total_planned_expenses: number;
  savings_rate_target_pct: number;
}>(
  `SELECT annual_salary_in_hand, total_planned_expenses, savings_rate_target_pct
   FROM yearly_plans WHERE user_id = ? ORDER BY financial_year DESC LIMIT 1;`,
  userId,
);
```

### 10.2 Spending Insights (FUNC-4)

**File:** `services/spending-insights.ts`

Change all 3 occurrences of `c.is_avoidable` to `c.is_unavoidable` and invert the logic:
- `CASE WHEN c.is_avoidable = 0` → `CASE WHEN c.is_unavoidable = 1` (unavoidable/right-spend)
- `c.is_avoidable = 1` → `c.is_unavoidable = 0` (avoidable/discretionary)

### 10.3 Savings Tracker (FUNC-3)

**File:** `services/savings-tracker.ts` line 28-29

```sql
-- BEFORE:
SELECT SUM(amount) as total FROM expenses
WHERE user_id = ? AND status != 'rejected' AND deleted_at IS NULL AND date >= ? AND date <= ?;

-- AFTER:
SELECT SUM(amount) as total FROM expenses
WHERE user_id = ? AND status != 'rejected' AND deleted_at IS NULL
AND nature = 'realized' AND date >= ? AND date <= ?;
```

### 10.4 Credit SMS Handling (FUNC-6)

**File:** `services/sms/sms-to-expense.ts`

When a parsed SMS has `type === "credit"`:
```typescript
// BEFORE: silently returns without doing anything
if (parsed.type === "credit") return null;

// AFTER: mark as ignored so it doesn't accumulate
if (parsed.type === "credit") {
  await db.runAsync(
    "UPDATE pending_sms SET status = 'ignored' WHERE id = ?;",
    pendingSmsId,
  );
  return null;
}
```

### 10.5 Deep-Link Whitelist (SEC-6)

**File:** `app/_layout.tsx` line 81

```typescript
const ALLOWED_SCREENS = [
  "/(tabs)",
  "/(tabs)/budget",
  "/(tabs)/settings",
  "/expense/add",
  "/insights",
  "/settings/backup-restore",
  "/settings/notifications",
  // ... all valid routes
];

// In notification handler:
if (screen && typeof screen === "string" && ALLOWED_SCREENS.includes(screen)) {
  routerRef.current.push(screen as never);
}
```

---

## 11. Performance Fixes (Code Changes)

### 11.1 Tag Loading Batch Query (PERF-1)

**File:** `services/expense.ts` (or after split: `expense-queries.ts`)

```typescript
// BEFORE: N+1 (one query per expense)
for (const expense of expenses) {
  expense.tags = await getTagsForExpense(expense.id);
}

// AFTER: Single batch query
const expenseIds = expenses.map(e => e.id);
const placeholders = expenseIds.map(() => "?").join(",");
const allTags = await db.getAllAsync(
  `SELECT et.expense_id, t.id, t.name, t.color
   FROM expense_tags et JOIN tags t ON et.tag_id = t.id
   WHERE et.expense_id IN (${placeholders})`,
  ...expenseIds,
);
// Group by expense_id and attach
const tagMap = new Map<string, Tag[]>();
for (const tag of allTags) {
  const list = tagMap.get(tag.expense_id) ?? [];
  list.push({ id: tag.id, name: tag.name, color: tag.color });
  tagMap.set(tag.expense_id, list);
}
for (const expense of expenses) {
  expense.tags = tagMap.get(expense.id) ?? [];
}
```

### 11.2 Monthly Trend Single Query (PERF-2)

```sql
-- BEFORE: 6 separate queries (one per month)
-- AFTER: Single query
SELECT strftime('%Y-%m', date) as month, SUM(amount) as total
FROM expenses
WHERE user_id = ? AND category_id = ? AND deleted_at IS NULL
  AND date >= ? AND date <= ?
GROUP BY strftime('%Y-%m', date)
ORDER BY month;
```

### 11.3 Startup Parallelization (PERF-9)

**File:** `database/database.ts`

```typescript
// BEFORE: Sequential
await initDatabase();
await seedDefaultUser(db);
await seedMerchantMappings();
await setupNotificationChannel();
await checkNotifications();

// AFTER: Parallel where safe
await initDatabase(); // Must be first (others depend on DB)
await Promise.all([
  seedDefaultUser(db),
  seedMerchantMappings(),
  setupNotificationChannel(),
]);
await checkNotifications(); // Depends on notification channel
```

---

## 12. Testing Strategy

### Phase-by-Phase

| Phase | Testing Approach | New Tests |
|-------|-----------------|-----------|
| Phase 0 | Existing tests must pass after deletions/extractions | 0 |
| Phase 1 | Regression test per bug fix proving correct behavior | ~24 |
| Phase 2 | Encryption round-trip, password validation, SQL injection prevention | ~20 |
| Phase 3 | Full backup round-trip with all 26 tables, V1 backward compat | ~15 |
| Phase 4 | Split module tests pass, refund matching, forecast tolerance | ~20 |
| Phase 5 | UI guard-rail tests for Card usage, header styling, FAB | ~8 |
| Phase 6 | Batch query performance, migration test, startup timing | ~12 |
| Phase 7 | Cross-phase integration, full regression | ~20 |

### Key Test Cases

**Encryption round-trip:**
1. Create backup with password → decrypt → verify plaintext matches
2. Wrong password → verify decryption fails with clear error
3. Tampered file → verify HMAC check fails before decryption

**Backup completeness:**
1. Populate all 26 tables → backup → restore to fresh DB → verify every table row count matches
2. V1 backup file → restore with V5 code → verify backward compatibility

**Bug fix regressions:**
1. `getYearEndProjection()` returns non-null data (was crashing)
2. Right Spend shows actual avoidable/unavoidable split (was showing zeros)
3. Savings rate excludes forecast expenses (was including them)

---

## 13. Version History

| Version | Date | Change |
|---------|------|--------|
| 5.0 | 2026-04-15 | Initial V5 TDD — 1 migration, encryption overhaul, backup rewrite, 5 file deletions, 2 file splits, 4 utility extractions |
