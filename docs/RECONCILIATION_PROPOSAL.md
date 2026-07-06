# Reconciliation Feature — Product Proposal

**Version:** 1.0 | **Date:** July 2026 | **Status:** Draft for review

---

## 1. Problem Statement

Every month, Arth's account ledger may drift from the actual bank/CC statement due to:

- Transactions missed by SMS parsing (SMS not received, spam filter, new sender)
- Cashback credits, bank charges, and interest never appearing in SMS
- Inter-account transfers that are in Arth as `account_transfers` but may be miscoded
- Split expenses where Arth records the user's share (₹0–X) but the statement shows the full charge
- Manual entries with the wrong date or wrong amount

Today, catching these requires downloading statements and comparing manually. The reconciliation feature brings this workflow inside Arth.

---

## 2. Goals & Non-Goals

**Goals:**
- Import a bank/CC statement (PDF, XLS, or XLSX) for a given account and period
- Auto-match statement entries against the Arth ledger (expenses + transfers)
- Surface unmatched entries clearly and let the user resolve each one
- Verify that the statement's closing balance matches Arth's computed balance
- Mark an account-period as "reconciled" so the user knows it was verified

**Non-Goals (v1):**
- Auto-fix anything without user approval
- Cloud sync or sharing of statements
- Fetch statements directly from the bank (screen-scraping / Open Banking API)
- Real-time / live reconciliation (this is a periodic review feature)
- CSV support (banks don't provide statements in CSV)

---

## 3. Core Concepts

Three technical truths must be encoded in the matching engine before any UI is built:

| Concept | Why it matters |
|---------|---------------|
| **Arth ledger = expenses + transfers** | CC bill payments, salary credits, and self-transfers live in `account_transfers`, not `expenses`. A bank statement always shows both. |
| **Split expenses use `split_original_amount`** | If ₹9,522 was split with a friend and the user's share is ₹0, `expenses.amount = 0` but the CC statement shows ₹9,522. Matching must use `split_original_amount`. |
| **Date tolerance: 3 days** | A credit card swipe date vs. posting date can differ by 1–2 days. NEFT may take 1 day. Use a ±3-day window for matching. |
| **Amount tolerance: ±₹1** | FX transactions and manual rounding mean Arth and the statement may differ by a few paise. Anything within ₹1 is a candidate match. |
| **Direction matters** | A ₹500 debit and a ₹500 credit on the same day are not the same transaction. Always filter by direction first. |

---

## 4. Supported File Formats

Banks in India provide statements in three formats. All three must be supported from v1.

| Format | When banks use it | Complexity |
|--------|-------------------|------------|
| **PDF** | Default for all banks — monthly CC statements, savings account statements. Usually password-protected. | High — requires text extraction and bank-specific parsing |
| **XLS** | Older Excel format (`.xls`). HDFC NetBanking, ICICI iMobile export. | Medium — columns vary by bank |
| **XLSX** | Newer Excel format (`.xlsx`). Axis Bank, ICICI, HDFC newer exports. | Medium — columns vary by bank |

### Bank-specific format notes

The app always prompts the user to enter their own PDF password — passwords are never hard-coded or assumed.

| Bank | Available formats | Notes |
|------|------------------|-------|
| HDFC CC | PDF, XLS | Tables well-structured in PDF |
| HDFC Savings | PDF, XLS, XLSX | XLS preferred for machine-parsing |
| ICICI CC | PDF, XLS, XLSX | XLS has clean columns |
| ICICI Savings | PDF, XLSX | |
| Axis CC | PDF, XLS | |
| Axis Savings | PDF, XLSX | Clean XLSX export |
| SBI Savings | PDF | Long annual statements (700+ rows) |
| FIRST Bank CC | PDF | Multi-card layout — two card sections in one statement |

---

## 5. User Scenarios (All Cases)

### A. Standard CC reconciliation (happy path)
User uploads HDFC CC statement (PDF or XLS) for April 2026. 22 of 25 transactions auto-match. 3 are flagged:
- ₹937 cashback credit → user marks as "bank adjustment, exclude"
- ₹2,723 EMI charge → user adds it as a new expense (linked to their loan)
- ₹1,646 charge → user finds it in Arth under a different date, manually links

**Result:** Account marked reconciled for April 2026.

### B. Split expense matching
CC statement: ₹9,522 "MYNTRA". Arth expense: `amount=0`, `split_original_amount=9,522`, split with Riya (100%).
System matches using `split_original_amount`. Shows: *"Matched — you recorded this as fully paid by Riya (₹9,522). Your share: ₹0."*

### C. CC bill payment (transfer)
Savings account statement: "IMPS ₹28,819 to HDFC CC".
Arth `account_transfers`: from=SBI, to=HDFC CC, ₹28,819. Auto-matched as a transfer. Shows the counterpart account name ("HDFC Tata Neu CC ****8957").

### D. Salary credit (transfer)
Savings statement: "NEFT ₹1,27,150 Coupa Software India". Arth `account_transfers` (incoming). If not in Arth: suggests "Add as salary credit transfer."

### E. EMI instalment on CC
CC statement shows "EMI TATA PAYMENTS ₹2,723" — a credit card EMI instalment, not a new purchase. If no matching loan repayment exists in Arth, flagged for the user to link to a loan schedule or add a `ledger_adjustment`.

### F. Cashback noise (Swiggy/Amazon CC)
Multiple small paired adjustments: "10% Swiggy CashBack +₹668.20" / "10% Swiggy CashBack_Reversal -₹30.60". System groups paired +/- entries and suggests: *"This looks like a cashback reversal pair. Mark both as bank adjustments?"* One-tap to exclude the pair.

### G. Old statement, no Arth data
User uploads a SBI savings statement for April 2025–March 2026. Arth has 0 entries for that period (started using Arth in 2026). System shows: *"No Arth entries found for this period. This account had 774 transactions in the statement that were never tracked in Arth."* Options: "Acknowledge — mark period as pre-Arth baseline" or "Bulk import selected transactions to seed history."

### H. Reversed/rejected SMS entry
User's ICICI CC auto-detected a ₹49 charge. User rejected it in Arth. Statement shows ₹49 as a real charge. Reconciliation flags: *"In statement but previously rejected in Arth."* Options: "Re-add it" or "I rejected this intentionally."

### I. Duplicate in Arth
SMS auto-created an expense AND user manually added the same one. Statement shows 1 entry, Arth has 2. Flagged as: *"2 Arth entries match this statement line — possible duplicate."* User picks which to keep.

### J. Multi-card CC (FIRST Bank)
FIRST Bank Select statement covers two physical cards (6284 and 9655) in one PDF. Parser groups transactions by card section header. Both sections match to the same Arth account.

### K. Pending-review items
An SMS auto-detected expense is still "pending review" (not yet approved). It is included in matching but flagged: *"Arth has a pending item for this — approve it to finalize the match."*

### L. Forex transaction rounding
Statement: ₹1,234.57 (foreign currency purchase). User entered ₹1,235 manually. ₹0.43 difference — within ±₹1 tolerance. Auto-matched and labelled "₹0.43 rounding difference."

### M. Balance mismatch after all items resolved
Statement closing balance: ₹12,456. Arth computed closing balance: ₹12,200. Difference: ₹256. After resolving all transaction mismatches, if the balance still doesn't agree, system offers: *"₹256 unaccounted — add a balance adjustment?"*

---

## 6. UX Flow

### Entry Points
- "Reconcile" button on the account ledger header (per account)
- Settings → Data → Reconcile Accounts (hub showing all past sessions)

### Screen Flow

```
Account Ledger
    └─► [Reconcile] button
              │
        Reconciliation Hub
        (past sessions list: date, status, match %)
              │
        [+ New Reconciliation]
              │
        ┌─── 1. Select Account (pre-filled from ledger) ────┐
        └──────────────────────┬────────────────────────────┘
                               │
        ┌─── 2. Import Statement ──────────────────────────┐
        │   [Upload PDF]  [Upload XLS]  [Upload XLSX]      │
        │                                                   │
        │   If PDF is password-protected:                   │
        │     [Enter password ________]                     │
        │                                                   │
        │   Auto-detect: bank name, account number, period  │
        │   If account number doesn't match any Arth        │
        │   account exactly: ⚠ warning + dropdown to       │
        │   confirm which account this belongs to           │
        │   User confirms: account + date range            │
        └──────────────────────┬────────────────────────────┘
                               │
        ┌─── 3. Matching (auto, ~3 sec) ───────────────────┐
        │   Progress bar                                    │
        │   "Matched 22 of 25 transactions"                 │
        └──────────────────────┬────────────────────────────┘
                               │
        ┌─── 4. Reconciliation Screen ─────────────────────┐
        │                                                   │
        │   [Matched 22] [Missing 3] [Extra 2] [Excluded 0]│
        │                                                   │
        │   Balance: Statement ₹12,456 | Arth ₹12,456 ✓   │
        │   (or: ⚠ ₹256 difference)                        │
        └──────────────────────┬────────────────────────────┘
                               │
              ┌────────────────┼──────────────────┐
              │                │                  │
           MATCHED           MISSING            EXTRA
        (tap to unlink)   [+ Add Expense]     [✓ Valid]
                          [↔ Link Manually]   [Edit]
                          [✗ Exclude]         [Delete]
                               │
        ┌─── 5. Mark Reconciled ───────────────────────────┐
        │   All items resolved                              │
        │   [Mark Reconciled ✓]                             │
        │   Saves session, stamps date on account ledger    │
        └───────────────────────────────────────────────────┘
```

### Matched tab
Shows paired rows: Statement entry on the left, Arth entry on the right. Tap any pair to unlink and re-review. Transfer matches shown with a purple pill. Split matches show "Your share: ₹0 / Full: ₹9,522".

### Missing tab (in statement, not in Arth)
Each row has three actions:
- **+ Add Expense** — opens the standard add-expense sheet pre-filled with date, amount, direction
- **↔ Link Manually** — opens a searchable list of Arth entries to manually pair
- **✗ Exclude** — marks as bank adjustment (cashback, bank charge) that doesn't need an Arth entry. Prompts for a reason tag: *Cashback / Bank charge / Reward fee / Refund / Other*

### Extra tab (in Arth, not in statement)
Each Arth entry that didn't match. Three actions:
- **✓ Confirm** — marks it as valid (it's real, just outside the statement period or a rounding edge)
- **Edit** — opens the expense/transfer edit screen
- **Delete** — soft-deletes the Arth entry

### Excluded tab
All excluded items with their reason tags. Undo available on each row.

---

## 7. Matching Algorithm

```
For each statement transaction S:

  1. Build Arth pool for this account:
       expenses (approved, not deleted) +
       account_transfers (not deleted, from_account OR to_account = this account)

  2. For each Arth entry A in pool:
       match_amount = A.split_original_amount if > 0, else A.amount
       direction    = A.nature == 'credit' OR A is transfer_in

  3. Candidate = A where:
       direction(A) == direction(S)  AND
       |match_amount(A) − S.amount| ≤ 1.00

  4. Among candidates, rank by |A.date − S.date| ascending

  5. Best candidate within 3 days  → AUTO MATCH (green)
     Best candidate within 7 days  → SUGGESTED (user confirms)
     No candidate                  → UNMATCHED (red)
     2+ candidates tie on date     → AMBIGUOUS (user picks)

After all statements processed:
  6. Remaining Arth pool entries = EXTRA IN ARTH
  7. Remaining statement entries = MISSING FROM ARTH
  8. Compare statement closing balance vs Arth computed closing balance
```

**Direction mapping (exact field values):**

| Source | Condition | Direction |
|--------|-----------|-----------|
| `expenses` | `nature = 'realized'` | Debit |
| `expenses` | `nature = 'credit'` | Credit |
| `expenses` | `nature = 'ledger_adjustment'` | Debit (positive adjustments are charges) |
| `account_transfers` | `from_account_id = this account` | Debit (money leaving) |
| `account_transfers` | `to_account_id = this account` | Credit (money arriving) |

Special rules:
- **Transfers** — included in the pool; shown with counterpart account name
- **Splits** — always match against `split_original_amount` when set and > 0. Formula: `match_amount = split_original_amount if split_original_amount > 0 else amount`
- **Pending-review expenses** — included in pool, flagged as "pending"
- **Rejected Arth entries** — excluded from pool, but if statement has them, surfaced as "previously rejected"
- **Cashback pairs** — two entries (+ then −, or − then +) within 5 days, amounts netting to near zero → auto-flagged as "pair" for one-tap exclude
- **Wallet top-ups** — statement entries like "AMAZON PAY WALLET LOAD ₹323" are transfers to a wallet, not purchases. If no matching `account_transfers` exists, suggest adding as a transfer to the relevant wallet account rather than an expense.

---

## 8. Technical Design

### New Database Tables (2 migrations required)

**`reconciliation_sessions`** — one row per account-period import
```sql
id                  TEXT PRIMARY KEY
account_id          TEXT NOT NULL REFERENCES financial_accounts(id)
stmt_start_date     TEXT NOT NULL
stmt_end_date       TEXT NOT NULL
stmt_closing_bal    REAL
arth_closing_bal    REAL
total_stmt_count    INTEGER
matched_count       INTEGER
status              TEXT NOT NULL  -- 'in_progress' | 'completed' | 'abandoned'
import_format       TEXT           -- 'pdf' | 'xls' | 'xlsx'
import_filename     TEXT
created_at          TEXT NOT NULL
completed_at        TEXT
deleted_at          TEXT
```

**`reconciliation_items`** — one row per statement transaction
```sql
id                  TEXT PRIMARY KEY
session_id          TEXT NOT NULL REFERENCES reconciliation_sessions(id)
stmt_date           TEXT NOT NULL
stmt_amount         REAL NOT NULL
stmt_direction      TEXT NOT NULL   -- 'debit' | 'credit'
stmt_narration      TEXT
matched_expense_id  TEXT REFERENCES expenses(id)
matched_transfer_id TEXT REFERENCES account_transfers(id)
match_confidence    TEXT            -- 'auto' | 'suggested' | 'manual'
status              TEXT NOT NULL   -- 'matched' | 'unmatched' | 'excluded' | 'added'
exclude_reason      TEXT            -- 'cashback' | 'bank_charge' | 'reward_fee' | 'refund' | 'other'
sort_order          INTEGER
created_at          TEXT NOT NULL
deleted_at          TEXT
```

Both tables must be added to:
- `database/migrations/index.ts` (import + register)
- `TABLE_SCHEMAS` in backup system (so reconciliation history survives backup/restore)
- `BACKUP_TABLES` in `services/backup.ts`

### New Services

```
services/reconciliation/
├── pdf-parser.ts          — PDF text extraction + bank-specific parsers (HDFC, ICICI, Axis, SBI, FIRST)
├── xls-parser.ts          — XLS/XLSX column mapping per bank
├── statement-matcher.ts   — Core matching algorithm (expenses + transfers, split amounts, date tolerance)
├── reconciliation-crud.ts — Create/read/update sessions and items
└── cashback-detector.ts   — Heuristic: pair +/- entries that net to near zero
```

### New Screens

```
app/settings/reconciliation/
├── index.tsx              — Hub: past sessions list with status badges
├── new.tsx                — Step 1+2: account select + file import
├── [sessionId].tsx        — Step 4: main work screen (tabs: Matched/Missing/Extra/Excluded)
└── manual-link.tsx        — Picker: search Arth entries to manually link to a statement row
```

### Integration with Existing Screens
- **Account Ledger header** — badge: "Reconciled Jun 2026" (green) or "Not reconciled" (grey)
- **Expense add screen** — when opened from Missing tab: pre-fill date, amount, direction; auto-link to reconciliation item on save
- **Settings screen** — "Reconcile Accounts" entry under Data section

### PDF Parsing Strategy

Each bank's PDF has a distinct layout. Bank-specific parsers required:

| Bank | Layout type | Key parsing challenge |
|------|-------------|----------------------|
| HDFC CC | Table-based | Reward points column alongside amount |
| HDFC Savings | Line-by-line | Date / Narration / Withdrawal / Deposit / Balance columns |
| ICICI CC | Table-based | "DR" / "CR" suffix on amounts |
| ICICI Savings | Line-by-line | Mixed debit/credit in single amount column with sign |
| Axis CC | Table-based | Clean layout, least complex |
| Axis Savings | Line-by-line | Narration wraps across lines |
| SBI Savings | Table across pages | Very long statements; page-break rows split transactions |
| FIRST Bank CC | Multi-section | Three patterns confirmed in production: (1) `DD Mon YY [desc] [Convert?] AMOUNT DR/CR` — description inline; (2) `DD Mon YY AMOUNT DR/CR` — description is the line(s) above and/or below; (3) "Convert" on the line is an EMI eligibility marker, NOT part of the merchant description — must be stripped. Card sections delimited by `Card Number: XXXX XXXX` lines. Pre-desc accumulator buffer required. |

For React Native on Android, PDF text extraction requires a native module or WASM library — options to evaluate during implementation:
- `react-native-pdf-extractor` (native, Android-first)
- A bundled WASM PDF.js build (larger bundle, no native dependency)
- Server-side extraction (sends file to a local HTTP server spawned on device — avoids bundle size but adds complexity)

### XLS / XLSX Parsing Strategy

Use a JavaScript-compatible spreadsheet library (e.g. `xlsx` / SheetJS — already common in RN projects). Each bank uses different column headers and date formats:

| Bank | Date column | Debit column | Credit column | Notes |
|------|-------------|--------------|---------------|-------|
| HDFC | "Date" | "Withdrawal Amt." | "Deposit Amt." | Amounts as strings with commas |
| ICICI | "Transaction Date" | "Debit" | "Credit" | First few rows are account summary — skip |
| Axis | "Tran Date" | "Debit" | "Credit" | dd-mm-yyyy format |
| ICICI CC | "Date" | "Amount" (with DR/CR suffix) | same column | Single amount column |

---

## 9. Edge Cases & Guard Rails

**Known account identifier mismatches (from July 2026 data):**

Arth's `account_identifier` field is not always the last 4 digits of the account number as shown in statements. Two confirmed mismatches:

| Account | Statement shows | Arth `account_identifier` | Why |
|---------|----------------|--------------------------|-----|
| SBI Savings | ****9176 | `0006` | User stored a branch code, not account suffix |
| ICICI Savings | ****7322 | `322` | Only 3 digits stored, not 4 |

Because of this, the auto-detection step must NOT rely solely on `account_identifier`. Strategy:
1. Match on `bank_name` + `account_type` first (e.g. "SBI" + "savings")
2. If the detected account number suffix does NOT match any Arth account's `account_identifier`, show a **yellow warning banner**: *"We detected this as an SBI savings statement (****9176) but couldn't find an exact match in Arth. Please confirm which account this belongs to."*
3. User picks from a dropdown of Arth accounts of the same bank/type
4. Remember the confirmed mapping for future imports (store in MMKV keyed by detected account number suffix)

| Risk | Handling |
|------|---------|
| User uploads statement for wrong account | Warn if detected bank name doesn't match the selected Arth account's bank |
| Same statement imported twice | Detect by (account_id + stmt_start_date + stmt_end_date). Offer to resume the previous session. |
| PDF password wrong | Clear error: "Incorrect password." with a retry prompt. Do not attempt to guess. |
| PDF is scanned image, not text | Detect zero extracted text → show error: "This PDF is a scanned image and cannot be read automatically. Please download the digital statement from your bank's app." |
| Balance check: Arth vs statement still differ after all items resolved | Offer "Add balance adjustment" directly from reconciliation screen |
| Arth entry already matched in a previous session | Flag: "This entry was reconciled in [month]. Link it again?" |
| FIRST Bank multi-card: only one card reconciled | Let user run two separate sessions for the same statement file — one per card sub-section |
| Very large statements (SBI 1-year, 774 rows) | Paginate the resolution UI; batch the matching operation in chunks to avoid blocking the UI thread |
| XLS/XLSX with merged cells or multi-row headers | Bank-specific parser must skip summary rows before the actual transaction table |

---

## 10. Implementation Phases

### Phase 1 — Core engine + XLS/XLSX import
- XLS and XLSX parsers for HDFC, ICICI, Axis (the 3 largest account families)
- Matching engine: expenses + transfers, `split_original_amount`, date/amount tolerance
- Full resolution UI: Matched / Missing / Extra / Excluded tabs
- Manual link picker
- Balance comparison
- Reconciliation history screen
- Account ledger badge

### Phase 2 — PDF import
- PDF text extraction (evaluate native module vs. WASM)
- Bank-specific PDF parsers: HDFC, ICICI, Axis, SBI, FIRST Bank
- Password-protected PDF handling with in-app password prompt
- Scanned PDF detection + helpful error

### Phase 3 — Smart patterns
- Cashback pair auto-detection and group-exclude
- "Likely a bank charge" classifier (service tax, forex markup, reward fee keywords)
- Pre-Arth period handling: acknowledge a historical period as baseline without importing every row
- Reconciliation summary report (exportable as PDF)

---

## 11. What This Fixes from the Manual Exercise

The following gaps were found by running a manual Python reconciliation against the July 2026 backup:

| Finding | How the feature handles it |
|---------|--------------------------|
| HDFC Swiggy CC — 14 cashback reversals not in Arth | Detected as paired noise, one-tap exclude |
| FIRST CC — ₹23,548 UPI bill payment not in Arth | Flagged as missing; user adds as an account transfer |
| FIRST CC — ₹674 force closure fee not in Arth | Flagged as missing; user adds as a bank charge expense |
| ICICI CC — ₹49 Lenskart not in Arth | Flagged as missing; user adds as expense |
| SBI savings — 772 transactions with no Arth match | Explained as pre-Arth period (statement: Apr 2025–Mar 2026, Arth usage started Apr 2026) |
| Split expenses matching on wrong amount | Fixed: match always uses `split_original_amount` when set |
| Transfers completely absent from matching | Fixed: `account_transfers` always included in the Arth pool |
| HDFC Tata Neu CC — EMI instalment line not in Arth | Flagged as missing; user links to loan repayment or adds `ledger_adjustment` |

---

## 12. Baseline Performance (July 2026 Manual Run)

These match rates were measured by running the reconciliation algorithm manually against the July 2026 backup and real statements. They serve as the acceptance benchmark for the engine implementation.

| Account | Statement period | Stmt txns | Auto-matched | Match % | Notes |
|---------|-----------------|-----------|-------------|---------|-------|
| HDFC Tata Neu CC ****8957 | Apr–May 2026 | 25 | 22 | **88%** | 3 missing: EMI instalment, EMI charge, cashback credit |
| HDFC Swiggy CC ****9628 | Apr–May 2026 | 29 | 15 | **52%** | 14 missing: all cashback +/− reversal pairs (noise) |
| Amazon ICICI CC ****3001 | Apr–May 2026 | 32 | 28 | **88%** | 4 missing: Lenskart ₹49, Amazon Pay Wallet load ₹323, Uber refund ₹2, closure refund ₹2 |
| Axis Neo CC ****2445 | Apr–May 2026 | 7 | 7 | **100%** | — |
| Axis Flipkart CC ****8920 | Apr–May 2026 | 5 | 4 | **80%** | 1 missing: CRED cashback ₹4 |
| FIRST Select CC ****6284/9655 | Mar–Jun 2026 | 18 | 7 | **39%** | 11 missing: UPI payment ₹23,548, BBPS payment ₹3,687, force closure fee ₹674, reward redemption ₹99 + IGST ₹18, other charges |
| SBI Savings ****9176 | Apr 2025–Mar 2026 | 774 | 2 | **0.3%** | Expected — Arth usage started Apr 2026, no overlap |
| ICICI Savings ****7322 | Apr 2025–Mar 2026 | 109 | 7 | **6.4%** | Expected — same period mismatch as SBI |
| Axis Savings ****2836 | Apr 2025–Mar 2026 | 107 | 2 | **1.9%** | Expected — same period mismatch |

**Target for the engine:** CC accounts active in the same period as Arth should reach ≥85% auto-match without any user input. Savings accounts reconciled against a period predating Arth use should immediately show the "pre-Arth period" explanation instead of a 0% match screen.
