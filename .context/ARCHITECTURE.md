# Architecture

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | React Native | 0.81.5 |
| Platform | Expo | 54.0.33 |
| Navigation | Expo Router (file-based) | 6.0.23 |
| Styling | NativeWind (Tailwind CSS for RN) | 4.2.3 |
| State | React hooks (useState/useCallback/useMemo) | — |
| Database | expo-sqlite | 16.0.10 |
| KV Store | react-native-mmkv | 3.3.3 |
| Animations | react-native-reanimated | 4.1.1 |
| Charts | react-native-svg (custom) | 15.12.1 |
| Testing | Jest + jest-expo + @testing-library/react-native | 29.7.0 |
| TypeScript | typescript | 5.9.2 |
| Node.js | (via .nvmrc) | 25.5.0 |
| Linting | ESLint (expo config) + Prettier | — |

## Directory Structure

```
~/accounts-manager-app/
├── app/                        # Expo Router pages (file-based routing)
│   ├── (lock)/                 # Biometric lock screen
│   ├── (onboarding)/           # First-run onboarding flow
│   ├── (tabs)/                 # Bottom tab navigation (Home, Transactions, Budget, Settings)
│   ├── budget/                 # Budget drill-down screens
│   ├── expense/                # Add/edit/detail expense screens
│   ├── goals/                  # Yearly plan, milestones, investments, balance sheet, YoY
│   ├── hisaab/                 # Hisaab person ledger
│   ├── insights/               # Analytics, compare, patterns, forecast, drills
│   ├── loans/                  # Loan add/detail screens
│   ├── reconciliation/         # Account ledger, credit cards, bank, wallet, demat
│   ├── settings/               # All settings screens (nested)
│   │   ├── help/               # In-app help center
│   │   ├── smart-rules/        # Smart rule management
│   │   └── sms-templates/      # User SMS template authoring
│   ├── simulator/              # Cash-flow simulator
│   └── summary/                # Monthly summary
├── components/                 # Reusable UI components
│   ├── ui/                     # Generic (Button, Card, Input, Modal, etc.)
│   ├── expense/                # Expense-specific (sheets, pickers, metadata)
│   ├── budget/                 # Budget-specific
│   ├── goals/                  # Goal/milestone components
│   ├── hisaab/                 # Hisaab export picker, split sheets
│   ├── home/                   # Home tab cards (bank summary, loan, demat, etc.)
│   ├── loans/                  # Prepayment/correction sheets
│   ├── charts/                 # Chart wrappers (DonutChart, TrendBarChart, TrendLineChart)
│   ├── simulator/              # Simulator sheets (entry edit, stale resolve, hisaab)
│   ├── account/                # Account detail components (BalanceSourceCard)
│   ├── analytics/              # Insight cards, pattern components
│   ├── cockpit/                # Financial cockpit (legacy)
│   └── sms-templates/          # SMS template UI components
├── services/                   # Business logic layer (90+ service files)
│   ├── sms/                    # SMS parsing subsystem
│   ├── public-data/            # Bundled data (IFSC, MCC, merchant brands, SMS templates)
│   ├── analytics/              # Analytics engine (classifier, patterns, forecast)
│   └── docs/                   # Help article service
├── database/                   # SQLite schema and migrations
│   ├── migrations/             # 41 migration files (001–041)
│   ├── defaults/               # Seed data (categories, payment modes, merchant mappings)
│   ├── database.ts             # DB initialization
│   ├── seed.ts                 # Seed runner
│   ├── TABLE_SCHEMAS.ts        # Column whitelist (backup validation)
│   └── index.ts                # Barrel export
├── utils/                      # Pure utility functions
├── constants/                  # Theme, colors, routes, currencies, icons
├── hooks/                      # Custom React hooks
├── assets/                     # Static assets
│   ├── data/                   # Bundled JSON data files
│   ├── docs/articles/          # Help center markdown articles (28)
│   ├── fonts/                  # Custom fonts
│   └── images/                 # App icons, splash, logo concepts
├── __tests__/                  # Test suites
│   ├── unit/                   # Unit tests (~55 files)
│   ├── integration/            # Integration tests (~14 files)
│   └── fixtures/               # Test data fixtures
├── docs/                       # Version documentation
│   ├── MVP/                    # PRD, TDD, MASTER_PLAN, DEVOPS, SECURITY, TEST_STRATEGY
│   ├── V1/ through V17/       # Per-version docs (PRD, TDD, MASTER_PLAN)
│   └── internal/               # Internal planning docs
├── bin/                        # Build scripts
│   ├── build-apk.sh            # Direct Gradle build wrapper
│   └── artha-release.keystore  # Signing keystore (committed, stable)
├── plugins/                    # Expo config plugins
│   ├── withDisableBackup.js    # Disable Android auto-backup
├── .claude/                    # Claude Code project settings
└── .maestro/                   # E2E test flows (Maestro, placeholder)
```

## Data Flow

```
SMS arrives on device
    ↓
sms-reader.ts (reads via react-native-get-sms-android)
    ↓
sms-parser.ts (hardcoded bank parsers → template fallback)
    ↓
sms-to-expense.ts (creates expense with status='pending')
    ↓
Review Queue (user approves/rejects/edits)
    ↓
expense-crud.ts (writes to SQLite)
    ↓
bumpDataVersion() (MMKV signal)
    ↓
useDataRefresh hook (all screens re-render with fresh data)
```

## State Management Pattern

- **No global state library** (no Redux, no Zustand, no MobX)
- Each screen loads its own data via service calls on mount/focus
- `useDataRefresh()` hook subscribes to MMKV `data_version` key — any write bumps this counter, triggering re-fetch on all mounted screens
- `React.memo` on expensive list items and chart components
- `useMemo` for derived computations (filtered lists, aggregations)
- MMKV for device-local preferences (not backed up): theme, biometric settings, duplicate dismissals, min-balance acks

## Database Architecture

- **SQLite** via expo-sqlite (single DB file on device)
- **41 migrations** (numbered 001–041), run sequentially on app start
- **TABLE_SCHEMAS.ts** — column whitelist for backup validation
- **No ORMs** — raw SQL with parameterized queries (security: no string interpolation)
- **Transactions** (`db.withTransactionAsync`) for multi-step deletes/cascades
- **Indexes** — partial indexes for hot-path queries (expenses, transfers, contributions)
- **Foreign keys** — enforced via `PRAGMA foreign_keys = ON`

## Key Architectural Patterns

1. **Service layer separation** — UI components never write SQL directly; all DB access goes through `services/`
2. **Data version bumping** — every mutation calls `bumpDataVersion()` to signal UI refresh
3. **Barrel exports** — services have index files for clean imports
4. **File-based routing** — screen paths match URL structure exactly
5. **Bottom-sheet pattern** — complex inputs use slide-up sheets (not new screens)
6. **Soft delete** — `deleted_at` column pattern; recycle bin with 30-day auto-purge
7. **Backup round-trip** — every table in BACKUP_TABLES must survive export→import cycle
