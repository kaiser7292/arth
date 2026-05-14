# Artha v15 — Product Requirements

**Version target:** 15.0.0
**Release date:** 2026-04-29
**Theme:** Public reference data + first-run onboarding + in-app help — making Artha usable on first install for **any Indian user**, not just the owner.

---

## Context

Artha v1–v14 was built around the owner's personal bank/merchant/SMS patterns. Any new user whose bank, SMS format, or spending pattern differed got a degraded experience — SMS auto-detect often missed, merchant categorization fell back to "Other", and there was no guided setup.

v15 fixes this across three pillars:

1. **Public reference data** — bundled JSON assets seeded into SQLite on first run, covering IFSC prefixes, SMS sender codes, SMS templates, MCC codes, and merchant brands.
2. **First-run onboarding wizard** — guided 5-step setup for fresh installs.
3. **In-app help center** — bundled, searchable docs with context-aware "Learn more" chips.

---

## v15.0.0 scope summary (this release)

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Data-source scaffolding (6 new tables via migration 015) | ✅ Shipped (pre-15.0.0 session) |
| 2a | MCC + IFSC bundled reference data | ✅ Shipped |
| 2b | Merchant-brand registry + categorizer fallback | ✅ Shipped |
| 2c | Reminder-hint harvest into staging table | ✅ Shipped |
| **2d** | **Tier-1 SMS sender + SMS template bundles (11 PSU banks)** | ✅ **Shipped this session** |
| 4 | First-run onboarding wizard | ✅ Shipped |
| 5 | In-app help center | ✅ Shipped |

**Deferred to v16:** Phase 3 online bundle refresh, Phase 5b on-device MiniLM embeddings.

---

## Phase 2d — Generic SMS parser for PSU banks (this session's focus)

### Problem

Before v15.0.0, Artha's SMS parser only recognised hardcoded templates for HDFC, ICICI, Axis, SBI, Kotak, IDFC First, Federal, AU, RBL, HSBC, Citi, Amex, Paytm, PhonePe, Google Pay. The 11 Indian PSU banks — representing ~40% of Indian retail banking customers — were either silently dropped (Canara, BOB, UBI, Indian Bank, Central, IOB, UCO, BOI, BOM, Punjab & Sind) or recognised only at the sender level without parsing (PNB).

Additionally, the existing code had a **sender-ID collision**: `INDBNK` was incorrectly mapped to IndusInd Bank. Real DLT codes for IndusInd are `INDUSB` / `INDSIN` / `INDBKL`. `INDBNK` is the Public Sector Indian Bank.

### Goals

1. Any Indian PSU bank user's SMS parses into a pending expense out of the box.
2. No regression for the 14 banks already covered — hardcoded `BANK_PATTERNS` always run first.
3. No custom code per bank — a data-driven template system that can add future banks by editing a JSON bundle.
4. Credit card SMS (BOBCARD in v15.0.0; others follow) work through the same template mechanism.
5. UPI / NEFT / IMPS / ATM / reminder-hint SMS all covered.

### Non-goals

- Email parsing (unchanged — still manual).
- Bank balance sheet reconciliation changes.
- New user-visible UI — SMS scan flow and pending queue are unchanged.
- International banks.

### Functional requirements

| Requirement | Source of truth |
|-------------|----------------|
| Sender resolution: `INDBNK` → Indian Bank, `INDUSB`/`INDSIN`/`INDBKL` → IndusInd Bank | `services/sms/bank-senders.ts` |
| Sender allowlist includes all 11 PSU banks (multiple DLT variants each) | `services/sms/bank-senders.ts` + `assets/data/sms-senders.json` |
| DB-backed template fallback fires only when `v15_sms_template_fallback=true` AND hardcoded `parseBankSMS()` returned null AND sender is a bank | `services/sms/sms-parser.ts` |
| Template matching scopes to the sender-resolved bank first; then falls back to `__generic__` templates | `services/public-data/sms-template-matcher.ts` |
| Named capture groups: `amount`, `account`, `merchant`, `ref`, `balance`, `dueDate` | `assets/data/sms-templates.json` |
| Hardcoded patterns always win — template matches tag confidence 0.7 vs 1.0 for hardcoded | `sms-template-matcher.ts` |
| Reminder-hint matches flow into `reminder_suggestions`, never into expenses | Existing `reminder-hints.ts` |
| IFSC bank resolver active — when an SMS carries an IFSC, resolve bank via `ifsc_bank_registry` | Flag `v15_ifsc_bank_resolver=true` |

