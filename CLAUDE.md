# Arth — CLAUDE.md

## What This Is

Personal finance app for Android. React Native + Expo, 100% local (SQLite + MMKV). No cloud.

**Owner:** Sourav Baid (non-technical user building this as a personal tool)
**Repo:** github.com/kaiser7292/artha

### Naming: "Arth" vs "Artha"
The app was rebranded from **Artha** to **Arth** (commit `815a3e2`, 2026-05-22) — every user-visible string (home screen, onboarding, settings, help articles, etc.) now says "Arth." **"Artha" intentionally remains** at the technical layer only: GitHub repo name, Android package id (`com.souravbaid.artha`), Expo slug/scheme, and the backup file's internal `MAGIC_HEADER`/legacy `.artha` extension (kept for backward compatibility). When discussing the product with the owner, call it **Arth**; "Artha" in code/config/docs below refers to the project, not a naming bug.

---

## Quick Reference

| What | Where |
|------|-------|
| **Where's the problem? (start here for bug reports)** | `.context/FEATURE_MAP.md` |
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
├── services/               # Business logic (105 service files)
│   ├── sms/                # SMS reading, parsing, orchestration, templates
│   ├── docs/               # Help center article service
│   ├── analytics/          # Analytics computation
│   └── public-data/        # Bundled reference data (IFSC, MCC, templates)
├── database/               # SQLite schema + migrations (49 migration files, schema version 051)
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
2. **Balance chain model** — `account_month_balances` stores opening balances; closing = opening − expenses + credits ± transfers ± adjustments. Chain builds forward from a seeded month.
3. **SMS pipeline** — `sms-reader → sms-parser → sms-orchestrator → sms-to-expense`. Reader fetches raw SMS, parser extracts fields, orchestrator deduplicates + routes, sms-to-expense creates pending expenses.
4. **Review queue** — All auto-detected data goes through approve/edit/reject before appearing in reports.
5. **Fiscal year** — Indian FY (Apr 1 – Mar 31) default. Drives yearly plans, savings rates, YoY.
6. **Soft delete everywhere** — `deleted_at` column, 30-day auto-purge, restorable from recycle bin.
7. **Single source of truth for transactions** — Migration 005 unified credits + debits + ledger adjustments into the `expenses` table. `nature` column distinguishes them. The legacy `account_credits` table is kept only for backward-compat during restore.

---

## Working Rules

### Propose Before Coding
Do not modify code without the user's explicit approval. Present changes verbally or as diffs first.

### Database Changes Checklist (CRITICAL — easy to miss)
Every time you add/modify a table or column, ALL of these must happen together:
1. **Create a numbered migration** in `database/migrations/NNN_description.ts` — use `ALTER TABLE` with a `PRAGMA table_info` idempotency guard
2. **Register it** in `database/migrations/index.ts` (import + add to the `migrations` array)
3. **Add the column to TABLE_SCHEMAS.ts** — without this, backup/restore SILENTLY drops the column data because restore filters columns through this whitelist (`Object.keys(row).filter(col => allowedSet.has(col))`)
4. **Add the table to BACKUP_TABLES** in `services/backup.ts` if it's user data
5. **Update cascade paths** in `data-cleanup.ts`, `permanentlyDeleteExpense`, `hardDeletePerson`
6. **Update mock objects** in test files
7. **Update any SQL query that references the column** — particularly `SELECT id, account_id, …, your_new_col, …` queries scattered across services

**The classic trap (May 2026 incident):** Migration 023 added `source_sms_address` to `account_transfers`. Later a query started selecting `source_sms_address` from `expenses` (a different table) on the assumption it existed there too. The query failed with "no such column", which silently crashed the entire account-ledger data-load callback — balance summary updated correctly (different query path) but the transaction list stayed empty. Lesson: every column referenced in SQL must have a migration adding it to the SPECIFIC table being queried.

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

