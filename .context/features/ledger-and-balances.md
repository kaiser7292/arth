# Reconciliation / Account Ledger / Balance Chain

[← back to Feature Map](../FEATURE_MAP.md)

## In plain English

Every account (bank, credit card, wallet, demat, pension, loan) has a running balance per month. Think of it like a chain: each month's **opening balance** = last month's **closing balance**. The app builds this chain forward from whenever you first told it a starting balance ("seeded" the account).

The closing balance formula depends on account type:
- **Savings / wallet / pension / loan**: closing = opening − what you spent + what you got credited − transfers out + transfers in ± manual adjustments. (Spending *reduces* the balance, like a real bank account.)
- **Credit card**: closing = opening + what you spent − what you got credited (refunds) + transfers out (bill payments leaving this "pool") − transfers in ± adjustments. (Spending *increases* what you owe — opposite sign from a savings account, because a credit card balance represents debt, not cash. It resets to 0 at the start of each billing cycle.)

If you haven't told the app a starting balance for an account yet ("unseeded"), it instead walks forward from the very first transaction it can find for that account, assuming the balance started at zero.

**Adding a credit or transfer manually:** if you're viewing a past month and tap "Add Credit"/"Add Transfer" from the floating button, the date defaults to the 1st of *that* month — not today. (If you're viewing the current month, it defaults to today.) This is deliberate: it stops a credit from silently landing in the wrong month.

## The #1 symptom: balance is right, transaction list is empty

This is a crash, not a data problem. The account-ledger screen sets the balance numbers *first*, then loads the transaction rows in a second step. If anything throws an error in that second step — most often a database query asking for a column that doesn't exist on that particular table — the balance you already see stays on screen, but the transaction list never gets filled in. It looks like "data went missing" but no data was actually lost.

When this happens, tell Claude: which account, which month, what type of account (savings/CC/wallet/demat/pension). That narrows down which of the three queries (transactions, credits, or transfers) is the one throwing.

## Technical

**Files:**
- `app/reconciliation/account-ledger.tsx` — the screen; the `useDataRefresh` load callback here is the single most error-prone spot in the app. Order: fetch accounts → determine seeded/unseeded → set header balance numbers → run 3 parallel queries (expenses+adjustments, credits, transfers) → resolve account/person name lookups → merge into one list → sort → display.
- `services/account-balance.ts` — `isAccountSeeded`, `getMonthBalanceSummary` (seeded path, includes self-heal re-anchoring to previous month's actual closing if not manually overridden), `computeUnseededBalance` (unseeded path, chains from earliest activity at opening=0), `getOrCreateMonthBalance` (intentionally **not recursive** — see Don'ts below).
- `services/account-credit.ts`, `services/account-transfer.ts` — credits and transfers.
- `services/financial-account.ts` — account CRUD, SMS account linking.

**Tables:** `financial_accounts`, `account_month_balances` (opening balance anchor per account+month, UNIQUE constraint), `expenses` (nature = `realized`/`credit`/`ledger_adjustment`/`forecast`), `account_transfers`.

**Don't:**
- Make `getOrCreateMonthBalance` recursive — a past attempt hit UNIQUE constraint errors that broke "no transactions show" across *all* accounts, not just one.
- Seed `account_month_balances` from `addCredit` — same root cause, surprise inserts collide with the chain.
- Add `minMonth`/`maxMonth` bounds to the ledger's PeriodNavigator — several reconciliation screens are intentionally unbounded for free navigation.
- Assume a column on `expenses` exists just because the same-named column exists on `account_transfers` — they're sibling tables added by different migrations.
