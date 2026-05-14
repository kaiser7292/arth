# PRD V17 — Loans + Expense→Investment Linking

**Version range:** v17.0.0 through v17.3.0
**Status:** Spec
**Parent:** [`PROPOSAL_V17_loans_and_investments.md`](PROPOSAL_V17_loans_and_investments.md)

## Why

Two real-world gaps in v16.x:

1. Loans are stored as a `last_known_balance` scalar. No amortization, no prepayment, no interest paid vs principal paid view, no foreclosure calc.
2. Investment flows that aren't demat-shaped (SIP via bank auto-debit, PPF, ELSS, gold jewelry, real estate contribution) have no way to credit an Investment Bucket. Money leaves savings as an "expense"; the bucket shows 0.

## Scope by minor version

### v17.0.0
- **Part 1 complete:** mark any realized expense as an investment → link it to any active Investment Bucket (regardless of FY). Budget excludes linked expenses; Insights excludes linked; Savings rate includes them. Smart Rules gains a `link_to_investment_bucket` action.
- **Part 2 foundation:** `loan_accounts` / `loan_schedule_entries` / `loan_prepayments` schema. Add Loan wizard. Loan detail screen (read-only — hero + schedule list). Balance Sheet uses live amortized outstanding for loans that have a `loan_accounts` row. Home Loans summary card. All 7 loan types (personal/home/auto/education/business/gold/against_fd/other) + currency field.

### v17.1.0
- Prepayment flow (part-payment + foreclosure) with charge calculation per user-entered rules.
- What-if calculator: enter prepayment amount → shows interest saved + months saved + net applied.
- Schedule regeneration on prepayment.

### v17.2.0
- SMS EMI auto-match (link schedule installments to real debit expenses).
- Notifications: N days before EMI, overdue alert.

### v17.3.0
- Debt Reduction bucket type.
- Yearly Plan debt-reduction metric + on-track logic.
- Simulator: planned entries referencing a loan for prepayment projection.
- FX conversion for non-INR loans (if needed).

## Functional requirements

### F1 — Mark expense as investment (v17.0.0)

**Trigger:** expense detail screen → "Mark as Investment" action.

**Preconditions:**
- Expense nature = `realized` (not forecast).
- Not a credit, transfer, or refund.
- Not a split-tender leg / multi-split / single-split source — v17.0.0 single-type only.

**Flow:**
1. User taps action → `InvestmentBucketPickerSheet` opens.
2. Sheet shows all active buckets across all FYs, current-FY first, divider, prior-FY below.
3. Each row shows: bucket name, FY, current/target, linked milestone if any, progress bar.
4. User picks bucket → link row created in `expense_investment_links` → sheet closes.
5. Expense detail shows an accent-tinted "Investment · <bucket name>" pill with:
   - "View bucket" → deep-link to `/goals/investment-detail?id=<bucket_id>`
   - "Unlink investment" → drops link row
6. On link, also fire a first-link info banner (MMKV-gated, once per user): *"This expense is now tracked in the <bucket> bucket. It won't count toward your budget for <month>. You can unlink anytime."*

**Postconditions:**
- `expense_investment_links` row exists.
- Bucket `current_contributed` recomputed (includes both demat contribs + link contribs).
- Budget recomputes on next read (exclusion filter).
- Insight engine excludes the expense from Spending / YoY / Creep / Forecast.
- Yearly Plan savings rate counts it.
- Milestone progress updates if bucket is linked to one.

### F2 — Budget exclusion (v17.0.0)

`services/budget.ts:getCategorySpending` (or its equivalent — whatever feeds `(tabs)/budget.tsx`) must LEFT JOIN `expense_investment_links` and exclude expenses with a link row.

Linked expenses rendered in a **"Tracked via Buckets"** strip below category rows. Shows:
- Per-link row: merchant, amount, bucket name, tappable → expense detail.
- Footer: total.

### F3 — Insights exclusion (v17.0.0)

Spending trend / Lifestyle Creep / Forecast / YoY all exclude linked expenses. Savings rate includes them.

### F4 — Smart Rules action (deferred to v17.2.0)

