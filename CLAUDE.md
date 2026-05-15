# Artha (अर्थ) — CLAUDE.md

## What This Is

Personal finance app for Android. React Native + Expo, 100% local (SQLite + MMKV). No cloud.

**Owner:** Sourav Baid (non-technical user building this as a personal tool)
**Repo:** github.com/kaiser7292/artha

---

## Quick Reference

| What | Where |
|------|-------|
| Architecture, stack, patterns | `.context/ARCHITECTURE.md` |
| Database schema & migrations | `.context/DATABASE_SCHEMA.md` |
| Service map (where logic lives) | `.context/SERVICES_MAP.md` |
| Design system (colors, spacing) | `.context/DESIGN_SYSTEM.md` |
| Build & release process | `.context/BUILD_AND_RELEASE.md` |
| Conventions & code patterns | `.context/CONVENTIONS_AND_PATTERNS.md` |
| Testing | `.context/TESTING_STRATEGY.md` |
| Setup (macOS) | `.context/SETUP_GUIDE.md` |
| Full overview + feature list | `.context/PROJECT_OVERVIEW.md` |

**Read `.context/` files for deep detail. This file covers rules and conventions only.**

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native + Expo (SDK 53) |
| Navigation | Expo Router (file-based) |
| Styling | NativeWind (Tailwind for RN) |
| Database | expo-sqlite (plaintext, OS-level encryption) |
| KV Store | react-native-mmkv (settings, device-local prefs) |
| SMS | react-native-get-sms-android (Android only) |
| Testing | Jest + React Native Testing Library |
| Build | GitHub Actions (auto) + local Gradle (manual) |
| Branch | staging → main |

---

## Project Structure

```
artha/
├── app/                    # Expo Router pages (file-based routing)
│   ├── (tabs)/             # Bottom tab screens (Home, Transactions, Budget, Settings)
│   ├── (lock)/             # Biometric lock screen
│   ├── (onboarding)/       # First-run onboarding
│   ├── expense/            # Expense add/edit/review
│   ├── reconciliation/     # Account ledgers, credit cards, wallets, pension, demat
│   ├── goals/              # Yearly plan, balance sheet, milestones, YoY, loans
│   ├── insights/           # Analytics, compare, patterns, drills
│   ├── simulator/          # Cash-flow simulator
│   ├── loans/              # Loan management
│   ├── hisaab/             # Family ledger
│   ├── settings/           # All settings screens
│   ├── budget/             # Budget drilldowns
│   └── summary/            # Monthly summary
├── components/             # Reusable UI components
│   ├── ui/                 # Generic (Button, Card, Input, PeriodNavigator, etc.)
│   ├── expense/            # Expense-specific sheets and components
│   ├── home/               # Home tab cards
│   ├── charts/             # Chart wrappers
│   ├── loans/              # Loan sheets
│   ├── simulator/          # Simulator sheets
│   └── account/            # Account-related components
├── services/               # Business logic (83 service files)
│   ├── sms/                # SMS reading, parsing, orchestration, templates
│   ├── docs/               # Help center article service
│   ├── analytics/          # Analytics computation
│   └── public-data/        # Bundled reference data (IFSC, MCC, templates)
├── database/               # SQLite schema + migrations (47 migrations)
├── utils/                  # Helpers, formatters, validators
├── constants/              # Theme, config, category defaults
├── hooks/                  # Custom React hooks
├── assets/                 # Images, fonts, bundled data, help articles
├── __tests__/              # Jest tests (unit + integration)
├── .context/               # Detailed project documentation (READ THESE)
├── docs/                   # Historical version docs (PRD/TDD/MASTER_PLAN per version)
└── .github/workflows/      # CI/CD (build-apk.yml)
```

---

## Key Architectural Decisions

1. **100% local** — No server, no sync, no telemetry. SQLite single source of truth.
2. **Balance chain model** — `account_month_balances` stores opening balances; closing = opening − expenses + credits ± transfers ± adjustments. Chain builds forward recursively.
3. **SMS pipeline** — `sms-reader → sms-parser → sms-orchestrator → sms-to-expense`. Reader fetches raw SMS, parser extracts fields, orchestrator deduplicates + routes, sms-to-expense creates pending expenses.
4. **Review queue** — All auto-detected data goes through approve/edit/reject before appearing in reports.
5. **Fiscal year** — Indian FY (Apr 1 – Mar 31) default. Drives yearly plans, savings rates, YoY.
6. **Soft delete everywhere** — `deleted_at` column, 30-day auto-purge, restorable from recycle bin.
7. **Period navigation bounds** — Screens don't let users navigate before earliest data exists, and limit future to +3 months unless data exists further out.

---

## Working Rules

### Propose Before Coding
Do not modify code without the user's explicit approval. Present changes verbally or as diffs first.