### Build (Windows — the actual machine this runs on)
```powershell
# 1. Stop any running Gradle daemons
Get-Process -Name "java" -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Prebuild (applies config plugins — do NOT use --clean unless deps changed)
npx expo prebuild --platform android

# 3. Build APK
cd android; .\gradlew assembleRelease

# 4. Release (from repo root)
gh release create vX.Y.Z "android/app/build/outputs/apk/release/app-arm64-v8a-release.apk" --title "vX.Y.Z" --notes "..."
```
Output APK is `app-arm64-v8a-release.apk` (~120 MB). See `.context/BUILD_AND_RELEASE.md` for full details.
GitHub Actions auto-builds on push to staging/main (not master).

### Git Convention
```
feat(scope): description
fix(scope): description
test(scope): description
chore(scope): description
```

### Working Reference Versions
The latest GitHub release (currently v2.11.3) ships an APK that the user trusts as a known-good baseline. When a regression appears, diffing against the working tag is faster than guessing — `git diff <tag>..HEAD -- <path>`.

---

## SMS Pipeline (Deep Dive)

The most complex subsystem. Four layers:

```
1. sms-reader.ts        — Reads raw SMS from Android inbox via native module
                          Filters by bank senders + user-claimed senders
                          Paginated: 500 per batch (rawCount-driven, not filtered count —
                          a 500-msg page with 0 bank SMS still has more pages)

2. sms-parser.ts        — Tries hardcoded parsers first (14 private + 11 PSU banks +
                          EPFO + insurance/utility patterns in services/sms/bank-patterns.ts)
                          Falls back to DB template matcher (user-authored templates)
                          Returns ParsedSMS with amount, account, merchant, type, balance
                          ALSO returns unrecognizedSms[] and skippedSms[] for scan logging

3. sms-orchestrator.ts  — Single entry point: runSmsScan({ manual, accountIds })
                          Phase 1: read SMS from device
                          Phase 2: parse (hardcoded → user templates)
                          Phase 3: account filtering (POST-parse, so user templates
                                   match before filter — pension uses cardLast4 OR
                                   merchant-substring match)
                          Phase 4: process (create expenses/credits)
                          Phase 5: build scan_run + scan_details for the Scan Runs UI
                          Logs ALL outcomes — passed, filtered, unrecognized, skipped —
                          with raw body so user can search/inspect later

4. sms-to-expense.ts    — Creates pending expense/credit rows
                          Calls linkExpenseToAccount (loose match: account_identifier
                          equals cardLast4, ignores bank_name/account_type)
                          Applies Smart Rules for auto-categorization

5. expense-crud.ts      — On approveExpense: if a credit has no account_id and a raw
                          SMS body, retries discoverOrUpdateAccount (strict bank+type
                          match) with linkExpenseToAccount fallback (loose match).
                          Final safety net for accounts created AFTER the SMS arrived.
```

User templates (Smart SMS Templates) let users teach the app new SMS formats:
- `services/sms/user-sms-templates.ts` — CRUD + diagnose + test
- `services/sms/template-compiler.ts` — Compiles tagged spans to regex
- `services/sms/sms-normalize.ts` — 9-step normalization (applied symmetrically at compile + match time)
- Sender routing: `sender_match_mode` (code/exact/contains) + `sender_pattern`

### Scan Runs UI (`/settings/sms-scan-runs`)
Each run logs `sms_scan_runs` (summary) + `sms_scan_details` (per-SMS rows: hardcoded / template / filtered / unrecognized / skipped). Tapping a category shows the full raw SMS body (`sms_body_preview` stores up to 500 chars) plus a parsed-fields table (Amount/Merchant/Type/etc.). Search inside the category page filters by body, sender, or merchant. Hardware back navigates view-modes (category → drilldown → list) before leaving the screen.

---

## Balance & Ledger Model

