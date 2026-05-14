# V13 Proposal — Shared Credit Limit Pools

**Status:** draft — not yet approved for implementation. Plan + full impact analysis below.

---

## 1. Problem

Many Indian credit-card issuers assign a **single credit limit shared across multiple cards on the same customer account**. Common examples:

- HDFC issues 2–4 cards under one ₹5L line (Diners + Millennia + Regalia).
- Amex supplementary cards share the primary cardholder's line.
- ICICI may offer a second card that shares the original limit.

The app currently models each card as an independent `financial_accounts` row with its own `credit_limit`. "Shared limit" is inferred at read-time: the credit-cards screen groups cards by `bank_name` and takes `max(credit_limit)` as the shared pool. This inference is fragile, the ledger is per-card so spending on one card doesn't affect the sibling's computed balance, and "Utilized" math double-counts against the shared pool.

## 2. Target behaviour

For cards in the same pool:
- **One** opening balance (applies to all siblings).
- **One** outstanding / utilized figure.
- Transactions on any sibling card deplete the same available credit.
- The reconciliation "Difference" check reconciles against the pool, not per card.
- Per-card details (last-4, rewards category, due date) stay distinct — users still care which physical card they used.

## 3. Data-model options considered

### Option A — Dedicated `credit_pools` entity (recommended)

New table `credit_pools`:
```
id TEXT PRIMARY KEY,
user_id TEXT NOT NULL REFERENCES users(id),
bank_name TEXT NOT NULL,
credit_limit REAL NOT NULL,
label TEXT,  -- optional user-facing name, e.g. "HDFC Regalia Pool"
created_at TEXT,
updated_at TEXT
```

New column on `financial_accounts`:
```
credit_pool_id TEXT NULL REFERENCES credit_pools(id)
```

Ledger (`account_month_balances`) gets an analogous column:
```
credit_pool_id TEXT NULL  -- when set, account_id is NULL and vice-versa
```

So a pool has ledger rows keyed by pool id; standalone credit cards (and non-CC accounts) keep ledger rows keyed by account id.

**Pros:**
- Clean conceptual model — "pool" is a first-class entity, inspectable and editable.
- Migrating existing data is mechanical: infer pools from `bank_name` + `credit_limit` identity.
- Label lets the user name the pool ("HDFC Infinia Pool") distinct from individual cards.

**Cons:**
- Biggest migration cost (new table, backfill, UI).
- Every balance query that joins expenses to an account needs to know whether to group by account or pool.

### Option B — Primary-card designation

Pick one card per pool as "primary". Ledger lives on primary; siblings have `primary_card_id` and no ledger of their own.

**Pros:** Smaller schema change — one nullable column on `financial_accounts`.
**Cons:**
- Arbitrary — which card is primary? Breaks when user deletes the primary.
- Confusing to users: "why is my ledger on Diners and not Infinia?"
- Edge cases: adding a card to an existing pool, removing a card, merging pools.

### Option C — No schema change, group at read-time

Keep per-card ledgers, but for reads: sum all cards in a pool (detected by `bank_name` + `credit_limit`) to compute pool figures. Seeding behavior: when user seeds one card, seed all siblings to the same value.

**Pros:** Zero migration.
**Cons:**
- Doesn't fix the fundamental "one pool, N ledgers" mismatch — each card's own closing is still tracked independently. Reset/reconcile flows get harder.
- Opening balance still needs to be entered/seeded in N places or magically mirrored. Both break user mental model.
- Inference remains fragile — any bank-name drift or limit mismatch breaks grouping.

### Option D — Grouping only, keep ledger split (lightweight)

Same as C but add an explicit `pool_group_id` column to `financial_accounts` to avoid bank-name-based inference. Users can explicitly group cards. Ledger stays per-card; UI always aggregates for display.

**Pros:** Modest migration, no data model redesign, user-controlled grouping.
**Cons:** Still has the "N ledgers for one pool" problem. Mathematically the sum-of-card-closings must equal the pool closing, but in practice SMS parsing may give per-card running balances that drift.

### Recommended: Option A

Correctness > ergonomics here. Users will trust pool math only if it's derived from a single source.

## 4. Migration plan (Option A)

### Migration 008 — create `credit_pools` table
```sql
CREATE TABLE credit_pools (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  bank_name TEXT NOT NULL,
  credit_limit REAL NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_credit_pools_user ON credit_pools(user_id);
```

### Migration 009 — add `credit_pool_id` to `financial_accounts` and `account_month_balances`
```sql
ALTER TABLE financial_accounts ADD COLUMN credit_pool_id TEXT NULL REFERENCES credit_pools(id);
ALTER TABLE account_month_balances ADD COLUMN credit_pool_id TEXT NULL;
-- note: account_month_balances.account_id becomes nullable conceptually
-- (one of account_id / credit_pool_id must be set)
```

### Migration 010 — backfill pools from existing data
For each user, group CC accounts by (`bank_name`, `credit_limit`) and create a pool row where the group size ≥ 2. Update `financial_accounts.credit_pool_id` for each card in the group.

Leave pools with a single card as `credit_pool_id = NULL` (standalone cards). User can manually pool them later if needed.

**Ledger rows in `account_month_balances`** stay where they are — we don't collapse per-card rows into pool rows during migration. Instead, the read path is updated to prefer pool-level rows when they exist; on the next user action (seeding, overriding), the pool row is created and per-card rows become stale (but harmless until a later cleanup).

A follow-up migration 011 could consolidate, but keep 008–010 reversible.

