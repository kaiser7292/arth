# V17 Proposal — Proper Loan Management + Expense-as-Investment Linking

**Status:** Proposal only. No code written. User to approve scope before planning.
**Target app version (tentative):** v17.0.0 (MAJOR — new feature surface).
**Informing document:** Axis Bank Personal Loan Key Fact Sheet + Repayment Schedule (Sourav's own loan: `PPR000810877249`, ₹10,15,000 @ 11.49% fixed, 60 EMIs of ₹22,317).

---

## Why now

Two user-surfaced gaps in v16.x:

1. **Loans are second-class.** `financial_accounts.account_type='loan'` exists, but it only stores a `last_known_balance` scalar. No interest rate, no tenure, no EMI, no amortization schedule, no prepayment modeling. A user paying ₹22K/month on a ₹10L personal loan gets no:
   - Split of EMI into principal vs interest per month
   - Outstanding-principal roll-forward (the real liability)
   - Prepayment "what-if" (does a ₹1L part-payment save ₹80K interest + 7 months?)
   - Foreclosure projection (what's it cost to close this today?)
   - Penal-charge modeling
   - Integration with Yearly Plan / Balance Sheet beyond a flat number

2. **Investments that don't live in a demat account are orphaned.** Today an Investment Bucket can only be fed via a demat transfer (v14.4.0 link). But many real investment flows aren't demat-shaped:
   - Recurring SIP via bank auto-debit (money leaves savings, lands in an MF folio, not held at a broker)
   - Manual purchase via Groww/Zerodha apps where the user records it as an outflow on a spending screen
   - PPF/NPS/ELSS contributions (no "demat" container)
   - Gold jewelry / physical gold (no account)
   - Real estate investment (single asset, no account)

   User can't currently say "**this ₹25,000 expense from HDFC Savings on 5th each month is actually a SIP contribution to my Retirement bucket**" without a parallel demat shim.

---

## User asks (verbatim)

> "Can we have an option where they can breakdown the CTC — sometimes employer does not include PM and gratuity as part of CTC" → **shipped in v16.0.9** (gratuityInCTC toggle + manual-breakdown mode).

> "Employee PF is included in taxation income and is not deducted anymore in new regime" → **verified already correct in v16.0.9; regression test added.**

> "Can we have an option to mark an expense as an investment and link it to an investment bucket which is not marked by an account?" → **Part 1 of this proposal.**

> "Have a proper loan account management, debt reduction, advanced closure plan — where if you do prepayment it reduces cost depending on loan terms and tenure left and all that" → **Part 2 of this proposal.**

> Use the attached Axis PDF to come up with a proposal → **schema derived from its fields below.**

> "Connect it to the yearly plan or investment bucket, balance sheet and account master" → **integration surface in each part.**

---

## Part 1 — Mark an Expense as Investment, link to any Investment Bucket

### The problem in plain words

Today if user sets up a ₹25K monthly SIP to "HDFC Flexi Cap" via bank auto-debit:
- The money leaves HDFC Savings as an "expense" (category: Investments, merchant: HDFC AMC).
- The Investment Bucket "Retirement" shows ₹0 contributed because it's not tied to a demat transfer.
- Balance Sheet counts it neither as asset nor liability — it just disappears into the "spent" bucket.
- Yearly Plan's "on-track" logic for savings rate doesn't credit it.

That's double-wrong: the money should count as an **investment contribution**, not a discretionary expense.

### Proposed: `expense_investment_links` (new table)

One expense can point at one Investment Bucket. Additive to existing schema — the expense row stays a regular expense (nature=realized, debits the account) so account balances continue to be right. The link is a tag/metadata relationship that promotes the outflow from "spend" to "investment contribution".

**Schema sketch (migration 028):**

```sql
CREATE TABLE expense_investment_links (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  investment_bucket_id TEXT NOT NULL REFERENCES investment_buckets(id) ON DELETE CASCADE,
  -- denormalized for fast aggregation; kept in sync with expense.amount
  contribution_amount REAL NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_expense_investment_link_unique
  ON expense_investment_links(expense_id);
CREATE INDEX idx_expense_investment_link_bucket
  ON expense_investment_links(investment_bucket_id);
```

### UX flow

Expense detail screen (`app/expense/[id].tsx`) gets a new action:

- **"Mark as Investment"** (visible for realized non-refund non-credit non-transfer expenses).
- Tap → opens `InvestmentBucketPickerSheet` (reuses v14.4.0 pattern from demat sheets) showing the user's active buckets for the current FY with current/target progress bars.
- Pick a bucket → link created → expense row shows an **"Investment · Retirement"** soft pill in accent color (replacing the category chip or alongside).
- Undo via "Unlink investment" → drops the link row, expense reverts to normal.

**Hooks into existing surfaces:**

| Surface | Integration |
|---|---|
| **Investment Bucket detail** (`app/goals/investment-detail.tsx`) | "Contributions from expenses" section alongside existing "From transfers". Tappable rows → deep-link to source expense. |
| **`investment_buckets.current_contributed`** | Recomputed as `SUM(transfers) + SUM(expense_investment_links)`. `recomputeBucketContributed()` helper extended. |
| **Balance Sheet** (`services/balance-sheet.ts`) | Investment buckets already surface via milestones; now any linked SIP/manual-purchase expense credits the corresponding bucket, which in turn credits its linked milestone. Spending categorized as "Investments" but unlinked stays a cost; linked promotes to a saving. |
| **Yearly Plan savings rate** | `savings_rate` already counts bucket contributions; now counts these too. |
| **Expense Insights / Lifestyle Creep** | Linked expenses excluded from spending totals (they're savings, not spending). Avoids the "my Investments category exploded YoY" false-positive. |
| **Smart Rules** (v15.2) | New action type `link_to_investment_bucket: <bucket_id>` — auto-link expenses matching a rule (e.g. merchant contains "HDFC AMC" → link to Retirement). Saves manual tagging on recurring SIPs. |
| **Budget** | Linked expenses **excluded from budget totals entirely** (any category), shown in a dedicated "Tracked via Buckets" strip below the budget categories so the money is still visible without competing with discretionary-spend caps. Rationale: SIPs/contributions are pre-committed savings decisions, not discretionary spend; Buckets already track them against annual targets; counting them in Budget would be double-counting and would produce nonsense UX ("I'm at 100% of my Investments budget — good or bad?"). Precedent: employee EPF also leaves the salary every month and never appears in the expense budget. |
| **Budget — edge cases** | (a) Linking an expense after creation → `bumpDataVersion()` → live recompute; the row visually moves from the category to the Tracked strip. (b) Unlink → reverts to regular spend; budget picks it back up. (c) Refund on linked expense → reduces bucket contribution; budget math unchanged (already handles refunds via credit rows). (d) Split-tender with one leg linked → only that leg is excluded. (e) Exclusion is driven by the link row, not the expense's category — category can stay whatever makes sense (Investments / Salary Deduction / Uncategorized). |
| **Optional override (defer to v17.1.x)** | Per-bucket "Count contributions toward budget?" toggle, default Off. For users who *want* SIPs to compete with groceries for a monthly spending cap. Not worth shipping in v17.0.0 — default is the right default; add toggle only if users ask. |
| **Recycle bin / delete / refund** | Delete expense → FK cascade drops the link. Refund against a linked expense → reduce `contribution_amount` proportionally, bucket `current_contributed` recomputes. |

### Edge cases to handle

1. **Refund on a linked expense** (SIP reversed, MF redemption refund). Credit-side entry with `refund_of_expense_id` → should reduce the bucket contribution by the refund amount. Matches existing refund cascade logic.
2. **Split-tender purchase** with `purchase_group_id` — one leg marked as investment, the other as regular spend. Valid; link the specific leg only.
3. **Expense nature=forecast/intent** — cannot be linked (not realized). Only realized expenses carry weight.
4. **Multiple expenses per day to same bucket** — each expense links individually; bucket shows N contributions.
5. **Bucket deleted** — ON DELETE CASCADE drops links; the underlying expense reverts to regular.

---

## Part 2 — Proper Loan Management

### What the Axis PDF tells us about what "proper" means

Sourav's loan anatomy:

| Field | Value | Our schema needs |
|---|---|---|
| Agreement number | `PPR000810877249` | `loan_agreement_id` (text, user-supplied) |
| Lender | Axis Bank | existing `bank_name` |
| Loan type | PERSONAL POWER BRE (personal loan) | `loan_type` enum: personal / home / auto / education / business / gold / against-FD / other |
| Sanctioned amount | ₹10,15,000 | `principal_sanctioned` |
| Disbursed amount | ₹10,15,000 | `principal_disbursed` (may differ from sanctioned) |
| Disbursement date | 2024-04-05 | `disbursement_date` |
| EMI start date | 2024-04-10 | `emi_start_date` |
| EMI day | 10 of each month | `emi_day_of_month` (1-31) |
| Interest rate | 11.49% p.a. (monthly reducing) | `interest_rate_pa` (real), `interest_method` enum: reducing / flat / simple |
| Interest type | Fixed | `interest_type` enum: fixed / floating |
| Tenure | 60 months | `tenure_months` |
| EMI | ₹22,317 | `emi_amount` (derivable, but storing it avoids rounding differences with lender) |
| Repayment mode | Standing Instructions | `repayment_mode` enum: si / nach / pdc / manual |
| Processing fee | ₹9,998 | `processing_fee` |
| Stamp duty | ₹2,200 | `stamp_duty` |
| Insurance premium | - | `insurance_premium` |
| Prepayment charges | 3% if ≤36 EMIs remaining, 2% if >36 (after 1 year, waived for ≥₹10L full-foreclosure from own funds) | `prepayment_charge_pct_early` (3.0), `prepayment_charge_pct_late` (2.0), `prepayment_charge_threshold_emis` (36), `foreclosure_waiver_months` (12), `foreclosure_waiver_min_amount` (1000000) |
| Penal charge | 8% above base on overdue, capped at 24% | `penal_rate_pa` (8.0), `penal_rate_cap_pa` (24.0) |

Plus the **60-row amortization schedule** with opening principal / EMI / principal component / interest component / closing principal per installment. We generate this from the loan params rather than store every row — but we cache the schedule for fast display.

### Proposed schema

**Migration 028 (or 029 if bundled with Part 1).**

#### `loan_accounts` — extends `financial_accounts` via 1:1 FK

Keep the existing `financial_accounts` row (so account-master, ledger, transfers, SMS-linking all work unchanged). Add a sibling `loan_accounts` table holding all the loan-specific metadata:

```sql
CREATE TABLE loan_accounts (
  id TEXT PRIMARY KEY,
  financial_account_id TEXT NOT NULL UNIQUE REFERENCES financial_accounts(id) ON DELETE CASCADE,
  agreement_id TEXT,              -- e.g. "PPR000810877249"
  loan_type TEXT NOT NULL CHECK(loan_type IN ('personal','home','auto','education','business','gold','against_fd','other')),
  principal_sanctioned REAL NOT NULL,
  principal_disbursed REAL NOT NULL,
  disbursement_date TEXT NOT NULL,
  emi_start_date TEXT NOT NULL,
  emi_day_of_month INTEGER NOT NULL CHECK(emi_day_of_month BETWEEN 1 AND 31),
  interest_rate_pa REAL NOT NULL,
  interest_type TEXT NOT NULL CHECK(interest_type IN ('fixed','floating')),
  interest_method TEXT NOT NULL DEFAULT 'reducing' CHECK(interest_method IN ('reducing','flat','simple')),
  tenure_months INTEGER NOT NULL,
  emi_amount REAL NOT NULL,        -- stored (lender's figure may differ slightly from computed)
  repayment_mode TEXT CHECK(repayment_mode IN ('si','nach','pdc','manual')),
  processing_fee REAL DEFAULT 0,
  stamp_duty REAL DEFAULT 0,
  insurance_premium REAL DEFAULT 0,
  -- Prepayment terms
  prepayment_charge_pct_early REAL DEFAULT 0,
  prepayment_charge_pct_late REAL DEFAULT 0,
  prepayment_charge_threshold_emis INTEGER,
  foreclosure_waiver_months INTEGER,            -- loan is waived from charges after N months
  foreclosure_waiver_min_amount REAL,           -- and only for loans >= this size
  -- Penalty terms
  penal_rate_pa REAL DEFAULT 0,
  penal_rate_cap_pa REAL DEFAULT 0,
  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed','foreclosed','written_off')),
  closed_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### `loan_schedule_entries` — generated amortization rows (cached)

```sql
CREATE TABLE loan_schedule_entries (
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
  -- Linked real-world payment (SI debit matched to this installment)
  linked_expense_id TEXT REFERENCES expenses(id) ON DELETE SET NULL,
  paid_date TEXT,
  paid_amount REAL,
  UNIQUE(loan_account_id, installment_num)
);
```

#### `loan_prepayments` — part-payments + foreclosure events

```sql
CREATE TABLE loan_prepayments (
  id TEXT PRIMARY KEY,
  loan_account_id TEXT NOT NULL REFERENCES loan_accounts(id) ON DELETE CASCADE,
  prepayment_date TEXT NOT NULL,
  amount REAL NOT NULL,
  prepayment_charge REAL DEFAULT 0,
  gst_on_charge REAL DEFAULT 0,
  kind TEXT NOT NULL CHECK(kind IN ('part_payment','foreclosure')),
  -- What it does to the schedule
  strategy TEXT CHECK(strategy IN ('reduce_tenure','reduce_emi')),  -- part-payment only
  -- Source of funds
  linked_expense_id TEXT REFERENCES expenses(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Amortization math (EMI + schedule regeneration)

Standard reducing-balance formula:

```
EMI = P × r × (1+r)^n / ((1+r)^n − 1)
```

Where `P` = outstanding principal, `r` = monthly rate (annual/12), `n` = remaining months.

Per-installment split:
- interest = opening_principal × r
- principal = EMI − interest
- closing_principal = opening_principal − principal

This is pure math; add `services/loan-engine.ts` with unit-testable functions:

```ts
generateSchedule(params: LoanParams): ScheduleEntry[]
applyPartPayment(
  schedule: ScheduleEntry[],
  prepaymentDate: string,
  amount: number,
  strategy: "reduce_tenure" | "reduce_emi",
): ScheduleEntry[]
computeForeclosureQuote(loan: Loan, asOf: string): {
  principalOutstanding: number,
  interestAccruedToDate: number,
  prepaymentCharge: number,
  gst: number,
  totalToPay: number,
  savedInterest: number,  // vs running to term
  savedMonths: number,
}
computePrepaymentImpact(
  loan: Loan,
  amount: number,
  prepaymentDate: string,
  strategy: "reduce_tenure" | "reduce_emi",
): {
  charge: number,
  gst: number,
  netApplied: number,      // amount - charge - gst
  newTenure: number | null,
  newEMI: number | null,
  interestSavedTotal: number,
  monthsSaved: number,
}
```

Validate the engine against the Axis PDF's 60-row schedule — the first installment is oddly light on interest (₹1,944 for 5 days) because the loan was disbursed April 5 but EMI started April 10, then normalized at ₹9,524 from installment 2. Engine needs to handle the broken-period interest correctly (charge interest from disbursement to EMI start date, deduct from installment 1).

### What the user can do with it

#### 1. **"Add Loan" wizard** in Settings → Accounts
Guided form that captures the Axis fields (or equivalent from any lender's key-fact sheet). Generates the schedule on save. Also adds the loan as a regular `financial_accounts` row so it shows up in the ledger.

#### 2. **Loan detail screen** (`app/loans/[id].tsx`)
- Hero: Outstanding principal (live), interest paid to date, interest remaining to term.
- Amortization schedule with paid/overdue/scheduled badges.
- Timeline: EMIs + prepayments, sorted chronologically.
- "What-if prepayment" calculator — enter an amount and strategy, shows interest saved + months saved + prepayment charge net-of-waiver.
- "Foreclose now" calculator — shows full closure cost and savings.
- Penal charge simulator — if you miss next EMI by N days, here's the penalty.

#### 3. **Auto-match EMI debits** to schedule installments
User's SI debit lands as an expense (from SMS or manual) → matcher looks for a scheduled installment within ±5 days of the EMI amount on this loan → auto-links it → marks installment `paid`. Mirror of the v14.6.0 recurring-reminder matcher.

#### 4. **Prepayment flow** from expense detail
User does a lump-sum prepayment via bank transfer → expense lands → tap "Link to Loan Prepayment" → pick loan + strategy → creates `loan_prepayments` row → regenerates schedule from that date forward.

#### 5. **Integration into other surfaces**

| Surface | Change |
|---|---|
| **Home card** | New "Loans" card summarizing outstanding + next-EMI-due. |
| **Balance Sheet** | Loan liability = live outstanding principal (from schedule) instead of `last_known_balance` scalar. Historic FY columns use end-of-FY outstanding (snapshot table or recomputed from schedule). |
| **Yearly Plan** | "Debt reduction" becomes a tracked goal — principal reduction YoY as a metric. User can set "pay off by <date>" target; app projects extra monthly amount needed. |
| **Investment Buckets** | New bucket type `debt_payoff` — feeds from prepayments rather than investments. Competes with investment buckets in the "where should my surplus go?" surface. |
| **Simulator (v16.0.0+)** | Planned entries can reference a loan for "simulate prepayment of ₹2L on <date>" — simulator shows impact on cashflow AND on long-term interest saving. |
| **Insights** | Interest paid vs principal paid trend. Debt-to-income ratio if combined with salary profile. |
| **Notifications** | N days before EMI date + overdue alert + foreclosure milestone ("only 6 EMIs left"). |
| **SMS parsing** | Auto-detect EMI SI debits (`A/c debited INR 22,317 for EMI`) and link to schedule. Requires extending `sms-templates.json` and the matcher. |

---

## Cross-part integration — how loans and investments connect to the bigger picture

### Balance Sheet truth
Today: assets = savings + wallets + demat + fund + pension; liabilities = CCs + loan last_known + hisaab.
After v17:
- Loans use live amortized outstanding (accurate to the paise on any date).
- Investment buckets are first-class assets when linked to a milestone; linked expenses contribute.
- Net worth finally reflects real debt-reduction progress + real investment accumulation (not just demat).

### Yearly Plan truth
Today: savings rate = (monthly saved ÷ salary) where saved = deposits to investment buckets from demat transfers.
After v17:
- Savings rate also credits linked-expense contributions.
- New metric: **debt reduction rate** = (principal paid down ÷ loan opening balance at FY start). Feeds into the cockpit alongside savings rate.
- "On-track" logic evaluates both axes — you can be on track for investments but off-track for debt payoff.

### Simulator (v16.0.0) truth
Today: simulator projects cashflow for user-entered planned entries.
After v17:
- Upcoming EMIs auto-seed into the active scenario (reminders already do this; now sourced from loan schedule).
- Prepayment planned entries tied to a specific loan show the real interest-saving delta in the warning strip ("This prepayment saves ₹1,42,000 over remaining tenure").

### Account Master truth
Today: `account_type='loan'` is just a liability label.
After v17: loans are fully modeled but still appear as rows in Account Master. Tapping a loan opens `loans/[id]` (new stack) instead of the generic account detail.

---

## Scope decisions (user to confirm)

### Part 1 — Expense-as-investment linking

| Decision | Recommendation | Rationale |
|---|---|---|
| Allow linking forecast (intent) expenses too? | **No** — realized only | Forecasts shouldn't inflate bucket `current_contributed`; wait until real. |
| Support reverse-direction (refund → reduces bucket)? | **Yes** | Data integrity. |
| UI entry point: both Expense detail AND Add-Expense screen? | **Expense detail only in v1** | Keeps add-flow simple; edit the freshly-created expense to mark it. |
| Smart Rules auto-linking? | **Yes, bundle with v17** | Recurring SIPs are the highest-frequency case; manual tagging would be tedious. |

### Part 2 — Loans

| Decision | Recommendation | Rationale |
|---|---|---|
| Interest method in v1? | **Reducing balance only** | Covers 99% of consumer loans. Flat/simple can come later. |
| Support floating-rate with rate-reset events? | **v2** | Adds a rate-history table; scope creep for v1. |
| Home loans with principal + interest + insurance + property-tax bundled? | **v2** — model as one composite for v1, break out later | Cover the core case first. |
| Gold loan / loan-against-FD with variable disbursement? | **v2** | Single-disbursement only in v1. |
| Co-borrower / joint loan support? | **v2** | Single-borrower in v1. |
| Prepayment modeling? | **Yes, both strategies** (reduce tenure OR reduce EMI) | The whole point of the feature. |
| Auto-match EMI debits via SMS? | **Yes** | Massive UX win; reuses existing matcher. |
| Historical loans (already paid off) — support entry? | **Yes** — status='closed' | User wants full financial history. |
| Interest-deduction tracking (Section 24b / 80EEA / 80E)? | **Yes for home/education loans** | Feeds back into the salary-calculator's old-regime deduction fields — reduces friction of typing the number. |

---

## Rough size estimate

| Area | Effort (for a dev doing it well) |
|---|---|
| Migration 028 + schema + TABLE_SCHEMAS + BACKUP_TABLES | S |
| `services/loan-engine.ts` (pure math) + unit tests | M |
| `services/loan-accounts.ts` (CRUD + schedule regen + prepayment apply) | M |
| Investment-bucket service + CRUD | S (small — extends existing) |
| Loan wizard + detail screen + prepayment sheet + foreclosure sheet | L |
| Expense-investment link sheet + expense-detail integration | M |
| Smart Rules: link_to_investment_bucket action | S |
| Balance Sheet rewrite to use live loan outstanding | S |
| Yearly Plan integration (debt reduction metric + on-track) | M |
| Home card (Loans summary) | S |
| SMS template for EMI auto-match | S |
| Notifications (EMI due, overdue) | S |
| Tests (engine + service + regression) | M |
| Docs (article for loans, article for investment links) | S |
| **Total** | Large — genuine v17.0.0 MAJOR bump. Safe to split across 17.0.x milestones if needed. |

---

## Proposed phasing

To keep each shippable chunk small:

- **v17.0.0** — Part 1 complete (expense→bucket linking + Smart Rules action) + Part 2 schema + Add Loan wizard + Loan detail (schedule display only, no prepayment yet) + Balance Sheet integration.
- **v17.1.0** — Prepayment flow + foreclosure calc + loan-engine what-if.
- **v17.2.0** — Auto-match EMI SMSes + notifications + Smart Rules action for EMIs.
- **v17.3.0** — Debt Reduction bucket type + Yearly Plan debt-reduction metric + Simulator integration.

---

## Scope decisions — LOCKED (answered 2026-05-04)

1. **Phasing** — v17.0.0 → v17.3.0 split agreed as proposed.
2. **Loan types day-1** — **All 7**: personal, home, auto, education, business, gold, loan-against-FD, other.
3. **Non-INR loans** — **Required**. Add `currency` (TEXT, default 'INR') to `loan_accounts` + `loan_prepayments`. Balance Sheet converts via existing FX rate table if present, else displays in native currency with a warning pill.
4. **Lender presets** — **No presets**. User enters prepayment charges / penal rates manually from their key-fact sheet in the Add Loan wizard. Keeps the feature lender-agnostic and future-proof (rates change; presets would rot).
5. **Bucket picker (Part 1)** — **All active buckets regardless of FY**. Sorted by current FY first, then older FYs below a divider.
6. **Investment-without-account clarification** — User means: *the existing bucket model is fine; buckets don't need a feeder account*. Demat-transfer linking (v14.4.0) is the OPTIONAL path, and an expense→bucket link is the SECOND path. No new kind of bucket needed. The proposal as written already handles this — Part 1 lets the user say "this ₹25K SIP expense credits the Retirement bucket" without any demat involvement. Resolved as-is.

## Concrete 17.0.0 task list (for user approval)

Before writing PRD/TDD/MASTER_PLAN, confirm this is the right first slice. v17.0.0 will ship:

**Part 1 — Expense→Investment linking (complete):**
- Migration 028: `expense_investment_links` table
- `services/expense-investment-link.ts` — CRUD + `recomputeBucketContributed` rewrite
- `components/expense/InvestmentBucketPickerSheet.tsx` — all-active-buckets picker
- `app/expense/[id].tsx` — "Mark as Investment" action + linked-badge
- `app/goals/investment-detail.tsx` — new "Contributions from expenses" section
- Budget tab: "Tracked via Buckets" strip below category list; linked expenses excluded from category totals
- Insights: exclude linked from Spending/YoY/Creep/Forecast; include in savings rate
- Smart Rules: `link_to_investment_bucket: <bucket_id>` action
- Yearly Plan savings-rate logic updated
- Backup/restore: `expense_investment_links` in `BACKUP_TABLES`
- Tests: service + budget exclusion + refund cascade + split-tender leg-scoped linking

**Part 2 — Loan schema + Add Loan + read-only detail (foundation):**
- Migration 029: `loan_accounts`, `loan_schedule_entries`, `loan_prepayments` (all 7 loan types, `currency` field)
- `services/loan-engine.ts` — pure math (generateSchedule, handles broken-period interest like Axis PDF's installment 1 edge case)
- `services/loan-accounts.ts` — CRUD + schedule generation on create
- `app/settings/loans/add.tsx` — Add Loan wizard (manual entry of all prepayment/penal rules, currency picker)
- `app/loans/[id].tsx` — loan detail (hero: outstanding principal / paid / remaining; amortization schedule list; status badges per installment). **No prepayment flow yet — that's v17.1.0.**
- Balance Sheet: replace `last_known_balance` scalar with live outstanding from schedule (for loan-type accounts that have a `loan_accounts` row; fall back to scalar for legacy rows)
- Home card: Loans summary (outstanding + next EMI date)
- Account Master: loan rows navigate to `/loans/[id]` instead of generic account detail
- Backup: three new tables in `BACKUP_TABLES`
- Tests: loan-engine amortization against Axis PDF reference + service CRUD + fresh-install migration

**Not in 17.0.0** (pushed to 17.1.x / 17.2.x / 17.3.x):
- Prepayment flow + foreclosure calc + what-if calculator → v17.1.0
- EMI auto-match from SMS + notifications → v17.2.0
- Debt Reduction bucket type + Yearly Plan debt-reduction metric + Simulator integration → v17.3.0

**Rough sizing check** — this is still a large v17.0.0, but it's the minimum coherent slice. Shipping just Part 1 alone would leave loans as second-class again; shipping loans without the wizard wouldn't let a user add one. This slice delivers two user-visible capabilities end-to-end.

**User to confirm** — say "write the trio" and I'll produce `PRD_V17.md` + `TDD_V17.md` + `MASTER_PLAN_V17.md`. Or say "trim X" if any of the above should slip to a later patch.
