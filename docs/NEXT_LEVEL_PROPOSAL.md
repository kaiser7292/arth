# Next-Level Proposal — Logic Changes

**Status:** Proposal — awaiting owner approval. No code written.
**Date:** 2026-10-03
**In scope:** SMS coverage, FD events, self-transfers, "send unrecognised SMS", first-run summary, SIP detection, credit-card due gaps, add/edit transaction form revamp.
**Out of scope (owner decision):** Hindi localisation, tax-season mode, CAS PDF import, retirement-plan changes (retirement keeps counting all assets).

---

## 0. Facts this proposal is built on

Checked in code on 2026-10-03:

1. **7 of the 8 sample SMS are not recognised at all** (only the HDFC CC refund parses). SBI patterns in `services/sms/bank-patterns.ts` were written against example formats, not real ones; `assets/data/sms-templates.json` has no SBI entry; the SBI "credited by Rs…" SMS is wrongly claimed by a generic *Indian Overseas Bank* template.
2. **Correction to my earlier claim:** savings rate, yearly plan and income figures come from the **salary profile**, *not* from bank credits. So FD maturities and self-transfers do **not** inflate income today. The real damage is on the **spending** side and in **balances**:
   - A debit that is really an FD deposit or a transfer to your own account counts as **spending** in budgets/insights (budget queries only exclude rows with `reclassified_as_transfer = 1` or an investment/loan link).
   - The FD never appears as an asset, so **net worth is understated**.
   - Credits show in account "Credits" totals — the money did arrive, so this is mostly cosmetic.
3. **Sequencing consequence:** because those FD/transfer SMS are unrecognised today, they are currently *missing*, not *wrong*. If we only add the parsers (step 1), they'd start showing up as **spending**. So **steps 1 and 2 must ship together in the same release.**
4. Already built and reused here: "Mark as Fixed Deposit" (`MarkAsFDSheet`, `createFDAccountShell`, `completeFDDetails`), FD maturity settlement (`settleMaturedFDs`), `reclassifyExpenseAsTransfer` / `reclassifyCreditAsTransfer` (reversible, keep the raw SMS), investment-bucket linking (`linkExpenseToBucket`), CC due forecasts + payment matching, Catch Up deck (`services/catch-up.ts`).
5. Default SMS lookback on a fresh install is **7 days** (`defaultStartDate` in `sms-permissions.ts`).

---

## Step 1 — Recognise real SBI + HDFC savings formats

**File:** `services/sms/bank-patterns.ts` (new entries in `BANK_PATTERNS`), `assets/data/sms-templates.json` (IOB guard).

### 1.1 New in-memory fields on `ParsedSMS` (no DB change)
| Field | Meaning |
|---|---|
| `counterpartyName?: string` | Name after "transfer from/to", "linked to mobile …-", "…:NAME" |
| `counterpartyAcctLast4?: string` | Last 4 of the *other* account ("To A/c xxxx0006") |
| `fdEvent?: "open" \| "closure" \| null` | Set by keyword detection (step 2) |
| `fdNumber?: string` | Digits of the TD/FD account ("031705") |

### 1.2 New patterns
| Pattern | Sample | Output |
|---|---|---|
| HDFC Savings Debit (UPDATE) | `UPDATE: INR 19,980.00 debited from HDFC Bank XX0221 on 08-SEP-26. Info: FD through MOBILE-…:SOURAV BAID. Avl bal:INR 0.00` | `debit`, acct 0221, date, merchant = text after `Info:` up to `-`/`:`, balance, `counterpartyName` = text after last `:` |
| HDFC IMPS Sent | `IMPS INR 30,000.00 sent from HDFC Bank A/c XX0221 on 03-09-26 To A/c xxxxxxxxxx0006 Ref-…` | `debit`, `paymentMode: net_banking`, `counterpartyAcctLast4: 0006` |
| SBI IMPS Credit (linked mobile) | `Your a/c no. XXXXXXXX0006 is credited by Rs.20013.00 on 30-09-26 by a/c linked to mobile …-SOURAV BAI (IMPS Ref# …)-SBI` | `credit`, acct 0006, `counterpartyName: SOURAV BAI` |
| SBI Transfer Credit | `Your A/C XXXXX790006 Credited INR 50,079.00 on 30/09/26 -Deposit by transfer from Mr. SOURAVBAID. Avl Bal INR 62,305.01-SBI` | `credit`, acct 0006, name, balance |
| SBI TD Closure Credit | `Your A/C XXXXX790006 Credited. INR 50,029.00 on 15/09/26 on account of Closure of TD A/c XXXXX031705.-SBI` | `credit`, `fdEvent: closure`, `fdNumber: 031705` |
| SBI Transfer Debit | `Your A/C XXXXX790006 Debited INR 50,000.00 on 11/09/26 -Transferred to Mr. SOURAVBAID. Avl Balance INR 20,326.76-SBI` | `debit`, `paymentMode: net_banking`, name, balance |