```
financial_accounts          — Master list (bank/savings, credit_card, wallet, demat,
                              loan, pension)
account_month_balances      — Opening balance per (account_id, month) — UNIQUE constraint.
                              Acts as the chain anchor. NULL if user hasn't seeded.
expenses                    — Unified table for ALL transactions:
                                nature='realized'           — debits
                                nature='credit'             — credits/refunds
                                nature='ledger_adjustment'  — manual reconciliation
                                nature='forecast'           — pending dues
                              Columns: account_id (FK), amount, date, status
                              ('approved' / 'pending_review' / 'rejected'), source
                              ('manual' / 'sms_auto'), raw_source_text, source_sms_address
account_transfers           — Inter-account movements (from_account_id → to_account_id)
account_credits             — LEGACY: kept only for restore back-compat. New credits go
                              to expenses. Migration 005 already promoted old rows.
hisaab_persons / entries    — Family ledger (lending/borrowing). Linked to expenses via
                              expense_splits.hisaab_entry_id and hisaab_entries.linked_expense_id
expense_splits              — Bridge: maps an expense to one-or-more hisaab persons +
                              their share + the resulting hisaab_entry. After backup
                              restore, this is the canonical source for re-linking
                              hisaab → expense if linked_expense_id was lost.
```

### Closing balance formula
- **savings / wallet / pension / loan**: `closing = opening − expenses + credits − transfersOut + transfersIn + adjNet`
- **credit_card**: `closing = opening + expenses − credits + transfersOut − transfersIn + adjNet`
  (utilized model — opening seeds at 0 each cycle, autoSeedCreditCards resets monthly)

### Two paths for ledger balance computation
1. **Seeded path** (`isAccountSeeded` returns true → at least one `account_month_balances` row exists for this account):
   `getMonthBalanceSummary(accountId, month)` → `getOrCreateMonthBalance` finds/creates the opening row, applies self-heal if `is_manual_override=0` (re-anchors opening to the actual previous-month closing), then sums the components.
2. **Unseeded path** (no anchor row anywhere): `computeUnseededBalance` chains forward from the EARLIEST account activity month with opening=0.

`getOrCreateMonthBalance` is intentionally NON-recursive — a previous attempt at recursive chain-building hit UNIQUE constraint errors in production and crashed the entire ledger load. If a gap exists between seed and viewed month, the unseeded path is the safe answer.

### Account Ledger Screen Data Flow (`/reconciliation/account-ledger`)
The single most error-prone callback in the app. Lives in `useDataRefresh(useCallback(...))`. The order matters:

1. Fetch accounts → derive `isPoolCC`, `ledgerAccountIds` (1 for non-CC, N siblings for shared-pool CCs)
2. `isAccountSeeded` → branch into seeded vs unseeded balance path
3. `setOpening / setTotalExpenses / setTotalCredits / setClosing` (header card)
4. Three parallel queries: `getLedgerExpenses` (debits + ledger_adjustments), `getCreditsForMonth` (credits), `getTransfersForMonth` (transfers in/out)
5. Build account name maps (active + inactive) for transfer counter-account display
6. Resolve hisaab person names (split expenses) and settlement links (credit ↔ hisaab)
7. Push all rows into a single `LedgerEntry[]` array, sort by date desc, `setEntries`

**Critical:** any unhandled exception between steps 3 and 7 leaves the UI showing CORRECT balances (set in step 3) but ZERO transactions (`entries` never gets set). The historical bug class here is "non-existent column in SELECT" — see the migration trap above. When debugging "balance shows but no transactions", the suspect is always: (a) a missing column referenced by `getLedgerExpenses` / `getCreditsForMonth` / `getTransfersForMonth`, or (b) an enrichment query (`getAllAccounts`, `getPersonsByIds`, `getSettlementsForCredits`) throwing.

### Manual credit / transfer from FAB
"Add Credit" / "Add Transfer" in the account-ledger FAB defaults the date to **today if today is in the viewed month, otherwise the first day of the viewed month**. Without this, viewing a past month and clicking Add Credit would default to today, write the credit to the current month, and the user would see the balance update somewhere else but no row in their viewed month. Don't regress this.

---

## Loan Engine

