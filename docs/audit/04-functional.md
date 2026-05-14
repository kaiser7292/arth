# Functional Audit

## Quick Wins (Low Effort, High Impact)

### 🔴 CRITICAL — `migration042` ignores the passed `db` parameter
**File:** `database/migrations/042_simulator_transfers.ts`  
**Issue:** The `up()` function signature matches the `Migration` interface (`up: (db: SQLiteDatabase) => Promise<void>`) but internally calls `getDatabase()` instead of using the passed `db`. During migration, the passed `db` is the live connection with WAL + FK settings already configured. `getDatabase()` returns the same instance in production, but in tests the passed mock is bypassed entirely — meaning migration 042 is **never actually tested**.  
**User / UX Impact:** No impact in normal production use today (both paths reach the same DB). The risk is on app upgrade: if a future change causes `getDatabase()` to return a different or uninitialized instance during the migration phase, the `ALTER TABLE` would run on the wrong connection and silently fail — leaving users' `simulation_entries` without the `from_account_id`/`to_account_id` columns. The Simulator screen would then crash or show malformed transfer entries with no helpful error message.  
**Fix:** Replace `getDatabase()` with the `db` parameter. Remove the unused `down()` method.

---

### 🟡 HIGH — `sendDailySummaryNotification` does a raw DB query inside a service (bypasses service layer)
**File:** `services/notification-scheduler.ts` lines 104–113  
**Issue:** The function does `import("@/database")` and runs a raw SQL query for yesterday's spending. This bypasses the `expense-queries` service layer, duplicates query logic, and means this query is not testable via the mock DB pattern used elsewhere.  
**User / UX Impact:** If the `expenses` table schema changes (column rename, status value change), this raw query will break silently and the daily 8:30 AM notification will either show “Yesterday: ₹0 spent in 0 transactions” every day (wrong) or throw an unhandled exception that suppresses the notification entirely. The user’s morning summary stops arriving with no explanation.  
**Fix:** Extract to a `getYesterdaySpendingSummary(userId, date)` function in `services/expense-queries.ts`.

---

### 🟡 HIGH — `checkAndNotifyLoanEMIs` queries for "overdue EMIs" using `due_date <= yesterday`
**File:** `services/notification-scheduler.ts` lines 524–537  
**Issue:** The overdue query uses `se.due_date <= yesterday` but Layer 1 already schedules per-EMI notifications. This means on every app open (past the 6h cooldown), the user could receive duplicate overdue-EMI push notifications — one from the scheduled Layer 1 system notification AND one from the Layer 2 app-open check.  
**User / UX Impact:** A user with an overdue home loan EMI who opens the app twice in a day (once morning, once evening) receives 2–3 identical "EMI overdue: HDFC Bank" notifications for the same entry within hours. This is noisy and erodes trust in notifications — users start dismissing or disabling all Artha notifications to stop the spam, losing visibility of genuinely important upcoming dues.  
**Fix:** Add a `notified_at` timestamp or a check against `last_sms_reminder_at` on `loan_accounts` to prevent re-notifying for the same EMI within a 24h window.

---

### 🟡 HIGH — `runDailyNotificationCheck` fires monthly summary on day 1 even if already sent
**File:** `services/notification-scheduler.ts` lines 653–655  
```ts
if (new Date().getDate() === 1) {
  sendMonthlySummaryNow(userId).catch(...);
}
```
**Issue:** If the app is opened multiple times on the 1st of the month, the monthly summary fires multiple times (the 6h cooldown applies to the overall check, but once past the cooldown the date === 1 condition will re-fire).  
**User / UX Impact:** On the 1st of each month, a user who checks Artha in the morning and again in the evening receives the same "May: ₹42,500 spent" monthly summary notification 2–3 times. Duplicate notifications for the same summary are confusing (the user wonders if their spending changed) and create notification fatigue. Users who see duplicates repeatedly tend to turn off the monthly summary entirely.  
**Fix:** Store a `notif_monthly_summary_last_sent_month` key in MMKV and only send if the current month differs from the stored value.

---

### 🟡 MEDIUM — Biometric lock deep-link allows navigation before lock fires
**File:** `app/_layout.tsx` lines 264–274  
**Issue:** The notification deep-link handler (`addNotificationResponseReceivedListener`) fires immediately on app open — before the lock `evaluateLock()` runs (which requires `dbReady && minSplashDone`). A user who taps a notification while the lock is active could navigate directly to a target screen, bypassing the lock screen.  
**User / UX Impact:** If a user has biometric lock enabled and someone taps an incoming notification on the locked screen (e.g. "EMI due tomorrow: HDFC ₹22,717"), they are taken directly to the Loans screen showing full EMI schedule, outstanding balance, and payment history — without ever seeing the biometric prompt. The lock is completely bypassed via the notification tap path. This is a real-world attack vector on any shared or briefly-unattended device.  
**Fix:** Check `shouldShowLock()` inside the notification response handler and redirect to lock screen if true, saving the intended target screen to navigate to after unlock.

---

