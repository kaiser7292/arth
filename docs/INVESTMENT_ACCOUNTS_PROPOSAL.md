# Investment Accounts — Product Proposal

**Version:** 1.0 | **Date:** September 2026 | **Status:** Draft for review

---

## 1. Why This Belongs in Arth

Arth tracks demat (equity/mutual fund) accounts and pension accounts today, but they are two disconnected islands with their own home cards, their own list screens, and their own "add account" flows. There is no way to answer "what do I actually hold across every investment I have" without adding the two cards together in your head. Fixed deposits — one of the most common Indian investment vehicles — don't exist in Arth at all; a user has to track them outside the app entirely.

This proposal introduces a generic `investment` account type that demat and pension both migrate into, and adds the fixed deposit as the first genuinely new instrument. The result is one place — one card on Home, one list screen, one add flow — for everything the user has invested, whatever kind of investment it is.

Recurring deposits are explicitly out of scope for this proposal — see section 12.

---

## 2. The Central Finding

**An FD is a loan in reverse, and Arth already has the whole pattern for it.** `loan_accounts` + `loan_schedule_entries` is a sibling params table plus dated future rows carrying `status` and `linked_expense_id`, with the current value computed from the schedule and never snapshotted. That is exactly an FD's shape.

**Pension is not a schedule at all — it's already a plain balance-chain account wearing a different label.** EPF/NPS-style accounts have no maturity schedule and no snapshot; their value is just the running total of contributions credited over time, computed with the exact same `opening − expenses + credits ± transfers ± adjustments` formula that savings accounts already use. Pension was implemented as its own `account_type` purely so it could have its own home card and icon — mechanically it has never needed anything a savings account doesn't already have.

Three things make consolidating all of this cheap:

1. **`financial_accounts.account_type` has no CHECK constraint** — it's plain `TEXT` (`001_consolidated_schema.ts:55`), never constrained by a later migration. Introducing `'investment'` is additive: no table rebuild.
2. **The balance engine has exactly one branch** — `isCC` in `computeClosing` (`services/account-balance.ts:32-45`). Savings, wallet, pension, loan, and demat all already share one formula. Adding `investment` to `balanceEligible` (`services/balance-sheet.ts:386-388`) is the entire cost of making a principal-only or contribution-only valuation work.
3. **Bucket feeding already exists.** `account_transfers` carries `investment_bucket_id` and `linked_contribution_id` (migration `011`), and `services/demat-transfer.ts:113-121` turns a bucket-tagged transfer into an `investment_contributions` row that `recomputeBucketContributed` (`services/yearly-plan.ts:500-557`) picks up. A transfer into any investment account reuses that channel with zero new schema.

---

## 3. The Instrument Dimension — Three Valuation Strategies, Not Two

Every investment account needs a way to know how its current value is determined. There are three shapes, not two:

| Strategy | Value comes from | Instruments | Engine cost |
|---|---|---|---|
| **`market`** | User-entered snapshots — value is unknowable to a local app | Equity, mutual funds, gold | Zero — this is the existing demat path, unchanged |
| **`contribution`** | The standard balance-chain formula (opening ± flows) | EPF, NPS, PPF | Zero — this is the existing pension path, unchanged |
| **`contract`** | Computed from principal, rate, and dates | FD, bonds | New — the only instrument with no existing analog |

This is the one correction to the shape of this proposal from its first draft: FD-style "contract" accounts and EPF-style "contribution" accounts look similar (both are "put money in, get more out later") but are mechanically nothing alike. An FD's value is unknowable without a schedule; a PPF's value is exactly its running contribution balance, the same as a savings account. Treating pension as a `contract` instrument would mean building a fake maturity schedule for an account that doesn't have one. Treating it as `market` would mean asking the user to manually snapshot a number the app already computes correctly today. `contribution` is the honest third category, and it costs nothing because it already exists.

---

## 4. What Migrates: Demat and Pension

Both migrations follow the same two-step pattern already used successfully for `bank` → `savings` aliasing, so the live screens keep working throughout:

