# Integrate Pension Accounts + SMS Account Filter

Add full support for pension account type including home screen card, settings configuration, and account detail page with balance ledger (like savings, not demat). Also add account filter to manual SMS scan.

**Note**: SMS parsing for EPFO passbook balance already exists in `services/sms/bank-patterns.ts` - no changes needed.

## Database Migration
- ✅ Already completed: Added 'pension' to CHECK constraint in `001_consolidated_schema.ts`
- ✅ Already completed: Created migration `047_add_pension_account_type.ts` for existing databases
- ✅ Already completed: Updated migration index

---

## STEP 1: Home Card Preferences Service
**File**: `services/home-card-preferences.ts`

1.1. Add "pension" to `HomeCardId` type union (line 15-28)
   - Add `"pension"` to the type definition

1.2. Add pension entry to `HOME_CARDS` array (after line 104)
   - id: "pension"
   - label: "Pension"
   - description: "EPF/PPF balance across your pension accounts"
   - defaultVisible: true

---

## STEP 2: Pension Summary Card Component
**File**: `components/home/PensionSummaryCard.tsx` (NEW)

2.1. Create new component file with exact structure matching BankBalanceSummary.tsx
   - Imports: memo, View, Text, Pressable from react-native
   - Imports: useRouter from expo-router
   - Imports: Ionicons from @expo/vector-icons
   - Imports: Card from @/components/ui
   - Imports: useColorScheme from @/hooks/use-color-scheme
   - Imports: ac, acAlpha from @/utils/accent
   - Imports: formatAmount from @/utils/format
   - Imports: STATUS_COLORS from @/constants/semantic-colors
   - Imports: FinancialAccount from @/services/financial-account

2.2. Define interface PensionSummaryCardProps
   - accounts: FinancialAccount[]
   - computedBalances: Record<string, number | null>
   - expenseTotals: Record<string, number>

2.3. Implement PensionSummaryCardImpl component
   - Use router, colorScheme hooks
   - Return null if accounts.length === 0
   - Calculate total balance: computedBalances[a.id] ?? a.last_known_balance ?? 0
   - Calculate total spent: expenseTotals[a.id] ?? 0
   - Use Pressable wrapping Card (Android touch bug fix pattern)
   - Navigate to "/reconciliation/pension-accounts" on press
   - Header row: icon (briefcase-outline), title "Pension", account count, chevron
   - Icon styling: w-10 h-10 rounded-full, accent[600] with 0.08 alpha background
   - Icon size: 20, color: ac(accent, colorScheme, 700, 300)
   - Balance row: "Total Balance" label, formatted amount with success color
   - Spent row: "Spent this month" label, formatted amount with error color if > 0
   - Export as memo(PensionSummaryCardImpl)

---

## STEP 3: Home Screen Integration
**File**: `app/(tabs)/index.tsx`

3.1. Import PensionSummaryCard (after line 14)
   - import { PensionSummaryCard } from "@/components/home/PensionSummaryCard";

3.2. Add pension accounts state (after line 96)
   - const [pensionAccounts, setPensionAccounts] = useState<FinancialAccount[]>(preloaded?.pensionAccounts ?? []);

3.3. Filter pension accounts in loadData function (around line 125-130)
   - Filter allAccounts by account_type === "pension"
   - setPensionAccounts(pensionAccounts)

3.4. Add pension card rendering (after line 697)
   - {isHomeCardVisible("pension") && (
       <PensionSummaryCard accounts={pensionAccounts} computedBalances={computedBalanceMap} expenseTotals={ccExpenseTotals} />
     )}

---

## STEP 4: Home Preload Service
**File**: `services/home-preload.ts`

4.1. Add pensionAccounts to HomePreloadData interface (after line 56)
   - pensionAccounts: FinancialAccount[];

4.2. Add pension to allAccounts filter in loadHomeSection (after line 175)
   - pensionAccounts: allAccounts.filter((a) => a.account_type === "pension"),

4.3. Add PensionAccountsPreloadData interface (after line 111)
   - interface PensionAccountsPreloadData
   - summaries: AccountSummaryRow[];
   - adjustmentStats: { total: number; count: number };

4.4. Add pension to Cache interface (after line 124)
   - pensionAccounts: PensionAccountsPreloadData | null;

4.5. Initialize pensionAccounts in cache (after line 132)
   - pensionAccounts: null,

4.6. Add pension to preloadHomeSection (after line 343)
   - loadAccountGroupSection("pension"),

4.7. Add cache assignment (after line 350)
   - cache.pensionAccounts = pensionAccounts;

4.8. Add consume function (after line 386)
   - export function consumePensionAccountsPreload(): PensionAccountsPreloadData | null

---

## STEP 5: Pension Reconciliation Screen
**File**: `app/reconciliation/pension-accounts.tsx` (NEW)

