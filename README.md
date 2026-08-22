# Arth · अर्थ

A personal finance app for Android, built with React Native and Expo. Tracks expenses, budgets, accounts, investments, family ledgers, loans, and more — 100% local, zero cloud dependency.

**Current version: v2.14.4**

---

## Features

### Expense Tracking
- Manual entry and automatic detection from bank SMS (25+ Indian banks — private and PSU)
- Review queue: all auto-detected data goes through approve / edit / reject before counting in balances
- Duplicate detection with one-tap resolution
- Expense splits — equal, I owe full, they owe full, by percentage, or by exact amount
- Hisaab settlements — mark a credit as repayment from a split
- Refund tracking — link refund credits back to the original expense
- Split-tender purchases — log a single purchase paid across multiple accounts/cards
- Tags, merchant names, categories, payment modes
- Smart Rules — auto-categorize, tag, set payment mode, description, auto-approve, and split based on merchant/amount/category conditions; apply retroactively to past expenses
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
- Close / reopen accounts — closed accounts are hidden from active views but history remains fully browsable

### Goals & Planning
- **Investment Buckets** — track contributions against yearly targets
- **Life Milestones** — savings goals with projected completion dates
- **Balance Sheet** — net worth snapshot (assets vs liabilities)
- **Year-over-Year** — multi-year income, expense, and savings comparison
- **Financial Health** — scored grade (A+ to F) across savings rate, debt, diversification, emergency fund, and spending discipline; detailed report available in Settings
- **Retirement Report** — readiness score, drawdown timeline, insurance coverage adequacy
- **Salary Calculator** — take-home income under old or new Indian tax regime

### Cashflow Simulator
- Simulates projected account balances using approved expenses, upcoming dues, and forecasts
- Links simulator entries to realized transactions for tracking plan vs actual

### Recurring Reminders
- Set reminders on any expense (weekly, monthly, quarterly, yearly)
- Home card auto-matches due reminders to exact-amount expenses — approve, skip, or dismiss inline
- Reminder detail screen with full fulfillment history
- Linked reminder badge on expense detail taps through to the reminder

### Family Ledger (Hisaab)
- Track money lent to or borrowed from anyone
- Running balance per person with settlement history
- Linked to expenses — expense splits automatically create hisaab entries

### Insurance & Risk Coverage
- Track term, health, home, car, and life insurance policies
- Coverage adequacy heuristics (10× income for term, ₹10L/member for health)
- Integrated into retirement report readiness score

### Insights & Analytics
- Monthly spend vs budget with category breakdown
- Trends, period comparisons, spending patterns
- Right-spend vs discretionary split
- Spending spike detection (categories 2× above 3-month average)
- Date-grouped transaction history (Today / Yesterday / day / date)

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
| AI | llama.rn (on-device, Llama 3.2 3B) |
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
├── services/               # Business logic (105+ service files)
│   └── sms/                # SMS reading, parsing, orchestration, templates
├── database/               # SQLite schema + 64 migrations (schema version 064)
├── utils/                  # Helpers, formatters, validators
├── constants/              # Theme, config, category defaults
├── hooks/                  # Custom React hooks
└── assets/                 # Images, fonts, bundled data, help articles
```

---

## Version History

| Version | Highlights |
|---------|-----------|
| **v2.14.x** | Smart Rules retroactive apply (all actions — category, description, auto-approve, split); split modes by %, exact amount; reminder skip option; financial health grade aligned; account version fix |
| **v2.13.x** | Risk & insurance coverage (term, health, home, car, life policies); retirement report integration; coverage adequacy heuristics |
| **v2.12.x** | Contextual tab headers (pending review count, backup age, budget status); date-grouped transaction history |
| **v2.11.x** | Goals page instant load (preloaded at startup); Investment Buckets + Milestones side-by-side with progress bars |
| **v2.10.x** | Financial Health Report — scored grade (A+ to F) with savings rate, debt, diversification, emergency fund, spending discipline dimensions |
| **v2.9.x** | Bottom sheet keyboard fix on Android; all 13 sheets use `height` behavior; windowSoftInputMode set via app.json |
| **v2.8.x** | Swipe navigation on all tabs (Home 5 pages, Transactions 5 pages, Budget 3 pages); Password Vault; on-device AI assistant |
| **v2.7.x** | Reconciliation session tracking; statement import groundwork |
| **v2.6.x** | Applied rule IDs — expenses carry the rule that processed them; "Processed by rule" badge on expense detail |
| **v2.5.x** | On-device Llama 3.2 3B model support; Smart SMS Templates — visual tag-builder for custom bank formats |
| **v2.14.0** | Close / reopen flow for all account types (bank, wallet, pension, demat, credit card, loan) |
| **v2.13.0** | Insurance policies + retirement report integration |
| **v2.12.0** | Contextual headers + date-grouped transactions |
| **v2.11.0** | Goals preloading + side-by-side plan cards |
| **v2.10.0** | Financial Health Report |
| **v2.9.0** | Bottom sheet keyboard fix |
| **v2.8.0** | Swipe pages + Password Vault + AI assistant |

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

MIT License

Copyright (c) 2026 Sourav Baid

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