New rule action type `link_to_investment_bucket` deferred to v17.2.0 where it bundles with SMS EMI auto-match infra changes. v17.0.0 ships manual linking only (expense detail → "Mark as Investment"). For recurring SIPs, users can multi-select and tag via the expense list in v17.0.0; full auto-tagging in v17.2.0.

### F5 — Add Loan wizard (v17.0.0)

**Entry:** Settings → Master Data → Accounts → "Add Loan" (new button alongside existing Add Account). Opens a multi-step form:

1. **Basics:** loan type (7 options), bank name, agreement ID, currency (default INR, picker from v16.0.0 locale list).
2. **Amounts:** principal sanctioned, principal disbursed, disbursement date, EMI start date, EMI day of month.
3. **Rate + tenure:** interest rate %, interest type (fixed/floating), interest method (reducing/flat/simple — default reducing), tenure months, EMI amount (pre-computed, editable to match lender).
4. **Fees + penalties:** processing fee, stamp duty, insurance premium, prepayment charge %s (early + late) + threshold EMIs + foreclosure waiver months + foreclosure waiver min amount, penal rate + penal cap.
5. **Review + save:** shows generated schedule preview (first 5 + last 5 installments).

On save:
- Creates `financial_accounts` row with `account_type='loan'`.
- Creates `loan_accounts` 1:1 sibling.
- Generates full `loan_schedule_entries` (all N rows).
- Redirects to `/loans/[id]`.

### F6 — Loan detail screen (v17.0.0)

Hero card: outstanding principal (live, computed from schedule), interest paid to date, interest remaining to term, next EMI due date + amount.

Sections:
- **Schedule** (collapsible, default closed): paginated list of 60-ish installments with status chips (scheduled / paid / overdue).
- **Key details**: agreement number, interest rate, tenure, disbursement date, EMI day — read-only in v17.0.0 (edit in v17.1.0).

### F7 — Balance Sheet integration (v17.0.0)

`services/balance-sheet.ts` — for accounts with `account_type='loan'`:
- If a `loan_accounts` row exists: liability = outstanding principal computed from schedule at `asOfDate`.
- Else: fall back to `last_known_balance` (legacy behavior).

Historic FY columns: for loans with a schedule, back-compute outstanding at the historic `asOfDate`; for legacy scalar loans, continue showing `—`.

### F8 — Home Loans summary card (v17.0.0)

New card on `(tabs)/index.tsx` under "Explore & Tools". Shows:
- Count of active loans.
- Total outstanding across loans (INR only in v17.0.0; non-INR excluded with note).
- Next EMI due (merchant + date).
- Tap → navigates to a new `/loans/index` list screen (or to single loan if only one).

### F9 — Feature flags (v17.0.0)

Both gates in `services/feature-flags.ts`:
- `v17_expense_investment_link` — gates F1-F4. Off = feature invisible; existing links stay in DB inert.
- `v17_loans_v1` — gates F5-F8. Off = Add Loan hidden; loans fall back to scalar.

Default both ON. Flip-off for rollback.

### F10 — Backup/restore (v17.0.0)

`BACKUP_TABLES` adds (in dependency order): `expense_investment_links`, `loan_accounts`, `loan_schedule_entries`, `loan_prepayments`. `TABLE_SCHEMAS` gets a column list for each.

### F11 — Prepayment flow (v17.1.0)

Two entry points:
1. Loan detail → "Record prepayment" → sheet: amount, strategy (reduce tenure / reduce EMI), date, optional linked-expense picker.
2. Expense detail (any realized non-credit non-transfer) → "Link to loan prepayment" → pick loan + strategy.