**Step 1 — introduce `investment` + the instrument dimension, build FD end to end, and alias the existing types.** New `isInvestmentType()` / `ASSET_ACCOUNT_TYPES` helpers let `'demat'` and `'pension'` resolve as investment accounts everywhere the generic path is used (home card, unified list, balance sheet), without touching a single stored row. The dedicated demat and pension screens keep running exactly as they do today.

**Step 2 — flip the stored `account_type`.** Once the generic path is proven on real data, `updateAccountType` (`services/financial-account.ts:695-713`, already exists) flips `demat` accounts to `investment` + `instrument='equity'` + `valuation='market'`, and `pension` accounts to `investment` + `instrument='epf'` (or `'nps'`/`'ppf'` per account) + `valuation='contribution'`.

`demat_portfolio_snapshots` / `demat_fund_snapshots` and the pension contribution-tracking queries keep their table names and logic — renaming them buys nothing and costs a schema sweep. The instrument-specific screens (snapshot entry, contribution view) are reused unchanged; only their entry point and their home-card representation change.

---

## 5. User Experience

### Home screen

Today: a separate **Pension** card and a separate **Demat portfolio** card, each with its own total.

After: both are replaced by one **Investments** card — a total value plus a breakdown strip by instrument group (e.g. "Equity ₹3.16L · EPF ₹8.42L · FD ₹48K"). Tapping it opens the unified list below. This is a straight replacement, not an addition — two cards become one.

### Investments — new unified list screen

Every investment account in one place, regardless of instrument: an equity/demat account, an EPF account, and an FD sit in the same list, each showing its current value and a short label for what kind of value it is ("Equity · market value", "Retirement · contributions", "Fixed deposit · matures 12 Mar 2027"). This screen does not exist today.

### Account detail — three screens, one per valuation strategy

Tapping into an account routes to a different screen depending on `valuation`, because the data entry is genuinely different for each:

- **`market`** (equity, mutual fund, gold) — the existing demat snapshot screen, unchanged. "Record a snapshot" stays the primary action.
- **`contribution`** (EPF, NPS, PPF) — the existing pension contribution screen, unchanged. Shows contributions this FY, last contribution date, same as today.
- **`contract`** (FD, bond) — a **new** screen: principal, rate, maturity date, and a countdown to the next scheduled event (interest payout or maturity). Nothing like this exists today because nothing like an FD exists today.

### Add investment — new consolidated flow

Today there are two separate entry points: "Add pension account" and "Add demat account", each in a different part of Settings. This becomes one flow: pick an instrument (Equity / Gold / EPF-NPS / Fixed Deposit / …), then fill in the fields that instrument actually needs. The picker is the only new UI here — everything past it reuses the existing demat and pension setup forms, plus the new FD setup form.

### What this means concretely

| Piece | Status |
|---|---|
| Demat balance/snapshot engine | Migrates as-is |
| Pension balance-chain engine | Migrates as-is |
| Demat portfolio/fund snapshot screens | Reused, unchanged |
| Pension contribution screen | Reused, unchanged |
| Home cards (Pension + Demat) | Removed, replaced by one Investments card |
| Investments list screen | New |
| FD detail screen | New |
| FD schedule + maturity materialization engine | New |
| Add-investment flow | New (consolidates two existing flows) |
| Balance sheet grouping | Consolidates two rows into one expandable "Investments" row |

---

## 6. Schema

- `financial_accounts.account_type` gains `'investment'`.
- **`investment_products`** (1:1 with a financial account, modeled on `loan_accounts`):
  ```
  id                     TEXT PRIMARY KEY
  financial_account_id   TEXT NOT NULL REFERENCES financial_accounts(id)
  instrument             TEXT NOT NULL   -- equity | mutual_fund | gold | fd | bond | epf | nps | ppf | other
  valuation              TEXT NOT NULL   -- market | contract | contribution
  principal              REAL            -- contract only
  interest_rate_pa       REAL            -- contract only
  interest_method        TEXT            -- contract only: simple | compound
  compounding_freq       TEXT            -- contract only: monthly | quarterly | annually
  start_date             TEXT            -- contract only
  maturity_date          TEXT            -- contract only
  payout_mode            TEXT            -- contract only: cumulative | periodic
  source_account_id      TEXT            -- contract only — where principal came from / returns to
  auto_credit_on_maturity INTEGER        -- contract only
  status                 TEXT NOT NULL DEFAULT 'active'
  ```
