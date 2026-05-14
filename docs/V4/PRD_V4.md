# Artha (अर्थ) — Version 4 Product Requirements Document

**Version:** 4.0 (Draft)
**Author:** Sourav Baid
**Date:** 2026-04-13
**Status:** Ready to implement
**Predecessor:** V3 PRD at `docs/V3/PRD_V3.md`

---

## 1. Executive Summary

Version 4 transforms Artha from a *detection* app into a *data-quality* app. The focus is on three pillars:

1. **Master Data Management** — SMS-detected merchant names and account/payment mode combinations are auto-populated into editable master data. Users correct once, system applies everywhere.
2. **Insights Flexibility** — Week-on-week and fully custom date range comparisons give users the power to analyze spending at any granularity.
3. **Transaction Precision** — Timestamps captured from SMS for audit-quality records, displayed on detail pages only.

### Key Data Model Insight

- **Account** = *where* money comes from (HDFC Savings xx1234, ICICI Credit Card xx3001)
- **Payment Mode** = *how* the payment was made (Credit Card, Debit Card, UPI, Net Banking, Wallet)
- **Relationship:** One account → many payment modes. A single HDFC Savings account can be used via debit card, UPI, and net banking. This is a one-to-many relationship formalized in V4.

### Auto-Detection Philosophy

The SMS text itself tells us the payment mode. No guessing, no default flags:
- "ICICI Bank **Card** XX3001" + "**Avl Limit**" → Credit Card
- "A/c no. XX2836 ... **UPI/P2M/**..." → UPI
- "ICICI Bank **Acc** XX322 debited" (no UPI marker) → Net Banking
- "**Wallet** debit" → Wallet
- EMI / Standing Instruction → Auto Debit

The `account_payment_modes` link table is auto-populated as the parser encounters new account-mode combinations. Users view and correct via Settings > Data Management.

### Version Metrics

| Metric | V3 (Baseline) | V4 (Projected) |
|--------|--------------|----------------|
| Tests | 982 | ~1,090 |
| Migrations | 22 | 25 |
| Services | ~39 | ~43 |
| Screens | 45+ | ~51 |
| Version | 2.0.0 | 4.0.0 |

---

## 2. Phase 1: Master Data Management (F1 + F2 + F3 + F4)

### F1: SMS Parser — Payment Mode Detection

**Problem:** The SMS parser currently extracts account (card last 4 digits, bank name, account type) but `payment_mode_id` is **always NULL** on auto-detected expenses. Users must manually set payment mode during review — tedious and often skipped, making insights by payment mode inaccurate.

**Root cause:** The `ParsedSMS` interface has no field for payment mode. The information IS in the SMS text but is never extracted.

**Solution:** Add a `paymentMode` field to `ParsedSMS` and enhance bank patterns to infer it from SMS context.

**Detection rules (derived from real Indian bank SMS samples):**

| SMS Signal | Inferred Payment Mode |
|---|---|
| "Card" keyword + credit limit / available credit limit present | **Credit Card** |
| "Card" keyword + available balance (not credit limit) | **Debit Card** |
| "Card" keyword + "CC" in BLOCK message (HDFC pattern) | **Credit Card** |
| "UPI/P2M/" or "UPI/P2A/" marker present | **UPI** |
| Account debit ("A/c no." / "Acc") without UPI marker | **Net Banking** |
| Standing Instruction / NACH keyword | **Auto Debit** |
| Wallet keyword (Paytm, PhonePe wallet) | **Wallet** |
| EMI from loan account | **Auto Debit** |

**Real SMS examples and their detection:**

