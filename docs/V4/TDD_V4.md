# Artha (अर्थ) — Version 4 Technical Design Document

**Version:** 4.0 (Draft)
**Date:** 2026-04-13
**Status:** Ready to implement
**Predecessor:** V3 TDD at `docs/V3/TDD_V3.md`

---

## 1. Overview

V4 adds 2 new migrations, 2 new services, 4 new screens, and significant enhancements to the SMS parser pipeline. Architecture remains 100% local (SQLite + MMKV, no cloud).

**Schema version after V4:** 24 migrations (14 MVP + 3 V1 + 4 V2 + 1 V3 + 2 V4)
**Tables:** 24 (22 existing + `account_payment_modes` + expenses `transaction_time` column)
**New services:** 2 (`account-master.ts`, `comparison-insights.ts`)
**Modified services:** 4 (`bank-patterns.ts`, `sms-to-expense.ts`, `financial-account.ts`, `spending-insights.ts`)
**New screens:** 4
**Modified screens:** 4

---

## 2. Schema Changes

### 2.1 Migration 023: `account_payment_modes`

**Purpose:** Junction table formalizing the one-to-many relationship between financial accounts and payment modes. A single savings account (e.g., HDFC xx1234) can be used via debit card, UPI, and net banking — each combination gets a row.

**File:** `database/migrations/023_account_payment_modes.ts`

```sql
CREATE TABLE IF NOT EXISTS account_payment_modes (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  payment_mode_id TEXT NOT NULL REFERENCES payment_modes(id),
  first_seen_date TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_apm_unique
  ON account_payment_modes(account_id, payment_mode_id);

CREATE INDEX IF NOT EXISTS idx_apm_account
  ON account_payment_modes(account_id);
```

**Impact:**
- Auto-populated by SMS parser when new account-mode combos are detected
- Consumed by expense add/edit for payment mode suggestions
- Consumed by account master data screen for display
- No foreign key ON DELETE CASCADE — if account deleted, links remain (soft-delete pattern)

### 2.2 Migration 024: `transaction_time` on expenses

**Purpose:** Add time-of-day precision to expenses. SMS transactions have timestamps; manual entries default to 00:00:00.

**File:** `database/migrations/024_transaction_time.ts`

```sql
ALTER TABLE expenses ADD COLUMN transaction_time TEXT NOT NULL DEFAULT '00:00:00';
```

**Impact:**
- All existing expenses get `00:00:00` (original time not recoverable)
- New SMS-detected expenses get actual time from SMS text
- Manual expenses get `00:00:00` (no time input in UI)
- Displayed only on expense detail page, read-only on edit

---

## 3. ParsedSMS Interface Changes

### 3.1 New Field: `paymentMode`

**File:** `services/sms/bank-patterns.ts`

```typescript
export interface ParsedSMS {
  // ... existing fields unchanged ...

  /** Payment mode inferred from SMS context */
  paymentMode?: "credit_card" | "debit_card" | "upi" | "net_banking" | "wallet" | "auto_debit" | null;

  /** Transaction time extracted from SMS (HH:MM:SS format) */
  transactionTime?: string | null;
}
```

**Payment mode values map to `payment_modes.type`:**

| ParsedSMS.paymentMode | payment_modes.type |
|---|---|
| `"credit_card"` | `"credit_card"` |
| `"debit_card"` | `"debit_card"` |
| `"upi"` | `"upi"` |
| `"net_banking"` | `"bank_transfer"` |
| `"wallet"` | `"wallet"` |
| `"auto_debit"` | `"bank_transfer"` |
| `null` | NULL (user classifies) |

### 3.2 Payment Mode Inference Logic

**New function:** `inferPaymentMode(parsed: ParsedSMS, smsBody: string): PaymentMode | null`

**Location:** `services/sms/bank-patterns.ts` (added after existing `inferAccountTypeFromKeywords`)

**Decision tree:**

