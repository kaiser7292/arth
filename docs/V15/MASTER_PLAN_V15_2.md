# Artha v15.2.0 — Master Plan

**Target version:** 15.2.0
**Session date:** 2026-04-29

---

## Session log

| Phase | Step | Status |
|-------|------|--------|
| A | Install `expo-local-authentication` | ✅ |
| A | `services/biometric-lock.ts` (settings, shouldShowLock, promptUnlock) | ✅ |
| A | `app/(lock)/lock.tsx` + `(lock)/_layout.tsx` | ✅ |
| A | Wire gate into `app/_layout.tsx` (cold start + AppState listener) | ✅ |
| A | `app/settings/security.tsx` (toggle + timeout + Lock Now) | ✅ |
| A | Added row in settings screen + stack layout registration | ✅ |
| A | Flag `v15_biometric_lock: true` | ✅ |
| A | 22 unit tests (`biometric-lock.test.ts`) | ✅ |
| B | Migration 017 — `smart_rules` + `expenses.applied_rule_id` | ✅ |
| B | `services/smart-rules.ts` (evaluator + CRUD + retroactive apply) | ✅ |
| B | `Expense.applied_rule_id` in `expense-types.ts` | ✅ |
| B | 22 evaluator unit tests (`smart-rules-evaluator.test.ts`) | ✅ |
| C | `app/settings/smart-rules/index.tsx` (list + FAB + delete) | ✅ |
| C | `app/settings/smart-rules/[id].tsx` (create/edit + retroactive) | ✅ |
| C | Stack registration + settings row + route allowlist (not deep-linked) | ✅ |
| D | Wire into `createExpense` (manual path) | ✅ |
| D | Wire into `sms-to-expense.ts` realize path (auto-approve bypass) | ✅ |
| E | Expense-detail "Categorized by rule" badge + nav | ✅ |
| F | `smart_rules` added to `BACKUP_TABLES` | ✅ |
| F | `TABLE_SCHEMAS.ts` updated (new table + applied_rule_id column) | ✅ |
| F | Cleanup path — no action (expense delete removes stamp naturally) | ✅ |
| F | Update 2 existing tests for migration 017 count + new INSERT param | ✅ |
| F | `npx tsc --noEmit` clean (except pre-existing backup.ts AES noise) | ✅ |
| F | `npx jest` — 1151 pass, 0 fail | ✅ |
| G | `docs/V15/PRD_V15_2.md`, `TDD_V15_2.md`, `MASTER_PLAN_V15_2.md` | ✅ |
| G | Bump `app.json` 15.1.0 → 15.2.0, versionCode 150200 | pending |
| G | Update CLAUDE.md version history + in-flight block | pending |
| Build | commit → push → release → APK → upload | pending — awaiting user "build" |

---

## Current state

**App version in `app.json`:** 15.1.0 → bump to **15.2.0** (MINOR — 2 net-new features, neither breaking).

### What's shipping in v15.2.0

| # | Feature | Files | Tests |
|---|---|---|---|
| 1 | Biometric app lock | 4 new files + 4 modified + 1 new dep | 22 |
| 2 | Smart rules (manual + SMS paths) | 4 new files + 9 modified | 22 |
| Bug fix | `INDBNK` sender collision (from 15.1.0) | (already shipped) | (already shipped) |

### What's NOT shipping

- Multi-currency (explicitly deferred to v16.0.0 by user decision)
- `action_mark_auto` default ON (confirmed default OFF per user)
- Category bottom-sheet picker (uses simple cycle for v1; replace in v15.2.1)
- Tag multi-select UI in rule detail

---

## Mandatory behaviours (CLAUDE.md compliance)

- ✅ Every DB write calls `bumpDataVersion()` (both in `createRule` / `updateRule` / `deleteRule`)
- ✅ FK cascades maintained — `deleteRule` clears `expenses.applied_rule_id` stamps first
- ✅ New tables added to `BACKUP_TABLES` in correct dependency order (after base tables)
- ✅ TABLE_SCHEMAS matches actual schema
- ✅ Design system respected — reused Card / Input / Button / ScreenContainer / ScreenContainer
- ✅ No hardcoded hex — uses `useColorScheme()` + accent palette
- ✅ Route allowlist updated where needed; lock screen intentionally NOT allowlisted (not a deep-link target)
- ✅ No SQL string interpolation — all queries parameterised
- ✅ No secrets / API keys
- ✅ All write ops on `expenses` updated to include `applied_rule_id`

---

## Verification

| Command | Expected | Actual |
|---|---|---|
| `npx jest` | 1151 pass | ✅ 1151 pass |
| `npx jest __tests__/unit/biometric-lock.test.ts` | 22 pass | ✅ |
| `npx jest __tests__/unit/smart-rules-evaluator.test.ts` | 22 pass | ✅ |
| `npx tsc --noEmit` | No new errors in non-test files | ✅ (only pre-existing backup.ts AES noise) |

---

## Build pipeline (awaiting user trigger)

Per CLAUDE.md, "build" means the full pipeline. Sequence:

1. `git add` + `git commit` with descriptive v15.2.0 message
2. `git push origin main`
3. `gh release create v15.2.0 --title "Artha v15.2.0 — App lock + Smart rules" --notes "..."`
4. `cd ~/accounts-manager-app && export JAVA_HOME=... && export ANDROID_HOME=... && eas build --platform android --profile preview --local --non-interactive`
5. `gh release upload v15.2.0 ./build-*.apk`

Will execute when user says "build".
