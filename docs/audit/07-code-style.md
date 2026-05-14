# Code Style & Documentation Audit

## Quick Wins (Low Effort, High Impact)

### 🟡 HIGH — Production `logger` is a complete no-op (errors silently swallowed)
**File:** `utils/logger.ts`  
**Issue:** In production builds, `logger.error`, `logger.warn`, etc. are all silent no-ops. This means any unhandled exception caught by the `ErrorBoundary` or the various `.catch((e) => logger.warn(...))` fire-and-forgets are **completely invisible** to you after release. There is no crash reporting, no remote logging, and no way to diagnose production issues.  
**User / UX Impact:** When a user reports "the app showed an error" or "that screen isn’t loading", there is zero diagnostic information available — no stack trace, no context, no frequency data. Every production bug investigation starts blind. Non-fatal errors (e.g. a failed SMS parse, a notification that didn’t schedule, a balance sync that returned null) silently degrade the user experience with no mechanism for you to ever know they occurred. The user experiences broken features; you see no signal.  
**Fix:** Integrate a lightweight crash reporter. At minimum: override `logger.error` in production to write to a local SQLite `app_logs` table (last 100 entries) that can be exported via Settings → Help → Send Logs. Long-term: integrate `expo-application` + a remote sink (Sentry, Bugsnag, or a simple POST endpoint).

---

### 🟡 HIGH — `services/index.ts` re-exports (barrel file) — check for dead exports
**File:** `services/index.ts`  
**Issue:** Barrel files accumulate dead exports as features are removed. After removing the notification collector, the barrel may still export removed symbols. Unused exports add to bundle size.  
**User / UX Impact:** Dead exports that still reference removed modules will cause Metro bundler to include dead code in the JS bundle, slightly increasing app size and startup time. More critically: if a dead export references a module that was deleted (not just modified), the app will fail to bundle entirely — a CI build failure that blocks releasing fixes to users.  
**Fix:** Audit `services/index.ts` against all current `services/*.ts` files and remove any exports that no longer resolve.

---

### 🟡 MEDIUM — `any` used heavily across 38 service files
**Files:** Multiple (top offenders: `balance-source.ts` ×10, `onboarding.ts` ×6, `financial-account.ts` ×6, `loan-accounts.ts` ×6)  
**Issue:** Wide use of `any` disables TypeScript's type-safety in the most complex business logic layers (balance calculation, loan engine, account management). Silent type errors in these paths can cause runtime crashes or wrong financial calculations.  
**User / UX Impact:** In `loan-accounts.ts` and `balance-source.ts`, `any` on DB row results means a column rename or type change in a migration silently passes TypeScript but crashes at runtime when the code tries to access the renamed field. The user sees the Loans screen or Balance Sheet show blank values, NaN balances, or a JS crash — directly impacting their ability to track their most sensitive financial data. These bugs are also the hardest to diagnose without crash reporting (see logger issue).  
**Fix:** Progressively replace `any` with specific types, starting with `loan-accounts.ts` and `financial-account.ts` (highest data sensitivity). Use `unknown` with type guards as an intermediate step.

---

### 🟡 MEDIUM — `V15FlagName` type is stale (covers v17 flags)
**File:** `services/feature-flags.ts` line 46  
**Issue:** `V15FlagName = keyof typeof V15_FLAGS` includes `v17_expense_investment_link` and `v17_loans_v1`. The type name implies v15 scope but it covers all versions. `getFlag(name: V15FlagName)` is misleading.  
**User / UX Impact:** None directly visible. Indirectly: a developer trying to add a new v18 feature flag may look at the stale `V15FlagName` type and incorrectly conclude there’s a separate flag system for v17+ features, leading to a duplicate flag mechanism or a flag that is added but never checked correctly — a feature that appears enabled in Settings but silently does nothing.  
**Fix:** Rename to `FeatureFlagName` or `AppFlagName`.

---

### 🟡 MEDIUM — `backup.ts` uses `eslint-disable @typescript-eslint/no-var-requires`
**File:** `services/backup.ts` line 43  
```ts
// eslint-disable-next-line @typescript-eslint/no-var-requires
const APP_VERSION: string = require("../app.json").expo.version;
```
**Issue:** `require()` in a TypeScript file is a code smell. `app.json` can be imported with `import appConfig from "../app.json"` and the version accessed as `appConfig.expo.version` with proper typing.  
**User / UX Impact:** No direct runtime impact. Risk: if `app.json` is restructured (e.g. `expo.version` moves to a different key), TypeScript won’t catch the broken path at compile time because `require()` returns `any`. The backup file would then write version `undefined` into the header, and the backup version display in Settings would show "undefined" — confusing to users reviewing their backup history.  
**Fix:** Replace with a typed `import`.

---