```
1. If parsed.upiSubtype is "p2m" or "p2a" → return "upi"
2. If parsed.type is "standing_instruction" or "nach_debit" or "emi" → return "auto_debit"
3. If parsed.accountType is "wallet" → return "wallet"
4. If parsed.accountType is "credit_card" → return "credit_card"
5. If SMS body contains "Card" keyword:
   a. If creditLimit or availableCreditLimit present → return "credit_card"
   b. If availableBalance present (not credit) → return "debit_card"
   c. If "CC" in BLOCK message → return "credit_card"
   d. Default for "Card" with no other signal → return "credit_card"
      (most Indian bank card SMS with limits = CC; debit cards rarely send limit SMS)
6. If parsed.accountType is "savings" (A/c debit, no UPI, no Card) → return "net_banking"
7. If parsed.accountType is "loan" → return "auto_debit"
8. Return null (unknown — user classifies in review)
```

**Per-bank pattern enhancements:**

| Bank | Pattern | Signal | Inferred Mode |
|---|---|---|---|
| ICICI | `spent using ICICI Bank Card XX3001 ... Avl Limit` | Card + Avl Limit | Credit Card |
| ICICI | `ICICI Bank Acc XX322 debited` | Acc + no UPI | Net Banking |
| Axis | `A/c no. XX2836 ... UPI/P2M/` | A/c + UPI/P2M | UPI |
| Axis | `Axis Bank Card no. XX2445 ... Avl Limit` | Card + Avl Limit | Credit Card |
| HDFC | `HDFC Bank Card 8957 ... BLOCK CC 8957` | Card + CC | Credit Card |
| HDFC | `HDFC Bank Card 9628 ... BLOCK CC 9628` | Card + CC | Credit Card |
| Axis | `EMI ... Axis Bank Loan A/c XX7249` | EMI + Loan | Auto Debit |
| ICICI | `Standing Instruction ... ICICI Bank Credit Card 3001` | SI + CC | Auto Debit |

### 3.3 Transaction Time Extraction

**Enhancement to existing date parsers** in `bank-patterns.ts` (lines 96-169):

Current parsers extract date only (return YYYY-MM-DD). Enhanced to also capture time when present.

**New helper:** `parseDateAndTime(dateStr: string): { date: string; time: string | null }`

**Formats with time data:**

| Format | Example | Time Extracted |
|---|---|---|
| `DD-MM-YY, HH:MM:SS` | `11-04-26, 15:39:39` | `15:39:39` |
| `DD-MM-YY HH:MM:SS IST` | `09-09-25 02:31:10 IST` | `02:31:10` |
| `YYYY-MM-DD:HH:MM:SS` | `2026-04-07:19:25:50` | `19:25:50` |
| `DD-MM-YY HH:MM:SS` | `22-06-25 20:14:43` | `20:14:43` |
| `DD-MMM-YY` (no time) | `11-Apr-26` | `null` |
| `DD/MM/YYYY` (no time) | `11/04/2026` | `null` |

When time is `null`, `sms-to-expense.ts` defaults to `00:00:00`.

---

## 4. New Services

### 4.1 services/account-master.ts (~180 lines)

CRUD service for the account-payment mode link table + account display management.

**Key exports:**

| Function | Signature | Purpose |
|---|---|---|
| `getAccountWithModes(accountId)` | `(accountId: string) → Promise<AccountWithModes>` | Get account + all linked payment modes |
| `getAllAccountsWithModes(userId)` | `(userId: string) → Promise<AccountWithModes[]>` | All accounts with their modes for master data screen |
| `addPaymentModeToAccount(accountId, paymentModeId)` | `(accountId: string, modeId: string) → Promise<void>` | Manually link a mode to an account |
| `removePaymentModeFromAccount(accountId, paymentModeId)` | `(accountId: string, modeId: string) → Promise<void>` | Unlink a mode from an account |
| `autoPopulateAccountMode(accountId, paymentModeId)` | `(accountId: string, modeId: string) → Promise<void>` | Called by SMS parser — inserts if not exists (idempotent) |
| `getLinkedModesForAccount(accountId)` | `(accountId: string) → Promise<PaymentMode[]>` | Get modes linked to an account (for expense picker dropdown) |
| `updateAccountLabel(accountId, label)` | `(accountId: string, label: string) → Promise<void>` | User-friendly name for account display |

**Types:**

```typescript
interface AccountWithModes {
  account: FinancialAccount;
  linkedModes: PaymentMode[];
}
```

### 4.2 services/comparison-insights.ts (~250 lines)

Date range comparison analytics service.