## 5. Impact analysis — files / areas affected

Ordered by risk.

### 5.1 Service layer (`services/`)

- **`account-balance.ts`** — every function: `getOrCreateMonthBalance`, `getMonthBalanceSummary`, `getClosingBalance`, `getComputedBalances`, `seedOpeningBalance`, `overrideOpeningBalance`, `adjustOpeningBalance`, `deleteOpeningAdjustment`, `adjustAccountAvailable`, `clearAccountLedger`, `getEarliestMonth`. Each must branch: if account has `credit_pool_id`, key on pool; else key on account.
- **`financial-account.ts`** — `getCcExpenseTotals`, `getAccountSummary`. Need pool-aware variants that aggregate across sibling cards.
- **`account-master.ts`** — payment-mode linking is per-card (unchanged), but account-list UIs need to know pool identity.
- **`expense-crud.ts`** / **`expense-queries.ts`** — expense.account_id stays the physical card (no change). Ledger reads that sum expenses need to filter by `account_id IN (SELECT id FROM financial_accounts WHERE credit_pool_id = ?)`.
- **`expense-forecasts.ts`** — CC repayment forecasts (`forecast_type = 'repayment'`) may need pool-level consideration if the user wants "pool repayment" vs per-card — UX question.
- **`settings/data-cleanup.ts`**, **`backup.ts`** — add `credit_pools` to table list; ensure deletion cascades right.

### 5.2 Screens

- **`app/reconciliation/credit-cards.tsx`** — biggest change. Group header becomes "Pool" (when pooled) or "Card". "Utilized", "Outstanding", "Tracked Spend" all become pool-level. Per-card breakdown becomes "card activity within pool".
- **`app/reconciliation/account-ledger.tsx`** — if opened for a pooled card, shows pool-level ledger not card-level. Or: new `app/reconciliation/pool-ledger.tsx`.
- **`app/settings/account-detail.tsx`** — for pooled cards, opening balance + adjustment UI must operate on the pool, not the card. Add a "Pool" section showing siblings + pool-level controls.
- **`app/settings/account-master.tsx`** — new "Group cards into a pool" action: pick cards → create pool. Also "Unpool" action. Show pool membership on the account list.
- **`app/(tabs)/index.tsx` home** — `CreditCardDashboard` component: display pools as one card (with sibling count badge) rather than stacked per-card.
- **`app/goals/yearly-plan.tsx`** / any plan-page using account lists — ensure CC pool is treated as one entity for display but expenses still filter by individual card.

### 5.3 New UI

- **Pool management sheet/page** — list pools, add/remove cards, rename pool, delete pool (with "unpool cards" confirmation).
- **Onboarding nudge** — after SMS import detects 2+ cards with the same bank, prompt: "Do these share a credit limit?"

### 5.4 Tests

Existing tests cover per-card ledger math. New test coverage needed:
- Pool seeding mirrors to no sibling (pool has single ledger row).
- Expense on sibling card affects pool closing.
- Pool opening adjustment creates one adjustment, not N.
- `clearAccountLedger` on pooled card should probably be "clear pool ledger + warn user siblings are affected".
- Backup/restore round-trips `credit_pools` table + `credit_pool_id` FKs.

## 6. UX questions to resolve before implementation

1. **Auto-detect vs manual grouping?** Default to auto-detect (same bank, same limit) with a prompt, or require explicit user action?
2. **What happens when user edits a sibling card's `credit_limit`?** Should it unpool? Warn? Update the pool?
3. **What happens when a new CC is SMS-detected and the bank already has a pool?** Auto-add to pool? Prompt? Default to standalone?
4. **Per-card "available credit" in the balance dashboard** — does it still show, now filled with the pool's available? Or hidden?
5. **Bill payment flow** — if user pays ₹50k to one card in the pool, does it reduce the pool's outstanding by ₹50k, and we just record which card received the payment for due-date tracking? (I think yes.)
6. **Statement cycle cutoff** — siblings can have different billing cycles. Do we keep per-card cycles but a single pool balance? Yes, this is how banks actually do it — but reconciliation UI needs to show both.
7. **"Utilized this billing cycle" vs "Outstanding now"** — is that a new metric we want, pool-level?

## 7. Rollout

Phased:
1. **Schema + backfill** (migrations 008–010) — safe, reversible, no UI changes.
2. **Read-path rollout** — service layer reads pool ledger when `credit_pool_id` is set; falls back to per-card if pool ledger doesn't exist yet.
3. **Write-path rollout** — seeding + adjustments now write to pool ledger; per-card rows become dormant.
4. **UI rollout** — screen-by-screen, flag-gated if needed.
5. **Cleanup migration 011** — once all users are on the new flow, consolidate dormant per-card ledger rows.

## 8. Estimated scope

~500–800 lines touched across ~12 files. 2–3 focused sessions. Migrations trivial; the complexity is in service layer branching and UI redesign of the credit-cards screen.

## 9. Decision to make next

Before coding, we need your answer on:
- **Approve Option A (dedicated `credit_pools` table)?** Or prefer Option D (lighter, less correct)?
- **Auto-detect from bank+limit on migration, or wait for user to manually pool?** My vote: auto-detect, with a prompt during the first credit-cards screen visit post-upgrade ("We grouped X cards into a pool — looks right?").
- **Answers to the UX questions in section 6.**

Once decisions are in, I'll split this into a proper V13 MASTER_PLAN + TDD and implement phase-by-phase.
