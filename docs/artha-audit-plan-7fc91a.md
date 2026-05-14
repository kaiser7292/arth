# Artha Comprehensive App Audit Plan

Audit the full Artha codebase across 8 domains and produce separate per-area remediation markdown files in `docs/audit/`.

## Scope
- **Mobile app** (React Native / Expo / SQLite)
- **Backend APIs/services** (all `services/` layer)
- **Build & deployment pipelines** (`.github/workflows/build-apk.yml`, `eas.json`, `build-*.bat`)

## Output Files (to create in `docs/audit/`)
1. `01-db-schema.md` — DB schema gaps, missing entries, orphaned migrations
2. `02-security.md` — Secrets, permissions, encryption, auth
3. `03-performance.md` — Cold start, queries, caching, memoization
4. `04-functional.md` — Logic bugs, edge cases, dead code
5. `05-testing.md` — Test coverage gaps, skipped tests, flaky patterns
6. `06-ui-ux.md` — UI consistency, accessibility, layout issues
7. `07-code-style.md` — TypeScript quality, `any` usage, naming, docs
8. `08-build-deploy.md` — CI/CD issues, staging vs prod, workflow gaps

## Priority
Quick wins (low effort, high impact) listed first within each file.

## Key Findings Preview (from audit)
- **CRITICAL**: `kite-connect.ts` has hardcoded `http://localhost:3000` backend URL
- **HIGH**: Migration 042 uses `getDatabase()` directly (wrong pattern — others take `db: SQLiteDatabase` param)
- **HIGH**: `simulation_entries` missing `from_account_id`/`to_account_id` in `TABLE_SCHEMAS.ts` (added by migration 042 but not reflected in backup whitelist)
- **HIGH**: `settings` table created in migration 043 but absent from `TABLE_SCHEMAS.ts` (not backed up)
- **MEDIUM**: `TODO` comment in hisaab integration test — `deactivateHisaabPerson` import issue uncovered
- **MEDIUM**: UUID fallback uses `Math.random()` (not cryptographically secure)
- **MEDIUM**: `logger` is a no-op in production — errors are silently swallowed with no crash reporting
- **LOW**: Migration gap at 037 and 041 (deleted, but gap leaves numbering holes)
- **LOW**: Feature flags still named `v15_*` even for v17 features