### Database Changes Checklist
Every time you add/modify a table or column:
1. Register migration in `database/migrations/index.ts`
2. Update `database/TABLE_SCHEMAS.ts`
3. Add to `services/backup.ts` BACKUP_TABLES if user data
4. Update cascade paths in `data-cleanup.ts`, `permanentlyDeleteExpense`, `hardDeletePerson`
5. Update mock objects in test files

### Design System (Non-Negotiable)
- Use `<Card>` from `@/components/ui` for elevated surfaces
- Use `<ScreenContainer padTop={false}>` under Stack headers
- Use NativeWind classes for colors (not hardcoded hex)
- Stack headers: `fontWeight: "700"`, `fontSize: 18`, `headerShadowVisible: false`
- Typography: section labels = `text-xs font-semibold uppercase tracking-wider`

### Testing
```bash
npx jest                        # All tests
npx jest __tests__/unit/        # Unit only
npx jest --testPathPattern=X    # Specific test
npx tsc --noEmit                # Type check
```

### Build (macOS)
```bash
./bin/build-apk.sh              # Standard build
./bin/build-apk.sh --clean      # After branch switch
```
GitHub Actions auto-builds on push to staging/main.

### Git Convention
```
feat(scope): description
fix(scope): description
test(scope): description
chore(scope): description
```

---

## SMS Pipeline (Deep Dive)

The most complex subsystem. Four layers:

```
1. sms-reader.ts        — Reads raw SMS from Android inbox via native module
                          Filters by bank senders + user-claimed senders
                          Paginated: 500 per batch, uses rawCount for pagination decisions

2. sms-parser.ts        — Tries hardcoded parsers first (14 private + 11 PSU banks)
                          Falls back to DB template matcher (user-authored templates)
                          Returns ParsedSMS with amount, account, merchant, type, balance

3. sms-orchestrator.ts  — Deduplicates against existing expenses (±5 days, same amount)
                          Routes credits vs debits
                          Applies account filtering (user's selected scan accounts)
                          Logs scan runs to sms_scan_runs table

4. sms-to-expense.ts    — Creates pending expense/credit rows
                          Links to financial accounts (card last-4 or nickname match)
                          Applies Smart Rules for auto-categorization
```

User templates (Smart SMS Templates) allow teaching the app new SMS formats:
- `services/sms/user-sms-templates.ts` — CRUD + diagnose + test
- `services/sms/template-compiler.ts` — Compiles tagged spans to regex
- `services/sms/sms-normalize.ts` — 9-step normalization (applied symmetrically at compile + match time)
- Sender routing: `sender_match_mode` (code/exact/contains) + `sender_pattern`

---

## Balance & Ledger Model

```
financial_accounts          — Master list of accounts (bank, CC, wallet, demat, loan, pension)
account_month_balances      — Opening balance per account per month (chain anchor)
expenses                    — All transactions (debits, credits, forecasts)
account_transfers           — Inter-account movements
account_credits             — Incoming money (salary, refunds, settlements)

Closing balance = Opening − expenses + credits ± transfers ± adjustments
Next month's opening = This month's closing (chain)
```

Key services:
- `account-balance.ts` — Chain building (`getOrCreateMonthBalance` recursive), computed balances, month summaries
- `balance-source.ts` — SMS vs manual balance provenance, staleness detection
- `financial-account.ts` — Account CRUD, linking expenses to accounts

---

## Loan Engine

Full amortization with prepayment support:
- `services/loan-engine.ts` — Pure math: `generateSchedule`, `applyPrepayment`, rupee-level rounding
- `services/loan-accounts.ts` — CRUD, schedule rebuild, corrections, outstanding calculation
- Prepayment strategies: reduce_tenure, reduce_emi, trivial path (≤ 1 EMI)
- Manual corrections override computed values from a date forward
- All schedule operations wrapped in transactions for safety

---

## Feature Flags

`services/feature-flags.ts` — boolean flags for gating unreleased features. Check here before assuming a feature is live.

---

## Important Patterns

### Data Version (Cache Invalidation)
Every write operation calls `bumpDataVersion()` which increments an MMKV counter. `useDataRefresh` hook re-runs queries when the version changes. This is how the app stays reactive without a state manager.

### Period Navigator Bounds
`PeriodNavigator` accepts `minMonth` and `maxMonth`. Screens must:
- Set `minMonth` from `getEarliestMonth[ForAccounts]` (earliest data row)
- Set `maxMonth` to current month + 3 (hardcoded future limit)
- This prevents navigation into empty periods

### Preload Pattern
`services/home-preload.ts` runs expensive queries once on app start, caches results. Individual screens consume via `consumeXxxPreload()`. Prevents duplicate work on first render.

### Account Types
`bank`, `credit_card`, `wallet`, `demat`, `loan`, `pension`, `savings`

Each type has different UI treatment in account-detail, different balance semantics, and different ledger behavior.
