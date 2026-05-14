# Audit Implementation — Architectural Impact Analysis

Cross-cutting review of all 30 planned fixes against Artha's architecture to identify hidden risks, invariant violations, sequencing constraints, and changes that are architecturally unsound as written.

---

## 🔴 Issues Requiring Plan Revision Before Implementation

---

### A1 · S2-3: `cleanupLegacyScheduledScan` imports `settingsStorage` dynamically — breaks the pattern
**Plan says:** `const { settingsStorage } = await import('@/services/storage');` inside the cleanup function.

**Problem:** `CONVENTIONS_AND_PATTERNS.md` explicitly flags: *"MMKV not available in tests — never import MMKV at module level in testable code."* A dynamic import inside an async function still happens at module evaluation time in some Jest environments and bypasses the mock setup. Also, `settingsStorage` is already imported at the top of `_layout.tsx` via `notification-scheduler.ts` — there's no reason for a dynamic import here.

**Fix to plan:** Import `settingsStorage` at the top of the relevant module as a static import. The MMKV gotcha applies to *module-level initialization*, not to using it inside async functions. The dynamic import is unnecessary and potentially problematic.

---

### A2 · S2-7: Parallelising 4 notification checks — SQLite contention risk
**Plan says:** Replace 4 sequential `await` calls with `Promise.all([...])`.

**Problem:** `expo-sqlite` on Android uses a single connection by default. Running 4 DB-query functions in parallel against the same SQLite connection can cause `SQLITE_BUSY` errors or transaction interleaving — especially since `checkAndNotifyLoanEMIs` and `checkAndNotifyOverdue` both run `db.getAllAsync` over the `expenses` and related tables simultaneously. The existing sequential pattern was likely intentional to avoid this.

**Fix to plan:** Only parallelise functions that do not hit the DB simultaneously, or verify first that `expo-sqlite 16.x` opens the DB in WAL mode (which allows concurrent readers). Until confirmed, keep sequential OR restructure so DB reads are batched first, then notifications sent in parallel. This item needs a **WAL mode check** before implementation.

---

### A3 · S2-8: Duplicate scan MMKV cache — `DuplicatePair[]` may be large
**Plan says:** `settingsStorage.set(DUP_SCAN_CACHE_KEY, JSON.stringify(pairs))`.

**Problem:** MMKV is designed for small key-value pairs (settings, flags). Serialising a large `DuplicatePair[]` array (potentially hundreds of items for users with thousands of expenses) into MMKV will bloat the MMKV storage binary and slow down MMKV initialization on every app start (MMKV loads all keys into memory on boot). The correct cache location for large query results is **SQLite** (an indexed cache table) or a flat file in the app's document directory.

**Fix to plan:** Either (a) limit the cache to the count only (not the full pairs) — the home screen only shows the count, the full list is loaded on demand; or (b) write to a SQLite cache table (`duplicate_scan_cache`) with a `data_version` column, which is already searchable and doesn't bloat MMKV. Option (a) is the quick fix.

---

### A4 · S1-8: `expo-updates` `reloadAsync()` in ErrorBoundary — non-Expo Go environments
**Plan says:** `Updates.reloadAsync()` to restart from error boundary.

**Problem:** `expo-updates` `reloadAsync()` only works in Expo Go or OTA update environments. In a **self-hosted APK build** (which is Artha's primary build path per build repo), `reloadAsync()` throws `"reloadAsync is not supported in bare React Native"` unless the app has `expo-updates` properly configured with a proper `runtimeVersion`. The artha app uses local APK builds without EAS — `reloadAsync()` will silently fail or throw.

**Fix to plan:** Wrap in a try/catch and fall back to `RNRestart` from `react-native-restart` (already likely in the dependency tree), or use `BackHandler.exitApp()` on Android with a note to the user. Alternatively: check `Updates.isEmbeddedLaunch` before calling `reloadAsync()` and fall back to `BackHandler.exitApp()`.

---

### A5 · S5-1: `writeAppLog` calls `getDatabase()` inside `logger.ts` — circular dependency risk
**Plan says:** `logger.ts` imports `writeAppLog` from `services/app-log.ts`, which imports `getDatabase()` from `@/database`.

**Problem:** `logger.ts` is imported at the top of virtually every service file in the codebase — it's a foundational utility. If `logger.ts` now imports from `services/app-log.ts` which imports from `@/database`, this creates a long import chain. More critically, `logger` is used during `initDatabase()` itself (in `database/database.ts`) — importing from `services/app-log.ts` which calls `getDatabase()` during logger initialization creates a **circular initialization dependency**: `initDatabase → logger → writeAppLog → getDatabase → initDatabase (not yet done)`.

**Fix to plan:** `writeAppLog` must not import `getDatabase()` at module level — it must be a lazy import *inside* the function body: `const { getDatabase } = await import("@/database")`. Also, `app-log.ts` must gracefully handle the case where the DB isn't initialized yet (return early, don't throw). The `logger` itself should not be modified to import `app-log.ts` at top level — use a lazy setter pattern instead:
```ts
// In app-log.ts — called once after DB is ready:
export function attachLoggerToDb(): void {
  logger.setProductionHandler((level, msg, ctx) => writeAppLog(level, msg, ctx));
}
// logger.ts exposes:
let productionHandler: ((l,m,c) => void) | null = null;
export const logger = { setProductionHandler: (h) => { productionHandler = h; }, ... };
```

