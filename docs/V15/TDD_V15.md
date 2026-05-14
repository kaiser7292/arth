# Artha v15 — Technical Design

**Target version:** 15.0.0
**Release date:** 2026-04-29
**Scope:** Public reference data (Phase 1+2), first-run onboarding (Phase 4), in-app help (Phase 5). This TDD is scoped primarily to **Phase 2d** — the generic PSU bank SMS parser that shipped this session; earlier phases are documented via commit messages + code.

---

## Architecture — Phase 2d

### High-level flow

```
Android SMS Content Provider
       │
       ▼
sms-reader.ts  (unchanged)
       │
       ▼  raw SMS[]
sms-parser.ts → parseSmsBatch()
       │
       ├── 1. dedup via sms_id
       ├── 2. parseBankSMS() ← hardcoded BANK_PATTERNS (v1–v14)
       │       │
       │       ├── match → ParsedSMS
       │       └── miss  → null
       │
       ├── 3. NEW: if null AND V15_FLAGS.v15_sms_template_fallback AND isBankSender(address):
       │          tryTemplateMatch(body, address) ← DB-backed templates
       │                 │
       │                 ├── resolve sender → bank via hardcoded + sms_sender_registry
       │                 ├── fetch rows from sms_template_patterns scoped to bank
       │                 │   + __generic__ (sorted: bank first, priority ASC)
       │                 ├── run each regex with `i` flag
       │                 └── first match wins → ParsedSMS (confidence 0.7)
       │
       ├── 4. if still null → result.unrecognized++
       │
       └── 5. on success:
              ├── INSERT INTO pending_sms
              ├── harvestReminderHintFromParsed(parsed, body)  ← unchanged
              └── result.parsed++
```

### Key design decisions

**1. Fallback-only, never replacement.**
Hardcoded `BANK_PATTERNS` run first and always win when they match. This means every user who had a working SMS flow in v14.x has an identical flow in v15.0.0. Regression surface: zero.

**2. Bank-scoped matching.**
`tryTemplateMatch` SQL: `WHERE bank_name = ? OR bank_name = '__generic__' ORDER BY (generic first?) ASC, priority ASC`. This prevents a Canara template from matching a PNB SMS by accident.

**3. Named capture groups, uniform extraction.**
Every template uses `(?<amount>...)`, `(?<account>...)`, `(?<merchant>...)`, `(?<ref>...)`, `(?<balance>...)`, `(?<dueDate>...)` — so a single extractor function handles all banks.

**4. Confidence 0.7 for template matches.**
Downstream code (review queue, duplicate detection) can distinguish template-matched SMS from hardcoded-matched SMS if it ever needs to. Currently all consumers treat both identically.

**5. Stored as `i`-flag regex strings.**
JSON serialisation friendly. Each regex compiled once per match attempt — acceptable since the fallback only fires for SMS that already missed hardcoded patterns (a small subset).

**6. Sender-ID collision fix is the ONLY breaking change.**
`INDBNK` now resolves to Indian Bank (correct) instead of IndusInd Bank (previously incorrect). Real IndusInd SMS use `INDUSB`/`INDSIN`/`INDBKL` — which are now in the allowlist. So existing IndusInd users are unaffected; former "Indian Bank SMS misclassified as IndusInd" users get the correct attribution.

---

## File changes

### New files

| File | Purpose |
|------|---------|
| `assets/data/sms-senders.json` | 82 SMS sender codes, covering 11 PSU banks × DLT variants + major private/small finance banks + wallets |
| `assets/data/sms-templates.json` | 56 regex templates for PSU bank SMS + 3 generic extractors + 5 generic reminder-hint patterns |
| `services/public-data/sms-template-matcher.ts` | `tryTemplateMatch(body, senderAddress)` — resolves sender bank, fetches templates from DB, runs regex, extracts structured data |
| `__tests__/unit/psu-sms-templates.test.ts` | 46 tests: per-bank parse fixtures + sender mapping + bundle sanity |
| `docs/V15/PRD_V15.md`, `TDD_V15.md`, `MASTER_PLAN_V15.md` | Per CLAUDE.md version convention |

### Modified files