5.1. Create new file matching bank-accounts.tsx structure exactly
   - Imports: useState, useCallback, useMemo from react
   - Imports: View, Text, ScrollView, Pressable from react-native
   - Imports: useRouter from expo-router
   - Imports: Ionicons from @expo/vector-icons
   - Imports: ScreenContainer, Card, PeriodNavigator from @/components/ui
   - Imports: useColorScheme from @/hooks/use-color-scheme
   - Imports: useDataRefresh from @/hooks/use-data-refresh
   - Imports: acAlpha from @/utils/accent
   - Imports: formatAmount from @/utils/format
   - Imports: StatusColors from @/constants/theme
   - Imports: DEFAULT_USER_ID from @/constants/app
   - Imports: getActiveAccounts, getAccountLatestStaleCheckDates from @/services/financial-account
   - Imports: FinancialAccount from @/services/financial-account
   - Imports: getMonthBalanceSummary, getAccountExpensesTotal, getAccountCreditsTotal, getAccountAdjustmentNet, getAdjustmentAbsTotalByAccountType from @/services/account-balance
   - Imports: getCurrentMonth from @/services/budget
   - Imports: consumePensionAccountsPreload from @/services/home-preload
   - Imports: getMonthDateRange from @/utils/budget-helpers

5.2. Define AccountSummary interface (same as bank-accounts)
   - account, opening, expenses, credits, current, seeded, autoDetectedStale

5.3. Implement PensionAccountsScreen component
   - Use router, colorScheme hooks
   - State: summaries, adjustmentStats, month
   - Preload: consumePensionAccountsPreload()
   - useDataRefresh: fetch pension accounts, filter by account_type === "pension"
   - Call getAdjustmentAbsTotalByAccountType with "pension"
   - Calculate totals: totalBalance, totalExpenses, totalCredits
   - Render: ScreenContainer, PeriodNavigator, ScrollView
   - Overall summary card: same styling as bank-accounts
   - Per-account cards: same styling as bank-accounts
   - Account icon: briefcase-outline (pension icon)
   - Navigate to account-ledger on press
   - Empty state: same pattern as bank-accounts

---

## STEP 6: Account Detail Page - Type Picker
**File**: `app/settings/account-detail.tsx`

6.1. Add pension to ACCOUNT_TYPES array (line 388-394)
   - { key: "pension", label: "Pension", icon: "briefcase-outline" }

---

## STEP 7: Account Detail Page - Balance Ledger
**File**: `app/settings/account-detail.tsx`

7.1. Remove pension from balance ledger exclusion (line 174)
   - Change condition from `acct.account_type !== "demat"` to `acct.account_type !== "demat" && acct.account_type !== "pension"`
   - This enables balance ledger for pension accounts

---

## STEP 8: Account Detail Page - Fund Balance Input
**File**: `app/settings/account-detail.tsx`

8.1. Add fund balance state for pension (after line 109)
   - const [fundBalanceValue, setFundBalanceValue] = useState("");

8.2. Load fund balance in loadData for pension (after line 170)
   - if (acct.account_type === "pension") {
       const currentFund = await getCurrentFundBalance(acct.id);
       setFundBalanceValue(String(currentFund));
     }

8.3. Add fund balance input UI for pension (after line 588)
   - {accountType === "pension" && (
       <Card className="mb-3">
         <Text className="text-xs font-semibold text-text-tertiary dark:text-text-dark-secondary uppercase tracking-wider mb-3">
           EPF Passbook Balance
         </Text>
         <Input
           value={fundBalanceValue}
           onChangeText={(v) => { setFundBalanceValue(v); setDirty(true); }}
           keyboardType="numeric"
           placeholder="0"
           onFocus={() => { scrollToEnd logic }}
         />
       </Card>
     )}

8.4. Save fund balance in handleSave for pension (after line 244)
   - else if (accountType === "pension") {
       const fund = parseFloat(fundBalanceValue.replace(/,/g, ""));
       if (!isNaN(fund)) {
         await updateFundBalance(account.id, fund);
       }
     }

---

## STEP 9: Account Detail Page - Linked Payment Modes
**File**: `app/settings/account-detail.tsx`

9.1. Payment modes already work for all account types (no changes needed)
   - The linked payment modes section (lines 340-361) already supports all account types
   - No specific changes required for pension

---

## STEP 10: Account Detail Page - Min Balance Alert
**File**: `app/settings/account-detail.tsx`

10.1. Ensure min-balance alert is NOT shown for pension
    - The condition on line 550 already checks for accountType === "savings"
    - Pension will not show min-balance alert (correct behavior)

---

## STEP 11: Pension Summary Service Function
**File**: `services/financial-account.ts`

11.1. Add getPensionSummary function
    - Input: userId: string
    - Fetch all accounts with account_type === "pension"
    - Calculate total balance: sum of last_known_balance or fund_balance
    - Calculate account count
    - Find last contribution date (max of last_balance_date)
    - Return: { totalBalance, accountCount, lastContributionDate }

---

## STEP 12: SMS Account Filter - Storage Functions
**File**: `services/sms/sms-permissions.ts`

12.1. Add storage key constants
    - const KEY_SMS_SCAN_ACCOUNT_IDS = "sms_scan_account_ids";