---

### A6 · S2-4: Migration 044 uses table recreation — data safety risk during migration
**Plan says:** `CREATE TABLE expense_edit_history_new → INSERT → DROP → RENAME`.

**Problem:** This DDL pattern runs as 5 separate `execAsync` statements, not inside a single transaction. If the app crashes between `DROP TABLE expense_edit_history` and `ALTER TABLE ... RENAME`, the user's edit history is permanently gone with no recovery. Per `CONVENTIONS_AND_PATTERNS.md`: *"Every multi-step delete MUST use `db.withTransactionAsync`"*.

**Fix to plan:** Wrap the entire DDL in `db.withTransactionAsync(async () => { ... })`. Also note: `PRAGMA foreign_keys = OFF` should be set within the transaction to allow the table recreation without FK violations, then re-enabled after.

---

### A7 · S2-10: `import appConfig from "../app.json"` — TypeScript `resolveJsonModule` must be enabled
**Plan says:** Replace `require("../app.json")` with `import appConfig from "../app.json"`.

**Problem:** JSON imports require `"resolveJsonModule": true` in `tsconfig.json`. Verify this is already enabled before applying the fix. If it is, the fix is fine. If not, adding it changes how TypeScript resolves all JSON files project-wide (generally safe, but worth checking).

**Action:** Read `tsconfig.json` before implementing S2-10 to confirm `resolveJsonModule` is set.

---

## 🟡 Architectural Notes & Constraints (Non-blocking but must be acknowledged)

---

### B1 · S1-5 (kite-connect localhost fix): `EXPO_PUBLIC_*` vars are baked at build time
`process.env.EXPO_PUBLIC_KITE_BACKEND_URL` is read at Metro bundle time, not runtime. This means changing the backend URL requires a new build. For a production app this is correct. Ensure the `.env` file is in `.gitignore` and that staging vs production use different env values via EAS build profiles or `.env.staging` / `.env.production` files.

---

### B2 · S1-6 (`useRouter` fix): The `routerRef` pattern is still needed — verify new approach handles cold-start timing
The current code uses `routerRef` precisely because `useRouter()` may return a router instance that isn't fully initialised during the first render (before the navigation stack mounts). Moving to `const router = useRouter()` at the top level is correct for hooks rules, but the `useEffect(() => { routerRef.current = router }, [router])` means the ref is only updated after the first render cycle. The notification deep-link handler (line 268) uses `routerRef.current` — if a notification taps arrives before the first render completes, `routerRef.current` would be stale. The original `try/catch` worked around this by tolerating failure. The new implementation should verify the notification handler is registered in a `useEffect` that only fires after `dbReady` — which it currently is (line 264 `useEffect` has no deps, so it fires once on mount after the layout is committed). This should be fine, but verify.

---

### B3 · S2-1 (monthly summary MMKV dedup): Key name must be unique — check for collision with existing MMKV keys
`notif_monthly_summary_last_sent_month` — scan `notification-scheduler.ts` and all MMKV usages to confirm no existing key uses this name. The storage namespace is `artha-settings` shared with ALL settings. A naming collision silently corrupts unrelated settings.

---

### B4 · S2-2 (biometric deep-link fix): Lock screen needs to know the intended destination
The plan navigates to `/(lock)/lock` but doesn't pass the intended destination. After unlocking, the lock screen calls `router.replace("/(tabs)")` (always). The user who tapped a notification expecting to land on `/insights/compare` will be dropped on the home tab instead.

**Better approach:** Pass the target screen as a navigation param: `router.replace({ pathname: "/(lock)/lock", params: { returnTo: screen } })`, and have the lock screen read `params.returnTo` to navigate post-unlock.

---

### B5 · S4-3 (Home empty state): `isFirstLaunch` heuristic is fragile
`totalSpent === 0 && accounts.length === 0 && pendingCount === 0` will also match a user who legitimately has zero data (deleted all expenses, deleted all accounts). This user would keep seeing the "Welcome" onboarding state forever.

**Better approach:** Gate on `getOnboardingCompletedVersion() !== null` — users who completed onboarding should never see the first-launch state regardless of data count. This is already used on line 288 for the onboarding redirect.

---