**Key exports:**

| Function | Signature | Purpose |
|---|---|---|
| `getWeeklyComparison(userId, week1Start, week1End, week2Start, week2End)` | `→ Promise<ComparisonResult>` | WoW comparison |
| `getDateRangeComparison(userId, range1Start, range1End, range2Start, range2End)` | `→ Promise<ComparisonResult>` | Custom date range comparison |
| `getComparisonPresets()` | `→ ComparisonPreset[]` | Returns presets (this month vs last, this Q vs last Q, YoY) |

**Types:**

```typescript
interface ComparisonResult {
  range1: RangeSummary;
  range2: RangeSummary;
  deltas: DeltaSummary;
}

interface RangeSummary {
  startDate: string;
  endDate: string;
  totalSpend: number;
  avgDailySpend: number;
  highestExpense: { amount: number; description: string; date: string };
  categoryBreakdown: CategoryTotal[];
  topMerchants: MerchantTotal[];
  paymentModeDistribution: ModeTotal[];
  transactionCount: number;
}

interface DeltaSummary {
  totalSpendDelta: number;      // percentage change
  avgDailySpendDelta: number;
  transactionCountDelta: number;
  categoryDeltas: { categoryId: string; delta: number }[];
}

interface ComparisonPreset {
  label: string;
  range1: { start: string; end: string };
  range2: { start: string; end: string };
}
```

**Query approach:** Both functions query the same underlying data — expenses grouped by category, merchant, payment mode within each date range. Uses two parameterized queries (one per range) and computes deltas in JS.

---

## 5. Modified Services

### 5.1 services/sms/bank-patterns.ts

**Changes:**
1. Add `paymentMode` and `transactionTime` fields to `ParsedSMS` interface
2. Add `inferPaymentMode(parsed, smsBody)` function
3. Add `parseDateAndTime(dateStr)` helper — returns `{ date, time }` instead of just date
4. Update existing bank patterns to call `parseDateAndTime` where time data is available
5. Set `paymentMode` in each pattern's `parse()` function using pattern-specific signals

**Lines changed:** ~120 additions across the file

### 5.2 services/sms/sms-to-expense.ts

**Changes:**
1. After `discoverOrUpdateAccount()`, resolve `payment_mode_id`:
   - Look up user's `payment_modes` table for a mode matching `parsed.paymentMode`
   - If found → set `payment_mode_id` on the expense
   - Call `autoPopulateAccountMode(accountId, paymentModeId)` to populate link table
2. Set `transaction_time` on expense INSERT from `parsed.transactionTime ?? '00:00:00'`
3. Modify all INSERT statements to include `transaction_time` and `payment_mode_id`

**Lines changed:** ~40 additions

### 5.3 services/financial-account.ts

**Changes:**
1. After account discovery/creation, call `autoPopulateAccountMode()` with the detected payment mode
2. This auto-builds the link table over time from real SMS data

**Lines changed:** ~15 additions

### 5.4 services/spending-insights.ts

**Changes:**
1. Extend queries to use `merchant_aliases.canonical_name` for merchant grouping (use display names in insights, not raw names)
2. This makes insights merchant charts consistent with master data names

**Lines changed:** ~20 additions (JOIN on merchant_aliases)

### 5.5 services/merchant-alias.ts

**No structural changes.** The existing `normalizeMerchantName()` and `learnMerchantAlias()` functions already handle the mapping. V4 adds a UI to manage these, not new service logic.

---

## 6. New Components

### 6.1 No new reusable components needed

V4 screens use existing components:
- `Card`, `ScreenContainer`, `DateInput` from `components/ui/`
- `ExportFormatPicker` from `components/hisaab/` (for comparison export)
- Standard React Native `FlatList`, `TextInput`, `TouchableOpacity`

---

## 7. New Screens

### 7.1 app/settings/merchant-master.tsx (~280 lines) — Phase 1

Merchant name master data management screen.

**Data source:** `merchant_aliases` table via `getAllMerchantAliases(userId)` (existing service)