```
"INR 492.50 spent using ICICI Bank Card XX3001 ... Avl Limit: INR 1,55,855.32"
→ Account: ICICI/3001/credit_card | Mode: Credit Card
  (Signal: "Card" + "Avl Limit")

"INR 1236.00 debited A/c no. XX2836 11-04-26, 15:39:39 UPI/P2M/565346001016/Blue Tokai Coffee R"
→ Account: Axis/2836/savings | Mode: UPI
  (Signal: "UPI/P2M/")

"Spent INR 1087 Axis Bank Card no. XX2445 ... Avl Limit: INR 231506.85"
→ Account: Axis/2445/credit_card | Mode: Credit Card
  (Signal: "Card" + "Avl Limit")

"Spent Rs.1646.5 On HDFC Bank Card 8957 ... SMS BLOCK CC 8957"
→ Account: HDFC/8957/credit_card | Mode: Credit Card
  (Signal: "Card" + "CC" in block message)

"ICICI Bank Acc XX322 debited Rs. 5,696.00"
→ Account: ICICI/322/savings | Mode: Net Banking
  (Signal: "Acc debited" with no UPI marker)

"INR 120.00 debited A/c no. XX2836 ... UPI/P2A/747576280976/BABAJAN"
→ Account: Axis/2836/savings | Mode: UPI
  (Signal: "UPI/P2A/")

"EMI of INR 22317.00 for Axis Bank Loan A/c XX7249"
→ Account: Axis/7249/loan | Mode: Auto Debit
  (Signal: "EMI" + "Loan A/c")
```

**Impact on existing flow:**
- `sms-to-expense.ts` → now sets `payment_mode_id` using the detected mode + user's payment_modes table
- Auto-populates `account_payment_modes` link when a new account-mode combo is seen
- Existing expenses with NULL payment_mode_id are unaffected (no backfill — only new detections)

---

### F2: Master Data — Merchant Name Mappings

