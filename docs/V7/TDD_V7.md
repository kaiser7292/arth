# Artha (अर्थ) — Version 7 Technical Design Document

**Version:** 7.0
**Date:** 2026-04-17
**Status:** Draft
**Predecessor:** V6 TDD at `docs/V6/TDD_V6.md`

---

## 1. Overview

V7 introduces dual-entry accounting for inter-account transfers, distinguishes expense forecasts from repayment forecasts, and adds proper CC bill payment flow with source account tracking. Architecture remains 100% local (SQLite + MMKV, no cloud).

**Schema version after V7:** 37 migrations (3 new: 035, 036, 037)
**Tables:** 27 (+1 new: `account_transfers`)
**New columns:** 2 on `expenses` (`forecast_type`, `paid_from_account_id`)
**New files:** ~5 (1 service, 1 component, 3 migrations)
**Modified files:** ~15
**New dependencies:** None

---

## 2. Schema Changes

### 2.1 Migration 035: `forecast_type` and `paid_from_account_id` on expenses

**File:** `database/migrations/035_forecast_type.ts`

```typescript
export async function migrate035(db: SQLiteDatabase): Promise<void> {
  // forecast_type: 'expense' (default) or 'repayment' (CC bill payment)
  await db.execAsync(`
    ALTER TABLE expenses ADD COLUMN forecast_type TEXT DEFAULT 'expense';
  `);

  // paid_from_account_id: tracks which savings account was used to pay a repayment forecast
  await db.execAsync(`
    ALTER TABLE expenses ADD COLUMN paid_from_account_id TEXT;
  `);

  // Index for fast forecast_type filtering
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_expenses_forecast_type ON expenses(forecast_type);
  `);
}
```

**Impact on existing data:** All existing expenses get `forecast_type = 'expense'` (column default). Backfill in migration 037 corrects CC due forecasts.

### 2.2 Migration 036: `account_transfers` table

**File:** `database/migrations/036_account_transfers.ts`

```typescript
export async function migrate036(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS account_transfers (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL,
      from_account_id TEXT NOT NULL,
      to_account_id TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      date TEXT NOT NULL,
      linked_forecast_id TEXT,
      linked_expense_id TEXT,
      source TEXT DEFAULT 'manual',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT,
      FOREIGN KEY (from_account_id) REFERENCES financial_accounts(id),
      FOREIGN KEY (to_account_id) REFERENCES financial_accounts(id),
      FOREIGN KEY (linked_forecast_id) REFERENCES expenses(id),
      FOREIGN KEY (linked_expense_id) REFERENCES expenses(id)
    );
  `);

  // Composite indexes for balance calculation queries
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_transfers_from_account_date
      ON account_transfers(from_account_id, date) WHERE deleted_at IS NULL;
  `);
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_transfers_to_account_date
      ON account_transfers(to_account_id, date) WHERE deleted_at IS NULL;
  `);
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_transfers_user_date
      ON account_transfers(user_id, date) WHERE deleted_at IS NULL;
  `);
}
```

**Column definitions:**

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PK | UUID |
| `user_id` | TEXT NOT NULL | Owner |
| `from_account_id` | TEXT NOT NULL | Source account (savings/wallet) |
| `to_account_id` | TEXT NOT NULL | Destination account (CC/savings/wallet) |
| `amount` | REAL NOT NULL | Transfer amount in INR |
| `description` | TEXT | e.g., "CC bill payment — HDFC 8957" or "Self transfer" |
| `date` | TEXT NOT NULL | Transfer date (YYYY-MM-DD) |
| `linked_forecast_id` | TEXT | If created from a repayment forecast being marked as paid |
| `linked_expense_id` | TEXT | If created from reclassifying an expense as transfer |
| `source` | TEXT | `'manual'` or `'sms_auto'` |
| `created_at` | TEXT | Timestamp |
| `updated_at` | TEXT | Timestamp |
| `deleted_at` | TEXT | Soft delete |

### 2.3 Migration 037: Data backfill

**File:** `database/migrations/037_backfill_forecast_type.ts`

```typescript
export async function migrate037(db: SQLiteDatabase): Promise<void> {
  // Step 1: Set forecast_type = 'repayment' for CC due forecasts.
  // These are forecasts linked to a credit_card account where the SMS type
  // was amount_due_reminder (merchant_name contains "Due" or "Outstanding").
  await db.execAsync(`
    UPDATE expenses
    SET forecast_type = 'repayment'
    WHERE nature = 'forecast'
      AND account_id IN (
        SELECT id FROM financial_accounts WHERE account_type = 'credit_card'
      )
      AND (
        merchant_name LIKE '%Due%'
        OR merchant_name LIKE '%Outstanding%'
        OR merchant_name LIKE '%Amount Due%'
        OR description LIKE '%(Amount Due)%'
      );
  `);

  // Step 2: Migrate existing CC bill payment credits to account_transfers.
  // These are account_credits entries with description matching CC bill payment pattern.
  // We create transfer records and soft-delete the credit entries.
  const ccCredits = await db.getAllAsync<{
    id: string;
    account_id: string;
    user_id: string;
    amount: number;
    description: string;
    date: string;
    source: string;
  }>(`
    SELECT id, account_id, user_id, amount, description, date, source
    FROM account_credits
    WHERE deleted_at IS NULL
      AND description LIKE 'CC bill payment%'
  `);

  for (const credit of ccCredits) {
    // Create a transfer with from_account_id = NULL placeholder (unknown source)
    // These transfers will have from_account_id set to the CC account itself as a marker
    // that the source was unknown at migration time.
    // The to_account_id is the CC account.
    await db.runAsync(
      `INSERT INTO account_transfers (id, user_id, from_account_id, to_account_id, amount, description, date, source)
       VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?);`,
      credit.user_id,
      credit.account_id, // from = CC (placeholder: source unknown)
      credit.account_id, // to = CC
      credit.amount,
      credit.description,
      credit.date,
      credit.source,
    );

    // Soft-delete the credit entry
    await db.runAsync(
      `UPDATE account_credits SET deleted_at = datetime('now') WHERE id = ?;`,
      credit.id,
    );
  }
}
```

---

## 3. New Service: `services/account-transfer.ts`

### 3.1 Interface

```typescript
export interface AccountTransfer {
  id: string;
  user_id: string;
  from_account_id: string;
  to_account_id: string;
  amount: number;
  description: string | null;
  date: string;
  linked_forecast_id: string | null;
  linked_expense_id: string | null;
  source: "manual" | "sms_auto";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
```

### 3.2 Functions

| Function | Signature | Purpose |
|----------|-----------|---------|
| `createTransfer` | `(params: CreateTransferParams) => Promise<string>` | Insert a new transfer record. Returns ID. |
| `getTransfersForMonth` | `(accountId: string, startDate: string, endDate: string) => Promise<AccountTransfer[]>` | All transfers involving this account (in or out) for a date range. |
| `getTransfersOutTotal` | `(accountId: string, startDate: string, endDate: string) => Promise<number>` | SUM of transfers OUT of this account in date range. |
| `getTransfersInTotal` | `(accountId: string, startDate: string, endDate: string) => Promise<number>` | SUM of transfers INTO this account in date range. |
| `deleteTransfer` | `(id: string) => Promise<void>` | Soft delete. |
| `autoDetectTransfer` | `(userId: string, debitAccountId: string, amount: number, date: string) => Promise<string \| null>` | Look for a matching credit on another owned account within ±1 day. Returns destination account ID if found. |
| `reclassifyExpenseAsTransfer` | `(expenseId: string, toAccountId: string) => Promise<void>` | Convert a realized expense to a transfer: create transfer record, soft-delete the expense, bump data. |

### 3.3 `autoDetectTransfer` Logic

```
1. Query all active savings/wallet accounts for user (excluding debitAccountId)
2. For each candidate account, search account_credits where:
   - amount = exact match (transfers are all-or-nothing)
   - date within ±1 day of the debit date
   - source = 'sms_auto'
3. If exactly one match found: return that account's ID
4. If multiple matches or zero: return null (ambiguous or no match)
```

---

## 4. Modified Service: `services/expense-forecasts.ts`

### 4.1 Split `markForecastAsPaid`

The existing function (~110 lines) will be refactored into three handlers:

#### `markExpenseForecastAsPaid(forecastId: string)`
**For `forecast_type = 'expense'`** — identical to current `markForecastAsPaid` logic:
- Search for matching realized expense (±2% amount, ±7 days)
- Link if found, reject forecast
- No CC dues logic needed (expense forecasts don't reduce CC dues)

#### `markRepaymentAsPaid(forecastId: string, fromAccountId: string)`
**For `forecast_type = 'repayment'`** — new flow:
1. Load forecast, validate `forecast_type = 'repayment'`
2. Load CC account (via `forecast.account_id`)
3. Create `account_transfers` entry:
   - `from_account_id = fromAccountId` (user-selected savings account)
   - `to_account_id = forecast.account_id` (CC account)
   - `amount = forecast.amount`
   - `linked_forecast_id = forecastId`
   - `date = forecast.due_date ?? today`
   - `description = "CC bill payment — {bank} {card}"`
4. Call `applyCcPayment(forecast.account_id, forecast.amount)`:
   - Decrease `total_due`
   - Increase `last_known_balance`
   - Clear `min_due`/`due_date` if fully paid
5. Reject the forecast
6. `bumpDataVersion()`
7. Return `{ transferId: string }`

**Key difference from current:** No expense search, no `account_credits` entry, no double-counting.

#### `markForecastPaidExternally(forecastId: string)`
**For both forecast types:**
- For `forecast_type = 'expense'`: Just reject the forecast. No balance changes.
- For `forecast_type = 'repayment'`:
  1. Call `applyCcPayment(forecast.account_id, forecast.amount)` — CC dues decrease, available limit increases
  2. Reject the forecast
  3. No transfer created, no savings debit

### 4.2 Updated `getForecastExpenses` queries

No query changes needed — `forecast_type` is a new column, existing queries still work. The UI layer reads `forecast_type` to choose which action bar to show.

---

## 5. Modified Service: `services/financial-account.ts`

### 5.1 Rename `reduceCcDuesOnPayment` → `applyCcPayment`

```typescript
export async function applyCcPayment(
  accountId: string,
  paymentAmount: number,
): Promise<void> {
  const db = getDatabase();
  const account = await db.getFirstAsync<{
    account_type: string;
    total_due: number | null;
    last_known_balance: number | null;
    credit_limit: number | null;
  }>(
    "SELECT account_type, total_due, last_known_balance, credit_limit FROM financial_accounts WHERE id = ?;",
    accountId,
  );
  if (!account || account.account_type !== "credit_card") return;

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  // Decrease total_due
  if (account.total_due != null) {
    const newDue = Math.max(0, account.total_due - paymentAmount);
    updates.push("total_due = ?");
    values.push(newDue);
    if (newDue === 0) {
      updates.push("min_due = NULL");
      updates.push("due_date = NULL");
    }
  }

  // Increase last_known_balance (available limit)
  if (account.last_known_balance != null) {
    let newBalance = account.last_known_balance + paymentAmount;
    // Cap at credit_limit if known
    if (account.credit_limit != null) {
      newBalance = Math.min(newBalance, account.credit_limit);
    }
    updates.push("last_known_balance = ?");
    values.push(newBalance);
    updates.push("last_balance_date = ?");
    values.push(new Date().toISOString().split("T")[0]);
  }

  if (updates.length === 0) return;

  updates.push("updated_at = datetime('now')");
  values.push(accountId);

  await db.runAsync(
    `UPDATE financial_accounts SET ${updates.join(", ")} WHERE id = ?;`,
    ...values,
  );
  await bumpDataVersion();
}
```

**Change from current `reduceCcDuesOnPayment`:** Also increases `last_known_balance` (available credit limit), capped at `credit_limit`.

### 5.2 Remove CC-specific logic from `markForecastAsPaid`

The current `markForecastAsPaid` calls `reduceCcDuesOnPayment` and `addCredit` for CC accounts. After V7:
- `markRepaymentAsPaid` calls `applyCcPayment` and creates a transfer (not a credit)
- `markExpenseForecastAsPaid` does NOT call any CC logic (expense forecasts on CC are just expenses)
- Old `reduceCcDuesOnPayment` exported symbol kept as a thin wrapper around `applyCcPayment` for backward compatibility during transition, then removed

---

## 6. Modified Service: `services/account-balance.ts`

### 6.1 Updated Balance Formula

**Current:** `closing = opening - expenses + credits`

**New:** `closing = opening - expenses + credits - transfers_out + transfers_in`

### 6.2 Modified `getClosingBalance`

```typescript
export async function getClosingBalance(
  accountId: string,
  month: string,
): Promise<number | null> {
  const record = await db.getFirstAsync<AccountMonthBalance>(...);
  if (!record) return null;

  const { startDate, endDate } = getMonthDateRange(month);
  const expenses = await getAccountExpensesTotal(accountId, startDate, endDate);
  const credits = await getAccountCreditsTotal(accountId, startDate, endDate);
  const transfersOut = await getTransfersOutTotal(accountId, startDate, endDate);
  const transfersIn = await getTransfersInTotal(accountId, startDate, endDate);

  return record.opening_balance - expenses + credits - transfersOut + transfersIn;
}
```

### 6.3 Updated `MonthBalanceSummary` interface

```typescript
export interface MonthBalanceSummary {
  month: string;
  opening_balance: number;
  expenses: number;
  credits: number;
  transfers_out: number;  // NEW
  transfers_in: number;   // NEW
  closing_balance: number;
  is_manual_override: boolean;
}
```

### 6.4 Updated `getMonthBalanceSummary`

Returns the two new fields. UI can display transfers as a separate line item in the ledger.

### 6.5 Updated `computeUnseededBalance`

Same formula change: include transfers in the chaining calculation.

### 6.6 Updated `getEarliestAccountActivity`

Add `account_transfers` to the union query:

```sql
SELECT MIN(date) as min_date FROM (
  SELECT date FROM expenses WHERE account_id = ? AND deleted_at IS NULL
  UNION ALL
  SELECT date FROM account_credits WHERE account_id = ? AND deleted_at IS NULL
  UNION ALL
  SELECT date FROM account_transfers WHERE (from_account_id = ? OR to_account_id = ?) AND deleted_at IS NULL
);
```

---

## 7. Modified Service: `services/sms/sms-to-expense.ts`

### 7.1 Set `forecast_type` on forecast creation

In the forecast creation block (line ~208-235), add `forecast_type` to the INSERT:

```typescript
// Determine forecast_type
const forecastType =
  parsed.type === "amount_due_reminder" && parsed.accountType === "credit_card"
    ? "repayment"
    : "expense";

await db.runAsync(
  `INSERT INTO expenses (..., forecast_type) VALUES (..., ?);`,
  ...,
  forecastType,
);
```

**Rule:** `forecast_type = 'repayment'` when:
- `parsed.type === 'amount_due_reminder'` AND
- `parsed.accountType === 'credit_card'`

Everything else (SI reminders, EMI reminders, utility bills) → `'expense'`.

### 7.2 IMPS/P2A transfer detection

After creating a realized expense from a savings debit with IMPS/P2A:

```typescript
if (isRealized && (parsed.type === 'debit' || parsed.type === 'upi_debit')) {
  // Check if this might be a self-transfer
  if (parsed.paymentMode === 'net_banking' || parsed.upiSubtype === 'p2a') {
    const destAccountId = await autoDetectTransfer(userId, accountId, parsed.amount, date);
    if (destAccountId) {
      // Convert to transfer instead of expense
      await createTransfer({
        userId,
        fromAccountId: accountId!,
        toAccountId: destAccountId,
        amount: parsed.amount,
        description: `Self transfer — ${parsed.bank}`,
        date,
        linkedExpenseId: expenseId,
        source: 'sms_auto',
      });
      // Soft-delete the expense (it's a transfer, not spending)
      await db.runAsync(
        `UPDATE expenses SET deleted_at = datetime('now') WHERE id = ?;`,
        expenseId,
      );
    }
  }
}
```

---

## 8. Modified Service: `services/sms/bank-patterns.ts`

### 8.1 New Pattern: ICICI CC Payment via BBPS

```typescript
// "Payment of Rs 38,304.98 has been received on your ICICI Bank Credit Card XX3001 through Bharat Bill Payment System on 19-DEC-25."
{
  name: "ICICI CC Payment BBPS",
  bank: "ICICI Bank",
  type: "payment_received",
  test: /Payment\s+of\s+Rs\s+[\d,.]+\s+has\s+been\s+received\s+on\s+your\s+ICICI\s+Bank\s+Credit\s+Card/i,
  parse: (body) => {
    const m = body.match(
      /Payment\s+of\s+Rs\s+([\d,.]+)\s+has\s+been\s+received\s+on\s+your\s+ICICI\s+Bank\s+Credit\s+Card\s+XX(\d+)[\s\S]*?on\s+(\d{1,2}-\w{3}-\d{2})/i,
    );
    if (!m) return null;
    return {
      amount: parseAmount(m[1]),
      merchant: "Credit Card Payment",
      cardLast4: m[2],
      date: parseDDMMMYY(m[3]),
      bank: "ICICI Bank",
      type: "payment_received",
      skip: false,
      dueDate: null,
      isForecast: false,
      confidence: 0.95,
      accountType: "credit_card" as const,
    };
  },
},
```

### 8.2 New Pattern: ICICI CC Reversal

```typescript
// "Reversal of Rs 10.02 credited to ICICI Bank Credit Card XX3001 on 26-DEC-25."
{
  name: "ICICI CC Reversal",
  bank: "ICICI Bank",
  type: "refund",
  test: /Reversal\s+of\s+Rs\s+[\d,.]+\s+credited\s+to\s+ICICI\s+Bank\s+Credit\s+Card/i,
  parse: (body) => { ... },
},
```

### 8.3 New Pattern: Airtel Postpaid Bill Due

```typescript
// "AIRTEL POSTPAID bill of Rs 824.82 for 9874059999 is due on 31-12-2025."
{
  name: "ICICI Airtel Bill Due",
  bank: "ICICI Bank",
  type: "standing_instruction_reminder",
  test: /AIRTEL\s+POSTPAID\s+bill\s+of\s+Rs\s+[\d,.]+[\s\S]*?is\s+due\s+on/i,
  parse: (body) => {
    const m = body.match(
      /AIRTEL\s+POSTPAID\s+bill\s+of\s+Rs\s+([\d,.]+)\s+for\s+(\d+)\s+is\s+due\s+on\s+(\d{1,2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2})/i,
    );
    if (!m) return null;
    return {
      amount: parseAmount(m[1]),
      merchant: `Airtel Postpaid — ${m[2]}`,
      cardLast4: null,
      date: null,
      bank: "ICICI Bank",
      type: "standing_instruction_reminder",
      skip: false,
      dueDate: parseDateAny(m[3]) ?? parseYYYYMMDDTime(m[3]),
      isForecast: true,
      confidence: 0.85,
    };
  },
},
```

### 8.4 New Pattern: Axis Loan EMI Debit from Savings

```typescript
// "Debit INR 22717.00\nAxis Bank A/c XX2836\n11-09-25 15:03:48\nPPR000810877249_EMI_11-09-"
{
  name: "Axis Loan EMI Debit",
  bank: "Axis Bank",
  type: "emi",
  test: /Debit\s+INR\s+[\d,.]+[\s\S]*?Axis\s+Bank\s+A\/c\s+XX\d+[\s\S]*?(?:PPR|Loan\s+Repayment)/i,
  parse: (body) => {
    const m = body.match(
      /Debit\s+INR\s+([\d,.]+)[\s\S]*?Axis\s+Bank\s+A\/c\s+XX(\d+)[\s\S]*?(\d{2}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}[\s\S]*?(PPR\S*|Loan\s+Repayment\S*)/i,
    );
    if (!m) return null;
    return {
      amount: parseAmount(m[1]),
      merchant: "Loan EMI — " + m[4].trim(),
      cardLast4: m[2],
      date: parseDDMMYY(m[3]),
      bank: "Axis Bank",
      type: "emi",
      skip: false,
      dueDate: null,
      isForecast: false,
      confidence: 0.9,
      accountType: "savings" as const,
      paymentMode: "auto_debit" as const,
    };
  },
},
```

---

## 9. UI Changes

### 9.1 Modified: `components/expense/ForecastActionBar.tsx`

**New prop:** `forecastType: 'expense' | 'repayment'`

**Button logic:**

```
if forecastType === 'repayment':
  [Mark as Paid] → triggers account picker → onRepaymentPaid(id, accountId)
  [Paid Externally] → onPaidExternally(id)
  [Delete] → onDelete(id)

if forecastType === 'expense':
  [Mark as Paid] → current behavior → onMarkAsPaid(id)
  [Realise Now] → current behavior → onRealiseNow(id)
  [Paid Externally] → onPaidExternally(id)
  [Delete] → onDelete(id)
```

### 9.2 New: `components/expense/AccountPickerSheet.tsx`

Bottom sheet modal showing active savings and wallet accounts.

**Props:**
```typescript
interface AccountPickerSheetProps {
  visible: boolean;
  onSelect: (accountId: string) => void;
  onClose: () => void;
  preSelectedAccountId?: string;
}
```

**Displays:**
- Account label (or `{bank} ****{last4}`)
- Account type icon (savings/wallet)
- Current balance (if seeded)
- Radio selection

**Data source:** `getActiveAccounts(userId)` filtered to `account_type IN ('savings', 'wallet')`.

### 9.3 Modified: `hooks/use-forecast-actions.ts`

New handlers:

```typescript
export function useForecastActions(refresh, setForecasts) {
  // ... existing handlers ...

  const handleRepaymentPaid = useCallback(
    async (id: string, fromAccountId: string) => {
      await markRepaymentAsPaid(id, fromAccountId);
      setForecasts((prev) => prev.filter((f) => f.id !== id));
      refresh();
    },
    [setForecasts, refresh],
  );

  const handlePaidExternally = useCallback(
    async (id: string) => {
      await markForecastPaidExternally(id);
      setForecasts((prev) => prev.filter((f) => f.id !== id));
      refresh();
    },
    [setForecasts, refresh],
  );

  const handleMarkAsTransfer = useCallback(
    async (expenseId: string, toAccountId: string) => {
      await reclassifyExpenseAsTransfer(expenseId, toAccountId);
      refresh();
    },
    [refresh],
  );

  return {
    handleMarkPaid,
    handleRealise,
    handleDelete,
    handleRepaymentPaid,     // NEW
    handlePaidExternally,     // NEW
    handleMarkAsTransfer,     // NEW
  } as const;
}
```

### 9.4 Modified: `components/expense/ReviewQueueItem.tsx`

**Badge logic update:**

```typescript
// Current: isForecast ? "FORECAST" : "OVERDUE"
// New:
if (expense.nature === 'forecast') {
  if (expense.forecast_type === 'repayment') {
    badge = { text: "REPAYMENT", color: badgeColors.blue };
  } else if (isOverdue) {
    badge = { text: "OVERDUE", color: badgeColors.red };
  } else {
    badge = { text: "DUE", color: badgeColors.orange };
  }
}
```

### 9.5 Modified: `app/expense/[id].tsx`

**Expense detail screen:** Add "Mark as Transfer" button for realized savings expenses.

Condition: `expense.nature === 'realized' && expense.account_id && accountType === 'savings'`

On press: opens `AccountPickerSheet` → user picks destination → calls `reclassifyExpenseAsTransfer`.

### 9.6 Modified: `app/(tabs)/index.tsx` (Home Screen)

**Upcoming Dues section:** Show `forecast_type` badge. Separate repayment count from expense count:
- "3 upcoming dues (2 expenses, 1 repayment)"

---

## 10. Modified: `services/notification-scheduler.ts`

### 10.1 Different wording for repayment vs expense

**Current:** "Due today: {merchant} — Rs {amount}"

**New:**
- Expense: "Due today: {merchant} — Rs {amount}"
- Repayment: "CC bill Rs {amount} due today — {bank} Card {last4}"

Load `forecast_type` in the notification query and branch on it.

---

## 11. Updated: `database/TABLE_SCHEMAS.ts`

Add new columns and table:

```typescript
expenses: [
  ...existing,
  "forecast_type",        // 035
  "paid_from_account_id", // 035
] as const,

account_transfers: [
  "id",
  "user_id",
  "from_account_id",
  "to_account_id",
  "amount",
  "description",
  "date",
  "linked_forecast_id",
  "linked_expense_id",
  "source",
  "created_at",
  "updated_at",
  "deleted_at",
] as const,
```

---

## 12. Budget/Spending Exclusions

### 12.1 Transfers must NOT count as spending

**Already handled:** Transfers are in `account_transfers` table, not in `expenses`. Budget queries only sum `expenses` table → transfers are automatically excluded.

**Edge case:** When an expense is reclassified as a transfer via "Mark as Transfer", the expense is soft-deleted (`deleted_at` set) and a transfer record is created. Existing queries filter `deleted_at IS NULL`, so the expense disappears from budgets immediately.

### 12.2 Repayment forecasts and budget

Repayment forecasts (`forecast_type = 'repayment'`) are `nature = 'forecast'`, which is already excluded from budget calculations (budgets only sum `nature = 'realized'`). When a repayment is "paid", it becomes a transfer, not a realized expense. So repayments never hit budgets — correct behavior.

---

## 13. File Change Summary

### New Files
| File | Purpose |
|------|---------|
| `database/migrations/035_forecast_type.ts` | Add forecast_type, paid_from_account_id |
| `database/migrations/036_account_transfers.ts` | Create account_transfers table |
| `database/migrations/037_backfill_forecast_type.ts` | Backfill data |
| `services/account-transfer.ts` | Transfer CRUD + auto-detect |
| `components/expense/AccountPickerSheet.tsx` | Account picker bottom sheet |

### Modified Files
| File | Changes |
|------|---------|
| `database/TABLE_SCHEMAS.ts` | Add new columns + table |
| `database/migrations/index.ts` | Register migrations 035-037 |
| `services/expense-forecasts.ts` | Split markForecastAsPaid, add paid-externally |
| `services/financial-account.ts` | Rename + enhance reduceCcDuesOnPayment → applyCcPayment |
| `services/account-balance.ts` | Include transfers in balance formula |
| `services/sms/bank-patterns.ts` | 4 new patterns |
| `services/sms/sms-to-expense.ts` | Set forecast_type, IMPS/P2A transfer detection |
| `services/expense-types.ts` | Add forecast_type to Expense interface |
| `components/expense/ForecastActionBar.tsx` | Conditional buttons by forecast_type |
| `components/expense/ReviewQueueItem.tsx` | New badge colors/text |
| `hooks/use-forecast-actions.ts` | New handlers |
| `app/expense/[id].tsx` | Mark as Transfer action |
| `app/(tabs)/index.tsx` | Badge/count updates |
| `services/notification-scheduler.ts` | Wording by forecast_type |

### Deleted Code
| What | Where |
|------|-------|
| `addCredit()` calls for CC bill payments | `services/expense-forecasts.ts` (lines 399-405, 419-425) |
| Direct `reduceCcDuesOnPayment` calls | Replaced with `applyCcPayment` |

---

## 14. Dependency Graph

```
Migration 035 (forecast_type)
  ↓
Migration 036 (account_transfers table)
  ↓
Migration 037 (backfill)
  ↓
account-transfer.ts (new service, depends on table)
  ↓
expense-forecasts.ts (split markForecastAsPaid, calls transfer service)
financial-account.ts (applyCcPayment, called by forecast service)
account-balance.ts (includes transfers in formula, calls transfer service)
  ↓
sms-to-expense.ts (sets forecast_type, calls transfer service for IMPS/P2A)
bank-patterns.ts (new patterns, no service dependency)
  ↓
ForecastActionBar.tsx (reads forecast_type, shows different buttons)
AccountPickerSheet.tsx (new component, no service dependency)
use-forecast-actions.ts (calls new service functions)
  ↓
[id].tsx (Mark as Transfer button)
index.tsx (badge/count updates)
ReviewQueueItem.tsx (badge colors)
notification-scheduler.ts (wording)
```

---

## 15. Test Plan

### Unit Tests
- Migration 035/036/037: schema validation, backfill correctness
- `account-transfer.ts`: CRUD operations, autoDetectTransfer edge cases
- `applyCcPayment`: dues decrease + available limit increase + cap at credit_limit
- `markRepaymentAsPaid`: creates transfer, updates CC, rejects forecast
- `markForecastPaidExternally`: CC dues change for repayment, no change for expense
- `markExpenseForecastAsPaid`: unchanged behavior from current tests
- Balance calculation with transfers
- New SMS patterns: parse correctness, confidence scores

### Integration Tests
- End-to-end: CC bill SMS → repayment forecast → mark as paid → transfer created → balances correct
- End-to-end: IMPS debit + credit on two accounts → auto-detected as transfer
- Reclassify expense as transfer → expense removed from budget, transfer in ledger
- Paid externally → CC dues reduced, no transfer, no savings impact
