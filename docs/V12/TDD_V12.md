# Artha V12 — TDD

> **Technical Design Document for V12 Stabilization Release**

---

## Overview

V12 touches code across all layers but adds minimal new infrastructure. Two new migrations drop dead tables. Two new reusable UI components. One new aggregation query extension. Rest is remediation — targeted changes to existing services/screens.

---

## Schema Changes

### Migration 027 — Drop `sms_rules` table

**File:** `database/migrations/027_drop_sms_rules.ts`

```ts
import type { SQLiteDatabase } from 'expo-sqlite';

export const migration027 = {
  version: 27,
  name: 'drop_sms_rules',
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`DROP TABLE IF EXISTS sms_rules;`);
  },
};
```

**Impact:**
- Remove `sms_rules` from `database/TABLE_SCHEMAS.ts`
- Remove from `BACKUP_TABLES` in `services/backup.ts`
- Remove any cleanup for it in `services/data-cleanup.ts`
- Restore shim: when reading an old backup that contains an `sms_rules` array, silently skip it (log at `logger.info` level)

### Migration 028 — Drop `users` table

**File:** `database/migrations/028_drop_users.ts`

```ts
export const migration028 = {
  version: 28,
  name: 'drop_users',
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`DROP TABLE IF EXISTS users;`);
  },
};
```

**Impact:** Same cleanup list as Migration 027. Verified that `DEFAULT_USER_ID` is used as a free-string column (not FK) in every other table — confirmed via grep of `REFERENCES users` — zero matches.

### Register migrations

In `database/migrations/index.ts`:
```ts
import { migration027 } from './027_drop_sms_rules';
import { migration028 } from './028_drop_users';

export const migrations = [
  // ... existing
  migration027,
  migration028,
];
```

---

## New Service Functions

### `cleanupExpenseChildren(db, expenseIds)` — symmetric cascade helper

**File:** `services/expense-children-cleanup.ts`

```ts
export async function cleanupExpenseChildren(
  db: SQLiteDatabase,
  expenseIds: string[],
): Promise<void> {
  if (expenseIds.length === 0) return;
  const placeholders = expenseIds.map(() => '?').join(',');

  await db.runAsync(
    `DELETE FROM expense_splits WHERE expense_id IN (${placeholders});`,
    ...expenseIds,
  );
  await db.runAsync(
    `DELETE FROM multi_split_entries WHERE expense_id IN (${placeholders});`,
    ...expenseIds,
  );
  await db.runAsync(
    `DELETE FROM expense_tags WHERE expense_id IN (${placeholders});`,
    ...expenseIds,
  );
  await db.runAsync(
    `DELETE FROM hisaab_entries WHERE linked_expense_id IN (${placeholders});`,
    ...expenseIds,
  );
}
```

**Used by:**
- `permanentlyDeleteExpense(id)` — wraps with `cleanupExpenseChildren(db, [id])`
- `purgeOldDeletedExpenses()` — fetches ID list first, then `cleanupExpenseChildren(db, ids)`, then deletes expense rows

### `getFilteredExpenseSummaryWithPrevPeriod` — MoM trend

**File:** extends `services/expense-queries.ts`

```ts
export interface FilteredSummaryWithTrend extends FilteredSummary {
  previous: FilteredSummary | null;
  trendPct: number | null;
}

export async function getFilteredExpenseSummaryWithPrevPeriod(
  userId: string,
  filters: ExpenseFilters,
  period: 'month' | 'fy',
  groupBy: 'category' | 'account' | 'payment_mode' = 'category',
): Promise<FilteredSummaryWithTrend> {
  // 1. Compute prev-period date range by shifting filters.startDate/endDate back
  // 2. Call getFilteredExpenseSummary for current and previous
  // 3. trendPct = ((current.total - previous.total) / previous.total) * 100
}
```

---

## New UI Components

### `components/ui/EmptyState.tsx`