### B6 · S2-14 (remove duplicate settings index): Affects existing installs silently
Removing the `CREATE INDEX` from migration 043 only affects the migration file — the index **already exists** on all current user devices because migration 043 already ran. The redundant index will persist on existing installs indefinitely unless a new migration 045 explicitly `DROP INDEX`es it. The plan notes this but doesn't resolve it — decide whether to add the cleanup migration or accept the existing-install state.

---

### B7 · S2-13 (rename `V15FlagName`): All call sites of `getFlag()` must be checked
Adding `FeatureFlagName` as the primary type and keeping `V15FlagName` as an alias is fine for backward compat. However, any external code that has `: V15FlagName` type annotations will get a TypeScript deprecation if you add `@deprecated` to the alias. Decide whether to do a single-pass rename of all call sites now (straightforward) or leave the alias (lower risk, higher tech debt).

---

### B8 · S3-2 (migration test uses in-memory SQLite): Jest + expo-sqlite compatibility
`openDatabaseAsync(":memory:")` may not work correctly in the Jest/jsdom environment without the native module mock. Verify the existing integration tests (which already use SQLite) use a test database helper and replicate that pattern — don't use `openDatabaseAsync` directly in a new test without checking the existing test bootstrap setup first.

---

## ✅ Changes That Are Architecturally Sound As Written

| Item | Why It's Safe |
|------|--------------|
| S1-1 TABLE_SCHEMAS cols | Pure data addition, no code change, no runtime effect |
| S1-2 settings backup | Follows exactly the backup pattern in CONVENTIONS doc |
| S1-3 migration 042 fix | Aligns with `Migration.up(db)` interface contract |
| S1-4 migration gap comments | Comments only |
| S1-7 UUID CSPRNG fix | Pure utility, no architectural surface |
| S2-5 SQL extraction to service | Follows service-layer separation principle explicitly |
| S2-6 EMI dedup MMKV key | Small scalar value, appropriate for MMKV |
| S2-9 sync debounce | Purely additive constant, no behavior change for existing code |
| S2-11 sanitizeFilename fix | Pure string utility, no callers affected |
| S2-12 MAGIC_HEADER guard | Strictly more defensive, no behavior change in valid state |
| S3-1–S3-6 test additions | Additive, no production code change |
| S4-1 dep array fix | React correctness fix, no behavioral change |
| S4-2 step message casing | String literals only |
| S4-4 filter extract | UI restructuring, no data/service layer touch |
| S5-2 dead export audit | Read-only audit first, then targeted removals |
| S5-3 `any` → typed | Purely additive type narrowing, no runtime change |
| S5-5 flag comments | Comments only |

---

## Revised Implementation Order (Post-Review)

```
Before Sprint 1:
  - Verify tsconfig.json has resolveJsonModule: true  (for S2-10)
  - Verify expo-sqlite WAL mode status                (for S2-7 decision)
  - Check Updates.isEmbeddedLaunch availability       (for S1-8 fix)

Sprint 1: S1-1, S1-2, S1-3, S1-4, S1-5, S1-6, S1-7   [unchanged]
  + S1-8 with expo-updates fallback fix (A4)
  + S1-9 unchanged (no architectural issue)
  + S1-10 unchanged

Sprint 2:
  S2-1, S2-2 (with returnTo param — B4), S2-3 (static import — A1)
  S2-4 (wrap in withTransactionAsync — A6)
  S2-5 through S2-9 (except S2-7 — hold pending WAL check — A2)
  S2-10 (after tsconfig check — A7)
  S2-11, S2-12, S2-13, S2-14

Sprint 3 onward: unchanged

Sprint 5:
  S5-1 (with lazy DB import + setter pattern — A5)
  S5-3 modified: use limit-count-only for MMKV cache (A3)
```

---

## Summary of Plan Changes Required

| # | Sprint Item | Change Required |
|---|------------|----------------|
| A1 | S2-3 | Use static import for `settingsStorage`, not dynamic |
| A2 | S2-7 | Hold pending WAL mode verification; don't parallelize blindly |
| A3 | S2-8 | Cache only duplicate count in MMKV, not full pair array |
| A4 | S1-8 | Wrap `reloadAsync()` with `isEmbeddedLaunch` guard + `BackHandler` fallback |
| A5 | S5-1 | Use lazy `import()` inside `writeAppLog` + setter pattern for logger |
| A6 | S2-4 | Wrap migration DDL in `withTransactionAsync` + `PRAGMA foreign_keys = OFF` |
| A7 | S2-10 | Verify `resolveJsonModule: true` in `tsconfig.json` first |
| B2 | S2-2 | Pass `returnTo` param to lock screen so post-unlock navigation is correct |
| B4 | S4-3 | Gate empty state on `getOnboardingCompletedVersion()`, not data counts |