| File | Change |
|------|--------|
| `services/sms/bank-senders.ts` | +46 entries (11 PSU banks × multiple DLT codes + IndusInd remap). `INDBNK` now maps to Indian Bank. |
| `services/sms/sms-parser.ts` | +11 lines — await `tryTemplateMatch` fallback when hardcoded missed. Flag-gated. |
| `services/public-data/bundle-loader.ts` | Replaced two `throw new Error("not-shipped")` with `require()` for sms-senders + sms-templates bundles |
| `services/feature-flags.ts` | Flipped `v15_sms_template_fallback` and `v15_ifsc_bank_resolver` from `false` to `true` |
| `assets/data/*.json` (all 5 bundles) | Version aligned to `2026-04-29` for seed idempotency |
| `__tests__/unit/public-data-seed.test.ts` | Bump stubbed `seeded_version` from `2026-04-28` to `2026-04-29` to match bundle |

### No schema changes

Phase 2d reuses migration 015's `sms_sender_registry` and `sms_template_patterns` tables (shipped earlier in v15 prep).

---

## Template anatomy

Each entry in `sms-templates.json`:

```json
{
  "id": "pnb_debit_for_rs",
  "bank_name": "PNB",                    // or "__generic__" for cross-bank extractors
  "template_id": "pnb_ac_debited_for_rs", // human-readable tag for debugging
  "pattern_regex": "(?:a/c|Ac)\\s+...(?<amount>...)",
  "tx_type": "debit",                    // debit | credit | upi_debit | upi_credit
                                         // | cc_debit | cc_credit | refund
                                         // | balance_inquiry | reminder_hint
  "priority": 10                         // ASC: lower fires first within (bank, tx_type)
}
```

### `tx_type` → `TransactionType` mapping

```ts
const TX_TYPE_ALIASES = {
  debit:           "debit",
  credit:          "credit",
  upi_debit:       "upi_debit",
  upi_credit:      "upi_credit",
  cc_debit:        "debit",              // downstream treats CC and bank debit identically
  cc_credit:       "credit",
  refund:          "refund",
  balance_inquiry: "balance_inquiry",
  reminder_hint:   "amount_due_reminder",
};
```

### Reminder-hint handling

`reminder_hint` matches return `skip: true` — the SMS is recorded in `pending_sms` with status=`ignored`, and the existing `harvestReminderHintFromParsed()` flow takes over. No expense is ever created from a reminder-hint template match.

### Balance-inquiry handling

`balance_inquiry` templates are skipped by `tryTemplateMatch` entirely — they exist so the matcher has "seen" the pattern but doesn't produce a `ParsedSMS`. This prevents a balance-only SMS from being logged as an INR 0 expense.

---

## Performance

| Concern | Impact | Mitigation |
|---------|--------|-----------|
| Extra DB read per unrecognized SMS | 1 × `SELECT` returning ~10-50 rows | Fallback only fires when hardcoded missed AND sender is a bank — both rare. Negligible in practice. |
| Regex compilation | 1 × `new RegExp()` per candidate template | JS engine caches `new RegExp` for identical strings; still negligible vs DB roundtrip |
| Bundle size | `sms-senders.json` ~4 KB, `sms-templates.json` ~18 KB | +22 KB APK — well under the <115 MB budget |

---

## Testing strategy

### Unit tests (46 new + 1107 existing)

- **Per-bank fixtures** — ≥1 positive case per PSU bank × tx_type covered
- **Cross-bank isolation** — PNB templates do NOT match HDFC SMS, and OTP SMS don't match any debit template
- **Bundle sanity** — every regex compiles; every non-balance/non-ref template has an `amount` capture group; `count` matches `entries.length`
- **Sender mapping** — `INDBNK` → Indian Bank, `INDUSB`/`INDSIN`/`INDBKL` → IndusInd Bank; all 11 PSU sender codes pass `isBankSender`

### Integration coverage

- `public-data-seed.test.ts` continues to verify idempotency + user-data isolation — passes with bundles aligned to version `2026-04-29`

### Manual test plan (post-APK)

- [ ] Install fresh on a device with PNB SMS history; verify expense is parsed
- [ ] Install on a device with existing HDFC / ICICI SMS; verify no regression
- [ ] Verify IndusInd SMS from `INDUSB-S` still parses correctly
- [ ] Verify review-queue shows new PSU bank name in the bank badge

---

## Rollback plan

Flag flip — set `v15_sms_template_fallback: false` in `services/feature-flags.ts` and rebuild. Zero data side-effects since the fallback only ADDS parses; nothing is stored that would linger.

`INDBNK` sender remap is a bug fix and should not be rolled back.

---

## Open work (not in v15.0.0)

- Credit-card templates for other PSU banks (only BOBCARD shipped; SBI Card, PNB Rupay Card, etc. follow)
- Rural bank coverage (regional co-op banks)
- RBL / IDFC generic card templates
- Phase 3 online refresh (deferred to v16)