```tsx
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/hooks/use-color-scheme";

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, subtitle, action }: EmptyStateProps) {
  const { colors } = useColorScheme();
  return (
    <View className="flex-1 items-center justify-center px-6 py-12">
      <Ionicons name={icon} size={48} color={colors.textSecondary} />
      <Text className="text-lg font-medium text-text-primary dark:text-text-dark-primary mt-4 text-center">
        {title}
      </Text>
      {subtitle && (
        <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mt-1 text-center">
          {subtitle}
        </Text>
      )}
      {action && <View className="mt-4">{action}</View>}
    </View>
  );
}
```

### `components/ui/DateRangeChips.tsx`

Props:
```ts
interface DateRangeChipsProps {
  mode: 'fy' | 'custom' | 'all';
  selectedFY: number;
  customStart: string;
  customEnd: string;
  onChange: (mode, fy, customStart, customEnd) => void;
  allowAllTime?: boolean;
}
```

Extract the JSX block from `app/(tabs)/expenses.tsx:276-398`. No new logic.

---

## Performance Optimizations

### C1 — `getComputedBalances` batch

**Before:**
```ts
for (const account of accounts) {
  const balance = await getCurrentBalance(account.id);
  result.push({ ...account, balance });
}
```

**After:**
```ts
const month = formatMonth(new Date());
const rows = await db.getAllAsync<{ account_id: string; closing_balance: number }>(
  `SELECT account_id, closing_balance
   FROM account_month_balances
   WHERE month = ? AND account_id IN (${placeholders});`,
  month, ...accountIds,
);
const balanceMap = new Map(rows.map(r => [r.account_id, r.closing_balance]));

return accounts.map(a => ({ ...a, balance: balanceMap.get(a.id) ?? 0 }));
```

### C2 — `getAllAccountsWithModes` batch

Single JOIN:
```sql
SELECT fa.*, apm.payment_mode_id, pm.name as payment_mode_name
FROM financial_accounts fa
LEFT JOIN account_payment_modes apm ON apm.account_id = fa.id
LEFT JOIN payment_modes pm ON pm.id = apm.payment_mode_id
WHERE fa.user_id = ? AND fa.deleted_at IS NULL
ORDER BY fa.bank_name, fa.account_identifier;
```

Group client-side by `fa.id`.

### C3 — Memoization in `app/(tabs)/expenses.tsx`

Wrap:
- `categoryMap`, `paymentModeMap`, `accountMap` in `useMemo([categories, paymentModes, accounts])`
- `renderExpenseItem` in `useCallback([categoryMap, paymentModeMap, accountMap, handleDelete, router])`
- `handleDelete` — stabilize by removing `expense` closure, accept `(expenseId, isSplit, description)` as args

### C4 — `React.memo(ExpenseListItem)`

```tsx
export const ExpenseListItem = React.memo(function ExpenseListItem(props: Props) {
  // existing body
});
```

Check that `onPress` and `onLongPress` props are stable from consumers (C3 handles `(tabs)/expenses.tsx`).

### C5 — Column projection

Replace `SELECT *` with:
```sql
SELECT
  id, user_id, amount, currency, description, merchant_name,
  category_id, payment_mode_id, account_id,
  date, transaction_time, is_right_spend,
  source, status, nature,
  split_original_amount, split_person_id, split_pct, split_hisaab_entry_id,
  deleted_at, created_at
FROM expenses
WHERE ...
```

**Verify:** Every consumer of `getExpensesPaginated` uses only these fields. Grep consumers for `.fx_rate`, `.raw_merchant_name`, `.raw_source_text`, `.matched_forecast_id`, `.forecast_type`, `.paid_from_account_id`, `.convenience_fee`, `.fee_absorbed`, `.refund_of_expense_id`, `.due_date`, `.updated_at` — none should be accessed via the list query path.

---

## Security Changes

### B1 — ErrorBoundary

**File:** `app/_layout.tsx:23-51`