**UI layout:**
```
[Search bar — filter by raw or display name]

Section: "Merchant Name Mappings"

┌─────────────────────────────────────────┐
│ ZOMATO LIMITED → Zomato              [✏️] │
│ ZOMATO LTD → Zomato                 [✏️] │
│ AMAZON PAY IN R → Amazon Pay         [✏️] │
│ AMAZON PAY IN E → Amazon Pay         [✏️] │
│ AMAZON PAY WALL → Amazon Pay         [✏️] │
│ BLINK COMMERCE → Blinkit             [✏️] │
│ PYU*Jubilant Fo → Domino's           [✏️] │
│ STEAMGAMES → Steam                   [✏️] │
│ CAS*Swiggy → Swiggy                  [✏️] │
│ PYU*Swiggy Food → Swiggy            [✏️] │
│ NETFLIX → Netflix                     [✏️] │
│ TATA PAYMENTS LIMITED → (unmapped)   [✏️] │
└─────────────────────────────────────────┘

[Stats footer: "45 patterns, 28 unique merchants"]
```

**Edit flow:** Tap edit icon → inline TextInput replaces display name → type new name → auto-save on blur. Or tap to open bottom sheet with full edit (raw name read-only, display name editable).

### 7.2 app/settings/account-master.tsx (~320 lines) — Phase 1

Account master data management screen.

**Data source:** `getAllAccountsWithModes(userId)` from new `account-master.ts` service

**UI layout:**
```
Section: "Accounts & Payment Modes"

┌─────────────────────────────────────────┐
│ 🏦 ICICI Bank ****3001                  │
│    Type: Credit Card                     │
│    Label: "ICICI Amazon Pay CC"     [✏️] │
│    Modes: [Credit Card]                  │
│    Balance: ₹1,55,855 available          │
├─────────────────────────────────────────┤
│ 🏦 Axis Bank ****2836                   │
│    Type: Savings                         │
│    Label: "Axis Primary Savings"    [✏️] │
│    Modes: [UPI] [Debit Card] [Net Bkg]  │
│    Balance: ₹45,230                      │
├─────────────────────────────────────────┤
│ 🏦 HDFC Bank ****8957                   │
│    Type: Credit Card                     │
│    Label: "HDFC Millennia"          [✏️] │
│    Modes: [Credit Card]                  │
│    Limit: ₹1,62,000                     │
├─────────────────────────────────────────┤
│ 🏦 Axis Bank ****7249                   │
│    Type: Loan                            │
│    Label: "Car Loan EMI"            [✏️] │
│    Modes: [Auto Debit]                   │
│    EMI: ₹22,317 due 10th                │
└─────────────────────────────────────────┘
```

**Edit flow:** Tap account → expand card or navigate to detail. Edit label inline. Tap modes section → bottom sheet to add/remove payment modes from linked list.

### 7.3 app/insights/weekly.tsx (~300 lines) — Phase 2

Week-on-week comparison view.

**UI layout:**
```
[Week picker: ← Week 14 (Apr 1-7) vs Week 15 (Apr 8-14) →]

┌──────────────┬──────────────┐
│ Week 14      │ Week 15      │
│ ₹12,450      │ ₹8,920       │
│              │ ▼ 28.4%      │
├──────────────┼──────────────┤
│ Food: ₹4,200 │ Food: ₹3,100 │
│ Transport:₹2k│ Transport:₹1k│
│ Shopping:₹3k │ Shopping:₹2k │
├──────────────┼──────────────┤
│ Top: Swiggy  │ Top: Zomato  │
│ 2nd: Amazon  │ 2nd: Uber    │
├──────────────┼──────────────┤
│ UPI: 45%     │ UPI: 52%     │
│ CC: 40%      │ CC: 38%      │
│ Cash: 15%    │ Cash: 10%    │
└──────────────┴──────────────┘
```

### 7.4 app/insights/compare.tsx (~380 lines) — Phase 2

Custom date range comparison view.

