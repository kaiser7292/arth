# Merge Staging to Master and Release v18

This plan provides a comprehensive approach to merge staging to master, update help documentation with transfer reclassification information, bump the version to v18, and create a full release with an APK build for Pixel 9 and Samsung S8 (ARM 64 v8).

## Current State Analysis

- **artha repository**: Currently on master branch with only one commit (the transfer reclassification fixes from staging)
- **artha-builds repository**: Currently on staging branch with transfer reclassification fixes synced
- **Last release**: No tags/releases exist in the current repository (freshly initialized)
- **Transfer reclassification feature**: Changes in account-transfer.ts and expenses.tsx that allow converting expenses/credits to transfers without deleting them

## Detailed Steps

### 1. Create Help Documentation for Transfer Reclassification

**File to create**: `C:\Users\soura\CascadeProjects\artha\assets\docs\articles\transfers.md`

**Content structure** (following the format of refunds.md):
```markdown
---
title: Recording transfers between accounts
slug: transfers
summary: Move money between your accounts. Transfers don't count as spending and don't affect your budget.
tags: [transfers, account-transfer, money-movement, between-accounts]
contextKeys: [transactions, account-detail]
phrasings:
  - How do I record a transfer?
  - Money moved from savings to credit card
  - Transfer between accounts
  - Does a transfer count as spending?
  - Where do transfers show up?
  - Convert an expense to a transfer
  - Convert a credit to a transfer
  - Undo a transfer
---

A transfer is money moving between your accounts — from savings to credit card, from wallet to bank, or any other movement. Transfers don't count as spending and don't affect your budget.

## Why this matters

Transfers are different from expenses:
- **Not spending** — money you already own, just moving it around
- **No budget impact** — doesn't reduce your budget caps
- **Shows separately** — filtered out from spending insights
- **Ledger math** — appears in both account ledgers, balances net out correctly

## Record a transfer

1. Open the **Transfers** tab (bottom navigation).
2. Tap the **+** button.
3. Select the **source account** (where money is coming from).
4. Select the **destination account** (where money is going).
5. Enter the **amount**.
6. Enter the **date** (defaults to today).
7. Add a **description** (optional, e.g., "Credit card payment").
8. Tap **Save**.

The transfer appears in both account ledgers and is filtered in the Transfers nature filter.

## Convert an existing expense to a transfer

If you logged an expense that was actually a transfer (e.g., a credit card payment that you recorded as an expense):

1. Open the **expense** (Transactions tab → tap it).
2. Tap the **Convert to Transfer** action.
3. Select the **destination account** (where the money went).
4. Tap **Confirm**.

The expense is marked as reclassified and a transfer is created. The original expense stays visible but is filtered out from spending views.

## Convert a credit to a transfer

If you received a credit that was actually a transfer (e.g., money moved from one account to another):

1. Open the **credit** (Transactions tab → tap it).
2. Tap the **Convert to Transfer** action.
3. Select the **destination account** (where the money went).
4. Tap **Confirm**.

The credit is marked as reclassified and a transfer is created.

## Undo a transfer

If you converted an expense or credit to a transfer by mistake:

1. Open the **transfer** (Transfers tab → tap it).
2. Tap the **Undo** action.
3. Tap **Confirm**.

The transfer is deleted and the original expense/credit is restored (no longer marked as reclassified).

## Where transfers show up

- **Transfers tab** — all transfers listed by date, separate from spending
- **Account ledgers** — appears as debit in source account, credit in destination account
- **Budget / Insights** — excluded from spending totals
- **Transactions tab** — filtered when "Transfers" nature is selected

## Common situations

**I paid my credit card from savings.** Record a transfer: source = savings, destination = credit card, amount = payment amount.

**I logged a credit card payment as an expense by mistake.** Open the expense → Convert to Transfer → destination = credit card → Confirm. The expense is marked as reclassified and a transfer is created.

**I need to move money between my wallets.** Record a transfer: source = wallet 1, destination = wallet 2.

**I want to see all my money movements.** Use the Transfers tab or filter Transactions by "Transfers" nature.

## Related

- [Setting up your accounts](accounts)
- [Reconciling a ledger](reconciliation)
- [Recording refunds](refunds)
```

**Update docs index**:
- Run `node scripts/build-docs-index.mjs` to regenerate the docs index JSON
- This will add the new transfers article to the search index and help center
- Add "transfers" to the "Track day-to-day" group in services/docs/index.ts

### 2. Update Docs Service

**File to modify**: `C:\Users\soura\CascadeProjects\artha\services\docs\index.ts`

**Change**: Add "transfers" to the "Track day-to-day" group in DOMAIN_GROUPS array:
```typescript
{
  label: "Track day-to-day",
  slugs: [
    "accounts",
    "categories",
    "tags",
    "reconciliation",
    "refunds",
    "transfers",  // Add this line
    "hisaab",
    "review-queue",
  ],
},
```

### 3. Merge Staging to Master (artha)

**Repository**: C:\Users\soura\CascadeProjects\artha
- Checkout master branch: `git checkout master`
- Merge staging: `git merge staging`
- Push to origin: `git push origin master`

### 4. Merge Staging to Master (artha-builds)

**Repository**: C:\Users\soura\artha-builds
- Checkout master branch: `git checkout master`
- Merge staging: `git merge staging`
- Push to origin: `git push origin master`

### 5. Bump Version to v18

**Files to modify**:
- `C:\Users\soura\CascadeProjects\artha\package.json` - update "version" field
- `C:\Users\soura\CascadeProjects\artha\app.json` - update "version" field
- `C:\Users\soura\CascadeProjects\artha-builds\package.json` - update "version" field
- `C:\Users\soura\CascadeProjects\artha-builds\app.json` - update "version" field

**Current version**: Likely v17.x.x
**New version**: v18.0.0

### 6. Write Release Notes

**Content**: Functional release notes focusing on user-facing changes

**Draft**:
```
Version 18.0.0

New Features:
- Transfer Reclassification: Convert expenses or credits to transfers without losing the original record. This keeps your data clean while allowing you to correct mistakes.
- Improved Transfers Tab: Now shows all transfers between accounts, including those converted from expenses or credits.

Improvements:
- Better data handling for account transfers
- Enhanced transfer visibility in the ledger
- Improved undo functionality for transfers

Bug Fixes:
- Fixed issues with transfer reclassification on devices that haven't run the latest database migration
- Improved error handling for transfer operations
```

### 7. Create GitHub Release v18

**Steps**:
1. Create a new release on GitHub for artha repository
2. Tag: v18.0.0
3. Title: Version 18.0.0
4. Description: Paste the release notes
5. Attach APK (after building)

### 8. Build APK for ARM 64 v8

**Command**: `build-apk.bat` (modify if needed for ARM 64 v8 specific build)
- The build script should target arm64-v8a architecture
- Test on Pixel 9 and Samsung S8 if possible
- Output: artha-v18.0.0-arm64-v8a.apk

### 9. Attach APK to GitHub Release

**Steps**:
1. Upload the APK file to the GitHub release
2. Add release notes about device compatibility
3. Mark as pre-release if needed for testing

## Order of Execution

1. Create help doc (transfers.md)
2. Update docs service (add transfers to group)
3. Run build-docs-index.mjs
4. Commit help doc changes
5. Merge staging to master (artha)
6. Merge staging to master (artha-builds)
7. Bump version to v18 (both repos)
8. Commit version changes
9. Push to master (both repos)
10. Write release notes
11. Build APK
12. Create GitHub release
13. Attach APK to release