Full amortization with prepayment support:
- `services/loan-engine.ts` — Pure math: `generateSchedule`, `applyPrepayment`, rupee-level rounding
- `services/loan-accounts.ts` — CRUD, schedule rebuild, corrections, outstanding calculation
- Prepayment strategies: reduce_tenure, reduce_emi, trivial path (≤ 1 EMI)
- Manual corrections override computed values from a date forward
- All schedule operations wrapped in transactions for safety

---

## Backup & Restore

`services/backup.ts` exports the entire DB to an encrypted JSON file (AES-GCM). Restore is destructive: DELETE all rows in `BACKUP_TABLES` (reverse order, FKs OFF), then INSERT in forward order using `INSERT OR REPLACE`.

### Restore safety pitfalls
- **Column whitelist**: only columns in `TABLE_SCHEMAS[table]` are inserted. A column missing from the whitelist gets silently dropped on restore — even if the backup file has data for it.
- **`INSERT OR REPLACE` semantics**: REPLACE = DELETE + INSERT. Columns NOT in the INSERT list reset to their schema DEFAULT (usually NULL). Always restore via the table's full whitelist.
- **Post-restore repair steps** (run inside the same transaction):
  1. Promote legacy `account_credits` rows into `expenses` with `nature='credit'` (migration-005 semantics on legacy backups).
  2. Set `nature='credit'` on rows with `refund_of_expense_id IS NOT NULL` that ended up as 'realized'.
  3. Re-link `hisaab_entries.linked_expense_id` from `linked_account_credit_id` (legacy schema).
  4. Re-link `hisaab_entries.linked_expense_id` from `expense_splits.expense_id` when null but the bridge row exists. This is the canonical recovery path for a lost split↔expense link.
- **`PRAGMA foreign_keys = OFF`** before restore, ON after. Without this, FKs cascade-delete during restore.

### Migration ordering caveat
Migrations run on an empty DB BEFORE restore inserts. Any migration that needs to "promote" existing rows must be re-run as a post-restore step (because it ran when the DB was empty).

---

## Feature Flags

`services/feature-flags.ts` — boolean flags for gating unreleased features. Check here before assuming a feature is live.

---

## Important Patterns

### Data Version (Cache Invalidation)
Every write operation calls `bumpDataVersion()` (an MMKV counter). `useDataRefresh` hook subscribes to changes and re-runs the load callback **only while the screen is focused**. This is how the app stays reactive without a state manager. Other screens reload on next focus.

### useDataRefresh Hook
`hooks/use-data-refresh.ts` runs the load callback on (a) screen focus and (b) data-version changes. The callback is held in a ref so it always uses the latest closure. Critical: the callback has NO try/catch wrapper — if it throws, `entries` (or whatever final state) never gets set. Wrap individual risky operations in try/catch when their failure shouldn't tank the whole load.

### Period Navigator Bounds
`PeriodNavigator` accepts `minMonth` and `maxMonth`. They DON'T clamp the value — they only disable the chevron and grey out invalid picker cells. The user can still call `setMonth` directly to any value. Most reconciliation list screens (bank-accounts, wallets, pension-accounts) are intentionally UNBOUNDED so users can navigate freely; the individual account-ledger and account-detail screens are also unbounded to match.

### Preload Pattern
`services/home-preload.ts` runs expensive queries once on app start, caches results. Individual screens consume via `consumeXxxPreload()`. Each consume clears its slot — single-use, no stale data on re-entry.

Call `consumeXxxPreload()` at **module level** (outside the component function) so it fires once when the module loads, not on every render. Initialize all state from the preloaded value so the screen renders immediately without a loading spinner:
```ts
const preloaded = consumeGoalsPreload();

export default function GoalsScreen() {
  const [fyBuckets, setFyBuckets] = useState(preloaded?.fyBuckets ?? []);
  const [setupChecked, setSetupChecked] = useState(preloaded != null);
  // ...
}
```
The `GoalsPreloadData` interface includes: `cockpit`, `fyMilestones`, `fyBuckets`, `hasSalaryProfile`, `activeLoansCount`, `totalMonthlyEMI`, `fy`.

