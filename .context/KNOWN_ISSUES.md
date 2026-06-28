# Known Issues

Verified findings from a May 2026 internal audit (`docs/audit/`), re-checked against current code. Most were fixed in this pass (2026-06-28) — see the changelog at the bottom for what changed and why. What's left below is either genuinely out of scope for a quick fix, or needs a product/design decision before touching it.

As issues get fixed, move them out of this file rather than leaving them marked done — a stale "known issue" is worse than no list at all.

---

## Still open — needs a decision, not just a fix

**No "get started" guidance on the Home screen for a brand-new install.** Just a wall of zeros across every card with no obvious next action. Fixing this means writing actual UX copy and deciding what the call-to-action should be (Import SMS? Add an account? Add an expense?) — a product decision, not a bug fix.

**On the Expenses tab, the date-range filter sits inside a scroll view nested inside the main list.** On some Android phones, scrolling the filter can instead scroll the whole list. The fix means restructuring that screen's layout (move the filter outside the `FlatList`, or use a bottom sheet) — real regression risk on a heavily-used screen, worth doing deliberately rather than blind.

**SplashScreen uses hardcoded hex colors via inline `style` instead of NativeWind classes.** Purely cosmetic/maintainability (today's colors are correct) — converting it is mechanical but touches the screen every single cold start shows, so it's worth a visual check after the change rather than a blind edit.

**Zerodha (Kite Connect) integration has no token-expiry handling.** On inspection, this is currently moot: the integration only does the OAuth handshake and stores credentials — nothing in the app yet actually calls an authenticated Kite API to fetch portfolio/holdings data, so there's no code path that could even hit a 401/403 today. Worth revisiting once portfolio-fetching is actually built.

## Still open — deferred as too large/risky for a blind pass

**Heavy use of TypeScript's `any`** in `loan-accounts.ts`, `balance-source.ts`, `financial-account.ts`, `onboarding.ts` (~28 instances). Real type-safety risk in the most financially-sensitive code, but fixing it properly means touching DB-row-shaped types across 4 large files — an incremental cleanup project, not a one-sitting fix.

**Home-screen cold-start performance** — each account adds up to 3 extra sequential queries (`services/home-preload.ts`), and 11 queries fire simultaneously on every cold start. Real, but fixing it means restructuring the preload query batching in the app's most balance-sensitive code path. Given this codebase's history of ledger/balance regressions (see `.context/features/ledger-and-balances.md`), this needs deliberate testing, not a blind refactor.

**No integration test for the full cold-start DB init sequence.** Worth having, but it's a new test to write (mock DB, assert every table/column exists post-migration) rather than a fix to an existing one.

**SMS parser tests use hardcoded `DD-MM-26` dates** (~20 occurrences across many bank-format test cases) anchored to the current year. Not a bug today — only becomes one once the calendar moves past 2026 — and fixing it safely means updating each date string *and* its paired assertion in lockstep across every occurrence, which isn't safely doable without running the suite to catch a mismatch (no `node_modules` in this environment). Low priority; revisit when test infra is runnable.

**`bumpDataVersion()` fires before its triggering async work fully settles** (`services/settings.ts`), causing a ~200-500ms flash of stale numbers on Home after saving an expense. The fix (a debounce or transition) would change the timing of the app's core reactivity primitive that nearly every screen depends on — too broad a blast radius to change blindly without visually testing every consuming screen.

**No SMS permission rationale screen** before the Android system permission dialog. This needs new UI (a short explainer screen/dialog) with actual copy, not a one-line fix.

**`require()` for `app.json` version in `services/backup.ts`** and **raw commit message injected into the GitHub release body** (`.github/workflows/build-apk.yml`) — both low-risk code-style nits the original audit flagged. Left alone: the `require()` works today and an untested swap to `import` risks the backup version stamp silently breaking; the release-body issue only affects the GitHub Releases page text, not the app, on a private repo.

**No production crash/error visibility** — `utils/logger.ts` is a no-op in prod. Explicitly deferred per your decision earlier this session (the scaffolding for this — `app-log.ts`/`pii-redactor.ts` — was deleted rather than finished).

---

## Fixed this pass (2026-06-28)

- **Biometric lock notification bypass** — tapping a notification while locked now redirects to the lock screen first and resumes the original destination after unlock, instead of navigating straight there. (`app/_layout.tsx`, `app/(lock)/lock.tsx`, `services/biometric-lock.ts`)
- **Backup file header check** now runs in production, not just `__DEV__`. (`services/backup.ts`)
- **Duplicate EMI notifications** — capped to once per EMI per day on the app-open check. (`services/notification-scheduler.ts`)
- **Monthly summary notification** — capped to once per calendar month. (`services/notification-scheduler.ts`)
- **`cleanupLegacyScheduledScan`** no longer cancels every scheduled notification on every single startup — only runs once, ever, per device. (`app/_layout.tsx`)
- **Onboarding wizard no longer re-shown to existing users** if the one-time upgrade-detection step fails transiently. (`app/_layout.tsx`)
- **Orphaned `expense_edit_history` rows** are now cleaned up when an expense is permanently deleted (both the single-expense and the 30-day bulk-purge paths). (`services/expense-crud.ts`)
- **Merchant-mapping seed check** no longer hits the database on every cold start once seeded. (`services/smart-categorizer.ts`)
- **Duplicate-transaction scan** now persists its result across cold starts (keyed to data version) instead of re-scanning from scratch every app open. (`services/duplicate-detection.ts`)
- **Notification re-sync debounce** raised from 5 minutes to 1 hour to cut churn from frequent app-opens. (`services/notification-scheduler.ts`)
- **Splash screen** fresh-install message shortened for consistency with the others. (`app/_layout.tsx`)
- **Hisaab "deactivate person" test** re-enabled — it was silently testing nothing due to a missing import. (`__tests__/integration/hisaab.test.ts`)
- **CI pipeline** now runs `tsc --noEmit` and the full test suite before building, and the build job has a 45-minute timeout so a stuck self-hosted runner doesn't block releases silently. (`.github/workflows/build-apk.yml`)
- **`sanitizeFilename()`** in backup.ts no longer strips every dot from a filename (dead/contradictory regex). (`services/backup.ts`)
- **`V15FlagName`** renamed to `FeatureFlagName` — it covers v17+ flags, the old name was misleading. (`services/feature-flags.ts`)
- Removed dead `_AesAlgorithmGCM` type and an orphaned `settings` table entry in `TABLE_SCHEMAS.ts` left over from the deleted notification-collector feature. (`services/backup.ts`, `database/TABLE_SCHEMAS.ts`)
- **`build-local.bat`** Windows build script fixed (see prior session note — wrong repo path, broken publish step).
