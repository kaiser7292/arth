# TDD V17 — Technical Design

## Migrations

### 028_expense_investment_links (v17.0.0)
```sql
CREATE TABLE IF NOT EXISTS expense_investment_links (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  investment_bucket_id TEXT NOT NULL REFERENCES investment_buckets(id) ON DELETE CASCADE,
  contribution_amount REAL NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_exp_inv_link_exp ON expense_investment_links(expense_id);
CREATE INDEX idx_exp_inv_link_bucket ON expense_investment_links(investment_bucket_id);
```

### 029_loan_management (v17.0.0)
```sql
CREATE TABLE IF NOT EXISTS loan_accounts (
  id TEXT PRIMARY KEY,
  financial_account_id TEXT NOT NULL UNIQUE REFERENCES financial_accounts(id) ON DELETE CASCADE,
  agreement_id TEXT,
  loan_type TEXT NOT NULL CHECK(loan_type IN ('personal','home','auto','education','business','gold','against_fd','other')),
  currency TEXT NOT NULL DEFAULT 'INR',
  principal_sanctioned REAL NOT NULL,
  principal_disbursed REAL NOT NULL,
  disbursement_date TEXT NOT NULL,
  emi_start_date TEXT NOT NULL,
  emi_day_of_month INTEGER NOT NULL CHECK(emi_day_of_month BETWEEN 1 AND 31),
  interest_rate_pa REAL NOT NULL,
  interest_type TEXT NOT NULL CHECK(interest_type IN ('fixed','floating')),
  interest_method TEXT NOT NULL DEFAULT 'reducing' CHECK(interest_method IN ('reducing','flat','simple')),
  tenure_months INTEGER NOT NULL,
  emi_amount REAL NOT NULL,
  repayment_mode TEXT,
  processing_fee REAL DEFAULT 0,
  stamp_duty REAL DEFAULT 0,
  insurance_premium REAL DEFAULT 0,
  prepayment_charge_pct_early REAL DEFAULT 0,
  prepayment_charge_pct_late REAL DEFAULT 0,
  prepayment_charge_threshold_emis INTEGER,
  foreclosure_waiver_months INTEGER,
  foreclosure_waiver_min_amount REAL,
  penal_rate_pa REAL DEFAULT 0,
  penal_rate_cap_pa REAL DEFAULT 0,
  gst_pct REAL DEFAULT 18,
  fx_rate REAL,             -- v17.3.0 (nullable, for non-INR display)
  fx_rate_date TEXT,        -- v17.3.0
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed','foreclosed','written_off')),
  closed_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_loan_accounts_status ON loan_accounts(status);
CREATE INDEX idx_loan_accounts_fa ON loan_accounts(financial_account_id);

CREATE TABLE IF NOT EXISTS loan_schedule_entries (
  id TEXT PRIMARY KEY,
  loan_account_id TEXT NOT NULL REFERENCES loan_accounts(id) ON DELETE CASCADE,
  installment_num INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  opening_principal REAL NOT NULL,
  emi_amount REAL NOT NULL,
  principal_component REAL NOT NULL,
  interest_component REAL NOT NULL,
  closing_principal REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','paid','overdue','prepaid','skipped')),
  linked_expense_id TEXT REFERENCES expenses(id) ON DELETE SET NULL,
  paid_date TEXT,
  paid_amount REAL,
  UNIQUE(loan_account_id, installment_num)
);
CREATE INDEX idx_loan_sched_due ON loan_schedule_entries(loan_account_id, due_date);
CREATE INDEX idx_loan_sched_status ON loan_schedule_entries(loan_account_id, status);

CREATE TABLE IF NOT EXISTS loan_prepayments (
  id TEXT PRIMARY KEY,
  loan_account_id TEXT NOT NULL REFERENCES loan_accounts(id) ON DELETE CASCADE,
  prepayment_date TEXT NOT NULL,
  amount REAL NOT NULL,
  prepayment_charge REAL DEFAULT 0,
  gst_on_charge REAL DEFAULT 0,
  kind TEXT NOT NULL CHECK(kind IN ('part_payment','foreclosure')),
  strategy TEXT CHECK(strategy IN ('reduce_tenure','reduce_emi')),
  linked_expense_id TEXT REFERENCES expenses(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_loan_prepay_loan ON loan_prepayments(loan_account_id);
```

### 030_debt_reduction_bucket (v17.3.0)
```sql
ALTER TABLE investment_buckets ADD COLUMN bucket_type TEXT DEFAULT 'investment';
ALTER TABLE investment_buckets ADD COLUMN linked_loan_account_id TEXT;
CREATE INDEX idx_buckets_loan ON investment_buckets(linked_loan_account_id);
```

## Loan engine (pure math — `services/loan-engine.ts`)

### Amortization formula (reducing balance)

```
monthlyRate = annualRate / 12 / 100
EMI = P × r × (1+r)^n / ((1+r)^n − 1)
```

### Broken-period handling (first installment)
Axis PDF shows first installment has only 5 days of interest (Apr 5 disbursement → Apr 10 EMI start):
```
daysFromDisbursementToFirstEMI = emi_start_date - disbursement_date
broken_period_interest = principal * (annualRate / 365) * daysFromDisbursementToFirstEMI
```
First installment: `principal_component = EMI - broken_period_interest`, where `EMI` stays standard. Subsequent installments use normal monthly interest.