**UI layout:**
```
[Preset chips: This vs Last Month | This vs Last Quarter | YoY | Custom]

Range 1: [DateInput: 2026-01-01] to [DateInput: 2026-03-31]
Range 2: [DateInput: 2025-01-01] to [DateInput: 2025-03-31]

[Compare]

┌─────────────────────────────────────────┐
│ Total Spend                             │
│ Q1 2026: ₹1,45,000 | Q1 2025: ₹1,12,000│
│ ▲ 29.5% increase                        │
├─────────────────────────────────────────┤
│ Category Breakdown (table)              │
│ Food:      ₹32,000 → ₹41,000  ▲28%    │
│ Transport: ₹18,000 → ₹22,000  ▲22%    │
│ Shopping:  ₹28,000 → ₹35,000  ▲25%    │
├─────────────────────────────────────────┤
│ Avg Daily Spend                         │
│ ₹1,244/day → ₹1,611/day  ▲29.5%       │
├─────────────────────────────────────────┤
│ [Export Comparison]                      │
└─────────────────────────────────────────┘
```

---

## 8. Modified Screens

### 8.1 app/(tabs)/settings.tsx

- Add "Data Management" section with two entries:
  - "Merchant Names" → navigates to `app/settings/merchant-master.tsx`
  - "Accounts & Payment Modes" → navigates to `app/settings/account-master.tsx`

### 8.2 app/expense/add.tsx

- Add account picker (dropdown of active `financial_accounts`)
- When account selected → query `getLinkedModesForAccount(accountId)`
  - If 1 mode → auto-set payment mode
  - If multiple → show filtered payment mode dropdown (only linked modes)
  - If 0 modes → show full payment mode list (no filtering)

### 8.3 app/expense/[id].tsx

- **Detail view:** Show transaction time next to date ("Apr 11, 2026 at 3:39 PM")
- **Edit mode:** Account picker added. Date field editable. Time field shown but read-only (greyed out).
- **Account change:** When account changes, suggest updating payment mode per link table.

### 8.4 app/insights/index.tsx

- Add two new cards to the insights hub:
  - "Weekly Comparison" → navigates to `app/insights/weekly.tsx`
  - "Compare Periods" → navigates to `app/insights/compare.tsx`

---

## 9. SMS Pipeline — Updated Flow

```
Raw SMS (Android)
    ↓
Bank Pattern Matching (48+ patterns)
    ↓ Extract: amount, merchant, cardLast4, date+TIME, type, paymentMode
    ↓
Enrichment
    ├─ Account type inference (existing)
    ├─ UPI subtype detection (existing)
    ├─ Payment mode inference (NEW — inferPaymentMode())
    └─ Transaction time extraction (NEW — parseDateAndTime())
    ↓
Store in pending_sms
    ↓
Merchant Normalization (existing — merchant_alias.ts)
    ↓
Category Auto-Assignment (existing — smart-categorizer.ts)
    ↓
Account Discovery/Update (existing — financial-account.ts)
    ↓
Payment Mode Resolution (NEW)
    ├─ Look up payment_modes by parsed.paymentMode type
    ├─ Set payment_mode_id on expense (was always NULL before)
    └─ Auto-populate account_payment_modes link table
    ↓
Create Expense
    ├─ account_id: from account discovery
    ├─ payment_mode_id: from mode resolution (NEW — was always NULL)
    ├─ transaction_time: from SMS (NEW — was not captured)
    └─ ... (rest unchanged)
    ↓
User Review Queue
    ├─ Account field editable (NEW)
    ├─ Payment mode auto-filled (NEW — user can still correct)
    └─ Time shown on detail (NEW)
```

---

## 10. Testing Strategy

### Phase 1 Tests (~45)

| Category | Tests | Focus |
|---|---|---|
| Payment mode inference | ~15 | Each detection rule: CC, debit, UPI, net banking, wallet, auto debit, null |
| Account-mode link auto-population | ~8 | Insert on new combo, skip on duplicate, query linked modes |
| Merchant master data | ~8 | List, search, edit, bulk mapping |
| Account master data | ~6 | List accounts with modes, add/remove mode links, edit label |
| Expense account picker | ~8 | Manual: select account → auto-suggest mode; Edit: change account |

### Phase 2 Tests (~30)

| Category | Tests | Focus |
|---|---|---|
| Weekly comparison service | ~10 | Correct date ranges, category deltas, empty weeks, single-expense weeks |
| Date range comparison service | ~10 | Arbitrary ranges, presets, YoY, delta calculations |
| Comparison UI | ~10 | Preset selection, custom date entry, export |

### Phase 3 Tests (~15)