### 🟡 MEDIUM — `cleanupLegacyScheduledScan` cancels ALL scheduled notifications
**File:** `app/_layout.tsx` lines 136–139  
```ts
await Notifications.cancelAllScheduledNotificationsAsync();
```
**Issue:** This is called unconditionally on every startup. If Layer 1 scheduled EMI/reminder/daily notifications were set before this line runs, they get cancelled and then re-scheduled. There's a brief window where no notifications are scheduled. The comment says "v11.1.3 and earlier" but there's no guard to skip once the legacy cleanup is confirmed done.  
**User / UX Impact:** Every time the app starts, all 8:30 AM daily alarms, monthly summary alarms, and per-EMI date alarms are wiped and recreated. On devices with MIUI/ColorOS battery optimization that limits notification rescheduling frequency, repeated cancels + reschedules can cause the OS to rate-limit Artha's notifications. Users on these devices report notifications "randomly stopping" after a few days of active app use — this is likely why.  
**Fix:** Gate behind an MMKV flag (see Performance audit item).

---

### 🟡 MEDIUM — `bumpDataVersion` is synchronous but called after async operations
**File:** `services/settings.ts` line 92–94  
**Issue:** `bumpDataVersion()` is a synchronous MMKV write. All screens subscribed via `subscribeDataVersion` will re-render **before** all the downstream async effects of the mutation are complete (e.g., duplicate scan, preload re-run). This can briefly show stale counts on the Home screen.  
**User / UX Impact:** After adding or editing an expense, the Home screen instantly re-renders via the `dataVersion` subscription. But the preload data hasn't refreshed yet, so the user briefly sees the old "Total spent this month" amount and the old transaction count for ~200–500ms before it updates to the correct value. On slower devices this flash of stale data is long enough to notice — the counter visibly jumps from the old value to the new one a moment after the expense is saved.  
**Fix:** Consider adding a small debounce (50–100ms) or using a `useTransition` pattern on the React side to defer non-critical refreshes.

---

### 🟡 MEDIUM — `getOnboardingCompletedVersion()` check happens after DB ready but doesn't await migration
**File:** `app/_layout.tsx` lines 285–291  
**Issue:** The onboarding redirect fires after `dbReady`, but `migrateExistingUser()` runs in the parallel `Promise.all` before this point. If `migrateExistingUser` fails (caught as non-fatal), the user sees the onboarding wizard even though they're an existing user. The failure is logged but swallowed.  
**User / UX Impact:** An existing user who upgrades from a pre-v15 build and encounters a transient `migrateExistingUser()` failure (e.g. a locked DB during migration) is shown the full onboarding wizard from scratch — "Welcome to Artha, let's get you set up". All their existing data is still there, but they are sent through account setup steps they already completed. Completing the wizard a second time stamps a new "pre-existing" sentinel correctly, but the experience is jarring and can cause users to think their data was lost.  
**Fix:** Track the migration result explicitly and warn the user (or skip the redirect) if it failed rather than silently sending them to onboarding.

---

### 🟢 LOW — `ALLOWED_SCREENS` constant re-assigned from import in every render
**File:** `app/_layout.tsx` line 263  
```ts
const ALLOWED_SCREENS = ALLOWED_DEEP_LINK_SCREENS;
```
**Issue:** This creates a new `const` on every render. While it's an import reference (not a new object), the assignment is redundant — `ALLOWED_DEEP_LINK_SCREENS` can be used directly.  
**User / UX Impact:** None. This is a developer-readability issue only. No runtime behavior difference.  
**Fix:** Remove the intermediate `ALLOWED_SCREENS` assignment and use `ALLOWED_DEEP_LINK_SCREENS` directly in line 268.

---

### 🟢 LOW — Feature flags named `v15_*` for v17 features
**File:** `services/feature-flags.ts` lines 40–43  
**Issue:** `v17_expense_investment_link` and `v17_loans_v1` are correctly named, but the function signature is `getFlag(name: V15FlagName)` — the type is frozen at `V15FlagName`. This works but is confusing and will need renaming as the flag surface grows.  
**User / UX Impact:** None directly. Indirectly: if a developer accidentally passes a newly-added v18/v19 flag name to `getFlag()` and TypeScript rejects it due to the stale type, the developer may resort to a type cast or workaround that bypasses the type safety — increasing the chance of a typo silently disabling or enabling a feature for all users.  
**Fix:** Rename the type `V15FlagName` to `FeatureFlagName` (or `AppFlagName`) to match the actual scope.

---

## Summary Table

| Severity | Issue | File | Effort |
|----------|-------|------|--------|
| 🔴 Critical | Migration 042 ignores db param | 042_simulator_transfers.ts | 10 min |
| 🟡 High | Raw DB query in notification service | notification-scheduler.ts | 30 min |
| 🟡 High | Duplicate EMI overdue notifications | notification-scheduler.ts | 20 min |
| 🟡 High | Monthly summary re-fires on day 1 | notification-scheduler.ts | 15 min |
| 🟡 Medium | Deep-link bypasses biometric lock | app/_layout.tsx | 30 min |
| 🟡 Medium | cleanupLegacy cancels all notifs on every start | app/_layout.tsx | 15 min |
| 🟡 Medium | bumpDataVersion fires before async is settled | settings.ts | 1h |
| 🟡 Medium | Onboarding redirect ignores migration failure | app/_layout.tsx | 20 min |
| 🟢 Low | ALLOWED_SCREENS redundant assignment | app/_layout.tsx | 2 min |
| 🟢 Low | V15FlagName type name stale | feature-flags.ts | 5 min |
