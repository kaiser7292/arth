# Artha V7 — Account Transfers & Repayment Forecasts

**Version:** 7.0
**Date:** 2026-04-17
**Status:** Planning
**Theme:** Dual-entry accounting for inter-account transfers; distinguishing expense forecasts from repayment forecasts

---

## Problem Statement

Today, when a credit card bill is paid from a savings account, the app:
1. Does NOT debit the savings account
2. Does NOT increase the CC available limit
3. Creates an `account_credits` entry on the CC (a workaround, not proper accounting)
4. Cannot distinguish between "rent due next month" (expense) and "CC bill due next month" (repayment)
5. Has no "Paid Externally" option for forecasts
6. Does not detect inter-account transfers (IMPS/P2A to own accounts)

This causes **incorrect savings balances**, **double-counting risk**, and a confusing user experience where CC payments silently vanish without affecting the source account.

---

## Decisions (Locked)

| Decision | Answer |
|----------|--------|
| Loan EMI treatment | Expense forecast (NOT repayment) — only CC gets repayment treatment |
| "Paid externally" CC effect | CC due still decreases + available limit increases. No transfer created, no savings debit. |
| Partial CC payment | Not supported — all or nothing |
| Wallet top-ups | Acknowledged as transfers. Same `account_transfers` table supports it. Not in V7 scope. |
| "Realise Now" for repayments | Not shown. Repayment forecasts show: Mark as Paid (with account picker), Paid Externally, Delete |
| Replace `account_credits` for CC | Yes. CC bill payments become `account_transfers`. Existing CC payment credits migrated. |
| IMPS/P2A transfers | In scope. Auto-detect when same amount hits two known accounts within ±1 day. |

---

## Scope

### In Scope
1. `forecast_type` column on expenses (`'expense'` | `'repayment'`)
2. `account_transfers` table for inter-account movements
3. `paid_from_account_id` column on expenses
4. Refactored `markForecastAsPaid` — split by forecast_type
5. New "Paid Externally" action on both forecast types
6. Account picker modal for repayment source selection
7. CC available limit update on payment (`last_known_balance` increase)
8. Balance calculation update: include Transfers_Out and Transfers_In
9. SMS parser: new patterns for ICICI CC payment (Bharat Bill Pay), Airtel postpaid due, Axis loan EMI debit from savings
10. SMS parser: auto-detect source savings account from paired debit SMS
11. SMS parser: avoid creating expenses for `payment_received` type (already handled — verify)
12. IMPS/P2A auto-detection as transfers when matching deposit found on another owned account
13. UI: "Mark as Transfer" action on any realized savings expense (for manual reclassification)
14. Visual distinction: `DUE` badge vs `REPAYMENT` badge
15. Budget/spending totals: exclude transfers
16. Notification wording: different for expense vs repayment forecasts
17. Data migration: backfill `forecast_type`, migrate CC payment credits to transfers

### Out of Scope (Follow-up)
- Wallet top-ups as transfers
- Loan EMI principal/interest split
- Multi-currency transfers
- Scheduled/recurring transfer templates

---

## Phases

### Phase 1: Schema & Migration
- Migration 035: `forecast_type`, `paid_from_account_id` on expenses
- Migration 036: `account_transfers` table
- Migration 037: Backfill `forecast_type` + migrate CC payment credits to transfers

### Phase 2: Service Layer — Transfer Service
- New `services/account-transfer.ts`
- `createTransfer()`, `getTransfersForMonth()`, `getTransfersByAccount()`, `deleteTransfer()`
- `autoDetectTransfer()` — match paired debits/credits across accounts

### Phase 3: Service Layer — Forecast & Balance Updates
- Split `markForecastAsPaid` by `forecast_type`
- New `markRepaymentAsPaid(forecastId, fromAccountId)`
- New `markForecastPaidExternally(forecastId)`
- Refactor `reduceCcDuesOnPayment` → `applyCcPayment(accountId, amount)` (also increases available limit)
- Update `getClosingBalance` to include transfers
- Update `getAccountCreditsTotal` or add `getTransfersTotal`

### Phase 4: SMS Parser Updates
- New patterns: ICICI CC payment via BBPS, Airtel postpaid due, Axis loan debit from savings
- Auto-detect source account for CC payments (paired SMS matching)
- Set `forecast_type` on forecast creation in `sms-to-expense.ts`
- IMPS/P2A transfer detection logic

### Phase 5: UI — ForecastActionBar & Account Picker
- Modify `ForecastActionBar` to show different buttons by `forecast_type`
- New `AccountPickerSheet` component (bottom sheet with savings/wallet accounts)
- Update `use-forecast-actions.ts` hook with new handlers
- Update expense detail screen `[id].tsx`

### Phase 6: UI — Badges, Review Queue, Home Screen
- Distinct badges: `DUE` (orange) vs `REPAYMENT` (blue/purple)
- "Mark as Transfer" action on realized savings expenses
- Transfer section in monthly summary
- Exclude transfers from budget totals

### Phase 7: Notifications & Polish
- Different notification wording for expense vs repayment forecasts
- Update `notification-scheduler.ts`
- Update TABLE_SCHEMAS.ts
- Tests for all new services and migrations

---

## SMS Pattern Additions

### New patterns from Bank SMS Example.txt