### 🟡 MEDIUM — `_AesAlgorithmGCM` type exported only to suppress lint
**File:** `services/backup.ts` line 189  
```ts
export type _AesAlgorithmGCM = AesAlgorithmGCM;
```
**Issue:** This is a workaround for a lint rule ("unused type"). The underscore prefix signals "private/internal" but the type is exported. The real fix is to use `// eslint-disable-next-line` or re-examine whether the type alias is needed at all.  
**User / UX Impact:** None directly. This pollutes the public API of `backup.ts` with an internal type that external code could accidentally import and depend on. If the underlying `AesAlgorithmGCM` type changes in the `expo-crypto` library, any code importing `_AesAlgorithmGCM` would silently receive the wrong type without a direct import chain warning.  
**Fix:** Add `// eslint-disable-next-line @typescript-eslint/no-unused-vars` above the original `AesAlgorithmGCM` definition instead of exporting a dummy alias.

---

### 🟡 MEDIUM — Migration 042 has a `down()` method no other migration implements
**File:** `database/migrations/042_simulator_transfers.ts` lines 17–23  
**Issue:** The `Migration` interface only declares `up`. The `down()` function is not called anywhere and creates an illusion of reversibility that doesn't exist in the migration runner.  
**User / UX Impact:** None directly — `down()` is never called in production. Indirectly: a developer reading the migration may believe the schema change is safely reversible and attempt to build a rollback path based on `down()`, not realizing the migration runner never calls it. This false confidence could lead to a "rollback" feature being built that doesn’t actually execute, giving users false assurance that a schema downgrade worked when it didn’t.  
**Fix:** Remove `down()` from migration 042 to match the rest.

---

### 🟡 MEDIUM — `notification-scheduler.ts` has raw SQL queries inline (bypasses service layer)
**File:** `services/notification-scheduler.ts` multiple locations  
**Issue:** Raw `db.getAllAsync<{...}>` SQL queries are scattered throughout `notification-scheduler.ts`. This duplicates query logic that belongs in `expense-queries.ts` and `loan-accounts.ts` service files, and makes the scheduler hard to test in isolation.  
**User / UX Impact:** When expense or loan schema changes are made, they must be updated in two places: the service layer AND the inline SQL in the scheduler. Missing an update in the scheduler means daily summary notifications show wrong amounts (₹0 or stale data), overdue EMI alerts fire for already-paid loans, or upcoming reminders reference old column values. The user receives confidently-worded but incorrect notifications — e.g. "EMI overdue: ₹22,717" for a loan that was closed last month.  
**Fix:** Extract each raw query to a typed function in its respective service file.

---

### 🟢 LOW — `sanitizeFilename` in `backup.ts` strips `.` globally (removes all dots)
**File:** `services/backup.ts` line 56  
```ts
return name.replace(/[/\\.0]/g, "").replace(/\.\./g, "");
```
**Issue:** The regex strips ALL dots from the filename. This is overly aggressive — only `..` (path traversal) and leading dots need to be removed. The function is only called with a timestamp string so it's harmless in practice, but the implementation is misleading.  
**User / UX Impact:** Currently harmless since the function is called with timestamp strings (no dots in input). If the function is ever reused for user-supplied filenames (e.g. a custom backup name feature), all dots would be stripped — a file named "my.backup.2026" becomes "mybackup2026", which is unexpected. Users would get confusingly-named backup files with no extension distinction.  
**Fix:** Change regex to only strip path-traversal sequences: `name.replace(/\.{2,}/g, "").replace(/[/\\\0]/g, "")`.

---

### 🟢 LOW — Feature flag comments inconsistently document OFF vs ON state
**File:** `services/feature-flags.ts`  
**Issue:** Some flags document what happens when OFF (`v15_advisor_card: false — "keeps users off a Coming Soon dead-end"`), others only describe the ON behavior. Makes it harder to safely toggle a flag.  
**User / UX Impact:** If a developer flips a flag without knowing the OFF behaviour (e.g. mistakenly enables `v15_advisor_card`), users would land on a "Coming Soon" dead-end screen they can’t exit from without hitting back. Inconsistent flag documentation increases the chance of accidental flag toggles shipping features that aren’t ready — directly causing broken or incomplete UI appearing in production.  
**Fix:** Standardize each flag comment to include both ON and OFF behavior.

---

## Summary Table

| Severity | Issue | File | Effort |
|----------|-------|------|--------|
| 🟡 High | No production crash reporting | utils/logger.ts | 2h |
| 🟡 High | services/index.ts may have dead exports | services/index.ts | 30 min |
| 🟡 Medium | Heavy `any` usage in critical services | 38 files | ongoing |
| 🟡 Medium | V15FlagName type name stale | feature-flags.ts | 5 min |
| 🟡 Medium | `require()` for app.json version | backup.ts | 5 min |
| 🟡 Medium | `_AesAlgorithmGCM` dummy export hack | backup.ts | 5 min |
| 🟡 Medium | Migration 042 has `down()` not in interface | 042_simulator_transfers.ts | 2 min |
| 🟡 Medium | Raw SQL in notification-scheduler | notification-scheduler.ts | 1h |
| 🟢 Low | sanitizeFilename strips all dots | backup.ts | 5 min |
| 🟢 Low | Feature flag comments inconsistent | feature-flags.ts | 15 min |