### Coverage matrix (11 PSU banks)

| Bank | DLT senders | Debit | Credit | UPI | NEFT/IMPS | ATM | CC | Reminder |
|------|-------------|-------|--------|-----|-----------|-----|-----|----------|
| PNB | PNBSMS, PNBBNK, PUNBN | ✅ | ✅ | ✅ | ✅ | ⚠️ | — | ✅ |
| Canara | CANBNK, CANARA, CANABN | ✅ | ✅ | ✅ | ✅ | — | — | via generic |
| BOB | BOBSMS, BOBTXN, BOBIBN, BOBCRD, BABORB, BOBBSM | ✅ | ✅ | ✅ | ✅ | — | ✅ BOBCARD | via generic |
| UBI | UNIONB, UBOISL, UBOI, UNIONBK | ✅ | ✅ | ✅ | ✅ | via generic | — | via generic |
| Indian Bank | INDBNK, INDBSM, IBKIND | ✅ | ✅ | ✅ | ✅ | ✅ | — | via generic |
| Central | CENTBK, CBISMS, CBIBNK, CBOIIN | ✅ | ✅ | via generic | ✅ | — | — | via generic |
| IOB | IOBCHN, IOBSMS, IOBBNK | ✅ | ✅ | ✅ | ✅ | — | — | via generic |
| UCO | UCOBNK, UCOBANK, UCOBSM | ✅ | ✅ | ✅ | ✅ | — | — | via generic |
| BOI | BOIIND, BOIBNK, BOIUPI | ✅ | ✅ | ✅ | ✅ | ✅ CDM | — | via generic |
| BOM | BOMBNK, BOMSMS, MAHABK | ✅ | ✅ | via generic | ✅ | — | — | via generic |
| Punjab & Sind | PSBANK, PSBBNK, PSBSMS | ✅ | ✅ | ✅ | ✅ | — | — | via generic |

### Data sources

Templates and sender IDs authored in-house from:

- Real SMS samples collected on Sourav's own devices (see `__tests__/fixtures/sms-samples/`).
- Public bank SMS format documentation (bank help pages, RBI DLT sender registry).

Extraction approach: human curation. No automated scraping. Sender codes (DLT registry entries) and SMS bodies emitted by banks are factual content, not subject to copyright.

### Confidence tiers

| Signal | Confidence | Effect |
|--------|-----------|--------|
| Hardcoded `BANK_PATTERNS` match | 1.0 | Always wins |
| Bank-scoped DB template match | 0.7 | Fills gap when hardcoded misses |
| `__generic__` DB template match | 0.7 | Cross-bank fallback (amount, account, ref extractors) |
| No match | — | SMS marked `unrecognized` (unchanged) |

---

## Acceptance criteria

- ✅ 11 PSU banks parse ≥1 fixture each into a valid `ParsedSMS` with correct amount and tx_type
- ✅ `INDBNK` SMS sender resolves to **Indian Bank**, not IndusInd
- ✅ `INDUSB` / `INDSIN` / `INDBKL` SMS senders resolve to **IndusInd Bank**
- ✅ Existing fixture corpus (1106 pre-v15.0.0 tests) passes with zero changes
- ✅ 46 new PSU fixture tests all pass
- ✅ No non-test TypeScript errors introduced by v15.0.0 changes
- ✅ All 5 data bundles aligned to version `2026-04-29` for seed idempotency
- ✅ Flags `v15_sms_template_fallback` and `v15_ifsc_bank_resolver` are ON