**Problem:** SMS extracts raw merchant strings that are truncated, inconsistent, or unreadable:
- "ZOMATO LIMITED", "ZOMATO LTD", "ZOMATO" — all the same merchant, split in insights
- "AMAZON PAY IN R", "AMAZON PAY IN E", "AMAZON PAY WALL" — unclear what these are
- "PYU*Jubilant Fo" — truncated and prefixed
- "BLINK COMMERCE" — brand name that means nothing to the user (it's Blinkit)

**Current state:** `merchant_aliases` table (migration 020) already maps `sms_name → canonical_name`. Auto-learns when user edits merchant name on expense. BUT:
- No UI to view/manage all aliases
- No way to bulk-correct (e.g., map 5 Amazon variants to "Amazon")
- No way to see what raw patterns have been detected

**Solution:** Master data screen in Settings > Data Management > Merchant Names:
- List all `merchant_aliases` entries: raw SMS name (left) → display name (right)
- Search/filter by raw name or display name
- Edit any display name inline
- Bulk select multiple raw patterns → map to same display name
- Auto-populated when SMS detects new merchant patterns
- System applies canonical_name everywhere (expense list, insights, detail pages)

**Schema:** Uses existing `merchant_aliases` table — no new migration needed. Just a management UI.

---

### F3: Master Data — Account-Payment Mode Linking

**Problem:** Accounts and payment modes are independent. There's no record of "HDFC Savings xx1234 is used via Debit Card, UPI, and Net Banking." Without this:
- System can't validate that a payment mode makes sense for an account
- Insights show raw, unlinked data
- No master data view of accounts with their modes

**Key concept — Account vs Payment Mode (one-to-many):**

| Account | Linked Payment Modes |
|---|---|
| HDFC Savings xx1234 | Debit Card, UPI, Net Banking |
| ICICI Credit Card xx3001 | Credit Card |
| Axis Savings xx2836 | Debit Card, UPI, Net Banking |
| Axis Credit Card xx2445 | Credit Card |
| HDFC Credit Card xx8957 | Credit Card |
| HDFC Credit Card xx9628 | Credit Card |
| Axis Loan xx7249 | Auto Debit |
| Paytm Wallet | Wallet |
| Cash (no account) | Cash |

**Solution:**
- New `account_payment_modes` junction table
- Auto-populated by SMS parser: when a new account-mode combination is detected, a row is inserted
- User can view/edit in Settings > Data Management > Accounts
- Each account card shows: bank logo/name, account identifier, account type, linked modes as chips
- Tap to edit: add/remove payment modes from the linked list

**Auto-population flow:**
1. SMS parser detects account (HDFC/1234/savings) + mode (UPI)
2. Check `account_payment_modes`: does this combo exist?
3. If no → INSERT new link row
4. Result: over time, the link table builds itself from real SMS data

**No `is_default` flag.** The SMS itself tells us which mode was used for each transaction. No need to guess — just detect from the text.

---

### F4: Account & Mode Editing on Expenses

**Problem:** Once an expense is created (manual or auto-detected), there's limited ability to change the account. If auto-detection picks the wrong account, or the user wants to set it on a manual expense, they're stuck.

**Solution:**
- **Expense Add** (`app/expense/add.tsx`): Add account picker dropdown showing all active `financial_accounts`. When an account is selected, auto-suggest payment mode from the `account_payment_modes` link table. If only one linked mode → auto-set it. If multiple → show dropdown filtered to linked modes.
- **Expense Detail/Edit** (`app/expense/[id].tsx`): Add account picker in edit mode. When account is changed, suggest updating payment mode based on linked modes.
- **Auto-detected expenses:** SMS parser now sets both account_id AND payment_mode_id automatically. User can still correct in review queue.

**Dependency:** F1 (parser detection) and F3 (link table) should be done first.

---

## 3. Phase 2: Insights Enhancements (F5 + F6)

### F5: Week-on-Week Comparison

**Problem:** Current insights show 3-month category trends and single-month distributions. No short-term comparison. Users can't answer "did I spend more this week than last week?"

**Solution:** New insights view — "Weekly Comparison":
- Default: current week (Mon-Sun) vs previous week
- Side-by-side metrics:
  - Total spend (with % change)
  - Category breakdown (table with delta)
  - Top 5 merchants per week
  - Payment mode split
  - Average daily spend
- Delta indicators: green down-arrow (spent less), red up-arrow (spent more)
- Tap any category row → drill-down showing expenses from both weeks

**UI:** Two-column card layout or horizontally scrollable comparison cards.

---

### F6: Custom Date Range Comparison

**Problem:** Insights are locked to fixed windows. Users can't compare "December holiday spending vs regular October" or "Q1 this year vs Q1 last year."

**Solution:** New insights view — "Compare Periods":
- Two date range pickers (reuses V3 `DateInput` component)
- Presets for common comparisons:
  - This month vs last month
  - This quarter vs last quarter
  - Same month year-over-year
  - Custom (fully open-ended)
- Comparison metrics:
  - Total spend per range
  - Category-wise breakdown (table + optional chart)
  - Top merchants per range
  - Payment mode distribution
  - Average daily spend
  - Highest single expense per range
- Percentage delta for every metric
- Export comparison as PDF/text (reuses V3 export infrastructure)

**New screen:** `app/insights/compare.tsx`

---

## 4. Phase 3: Transaction Timestamps (F7)

### F7: Transaction Timestamps

**Problem:** Expenses store only a date (`date` field, YYYY-MM-DD). For SMS transactions, the actual time is in the SMS but gets discarded. Multiple transactions on the same day have no ordering beyond insertion sequence.

**Real SMS timestamp examples:**
```
"11-04-26, 15:39:39" → 15:39:39 (Axis Bank UPI)
"09-09-25 02:31:10 IST" → 02:31:10 (Axis Bank CC)
"2026-04-07:19:25:50" → 19:25:50 (HDFC Bank CC)
"22-06-25 20:14:43" → 20:14:43 (Axis Bank CC v2)
"2026-03-30:14:53:13" → 14:53:13 (HDFC Bank CC)
```

**Solution:**
- **New column:** `transaction_time TEXT NOT NULL DEFAULT '00:00:00'` on expenses table
- **Auto-detected (SMS):** Parser already handles date formats with time components (see `bank-patterns.ts` date parsers). Enhance to also extract and return the time portion.
- **Manual entry:** Defaults to `00:00:00` (start of day). Do NOT add time input to manual expense forms — that's cumbersome and unnecessary.
- **Display:** Show time on expense **detail page only** (`app/expense/[id].tsx`). Format: "2:45 PM" or "14:45" based on locale. NOT shown on list pages or budget views.
- **Editing:** When editing an expense, the **date is editable** but the **timestamp is read-only**. This preserves the original transaction time — an audit integrity decision.
- **Existing data:** Migration defaults all existing expenses to `00:00:00` (original time not recoverable).

---

## 5. Phase 4: Testing, Documentation & Build (F8)

- Cross-feature integration tests (~20 new tests)
- Update V4 documentation (PRD, TDD complete, MASTER_PLAN final)
- Version bump to 4.0.0
- APK build

---

## 6. Updated Data Model

### Migration 023: `account_payment_modes` (Phase 1)

```sql
CREATE TABLE IF NOT EXISTS account_payment_modes (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  payment_mode_id TEXT NOT NULL REFERENCES payment_modes(id),
  first_seen_date TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, payment_mode_id)
);
```

**Purpose:** Junction table formalizing the one-to-many relationship between accounts and payment modes. Auto-populated by SMS parser, viewable/editable by user.

`first_seen_date` tracks when this combination was first detected — useful for showing "this account has been used with UPI since March 2026."

### Migration 024: `transaction_time` on expenses (Phase 3)

```sql
ALTER TABLE expenses ADD COLUMN transaction_time TEXT NOT NULL DEFAULT '00:00:00';
```

**Purpose:** Time component for expenses. Set from SMS for auto-detected, 00:00:00 for manual.

### No migration needed for merchant names

Merchant display name mapping already exists via `merchant_aliases` table (migration 020). V4 adds a management UI, not a new table.

---

## 7. Screens Summary

### New Screens (V4)

| Screen | Route | Phase | Purpose |
|--------|-------|-------|---------|
| Merchant Master Data | `app/settings/merchant-master.tsx` | 1 | View/edit merchant name mappings |
| Account Master Data | `app/settings/account-master.tsx` | 1 | View accounts + linked payment modes |
| Weekly Comparison | `app/insights/weekly.tsx` | 2 | Week-on-week spending comparison |
| Period Comparison | `app/insights/compare.tsx` | 2 | Custom date range comparison |

### Modified Screens (V4)

| Screen | Route | Change |
|--------|-------|--------|
| Settings | `app/(tabs)/settings.tsx` | Data Management section with merchant + account master entries |
| Expense Add | `app/expense/add.tsx` | Account picker + payment mode auto-suggest |
| Expense Detail | `app/expense/[id].tsx` | Account picker in edit mode, timestamp display, read-only time |
| Insights Hub | `app/insights/index.tsx` | New cards for Weekly and Period Comparison |

---

## 8. Tech Stack

No new dependencies needed. V4 uses existing infrastructure:
- `merchant_aliases` table (migration 020) — already exists
- `financial_accounts` table (migration 011) — already exists
- `payment_modes` table (migration 001) — already exists
- `DateInput` component (V3) — reused for comparison date pickers
- Export infrastructure (V3) — reused for comparison export
- `spending-insights.ts` service (606 lines) — extended with comparison functions

---

## 9. Testing Summary

| Phase | New Tests | Running Total |
|-------|-----------|---------------|
| V3 Baseline | — | 982 |
| Phase 1 | ~45 | ~1,027 |
| Phase 2 | ~30 | ~1,057 |
| Phase 3 | ~15 | ~1,072 |
| Phase 4 | ~20 | ~1,092 |
| **V4 Total** | **~110** | **~1,092** |

---

## 10. Version History

| Version | Date | Change |
|---------|------|--------|
| 4.0 | 2026-04-13 | Initial V4 PRD — 8 features, 4 phases, SMS-parser-driven auto-detection |