12.2. Add getSmsScanAccountIds function
    - Read from MMKV settings
    - Parse JSON string to array of strings
    - Return string[] or empty array if not set

12.3. Add setSmsScanAccountIds function
    - Accept accountIds: string[]
    - JSON.stringify and store in MMKV settings

12.4. Export both functions

---

## STEP 13: SMS Account Filter - UI in Settings
**File**: `app/(tabs)/settings.tsx`

13.1. Add state for account filter (after line 117)
    - const [smsScanAccountIds, setSmsScanAccountIds] = useState<string[]>([]);

13.2. Load account filter on focus (after line 145)
    - setSmsScanAccountIds(getSmsScanAccountIds() ?? []);

13.3. Add account filter UI in SMS scan section
    - Add "Filter by Accounts" row in SMS scan card
    - On press, show AccountPickerSheet with multi-select
    - Display selected account count
    - Allow clearing filter (select all = no filter)

13.4. Pass accountIds to handleManualScan (after line 203)
    - await runSmsScan({ manual: true, accountIds: smsScanAccountIds });

---

## STEP 14: SMS Reader - Account Filtering
**File**: `services/sms/sms-reader.ts`

14.1. Update manualScan function signature (line 160)
    - Accept optional parameter: accountIds?: string[]

14.2. Filter SMS by account IDs (after line 163)
    - If accountIds provided, filter parsed SMS by matching account_identifier
    - Only process SMS for selected accounts
    - If no accountIds, process all SMS (current behavior)

---

## STEP 15: SMS Orchestrator - Account Filter Parameter
**File**: `services/sms/sms-orchestrator.ts`

15.1. Update ScanOutcome interface (line 30)
    - No changes needed

15.2. Update runSmsScan signature (line 53)
    - Accept options: { manual?: boolean; notify?: boolean; accountIds?: string[] }

15.3. Pass accountIds to manualReadSms (line 75)
    - const readResult = manual ? await manualReadSms(accountIds) : await checkForNewBankSMS();

15.4. Update manualReadSms import signature to accept accountIds

---

## STEP 16: Reconciliation Layout - Add Pension Route
**File**: `app/reconciliation/_layout.tsx`

16.1. Add pension-accounts screen to Stack (if needed)
    - Check if dynamic routing is used (likely not needed if using file-based routing)

---

## Files to Modify
1. `services/home-card-preferences.ts` - Add pension to HomeCardId and HOME_CARDS
2. `components/home/PensionSummaryCard.tsx` - Create new component (exact BankBalanceSummary pattern)
3. `app/(tabs)/index.tsx` - Import and render PensionSummaryCard, add pension state
4. `services/home-preload.ts` - Add pension to HomePreloadData, load section, cache, consume function
5. `app/reconciliation/pension-accounts.tsx` - Create new screen (exact bank-accounts pattern)
6. `app/settings/account-detail.tsx` - Add pension to ACCOUNT_TYPES, enable balance ledger, add fund balance input
7. `services/financial-account.ts` - Add getPensionSummary function
8. `services/sms/sms-permissions.ts` - Add getSmsScanAccountIds, setSmsScanAccountIds
9. `app/(tabs)/settings.tsx` - Add account filter UI for manual SMS scan
10. `services/sms/sms-reader.ts` - Update manualScan to accept accountIds parameter
11. `services/sms/sms-orchestrator.ts` - Update runSmsScan to accept and pass accountIds

---

## UI Design Consistency Checklist
- **Icon**: briefcase-outline (already defined in ACCOUNT_TYPE_ICONS)
- **Color**: #6366F1 (already defined in ACCOUNT_TYPE_COLORS)
- **Font sizes**: text-xs, text-sm, text-base (matching existing patterns)
- **Spacing**: mx-4, mt-2, mb-3 (matching existing patterns)
- **Card styling**: Card className with standard padding
- **Pressable wrapping**: Pressable wraps Card (Android touch bug fix)
- **Color scheme**: useColorScheme hook for dark/light mode
- **Accent colors**: ac, acAlpha utilities for accent-based styling
- **Status colors**: STATUS_COLORS for semantic coloring
- **Format utilities**: formatAmount for consistent number formatting

---

## Implementation Notes & Risks
- **Account ledger system**: account-ledger.tsx already works for any account type (just needs accountId). No changes needed to ledger.
- **Balance ledger**: Line 174 in account-detail.tsx excludes demat from balance ledger. Pension should NOT be excluded to get same ledger treatment as savings.
- **Linked payment modes**: Already work for all account types in account-detail.tsx. No special handling needed for pension.
- **Fund balance**: Similar to demat, pension needs fund balance input for EPF passbook balance from SMS.
- **SMS parsing**: EPFO passbook balance pattern already exists in bank-patterns.ts (lines 965-1001). Sets accountType to "pension" automatically.
- **Reconciliation pattern**: Follow same pattern as savings: Home card → List screen → Account ledger.
- **Preloading**: Must add pension to preload system to avoid extra DB queries on navigation.
- **Empty states**: Must handle zero pension accounts gracefully with empty state UI.