| Category | Tests | Focus |
|---|---|---|
| Time extraction from SMS | ~8 | Each date format with time, formats without time, null handling |
| Transaction time on expenses | ~4 | Auto-detect gets time, manual gets 00:00:00, edit preserves time |
| Detail page display | ~3 | Time formatted correctly, read-only in edit mode |

### Phase 4 Tests (~20)

| Category | Tests | Focus |
|---|---|---|
| Integration | ~15 | Full flow: SMS → parse → detect mode → create expense → verify mode + time |
| Cross-feature | ~5 | Insights use display names, comparison with mode filtering |

---

## 11. Planned Technical Work by Phase

### Phase 1 Task List

| Task | Files | Est. Lines |
|---|---|---|
| V4-1.1: Migration 023 — `account_payment_modes` | `database/migrations/023_account_payment_modes.ts` | ~35 |
| V4-1.2: Add `paymentMode` + `transactionTime` to ParsedSMS | `services/sms/bank-patterns.ts` | ~30 |
| V4-1.3: Implement `inferPaymentMode()` | `services/sms/bank-patterns.ts` | ~60 |
| V4-1.4: Enhance bank patterns with payment mode signals | `services/sms/bank-patterns.ts` | ~80 |
| V4-1.5: Service — `account-master.ts` | `services/account-master.ts` | ~180 |
| V4-1.6: Update `sms-to-expense.ts` — set payment_mode_id + populate link table | `services/sms/sms-to-expense.ts` | ~40 |
| V4-1.7: Update `financial-account.ts` — auto-populate link table | `services/financial-account.ts` | ~15 |
| V4-1.8: Screen — Merchant Master Data | `app/settings/merchant-master.tsx` | ~280 |
| V4-1.9: Screen — Account Master Data | `app/settings/account-master.tsx` | ~320 |
| V4-1.10: Update Settings screen — Data Management section | `app/(tabs)/settings.tsx` | ~30 |
| V4-1.11: Add account picker to expense add/edit | `app/expense/add.tsx`, `app/expense/[id].tsx` | ~120 |
| V4-1.12: Update insights queries to use display names | `services/spending-insights.ts` | ~20 |
| V4-1.13: Phase 1 tests | `__tests__/` | ~45 tests |

### Phase 2 Task List

| Task | Files | Est. Lines |
|---|---|---|
| V4-2.1: Service — `comparison-insights.ts` | `services/comparison-insights.ts` | ~250 |
| V4-2.2: Screen — Weekly Comparison | `app/insights/weekly.tsx` | ~300 |
| V4-2.3: Screen — Period Comparison | `app/insights/compare.tsx` | ~380 |
| V4-2.4: Comparison presets | in `comparison-insights.ts` | ~60 |
| V4-2.5: Wire to Insights hub | `app/insights/index.tsx` | ~30 |
| V4-2.6: Phase 2 tests | `__tests__/` | ~30 tests |

### Phase 3 Task List

| Task | Files | Est. Lines |
|---|---|---|
| V4-3.1: Migration 024 — `transaction_time` on expenses | `database/migrations/024_transaction_time.ts` | ~15 |
| V4-3.2: Implement `parseDateAndTime()` helper | `services/sms/bank-patterns.ts` | ~50 |
| V4-3.3: Update date parsers to extract time | `services/sms/bank-patterns.ts` | ~30 |
| V4-3.4: Update `sms-to-expense.ts` — set transaction_time | `services/sms/sms-to-expense.ts` | ~10 |
| V4-3.5: Update expense detail — show timestamp | `app/expense/[id].tsx` | ~25 |
| V4-3.6: Ensure edit mode keeps time read-only | `app/expense/[id].tsx` | ~10 |
| V4-3.7: Phase 3 tests | `__tests__/` | ~15 tests |

### Phase 4 Task List

| Task | Files | Est. Lines |
|---|---|---|
| V4-4.1: Cross-feature integration tests | `__tests__/` | ~20 tests |
| V4-4.2: Final V4 documentation update | `docs/V4/` | — |
| V4-4.3: V4 APK build (version 4.0.0) | — | — |

---

## 12. Version History

| Version | Date | Change |
|---------|------|--------|
| 4.0 | 2026-04-13 | Initial V4 TDD — 2 migrations, 2 services, 4 screens, SMS parser payment mode detection |