**Charge calculation (rules from user's entered data):**
```
months_since_disbursement = (prepayment_date - disbursement_date) in months
remaining_emis = tenure_months - installments_paid

if kind == "foreclosure":
  if loan.foreclosure_waiver_months is not null
     and months_since_disbursement >= loan.foreclosure_waiver_months
     and loan.principal_sanctioned >= (loan.foreclosure_waiver_min_amount ?? 0):
    charge = 0
  else if remaining_emis <= loan.prepayment_charge_threshold_emis:
    charge = (principal_outstanding * loan.prepayment_charge_pct_early) / 100
  else:
    charge = (principal_outstanding * loan.prepayment_charge_pct_late) / 100
else:  # part_payment
  if remaining_emis <= loan.prepayment_charge_threshold_emis:
    charge = (amount * loan.prepayment_charge_pct_early) / 100
  else:
    charge = (amount * loan.prepayment_charge_pct_late) / 100
```

Plus 18% GST on charge by default (user-overridable per loan).

**Schedule regen** after prepayment: delete all `status='scheduled'` installments after prepayment date, regenerate from remaining principal.

### F12 — Foreclosure calc (v17.1.0)

On loan detail: "Foreclose now" button → opens computed quote:
- Principal outstanding
- Interest accrued from last paid EMI to today
- Prepayment charge (with GST, net of waiver)
- Total to pay
- Interest saved (vs running to term)
- Months saved

Non-binding — just a calculator. User has to actually record the prepayment separately to mark the loan closed.

### F13 — What-if calculator (v17.1.0)

Loan detail: "What if I prepay ₹X?" slider → shows interest saved + months saved + prepayment charge impact.

### F14 — SMS EMI auto-match (v17.2.0)

SMS parser detects common EMI debit patterns. Matcher: find loan with `emi_amount` matching ±5% of SMS amount + EMI date within ±5 days of current SMS date. Auto-link debit expense to the `loan_schedule_entries` row → marks installment `paid`.

### F15 — EMI notifications (v17.2.0)

2 days before EMI → notification.
1 day after EMI date without a matched payment → overdue notification.

### F16 — Debt Reduction bucket (v17.3.0)

New bucket type `debt_payoff` in `investment_buckets` (migration adds `bucket_type` column). Linked to a loan. Feeds from prepayments (not contributions). `current_contributed` = sum of prepayments applied to the loan in the FY window.

### F17 — Yearly Plan debt-reduction metric (v17.3.0)

Cockpit shows "Debt reduced this FY" alongside "Saved this FY". On-track logic: if user set a debt-payoff target, show projected shortfall.

### F18 — Simulator integration (v17.3.0)

Planned entry types gain "Prepay loan". When run, simulator projects:
- Cashflow impact (outflow on prepay date).
- Long-term interest saving (delta vs running to term).
- Warning strip: "This prepayment saves ₹X over remaining tenure."

### F19 — FX conversion for non-INR loans (v17.3.0)

If loan currency ≠ locale currency: Balance Sheet shows value converted using a user-entered rate (stored per-loan with a date). Warning pill if rate is >90 days old.

## Non-functional

- All migrations idempotent (PRAGMA table_info guards).
- All new tables in `TABLE_SCHEMAS` and `BACKUP_TABLES`.
- Feature-flag rollback safe — flip off → feature disappears without data loss.
- Amortization math unit-tested against Sourav's Axis PDF (60 rows).
- Loan-engine is pure functions (no DB); service layer wraps DB ops.
- Zero new TS errors in v17-touched files.
- Full test suite remains green.

## Out of scope

- Co-borrower / joint loan modeling.
- Floating rate with rate-reset events.
- Home loans with property-tax / insurance bundled separately (all lumped into `insurance_premium` / `processing_fee` in v17).
- Auto-fetched FX rates (user enters manually).
- Gold / loan-against-FD with variable disbursement tranches.

## Release notes — headline copy (v17.0.0)

> **v17.0.0 — Loans + Investment linking.**
>
> **Mark any expense as an investment** and link it to your Investment Bucket. SIPs, PPF contributions, gold purchases, whatever — they now count toward your Investment Bucket goals instead of vanishing into your spending budget.
>
> **Proper loan management.** Add your loan's Key Fact Sheet once — the app computes the amortization schedule, tracks outstanding principal per EMI, and shows it correctly on your Balance Sheet.
>
> **Heads up:** If you retroactively tag past expenses as investments, your budget totals, insights, and savings rate for those months will recalculate — that's by design. Your SIPs were previously counted as "spending," but they're really savings.