- **`investment_schedule_entries`** (modeled on `loan_schedule_entries`, used only by `valuation='contract'` products):
  ```
  id                  TEXT PRIMARY KEY
  product_id          TEXT NOT NULL REFERENCES investment_products(id)
  event_num           INTEGER NOT NULL
  event_date          TEXT NOT NULL
  kind                TEXT NOT NULL   -- maturity | interest_payout
  principal_component REAL
  interest_component  REAL
  status              TEXT NOT NULL DEFAULT 'scheduled'   -- scheduled | materialised | skipped
  linked_expense_id   TEXT REFERENCES expenses(id)
  linked_transfer_id  TEXT REFERENCES account_transfers(id)
  UNIQUE(product_id, event_num)
  ```

`UNIQUE(product_id, event_num)` plus `status` is the idempotency key — the same mechanism `loan_schedule_entries` already uses, deliberately not a date comparison.

Both tables need `database/TABLE_SCHEMAS.ts` entries, `BACKUP_TABLES` entries, and a `services/data-cleanup.ts` cascade — the checklist this project's `CLAUDE.md` already enforces for every new table. Note the live `UNIQUE(user_id, account_identifier, bank_name, account_type)` index means several FDs at one bank need distinct identifiers.

`contribution`-valuation products (EPF, NPS, PPF) need no columns beyond `instrument` and `valuation` — there is no schedule, no principal, no rate. This is the concrete cost saving from splitting the valuation strategy in three instead of two.

---

## 7. Maturity Handling (`contract` instruments only)

At maturity, the app creates **two rows, only one of which is reviewable**, because only one of them is uncertain:

- **Principal** → an `account_transfers` row, FD → the source savings account. Deterministic — it is exactly what went in. Not reviewable; transfers have no status column.
- **Interest** → a `nature='credit'` expense in the source savings account, `status='pending_review'`.

Net worth rises by exactly the interest, the FD account closes at zero, and the one thing the user confirms is the one thing banks routinely get wrong — TDS and rounding mean the credited interest rarely matches the computed figure. Both rows stamp back onto the schedule row (`linked_transfer_id`, `linked_expense_id`) and flip it to `materialised`.

**This is the first "dated row → auto-created transaction" mechanism in the app, and that needs saying out loud.** Migration `014_recurring_reminders.ts` *removed* an earlier version of exactly this: recurring rules used to auto-create forecast rows, and it was reverted because "utility/rent amounts are often variable; the forecasts polluted the ledger with placeholder values the user then had to edit." An FD maturity is the case that objection does not cover — the date and amount are known at setup, not guessed — and routing the interest leg through the review queue answers the pollution concern directly: the user corrects the one number that's actually uncertain, and only that one.

---

## 8. The Trigger

An **idempotent on-app-open catch-up pass**, slotted beside `runDailyNotificationCheck` / `runScheduledBackupIfDue` in `app/_layout.tsx`: materialise every `scheduled` entry with `event_date <= today`.

A background accelerant is possible — `ARTHA_SCHEDULED_BACKUP` (`services/backup-schedule.ts`) already opens SQLite and writes files with the app closed, which is the existence proof — but `BackgroundFetch.minimumInterval` is a hint and Android Doze makes it unreliable, so it can only ever be a bonus. The on-open pass must be correct on its own, and is.

---

## 9. Integration and What It Actually Costs