| SMS Pattern | Type | Parser Action |
|------------|------|---------------|
| `Payment of Rs 38,304.98 has been received on your ICICI Bank Credit Card XX3001 through Bharat Bill Payment System on 19-DEC-25.` | `payment_received` | Transfer (not expense). Match to savings debit. Update CC dues + available limit. |
| `AIRTEL POSTPAID bill of Rs 824.82 for 9874059999 is due on 31-12-2025.` | Expense forecast | `forecast_type = 'expense'`. Utility bill. |
| `Debit INR 22717.00, Axis Bank A/c XX2836, PPR000810877249_EMI_11-09-` | Expense (savings debit for loan EMI) | Regular realized expense on savings. |
| `Debit INR 400.00, Axis Bank A/c XX2836, Loan Repayment - PPR0xxxxx` | Expense (manual loan prepayment) | Regular realized expense on savings. |
| `Reversal of Rs 10.02 credited to ICICI Bank Credit Card XX3001 on 26-DEC-25.` | Reversal/refund | Credit to CC account (like refund). |
| `Debit INR 5000.00, Axis Bank A/c XX2836, IMPS/P2A/608731207632/Sour` | Potential transfer | Check if destination is own account. If yes → transfer. If no → expense. |

### Existing patterns that need `forecast_type` assignment

| Pattern Name | Current `isForecast` | `forecast_type` |
|-------------|---------------------|-----------------|
| ICICI SI Reminder | true | `'expense'` (merchant charging CC) |
| HDFC Amount Due | true | `'repayment'` (CC bill payment) |
| Axis EMI Reminder | true | `'expense'` (loan EMI — per decision) |
| ICICI CC Total Due | true | `'repayment'` |
| Citi CC Due | true | `'repayment'` |
| Amex Payment Due | true | `'repayment'` |
| RBL CC Due | true | `'repayment'` |
| Kotak CC Payment Reminder | true | `'repayment'` |
| SBI CC Statement | true | `'repayment'` |
| Axis CC Outstanding | true | `'repayment'` |
| IDFC First CC Due | true | `'repayment'` |

**Rule:** `forecast_type = 'repayment'` when `type === 'amount_due_reminder'` and the SMS is about paying the CC bill (not a merchant charging the CC).

---

## User Journey — Complete Flow

### Scenario A: CC Bill Payment (Happy Path)

1. **SMS:** "Amount Due Rs.937 on HDFC Bank Credit Card 8957. Pay by 21/APR/2026"
2. **Parser:** Creates forecast expense: `forecast_type='repayment'`, `account_id=HDFC CC 8957`, `due_date=2026-04-21`
3. **Home screen:** Shows in "Upcoming Dues" with blue REPAYMENT badge
4. **Notification (April 19):** "CC bill Rs 937 due in 2 days — HDFC Card 8957"
5. **User taps "Mark as Paid":**
   - Account picker opens, showing savings accounts
   - User selects "Axis Bank XX2836"
   - System creates `account_transfers` entry: Axis 2836 → HDFC 8957, Rs 937
   - Axis savings balance decreases by Rs 937
   - HDFC CC `total_due` decreases by Rs 937, `last_known_balance` increases by Rs 937
   - Forecast rejected (disappears from upcoming)
6. **Later:** SMS arrives: "PAYMENT OF Rs. 937.05 RECEIVED TOWARDS YOUR CREDIT CARD ENDING WITH 8957"
   - Parser detects `payment_received` → no expense created
   - Updates CC available limit from SMS (if provided)
   - Matches to existing transfer (idempotent — no duplicate)

### Scenario B: CC Bill — Paid Externally

1. Same forecast as Scenario A
2. **User taps "Paid Externally":**
   - No account picker
   - CC `total_due` decreases by Rs 937, `last_known_balance` increases by Rs 937
   - Forecast rejected
   - No transfer created, no savings debit
   - Rationale: payment happened outside the app's tracked accounts

### Scenario C: Expense Forecast (Rent, Subscription)

1. **SMS:** "Payment of INR 199.00 towards Merchant NETFLIX to be debited from ICICI Bank Credit Card 3001, is due by 09/04/2026"
2. **Parser:** Creates forecast expense: `forecast_type='expense'`, linked to ICICI CC 3001
3. **User can:** Mark as Paid (current matching flow), Realise Now (converts to expense), Paid Externally (dismiss), Delete

### Scenario D: IMPS/P2A Self-Transfer

1. **SMS 1:** "Debit INR 5000.00, Axis Bank A/c XX2836, IMPS/P2A/608731207632/Sour"
2. **SMS 2 (within 1 day):** "INR 5000.00 credited to A/c no. XX0006..." (SBI account)
3. **Parser detects:** Same amount (5000), within ±1 day, both accounts belong to user
4. **Result:** Creates `account_transfers` entry: Axis 2836 → SBI 0006, Rs 5000. No expense.
5. **If no matching credit found:** Created as regular expense. User can later tap "Mark as Transfer" to reclassify.

### Scenario E: IMPS/P2A Payment to Someone Else

1. **SMS:** "INR 200.00 debited, A/c XX2836, UPI/P2A/Vasamsetti Suresh"
2. **Parser:** No matching credit on any owned account
3. **Result:** Regular expense (current behavior, unchanged)