### Prepayment schedule regeneration
1. Keep all paid + prepaid installments.
2. Recompute remaining principal from last paid/prepaid installment's `closing_principal`.
3. Apply prepayment net amount (amount - charge - gst) — reduces remaining principal.
4. If strategy = `reduce_tenure`:
   - Keep EMI same, shorten schedule until closing_principal hits 0.
5. If strategy = `reduce_emi`:
   - Keep remaining months same, recompute EMI from (new principal, remaining months, rate).
6. Delete old scheduled rows after prepay date, insert new ones.

### Pure functions
```ts
export function generateSchedule(params: LoanParams): ScheduleEntry[];
export function computeOutstandingAt(
  schedule: ScheduleEntry[],
  prepayments: Prepayment[],
  asOfDate: string,
): number;
export function applyPrepayment(
  schedule: ScheduleEntry[],
  loan: LoanParams,
  prepayment: Prepayment,
): ScheduleEntry[];
export function computePrepaymentCharge(
  loan: LoanParams,
  amount: number,
  prepaymentDate: string,
  kind: "part_payment" | "foreclosure",
  installmentsPaid: number,
  principalOutstanding: number,
): { charge: number; gst: number };
export function computeForeclosureQuote(
  loan: LoanParams,
  schedule: ScheduleEntry[],
  prepayments: Prepayment[],
  asOf: string,
): ForeclosureQuote;
export function computePrepaymentImpact(
  loan: LoanParams,
  schedule: ScheduleEntry[],
  prepayments: Prepayment[],
  amount: number,
  prepaymentDate: string,
  strategy: "reduce_tenure" | "reduce_emi",
): PrepaymentImpact;
```

## Services

### `services/loan-accounts.ts`
- `createLoan(input): Promise<string>` — creates FA row + loan_accounts row + full schedule in a transaction, bumps data version.
- `getLoanById(id)`, `getLoansWithAccount()`, `listActiveLoans()`.
- `updateLoan(id, updates)` — basic fields only; rate/tenure changes in v17.1.0+ regenerate schedule.
- `deleteLoan(id)` — soft via status='closed' in v1; hard delete from Account Master in v17.1.0.
- `getLoanSummaryForHome()` — next EMI + total outstanding.
- `recordPrepayment(loanId, input)` (v17.1.0) — inserts prepayment, regenerates schedule.

### `services/expense-investment-link.ts`
- `createLink(expenseId, bucketId)` — validates (not split, realized), inserts link, recomputes bucket.
- `deleteLink(expenseId)` — removes link, recomputes bucket.
- `getLinkForExpense(expenseId)`.
- `getLinksForBucket(bucketId)`.
- `getLinkedExpensesForMonth(yyyymm)` — for budget "Tracked via Buckets" strip.
- `recomputeBucketContributed(bucketId)` — SUM(investment_contributions) + SUM(links where expense not soft-deleted).

## Integrations (touch points)

| File | Change |
|---|---|
| `services/yearly-plan.ts:recomputeBucketContributed` | Add link sum. |
| `services/budget.ts:getCategorySpending` (or equivalent) | LEFT JOIN exclude. |
| `services/insight-engine.ts` | WHERE NOT EXISTS link for Spending/YoY/Creep/Forecast queries. |
| `services/financial-cockpit.ts:savings_rate` | No change (reads bucket.current_contributed, which now includes links). |
| `services/balance-sheet.ts` | Loan liability: if loan_accounts row exists, use computeOutstandingAt(schedule, prepayments, asOfDate); else fallback to last_known_balance. |
| `services/smart-rules.ts` | New action `link_to_investment_bucket` in evaluator. |
| `services/backup.ts` | Add 4 tables to BACKUP_TABLES. |
| `database/TABLE_SCHEMAS.ts` | Add 4 schemas. |
| `services/expense-crud.ts:deleteExpense` | Soft-delete: link recompute happens via bucket (link joins expenses on deleted_at IS NULL). |
| `app/(tabs)/budget.tsx` | Render "Tracked via Buckets" strip. |
| `app/(tabs)/index.tsx` | Add Loans card. |
| `app/expense/[id].tsx` | Add "Mark as Investment" action + linked badge. |
| `app/goals/investment-detail.tsx` | Add "Contributions from expenses" section. |
| `app/settings/_layout.tsx` | Register loans stack. |
| `app/loans/_layout.tsx`, `app/loans/index.tsx`, `app/loans/[id].tsx`, `app/loans/add.tsx` | New loan screens. |

## Feature flags (v17.0.0)
```ts
v17_expense_investment_link: true,
v17_loans_v1: true,
```
Both default ON. Flip to false → new surfaces disappear; data stays.

## Test surface
- `__tests__/unit/loan-engine.test.ts` — schedule generation (Axis 60-row reference), prepayment math, foreclosure quote, broken-period handling.
- `__tests__/unit/expense-investment-link.test.ts` — CRUD, split-tender rejection, soft-delete behavior, bucket recompute.
- `__tests__/integration/database.test.ts` — migration counts (+3 migrations).
- Balance sheet + budget + insights — regression assertions for link exclusion.

## Rollback plan
- `v17_expense_investment_link=false` → UI gone, `recomputeBucketContributed` uses legacy formula. Existing link rows remain (inert).
- `v17_loans_v1=false` → Add Loan hidden, loan detail falls back to generic account detail, Balance Sheet reverts to scalar fallback. Existing loan_accounts rows remain (inert).
