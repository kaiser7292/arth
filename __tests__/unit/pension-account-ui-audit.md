# Pension Account UI Audit

Audit performed to verify pension account implementation follows the same patterns as savings accounts.

## Hero Card Pattern Comparison

### BankBalanceSummary (Savings)
- Props: accounts, computedBalances, expenseTotals
- Icon: wallet-outline
- Title: "Bank Accounts"
- Route: /reconciliation/bank-accounts
- Structure: Pressable wrapping Card
- Header: icon + title + account count + chevron
- Data: Total Balance + Spent this month

### PensionSummaryCard (Pension)
- Props: accounts, computedBalances, expenseTotals ✅
- Icon: briefcase-outline ✅
- Title: "Pension" ✅
- Route: /reconciliation/pension-accounts ✅
- Structure: Pressable wrapping Card ✅
- Header: icon + title + account count + chevron ✅
- Data: Total Balance + Spent this month ✅

**Status**: Pattern consistent ✅

## Reconciliation Screen Pattern Comparison

### bank-accounts.tsx (Savings)
- Uses consumeBankAccountsPreload() ✅
- Filters by account_type === "savings" ✅
- AccountSummary interface ✅
- getMonthBalanceSummary for seeded accounts ✅
- Fallback to getAccountExpensesTotal/CreditsTotal for unseeded ✅
- Icon: wallet-outline
- Overall summary card with totals ✅
- Per-account cards with balance breakdown ✅

### pension-accounts.tsx (Pension)
- **Missing**: consumePensionAccountsPreload() ❌
- Filters by account_type === "pension" ✅
- AccountSummary interface ✅
- getMonthBalanceSummary for seeded accounts ✅
- Fallback to getAccountExpensesTotal/CreditsTotal for unseeded ✅
- Icon: briefcase-outline ✅
- Overall summary card with totals ✅
- Per-account cards with balance breakdown ✅

**Status**: Pattern mostly consistent, missing preload function ❌

## Issues Found

1. **Missing Preload Function**: pension-accounts reconciliation screen doesn't have a preload function like bank-accounts, wallets, and credit-cards. This means the screen will load data on mount instead of using preloaded data from app startup.

## Recommendations

1. Add consumePensionAccountsPreload() to home-preload.ts
2. Add PensionAccountsPreloadData interface
3. Add pensionAccounts to Cache interface
4. Add loadPensionAccountsSection() function
5. Add pension to preloadHomeData() parallel calls
6. Add consumePensionAccountsPreload() export function
7. Update pension-accounts.tsx to use consumePensionAccountsPreload()

## Account Detail Pattern Comparison

### account-detail.tsx
- ACCOUNT_TYPES includes "pension" ✅
- ACCOUNT_TYPE_ICONS includes "pension" ✅
- Fund balance input enabled for pension ✅
- Balance ledger enabled for pension ✅

**Status**: Pattern consistent ✅