Each pattern's `test` regex requires the bank marker (`HDFC Bank` / `-SBI`) so it can't steal other banks' SMS.

### 1.3 IOB template guard
The `iob_credit_by_rs` template only applies when the sender resolves to IOB (or the body contains "IOB"/"Indian Overseas"). Since hardcoded patterns run first, the new SBI pattern would already win — the guard prevents the same mistake for other banks.

### 1.4 Tests
`__tests__/unit/sms-parser.test.ts`: all 8 samples (names/account digits replaced with fake ones), asserting amount, account, date, type, balance, counterparty fields. Cross-bank guard: each new pattern must return null for the other samples.

---

## Step 2 — FD and self-transfer "money events"

### 2.1 New column
**Migration 080** — `expenses.money_event TEXT NULL`. Values: `fd_open`, `fd_closure`, `self_transfer`, `sip`. Set at SMS time; read by Catch Up / review queue to show the right card. Full DB checklist: migration with `PRAGMA table_info` guard, register in `migrations/index.ts`, add to `TABLE_SCHEMAS.expenses`, test mocks. (Not a new table, so no `BACKUP_TABLES` change.)

### 2.2 FD detection keywords (parser post-step)
After any debit/credit pattern matches, a shared helper inspects the body:
- `fdEvent = "open"` if debit and body matches `FD through`, `FD booked`, `towards FD`, `to TD A/c`, `e-TDR`, `Fixed Deposit .* (opened|created|booked)`, `RD instal`.
- `fdEvent = "closure"` if credit and body matches `Closure of (TD|FD)`, `FD .* (matured|maturity|closed)`, `maturity proceeds`, `premature (closure|withdrawal)`.
- `fdNumber` = digits following `TD A/c` / `FD (A/c|no)`.

