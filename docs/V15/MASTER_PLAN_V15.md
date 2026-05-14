# Artha v15 — Master Plan

**Target version:** 15.0.0
**Sessions spent:** Multiple. This is the finalised tracker.

---

## Session log (2026-04-29 — Phase 2d + finalisation)

| Step | What | Status |
|------|------|--------|
| Research | Catalogued 11 PSU bank SMS formats + DLT sender IDs from real SMS samples and public bank documentation | ✅ |
| Curation | `assets/data/sms-senders.json` — 82 entries | ✅ |
| Curation | `assets/data/sms-templates.json` — 56 regex templates (debit/credit/UPI/NEFT/CC/reminder) | ✅ |
| Code | `services/public-data/sms-template-matcher.ts` — new | ✅ |
| Code | `services/sms/sms-parser.ts` — template fallback wired | ✅ |
| Code | `services/public-data/bundle-loader.ts` — enabled sms-senders + sms-templates requires | ✅ |
| Bug fix | `services/sms/bank-senders.ts` — INDBNK remapped from IndusInd → Indian Bank; added INDUSB/INDSIN/INDBKL for IndusInd | ✅ |
| Flags | `v15_sms_template_fallback` + `v15_ifsc_bank_resolver` → ON | ✅ |
| Data | All 5 bundles aligned to version `2026-04-29` | ✅ |
| Tests | 46 new fixture tests across 11 PSU banks + sender mapping + bundle sanity | ✅ |
| Tests | Idempotency test updated for new version string | ✅ |
| Tests | `npx jest` — 1107 total, 1107 pass | ✅ |
| TS | `npx tsc --noEmit` — zero new errors in non-test files | ✅ |
| Docs | `docs/V15/PRD_V15.md`, `TDD_V15.md`, `MASTER_PLAN_V15.md` | ✅ |
| Version | `app.json` 14.8.1 → 15.0.0 | pending |
| CLAUDE.md | Version history + in-flight block updated | pending |
| Build pipeline | commit → push → GitHub release → APK → upload | pending — awaiting user "build" |

---

## Current state

**App version in `app.json`:** 14.8.1 — to bump to **15.0.0** (MAJOR — Phase 2d + sender bug fix + 11 new bank integrations = well over the 5-feature MINOR threshold; plus this is the v15 milestone drop).

**Shipped features in v15.0.0** (cumulative from pre-15.0.0 sessions + this one):

| # | Feature | Phase | Shipped |
|---|---------|-------|---------|
| 1 | 6 public-data tables + seed plumbing (migration 015) | 1 | Pre-15.0.0 ✅ |
| 2 | MCC codes bundle (981 rows) | 2a | Pre-15.0.0 ✅ |
| 3 | IFSC prefixes bundle (1510 rows) | 2a | Pre-15.0.0 ✅ |
| 4 | Merchant brand registry + categorizer fallback | 2b | Pre-15.0.0 ✅ |
| 5 | Reminder-hint harvest → `reminder_suggestions` staging | 2c | Pre-15.0.0 ✅ |
| 6 | **SMS senders bundle — 82 entries, 11 PSU banks** | 2d | **This session ✅** |
| 7 | **SMS templates bundle — 56 regex patterns** | 2d | **This session ✅** |
| 8 | **DB-backed template fallback in `parseSmsBatch`** | 2d | **This session ✅** |
| 9 | **`INDBNK` sender-ID bug fix** | 2d | **This session ✅** |
| 10 | **`v15_sms_template_fallback` + `v15_ifsc_bank_resolver` flags flipped ON** | 2d | **This session ✅** |
| 11 | First-run onboarding wizard (5-step) | 4 | Pre-15.0.0 ✅ |
| 12 | In-app help center (keyword + fuzzy search) | 5a | Pre-15.0.0 ✅ |

**Deferred to v16:**
- Phase 3 — online bundle refresh
- Phase 5b — on-device MiniLM embeddings for semantic doc search
- Extended credit-card templates beyond BOBCARD
- Rural / co-op bank coverage

---

## Mandatory behaviours (CLAUDE.md compliance)

- ✅ All bundles version-aligned to `2026-04-29` (single source of truth)
- ✅ `bumpDataVersion()` not needed — v15.0.0 adds no new user-data writes
- ✅ Backup-restore unaffected — no touch to `services/backup.ts` BACKUP_TABLES
- ✅ Zero regression: 1107 tests pass (0 failures, 0 skipped)
- ✅ New files follow naming conventions
- ✅ Design system unchanged — no new UI in 2d
- ✅ Route allowlist unchanged
- ✅ Data-cleanup service unchanged — tables are additive

---

## Feature Summary

v15.0.0 is the public-reference-data release. First-install experience for Indian users goes from "owner-bank-only" to "works for anyone with a PSU or major private bank account, guided by an onboarding wizard and backed by searchable in-app help."

The most important delta in this session: any user whose primary bank is PNB, Canara, BOB, Union Bank, Indian Bank, Central Bank, IOB, UCO, Bank of India, Bank of Maharashtra, or Punjab & Sind Bank now gets SMS auto-detect out of the box.

---

## Verification plan

| Artifact | Command | Expected |
|----------|---------|----------|
| Unit tests | `npx jest` | 1107 pass, 0 fail |
| PSU-specific tests | `npx jest __tests__/unit/psu-sms-templates.test.ts` | 46 pass |
| Bank-sender tests | `npx jest __tests__/unit/bank-senders.test.ts` | 20 pass |
| TS check | `npx tsc --noEmit` | No NEW errors introduced by v15 files (pre-existing `services/backup.ts` AES type noise is unrelated) |

---

## Build pipeline (awaiting user trigger)

Per CLAUDE.md, "build" means the full pipeline. Sequence:

1. `git add` + `git commit` with descriptive v15.0.0 message
2. `git push origin main`
3. `gh release create v15.0.0 --title "Artha v15.0.0 — PSU banks + onboarding + help" --notes "..."`
4. `cd ~/accounts-manager-app && export JAVA_HOME=... && export ANDROID_HOME=... && eas build --platform android --profile preview --local --non-interactive`
5. `gh release upload v15.0.0 ./build-*.apk`

Will execute when user says "build".
