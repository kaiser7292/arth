# Artha Comprehensive Audit — v17.6.5

**Audited:** May 2026 | **Scope:** Mobile app (Android/iOS), Services layer, Build/Deploy pipeline  
**Prioritization:** Quick wins (low effort, high impact) first within each area

---

## Audit Files

| # | Area | File | Issues |
|---|------|------|--------|
| 1 | DB Schema | [01-db-schema.md](./01-db-schema.md) | 8 issues (2 critical) |
| 2 | Security | [02-security.md](./02-security.md) | 9 issues (1 critical) |
| 3 | Performance | [03-performance.md](./03-performance.md) | 9 issues |
| 4 | Functional | [04-functional.md](./04-functional.md) | 10 issues (1 critical) |
| 5 | Testing | [05-testing.md](./05-testing.md) | 10 issues |
| 6 | UI / UX | [06-ui-ux.md](./06-ui-ux.md) | 9 issues |
| 7 | Code Style & Docs | [07-code-style.md](./07-code-style.md) | 10 issues |
| 8 | Build & Deploy | [08-build-deploy.md](./08-build-deploy.md) | 10 issues |

---

## 🔴 Critical Issues (Fix Immediately)

| # | Issue | File | Effort |
|---|-------|------|--------|
| 1 | `simulation_entries` missing `from_account_id`/`to_account_id` in TABLE_SCHEMAS — backup silently drops simulator transfer account links | `database/TABLE_SCHEMAS.ts` | 5 min |
| 2 | `settings` table (migration 043) absent from TABLE_SCHEMAS and BACKUP_TABLES — never backed up | `TABLE_SCHEMAS.ts` + `backup.ts` | 10 min |
| 3 | **Hardcoded `http://localhost:3000`** backend URL in kite-connect — token exchange fails in production | `services/kite-connect.ts` | 30 min |
| 4 | Migration 042 ignores the passed `db` parameter — calls `getDatabase()` directly, breaks test isolation | `042_simulator_transfers.ts` | 15 min |

---

## 🟡 High Priority Quick Wins (< 30 min each)

| # | Issue | File | Effort |
|---|-------|------|--------|
| 1 | `useRouter()` called inside try/catch — Rules of Hooks violation | `app/_layout.tsx` | 5 min |
| 2 | Monthly summary re-fires every app open on day 1 of month | `notification-scheduler.ts` | 15 min |
| 3 | No `timeout-minutes` on self-hosted CI runner job | `build-apk.yml` | 5 min |
| 4 | No `typecheck` or `test` step in CI pipeline | `build-apk.yml` | 10 min each |
| 5 | Staging `sed` steps in CI are no-ops (app.json already has staging values) | `build-apk.yml` | 10 min |
| 6 | UUID fallback uses `Math.random()` (not CSPRNG) | `utils/uuid.ts` | 10 min |
| 7 | `deactivateHisaabPerson` test commented out with TODO | `hisaab.test.ts` | 30 min |
| 8 | `services/index.ts` barrel may have dead exports post-notification-collector removal | `services/index.ts` | 30 min |
| 9 | No production crash reporting — `logger` is a complete no-op in prod | `utils/logger.ts` | 2h |
| 10 | ErrorBoundary and DB init failure screens have no restart/recovery action | `app/_layout.tsx` | 20 min each |

---

## 📊 Issue Count by Severity

| Severity | Count |
|----------|-------|
| 🔴 Critical | 4 |
| 🟡 High | ~18 |
| 🟡 Medium | ~35 |
| 🟢 Low | ~18 |
| **Total** | **~75** |

---

## Recommended Sprint Order

### Sprint 1 — Critical + 30-min fixes (1–2 hours total)
1. Fix `TABLE_SCHEMAS.ts` — add `simulation_entries` columns + `settings` table
2. Fix `backup.ts` — add `settings` to `BACKUP_TABLES`
3. Fix `kite-connect.ts` — remove hardcoded localhost URL
4. Fix `042_simulator_transfers.ts` — use db parameter
5. Fix `app/_layout.tsx` — move `useRouter()` out of try/catch
6. Fix `build-apk.yml` — add timeout, remove dead sed steps, add typecheck+test steps
7. Fix `utils/uuid.ts` — replace Math.random fallback with expo-crypto

### Sprint 2 — High impact functional + security fixes (3–4 hours)
1. Monthly summary deduplication (MMKV month guard)
2. Deep-link bypass biometric lock
3. Legacy cleanup MMKV gate
4. Duplicate scan persistence across cold starts
5. Merge 4 sequential notification checks to `Promise.all`

### Sprint 3 — Testing coverage gaps (2–3 hours)
1. Re-enable hisaab deactivation test
2. Add backup/restore tests for new columns + settings table
3. Add full DB init integration test
4. Expand UUID test to cover fallback path

### Sprint 4 — Code quality + performance (ongoing)
1. Replace `any` in high-sensitivity services
2. Extract raw SQL from notification-scheduler
3. Optimize account group section DB queries
4. Add production crash reporting