- **Balance sheet** — add `investment` to `balanceEligible`; add it to the `BalanceSheetRow.group` union, the `if/else` chain in `services/balance-sheet.ts`, and the tap-routing switch in `app/goals/balance-sheet.tsx`. `market`- and `contribution`-valued products keep rendering from their existing data sources.
- **Investment buckets** — free via the existing transfer channel; tag the funding transfer with a bucket, same as today.
- **Yearly plan** — needs nothing. The plan's investment target is already the sum of FY bucket `annual_target`s; accounts play no part in that calculation.
- **The real cost is registration, not engineering.** A new account type must be declared in roughly 34 places: `AccountType` (`services/financial-account.ts`) and `isValidAccountType`, the balance-sheet chain, `services/simulator-engine.ts`, `services/home-card-preferences.ts`, the icon/label maps duplicated across `account-add.tsx`, `account-detail.tsx`, `account-master.tsx`, `app/(tabs)/settings.tsx`, `app/settings/smart-rules/[id].tsx`, `app/(onboarding)/accounts-preview.tsx`, `components/expense/AccountPickerSheet.tsx`, plus 11 hardcoded `filterTypes={[...]}` arrays at picker call sites.

  Those 11 arrays are worth fixing **before** this work starts, as their own small pass: extract `ASSET_ACCOUNT_TYPES` / `TRANSFERABLE_TYPES` constants so a new type is declared once instead of eleven times. This isn't hypothetical hardening — a past release was a one-line fix adding `"demat"` to one of these arrays after it shipped missing, and `AccountPickerSheet.tsx` still has no `pension` icon today, the same bug already latent and waiting to surface.

---

## 10. Verification

The math (accrual, maturity amount, schedule generation for `contract` instruments) is pure and belongs in unit tests, the same way `services/loan-engine.ts` is tested. The materialization pass is the risky part and needs integration tests against a **real SQLite engine** (`node:sqlite`, the same approach as `__tests__/integration/simulator-unlink.test.ts` and the tests added for this session's simulator/smart-rules work) — asserting that running the pass twice creates one set of rows, that a materialised entry is never revisited, and that the FD's closing balance and the balance-sheet asset row both land correctly. A mock that only records SQL strings cannot answer any of those.

Plus the standing rule already in `.context/`: restore a backup on the built APK and confirm the ledger, hisaab links, and loan schedules still render — this work touches the account-type registration surface broadly enough that a restore regression is a real risk, not a formality.

---

## 11. Implementation Phases

**Phase 0 — the 11-array cleanup.** `ASSET_ACCOUNT_TYPES` / `TRANSFERABLE_TYPES` constants, fixing the latent `AccountPickerSheet` pension-icon gap along the way. Ships independently, has value on its own, de-risks everything after it.

**Phase 1 — `investment` + instrument dimension + FD end to end.** Schema, the `contract` schedule engine, the maturity trigger, the new FD detail screen, the consolidated add-investment flow, the unified Investments list and home card. Demat and pension alias in via Step 1 of section 4 but keep their stored `account_type` unchanged.

**Phase 2 — demat and pension conversion.** Step 2 of section 4: flip stored `account_type` for both, once Phase 1 has run on real data without incident.

**Phase 3 — polish.** Balance sheet sub-grouping by instrument within the one "Investments" row (rather than just a flat total), bond support if requested.

---

## 12. Explicitly Out of Scope

- **Recurring deposits.** An RD takes periodic contributions into a schedule that otherwise matures like an FD — closer to `contribution` on the funding side and `contract` on the maturity side, and not a clean fit for either without its own design pass. Skipped for this proposal entirely; FD is the only `contract` instrument in v1. Revisit as a follow-up once FD has shipped and proven the schedule engine.
- **NPS partial withdrawal / tiered accounts.** NPS has Tier I/II accounts with different withdrawal rules. Modeled as a single `contribution` account per tier, same as EPF, with no withdrawal-rule enforcement — Arth doesn't enforce loan prepayment rules either, it records what happened.
- **Live-priced gold or digital gold.** Gold sits in `market` valuation alongside equity/mutual funds — the user snapshots value periodically, same as any market instrument. A live-ish price feed is out of scope; Arth has no market-data connectivity anywhere today and this proposal doesn't introduce one.
