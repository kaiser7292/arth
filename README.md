# Arth · अर्थ

A personal finance app for Android, built with React Native and Expo. Tracks expenses, budgets, accounts, investments, family ledgers, loans, and more — 100% local, zero cloud dependency.

**Current version: v1.15.0**

---

## Features

### Expense Tracking
- Manual entry and automatic detection from bank SMS (25+ Indian banks — private and PSU)
- Review queue: all auto-detected data goes through approve / edit / reject before counting in balances
- Duplicate detection with one-tap resolution
- Expense splits (single person or multi-person with percentage, exact, or equal modes)
- Hisaab settlements — mark a credit as repayment from a split
- Refund tracking — link refund credits back to the original expense
- Split-tender purchases — log a single purchase paid across multiple accounts/cards
- Tags, merchant names, categories, payment modes
- Smart Rules — auto-categorize, tag, set payment mode, and more based on merchant/amount conditions
- Formula input — type `=10000*18%` in any amount field; live preview evaluates on blur
- Recycle bin — 30-day recovery for all deleted expenses

### Accounts & Reconciliation
- **Savings / Bank accounts** — monthly ledger with opening/closing balance chain
- **Credit cards** — utilized balance model, monthly statement reconciliation
- **Wallets** — UPI wallets, cash
- **Demat portfolio** — snapshot-based P&L, invested vs current value, idle fund tracking
- **Pension / EPFO** — contribution tracking with YTD summary
- **Loans** — full amortization schedule, prepayment (reduce-tenure or reduce-EMI), manual corrections
- Account transfers with inter-account navigation
- Reclassify any expense or credit as a transfer without re-entering data

### Cashflow Simulator
- Simulates projected account balances using a mix of approved expenses, upcoming dues, and forecasts
- Links simulator entries to realized transactions for tracking plan vs actual

### Recurring Reminders
- Set reminders on any expense (weekly, monthly, quarterly, yearly)
- Home card auto-matches due reminders to exact-amount expenses — approve or dismiss inline
- Reminder detail screen with full fulfillment history
- Linked reminder badge on expense detail taps through to the reminder

### Family Ledger (Hisaab)
- Track money lent to or borrowed from anyone
- Running balance per person with settlement history
- Linked to expenses — expense splits automatically create hisaab entries

### Insights & Analytics
- Monthly spend vs budget with category breakdown
- Trends, period comparisons, spending patterns
- Year-over-year comparison
- Balance sheet (assets vs liabilities snapshot)
- Yearly plan — investment bucket allocation and progress
- Milestones — savings goals with projected completion dates
- Salary calculator — take-home income under old or new Indian tax regime

### SMS Auto-Detection
- Reads bank SMS from the Android inbox on demand or on a schedule
- 25+ supported banks out of the box (14 private, 11 PSU + EPFO, insurance)
- Smart SMS Templates — teach the app new SMS formats using a visual tag-builder
- Scan Runs history — inspect every parsed, filtered, or unrecognized SMS after a scan
- Scan filtering by account so only relevant SMS are processed

### Backup & Restore
- AES-256-GCM encrypted backups with a user-set password (`.artha` format, backward-compatible)
- Scheduled auto-backup: configurable interval (4h / 6h / 8h / 12h / 24h / 48h), notification-triggered execution
- Safety checkpoints: silent auto-backup before any destructive delete — up to 10 kept, one-tap restore
- Share any backup file directly from the settings screen

### UX & Personalization
- Swipe between tabs (Home, Transactions, Budget, Goals, Settings) with haptic feedback
- Pull-to-refresh on all account screens
- Biometric lock (fingerprint / face unlock)
- Dark mode with 5 accent color themes
- Bilingual branding — Arth · अर्थ
- Built-in help center with searchable articles
- Animated FAB with backdrop
- Devanagari script support throughout

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native + Expo SDK 53 |
| Navigation | Expo Router (file-based routing) |
| Styling | NativeWind (Tailwind CSS for React Native) |
| Database | expo-sqlite (local, on-device) |
| KV Store | react-native-mmkv |
| SMS | react-native-get-sms-android |
| Animations | react-native-reanimated |
| Testing | Jest + React Native Testing Library |
| Build | Local Gradle (`gradlew assembleRelease`) |

---

## Project Structure

```
artha/
├── app/                    # Expo Router pages (file-based routing)
│   ├── (tabs)/             # Bottom tab screens (Home, Transactions, Budget, Goals, Settings)
│   ├── expense/            # Expense add / edit / review
│   ├── reconciliation/     # Account ledger, credit cards, wallets, pension, demat
│   ├── goals/              # Yearly plan, balance sheet, milestones, YoY, loans
│   ├── insights/           # Analytics, comparisons, patterns
│   ├── simulator/          # Cash-flow simulator
│   ├── hisaab/             # Family ledger
│   ├── settings/           # All settings screens
│   └── summary/            # Monthly summaries
├── components/             # Reusable UI components
├── services/               # Business logic (105 service files)
│   └── sms/                # SMS reading, parsing, orchestration, templates
├── database/               # SQLite schema + 54 migrations
├── utils/                  # Helpers, formatters, validators
├── constants/              # Theme, config, category defaults
├── hooks/                  # Custom React hooks
└── assets/                 # Images, fonts, bundled data, help articles
```

---

## Version History

| Version | Highlights |
|---------|-----------|
| **v1.15.0** | Reminder auto-matching (inline approve/dismiss on home card), reminder detail screen, fulfilled-reminder badge taps through |
| **v1.14.0** | Backup scheduling redesign: hourly intervals, notification-triggered execution, share button per backup file |
| **v1.13.0** | Demat withdrawals auto-subtract from idle fund; bug fixes for simulator double-counting and backup reliability |
| **v1.12.0** | Animated FAB menu with backdrop; swipe-between-tabs and pull-to-refresh on account screens |
| **v1.11.0** | Backup notification tap navigates directly to Backup & Restore settings |
| **v1.10.0** | Scheduled auto-backup with configurable daily run time |
| **v1.9.0** | Safety checkpoints — silent auto-backup before destructive deletes, up to 10 kept |
| **v1.8.0** | Demat portfolio navigation fix; snapshot page header cleanup |
| **v1.7.0** | Help center articles; demat snapshot UI spec |
| **v1.6.0** | Formula input keyboard fix; Smart Rules dark-mode fix |
| **v1.5.0** | Formula input on all amount fields (`=` prefix, full BODMAS, `%` shorthand) |
| **v1.4.0** | Milestones YoY comparison fix; investment bucket contribution accuracy |
| **v1.3.0** | Undo Refund; Smart Rules dynamic THEN actions |
| **v1.2.0** | All 8 Smart Rules THEN action types; Devanagari branding restored |
| **v1.1.0** | Cashflow simulator multi-transaction linking; pension account balance fixes |

---

## Architecture Notes

- **100% local** — no server, no sync, no telemetry. SQLite is the single source of truth.
- **Balance chain model** — `account_month_balances` anchors each account's opening balance per month; closing = opening ± transactions.
- **SMS pipeline** — four-stage: reader → parser → orchestrator → expense creator. All outcomes are logged for inspection in Scan Runs.
- **Review queue** — auto-detected data always goes through approve/edit/reject before affecting budgets or balances.
- **Soft delete** — `deleted_at` column everywhere; 30-day auto-purge; restorable from recycle bin.
- **Indian FY** — April–March fiscal year (configurable). Drives yearly plans, savings rates, YoY comparison.

---

## License

Proprietary. All rights reserved.

Closed-source personal software. Not available for use, copying, modification, or redistribution without prior written permission.