```tsx
render() {
  if (this.state.error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.errorSubtitle}>Please restart the app.</Text>
        {__DEV__ && (
          <>
            <Text style={styles.errorMessage}>{this.state.error.message}</Text>
            <ScrollView style={styles.stackContainer}>
              <Text style={styles.stackText}>{this.state.error.stack}</Text>
            </ScrollView>
          </>
        )}
        <Pressable onPress={() => this.setState({ error: null })} style={styles.retryBtn}>
          <Text>Retry</Text>
        </Pressable>
      </View>
    );
  }
  return this.props.children;
}
```

### B2 — Password validation

**`services/backup.ts`** — export constant:
```ts
export const MIN_PASSWORD_LENGTH = 8;
```

**`app/settings/backup-restore.tsx`** — import + use:
```ts
import { MIN_PASSWORD_LENGTH } from "@/services/backup";
// ...
disabled={loading || password.length < MIN_PASSWORD_LENGTH}
// Error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
```

---

## Type Definitions

### Extension to ExpenseFilters (none)
F1 uses existing `ExpenseFilters` type — no changes.

### New `FilteredSummaryWithTrend` (F9)
See "New Service Functions" above.

### New `EmptyStateProps` (D3)
See "New UI Components" above.

---

## Testing Strategy

| Item | Test File | Test Type |
|------|-----------|-----------|
| A1 cascade | `__tests__/unit/expense-purge.test.ts` | Unit — split + purge + orphan assertion |
| A2, A3 bumps | N/A — manual verification | Manual |
| C1, C2 batching | `__tests__/unit/account-balance-batch.test.ts`, `account-master-batch.test.ts` | Unit — mock db, count query calls |
| C3, C4 memo | React DevTools profiler | Manual |
| C5 projection | Existing expense list tests; ensure they still pass | Regression |
| D3 EmptyState | `__tests__/components/empty-state.test.tsx` | Component |
| D4 Card usage | Visual regression — no test | Manual |
| E1, E2 drop tables | Migration test — run fresh DB, verify tables absent | Migration |
| E3 dead exports | TypeScript compile + existing tests | Regression |
| F1 FilterSummaryCard reuse | Each screen gets a snapshot test | Component |
| F2 merchant rename pending | `__tests__/unit/merchant-alias.test.ts` | Unit |
| F3 hisaab soft-delete | `__tests__/unit/hisaab-soft-delete.test.ts` | Unit |
| F4 DateRangeChips | Component test | Component |
| F5 balance drift alert | Component test + service test for drift calc | Mixed |
| F6 backup reminder | Manual — mock `lastBackupAt` at 31 days old | Manual |
| F7 split-edit revalidation | `__tests__/unit/split-edit.test.ts` | Unit |
| F8 tag rename bump | Manual | Manual |
| F9 MoM trend | `__tests__/unit/filtered-summary-trend.test.ts` | Unit |
| F10 cleanup helper | `__tests__/unit/expense-children-cleanup.test.ts` | Unit |

**Target:** 1050 → ~1070 tests after V12 (20 new unit/component tests).

---

## Risk & Mitigation

| Risk | Mitigation |
|------|-----------|
| Dropping `sms_rules` breaks old backup restore | Silent-skip shim in backup restore code |
| Dropping `users` breaks an obscure consumer | Full grep for `FROM users`, `REFERENCES users` before migration — confirmed zero |
| Column projection (C5) breaks a consumer that uses a dropped field | TypeScript catches it if consumer uses `.fieldName`; tests catch behavioural bugs |
| Memoization (C3/C4) breaks stale closure | Carefully review each handler's deps; React DevTools profiler verification |
| `cleanupExpenseChildren` (F10) introduces regression | Unit test asserting DB state after both paths is identical |
| Migration 027/028 fails on existing installs | `DROP TABLE IF EXISTS` is idempotent; no data lost |

---

## Rollback Plan

- Each phase is a separate commit
- Phases 0-2 are trivially revertable (no schema changes)
- Phase 3 (migrations) is NOT revertable once users have upgraded. Test thoroughly on staging/personal device first. Do not include in build until verified.
- Phases 4-5 are commits on feature branches; revert via `git revert` if needed.