### Budget Tab — Inline Swipe Pages
The Budget tab (`app/(tabs)/budget.tsx`) uses `SwipePager` with three inline pages:
1. **Overview** — category spend list
2. **Spending Split** — pie chart breakdown
3. **Monthly Summary** — inline `MonthlySummaryPage` component (NOT `router.push`)

`MonthlySummaryPage` (`components/budget/MonthlySummaryPage.tsx`) is the inline version of `app/summary/[month].tsx`. It receives `{ month: string }` and uses `useDataRefresh` for reactivity. Lazy-mounted via `visitedMonthly` state flag — placeholder `<View style={{ flex: 1 }} />` until first visit.

### Account Types
`bank` (alias for `savings`), `credit_card`, `wallet`, `demat`, `loan`, `pension`, `savings`

Each type has different UI in account-detail, different balance semantics, and different ledger behavior. EPFO/pension matches via `cardLast4` OR substring of `account_identifier` against parsed merchant — uniquely loose because UANs don't fit cleanly in 4 digits.

### Splits & Hisaab
Creating an expense with split data writes:
1. The expense row (with `split_person_id`, `split_pct`, `split_original_amount`, `split_hisaab_entry_id`)
2. An `expense_splits` row (the bridge)
3. A `hisaab_entries` row (the family-ledger entry, with `linked_expense_id`)

All three must travel together through backup/restore. The post-restore repair step uses `expense_splits` as the canonical bridge to recover the hisaab → expense link if `linked_expense_id` was lost.

---

## Goals Screen Architecture (`app/(tabs)/goals.tsx`)

Three sections: **Plan**, **Track**, **Analyse**. Driven entirely by preloaded + refreshed data — no `useCockpitData` hook dependency.

### Plan section (2-col grid)
- **Investment Buckets** card → `/goals/investment-buckets` — shows bucket count, contributed vs target, progress bar
- **Life Milestones** card → `/goals/milestones` — shows milestone count, next upcoming, progress bar

### Track section (list)
- **Loans & Debt** → `/goals/loans` — active loan count + monthly EMI
- **Balance Sheet** → `/goals/balance-sheet` — net worth (loaded async after page is visible)

### Analyse section (list)
- **Year-over-Year** → `/goals/yoy-comparison`
- **Income Calculator** → `/goals/salary-calculator`

### Financial Health card (top)
Shows savings rate + saved-this-FY. Guards:
- "of X% target" subtitle: only shown when `targetRatePct > 0`
- Progress bar: only shown when `targetSavings > 0`
- Advisory strip: only shown when `cockpitData.advisories.length > 0`

### Loading strategy
- `setupChecked` starts as `true` when preloaded data is available → no spinner on first open
- Balance sheet (`getBalanceSheetColumn`) is fetched **after** `setSetupChecked(true)` in a separate try/catch — it's heavy and must never block the page render
- `cockpit` is fetched inline via `useDataRefresh` alongside all other data (NOT via `useCockpitData` hook)

---

## APK Build Infrastructure

### Config plugins (`plugins/`)
| Plugin | File | Effect |
|--------|------|--------|
| `withArmOnly` | `plugins/withArmOnly.js` | ABI splits → arm64-v8a only APK (~120 MB vs ~210 MB) |
| `withAapt2Fix` | `plugins/withAapt2Fix.js` | Pins AAPT2 binary to prevent Windows AGP 8.11+ crash |
| `withDisableBackup` | `plugins/withDisableBackup.js` | Disables Android cloud backup |
| `withLargeHeap` | `plugins/withLargeHeap.js` | `android:largeHeap="true"` |
| `withNotificationListener` | `plugins/withNotificationListener.js` | Notification listener service |

All registered in `app.json` under `expo.plugins`. Applied automatically on every `expo prebuild`.

### APK size reality
- `llama.rn` (AI assistant) contributes ~60 MB of arm64 native libs (6 CPU-variant `.so` files for runtime dispatch). Cannot be reduced without removing the AI feature.
- The remaining ~60 MB is React Native core (`libreactnative.so`, Hermes, etc.) + JS bundle + assets.