### 2.3 FD opened → debit flagged, card offered
In `sms-to-expense.ts`, debit branch:
- Insert the pending debit exactly as today, plus `money_event = 'fd_open'`.
- **Skip `autoDetectTransfer`** for these rows (an FD deposit isn't a self-transfer).
- Catch Up / review queue: a `pending` card whose expense has `money_event = 'fd_open'` renders as **"Looks like a new Fixed Deposit"** with:
  - **Set up FD** → opens existing `MarkAsFDSheet` pre-filled (bank, amount, date, source account). Its existing logic creates the FD account and reclassifies this debit into the funding transfer → it stops counting as spending and the FD appears in net worth.
  - **Not an FD** → clears `money_event`, approves as a normal expense.
- Nothing is created without your tap.

### 2.4 FD closed → matched to an FD, or a card
In the credit branch, before the existing FD-maturity match, when `fdEvent = 'closure'`:
1. **Match by number:** active FD account whose `account_identifier` ends with `fdNumber`'s last 4–6 digits.
2. **Existing match:** current schedule-based query (unchanged).
3. **Premature-closure match:** active FD on a savings account of the same bank, `principal ≤ amount ≤ principal × 1.5`, start date before the SMS date. If exactly one → match; if several → card with a picker.

If matched: link credit as the FD payout and finalise via the existing settle path (`finaliseScheduleEntry` / `finaliseFDMaturityForExpenses`), recording actual interest = amount − principal. The FD account closes, net worth updates.

If not matched: insert the pending credit with `money_event = 'fd_closure'`. Card **"FD/TD closed — ₹50,029"**:
- **Close one of my FDs** → picker of active FDs → same finalise path.
- **Record an FD I never added** → creates a closed FD shell (principal = a debit flagged `fd_open` within the last 400 days for ≤ amount if found, else asks), so interest earned is recorded and the credit is reclassified as an FD → savings transfer.
- **Just a credit** → clears `money_event`, approves.

### 2.5 Your name(s) as banks write them
- **MMKV key `self_names`** (JSON string array) — added to `SETTINGS_REGISTRY` as **backed up, type string**.
- **Settings → Profile → "Your name in bank messages"**: list, add/remove.
- **Auto-suggest:** after each scan, count `counterpartyName` values across parsed SMS (normalised: uppercase, strip `MR./MRS./MS.`, remove spaces). If one value appears ≥ 3 times and isn't saved or dismissed → one-time Home prompt *"Is SOURAV BAID you? Banks use this name on transfers between your accounts."* Yes → saved. No → stored in `self_names_dismissed` (also registered, backed up).
- **Match rule** (`isSelfName(name)`): normalise both; match if equal, **or** one is a prefix of the other with ≥ 8 characters (covers `SOURAV BAI` ← bank truncation and `SOURAVBAID` ← spaces removed). Pure function, unit-tested.

### 2.6 Self-transfer pairing — both directions
New function `findSelfTransferPair(...)` in `services/account-transfer.ts`, replacing the body of `autoDetectTransfer` (which today: credit must be already approved, exact amount, ±1 day, debit side only).

**On a savings debit** (`net_banking`, UPI P2A, or `counterpartyName` is you):
- Look for a credit on another of your active accounts, status `approved` **or `pending_review`**, amount equal (or credit = debit − up to ₹25 for IMPS charges), date within **±2 days**.
- If `counterpartyAcctLast4` matches one of your accounts, restrict to that account.
- Exactly one candidate → pair (below). More than one → no auto-pair; card suggests.

**On a credit** (new — today nothing happens on the credit side):
- Same search mirrored: a debit on another of your accounts, same tolerance.
- Or `counterpartyName` is you.

**Pairing action:**
- Both sides found → create one transfer with `reclassifyExpenseAsTransfer` on the debit and `reclassifyCreditAsTransfer` on the credit (both reversible, keep raw SMS, set `reclassified_as_transfer = 1`). This replaces today's "create transfer + soft-delete the expense" in the debit path, so it can be undone from the expense screen.
- Only name matches, no other side yet → keep the row pending with `money_event = 'self_transfer'`. Card: **"Transfer to your own account …0006"** → *Pick account* (`reclassify…AsTransfer`) / *Add this account* (account-add pre-filled with last 4) / *Not mine*.
- When the other side arrives later, it pairs with the waiting row automatically (it's `pending_review`, which the new search includes).

**Guard (kept from today):** if a Smart Rule already classified the debit as spending (category/split/loan/bucket), don't auto-pair — suggest only.

### 2.7 Tests
- Unit: `isSelfName` cases; keyword detection; tolerance rules.
- Integration (real SQLite like existing tests): debit-then-credit pairs; credit-then-debit pairs; IMPS-charge tolerance; two candidates → no auto-pair; FD open → `MarkAsFDSheet` path → budget totals exclude it; closure matched by number; premature closure matched by principal range; unmatched closure → card; backup round-trip keeps `money_event`.

---

## Step 3 — "Send to developer" for unrecognised SMS

**Files:** `app/settings/sms-scan-runs.tsx`, new `services/sms/sms-redact.ts`.

- `redactSms(body)` — pure function:
  - Digit runs ≥ 4 that aren't the amount or a date → `XXXX` (account numbers, refs, phone numbers).
  - `XX1234` / `xxxxxx1234` style account masks → `XXnnnn` → `XXXXXX`.
  - Words after `from|to|by|Mr\.|Mrs\.|Ms\.|linked to mobile .*-|:` up to punctuation → `NAME`.
  - UPI IDs (`\S+@\S+`) → `upi@handle`. URLs → `https://link`.
  - Balance after `Avl Bal|Available Balance|Bal` → `X`.
  - Amount and dates kept (needed to build the pattern).
- In the **Unrecognised** category view: per-SMS **Send to developer** and a bulk **Send all from this sender** button.
- Shows the redacted text in an editable box first, then opens the email app via `mailto:` (subject `Arth — unrecognised SMS (<sender code>)`, body = redacted text + app version). **Arth makes no network call.**
- **Needs from you:** the support email address.
- Tests: redaction cases for each sample SMS (no name/account digits survive; amount survives).

---

## Step 4 — First-run "Here's your money" summary

**Files:** `app/(onboarding)/sms-consent.tsx`, new `app/(onboarding)/first-scan.tsx`, `services/sms/sms-permissions.ts`.

- After permission is granted: new screen **"How far back should Arth read?"** — 1 month / **3 months (default)** / 6 months. Sets `SMS_START_DATE` (today it silently defaults to 7 days).
- Runs `runSmsScan({ manual: true })` with a progress indicator. **Time cap 45 s:** if not finished, show "Still reading — we'll show your summary on Home when it's done" and continue; the scan keeps running.
- Summary (new pure function `buildFirstScanSummary(scanRunId)` reading the scan run + created rows):
  - Accounts found (with last SMS balance where available)
  - Total in / total out for the period
  - Top 5 merchants by spend
  - Upcoming dues found (CC bills, EMIs)
  - FDs / self-transfers detected (from step 2)
  - "N items to review"
- Buttons: **Review now** (Catch Up) / **Later** → Home.
- If the scan finished after the time cap, the same summary appears once as a Home card.
- Tests: summary builder on seeded data; onboarding step order.

---

## Step 5 — SIP auto-debits counted as investment

**Files:** `bank-patterns.ts`, `sms-to-expense.ts`, Catch Up card.

### 5.1 Detection
New helper `detectSip(parsed, body)` → true when type is `nach_debit` / `standing_instruction` / UPI autopay debit **and** merchant/narration matches an MF list:
`BSE STAR MF`, `BSE LTD`, `NSE MFSS`, `NSE CLEARING`, `ICCL`, `INDIAN CLEARING CORP`, `CAMS`, `KFIN`, `KARVY`, `MF UTILITIES`, `<AMC> MUTUAL FUND` / `<AMC> MF` (list of ~45 AMCs bundled as a constant), Groww / Zerodha Coin / Kuvera / Paytm Money / ET Money MF handles.

Plus generic NACH patterns for **SBI, ICICI, Kotak** (only HDFC and Axis exist today).

### 5.2 Behaviour
- Pending debit inserted as today with `money_event = 'sip'`.
- If a Smart Rule already links this merchant to a bucket → existing auto-link runs (unchanged).
- Otherwise card **"SIP ₹5,000 — HDFC Mutual Fund"**: **Link to bucket** (picker → `linkExpenseToBucket`, which already excludes it from budget spending) + checkbox **"Always do this for this fund"** → creates a Smart Rule via the existing rule-suggestion flow.
- **"It's not a SIP"** → clears `money_event`.
- `nach_bounce` whose merchant passes `detectSip` → notification "SIP to HDFC MF bounced — check balance in HDFC XX0221".
- Tests: detection list; card actions; budget totals exclude linked SIPs (already covered by existing budget query, add a case).

---

## Step 6 — Credit-card due gaps

**Files:** `sms-to-expense.ts` (`payment_received` branch), `services/notification-scheduler.ts`.

Today a payment-received SMS matches the repayment forecast only within ±0.5%; a part payment doesn't match, and the forecast stays at the full amount.

- **Part payment:** if no ±0.5% match, find the open repayment forecast on the same card with `amount > payment` and due date within the last 10 / next 30 days. Create the payment as today, then **reduce the forecast** to `amount − payment` and set its description to "₹X still due".
- **Overpayment / exact full payment:** unchanged (existing match closes the forecast).
- **Notifications:** only forecasts still `nature = 'forecast'` and not matched are counted (already true for matched ones — I'll confirm with a test; change nothing if it holds). Add a **3-day** lead to the existing 0–2-day "due soon" window for `forecast_type = 'repayment'` only.
- Tests: part payment reduces forecast; second payment clears it; notification excludes paid dues.

---

## Step 7 — Add/Edit transaction form revamp

### 7.1 What's wrong today (checked in code)
| Problem | Where |
|---|---|
| **Duplicating a credit** opens a screen titled **"Add Expense"** with a **"Save Expense"** button (it does save as a credit underneath) | `app/expense/add.tsx` — title/button only check `isRefund` / extra legs, never `isCreditDuplicate` |
| **Editing a credit** — button says "Update Credit", but the form is the expense form: placeholder "What did you spend on?", **Merchant**, spending **categories**, **payment mode**, and the "unavoidable/discretionary" toggle, none of which mean anything for money received | `app/expense/[id].tsx` edit mode |
| Other records (ledger adjustments etc.) fall through to **"Update Expense"** | same, `nature` check only knows credit/forecast |
| **Four different ways to enter a credit**, each a different form: Add screen (duplicate only), edit screen, the Transactions-tab "Add Credit" sheet (account, amount, description, date only), and the account-ledger "Add Credit" sheet (button says just "Save" when editing) | `add.tsx`, `[id].tsx`, `(tabs)/expenses.tsx`, `reconciliation/account-ledger.tsx` |
| Edit form is a second copy of the add form inside a 3,600-line screen — fixes to one don't reach the other | `[id].tsx` |
| Every field is shown at once (split, extra payment sources, tags, classification), and **Save** sits at the bottom of a long scroll | both |

If you saw "Update Expense" on a credit in the app, tell me which screen you opened it from — the code paths above are the ones I found, and the revamp replaces all of them.

### 7.2 One shared form, three types
New `components/expense/TransactionForm.tsx` used by **Add**, **Edit**, **Duplicate**, and both **Add Credit** sheets (the sheets become a link into the same form, pre-set to *Received* and the account).

At the top, a segmented switch: **Spent · Received · Transfer**. It sets colour, labels, fields and buttons:

| | **Spent** | **Received** | **Transfer** |
|---|---|---|---|
| Amount | ✓ (red tint) | ✓ (green tint) | ✓ |
| Who | **Paid to** (merchant) | **Received from** (payer — salary employer, person, bank) | — |
| Account | **Paid from** | **Into account** | **From** and **To** |
| Kind | **Category** (spending categories) | **Type** chips: Salary · Interest · Refund · Cashback · Reimbursement · Gift · Other | — |
| Date | Today / Yesterday chips + picker | same | same |
| Payment mode | auto-set from the account (already done via `getLinkedModesForAccount`), shown under "More" | hidden | hidden |
| Refund | — | choosing **Refund** asks "Refund of which expense?" (existing linked-refund logic) | — |
| Split with someone | under "More" | hidden | hidden |
| Extra payment source | under "More" | hidden | hidden |
| Unavoidable / discretionary | under "More" (auto from category, as today) | hidden | hidden |
| Note, tags | under "More" | under "More" | under "More" |
| Saves via | `createExpense` (nature `realized`) | `createExpense` (nature `credit`) | `createTransfer` (existing) |

**Labels follow the type everywhere:**
- Header: *New expense / New credit / New transfer*; editing: *Edit expense / Edit credit / Edit transfer*.
- Button: *Save expense / Save credit / Save transfer*; editing: **Save changes**.
- Placeholders: "What was it for?" (Spent), "What's this money for?" (Received).

### 7.3 Smart defaults
- **Account:** last account used for that type.
- **Category:** as you type *Paid to*, suggest the category from Smart Rules / merchant history (the categoriser already exists) — shown as a pre-selected chip you can change.
- **Received type:** pre-picked from the payer (e.g. employer name → Salary, "INT.PD"/"interest" → Interest).
- **Date:** the viewed month's rule stays (today if in the viewed month, else the 1st) when opened from a ledger.

### 7.4 Layout
- Amount + type switch at the top, then the 3–4 essential fields, then a collapsed **More options** row.
- **Save button pinned at the bottom**, above the keyboard, always visible.
- Inline errors next to the field (existing `validateExpense`).

### 7.5 Changing type while editing
- **Manual** records: switching Spent ↔ Received is allowed (asks to confirm; clears category/split that don't apply).
- **SMS** records: type is locked to what the bank said; the existing actions stay — *Mark as transfer*, *Mark as Fixed Deposit*, *reclassify credit as transfer*.
- Switching to **Transfer** on an existing record uses the existing reversible `reclassifyExpenseAsTransfer` / `reclassifyCreditAsTransfer`.

### 7.6 Data change
**Migration 080** (shared with step 2) also adds `expenses.credit_kind TEXT NULL` (`salary`, `interest`, `refund`, `cashback`, `reimbursement`, `gift`, `other`). Full DB checklist. SMS credits get it pre-filled where obvious (interest credits, refunds, step 2's FD closures).

Today credits borrow spending categories; existing credits keep their category, and `credit_kind` starts empty for them.

### 7.7 What stays the same
The read-only detail view, all its actions (approve/reject, mark as transfer/FD, rules, recurring, duplicate), and every service function. This is a UI change on top of existing save logic, plus the one new column.

### 7.8 Tests
Component tests: correct title/button/fields per type × add/edit/duplicate; credit duplicate shows "New credit"; type switch clears inapplicable fields; Transfer saves via `createTransfer`. Existing add/edit tests updated.

---

## Release plan

| Release | Contents | Why together |
|---|---|---|
| **A** | Steps 1 + 2 | Parsers alone would turn missing FD/transfer rows into wrong *spending* |
| **B** | Steps 3 + 4 | Play Store first impression + coverage feedback loop |
| **C** | Step 5 | |
| **D** | Step 6 | |
| **E** | Step 7 (form revamp) | Biggest UI change — own release so it can be tested on its own |

Each release: tests green (`npx jest`, `npx tsc --noEmit`), backup-coverage + settings-coverage guard tests pass, help articles updated, version bump.

## Decisions (owner, 2026-10-03)

1. **Name auto-suggest (2.5):** explained to owner; shown in the UI mockups for confirmation.
2. **Support email (3):** souravbaid270@gmail.com
3. **First-run lookback (4):** 3 months default — approved.
4. **Credit types (7.2 / 7.6):** separate credit-type list (`credit_kind`) — approved.
5. **Type switch on edit (7.5):** allowed (Spent ↔ Received ↔ Transfer) — approved.
6. **Next:** owner reviews UI mockups before any build.