### Bank accounts — transfers display
`BankBalanceSummary` (home hero card) and `bank-accounts.tsx` both show Transfers Out / Transfers In rows. These come from `getTransfersOutTotal` / `getTransfersInTotal` (month-range aware, in `services/account-transfer.ts`). `getComputedBalanceComponents` already returns `transfersOut`/`transfersIn` for the current month in `BankBalanceSummary`.

---

## Common Failure Patterns (and where to look first)

| Symptom | Likely Cause | First Place to Look |
|---------|--------------|---------------------|
| Balance summary shows correct numbers but transaction list is empty | A query in the ledger load callback threw (missing column, FK error, etc.) | `app/reconciliation/account-ledger.tsx` `useDataRefresh` callback; check what `getLedgerExpenses` / `getCreditsForMonth` / `getTransfersForMonth` SELECT |
| New SMS-detected credit not visible in account ledger but appears in Transactions tab | `linkExpenseToAccount` failed at SMS-time → `account_id` is NULL → ledger filters by `account_id = ?` | `services/expense-crud.ts:approveExpense` retries this; also check user template account match |
| Hisaab linkage gone after backup restore | Backup had data; restore dropped a column or post-restore repair didn't run | `services/backup.ts` post-restore SQL (lines that set linked_expense_id from account_credits / expense_splits) |
| Pension balance reads zero when user hasn't seeded | `getMonthBalanceSummary` returns null for unseeded accounts | Use `computeUnseededBalance` (chains from earliest activity, opening=0). Don't try to seed via `addCredit` — the recursive seeding caused UNIQUE constraint errors. |
| Manual credit added from FAB invisible in viewed month | FAB was defaulting date to today; user viewing a past month | `account-ledger.tsx` FAB onPress: `today >= startDate && today <= endDate ? today : startDate` |
| SMS Scan Runs UI shows "no scan history" | Error path didn't call `saveScanRun` before returning | `services/sms/sms-orchestrator.ts` — every exit path (read error, no SMS, catch block) must log a run |
| "balance updated but no transaction row" right after adding a credit/transfer | Date mismatch (FAB) OR the data-load callback threw between `setOpening` and `setEntries` | Same playbook as the empty-list bug above |

---

## What NOT To Do (Lessons Learned)

1. **Don't make `getOrCreateMonthBalance` recursive.** It hit UNIQUE constraint errors and cascaded into "no transactions show" for all accounts. Use `computeUnseededBalance` for gap-handling.
2. **Don't seed `account_month_balances` from `addCredit`.** Same root cause — surprise inserts collide with the chain.
3. **Don't add SQL columns without a migration AND a TABLE_SCHEMAS entry AND backup-list entry.** All three. Missing any one corrupts data silently on restore.
4. **Don't add minMonth/maxMonth to ledger PeriodNavigators just because they support it.** Several screens are intentionally unbounded; user wants free navigation.
5. **Don't use optimistic local state filtering after bulk approve/reject.** Use `loadItems()` for a full reload — duplicates and uncategorized counts depend on it.
6. **Don't assume a column exists on `expenses` because it exists on `account_transfers`.** They're sibling tables — check the migration that added it.
7. **Don't use `ndk { abiFilters }` and `splits { abi }` together.** They conflict in AGP 8+ and will crash the build. Use `splits` (via `withArmOnly` config plugin) — it subsumes `abiFilters`. Never add `ndk.abiFilters` back to `build.gradle`.
8. **Don't edit `android/app/build.gradle` or `android/gradle.properties` directly.** Both files are regenerated by `expo prebuild`. All permanent build customisations must go in a config plugin in `plugins/`.
9. **Don't call `consumeXxxPreload()` inside a component function.** It must be at module level — calling it inside the component runs it on every render and always gets `null` after the first consume.
10. **Don't show UI elements that depend on unset targets.** Guard with `targetValue > 0` before rendering progress bars, "of X target" subtitles, etc. (e.g. Financial Health card in Goals).
