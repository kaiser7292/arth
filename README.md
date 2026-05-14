# Artha (अर्थ)

A personal finance management app for Android, built with React Native and Expo. Tracks expenses, budgets, financial goals, investments, family ledgers, and more — all stored locally on your device with zero cloud dependency.

## Features

- **Expense Tracking** — Manual entry + automatic SMS detection (Indian banks)
- **Budget Management** — Monthly budgets with category-wise allocation and tracking
- **Financial Goals** — Investment buckets, milestones, and progress tracking
- **Hisaab (Family Ledger)** — Track money lent/borrowed with running balances
- **Insights Dashboard** — Spending trends, category breakdowns, period comparisons
- **Recurring Detection** — Auto-detects subscriptions and recurring payments
- **Credit Card Reconciliation** — Track credit card bills against transactions
- **Salary Calculator** — Income tax computation (Indian tax regime)
- **Backup & Restore** — AES-256-GCM encrypted backups (`.accmgr` format)
- **5 Color Themes** — Customizable accent colors with dark mode support
- **Universal Recycle Bin** — Recover any deleted data across all modules
- **Excel Export** — Export expenses and reports as XLSX

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native 0.81 + Expo SDK 54 |
| Navigation | Expo Router (file-based routing) |
| Styling | NativeWind (Tailwind CSS for React Native) |
| Database | expo-sqlite (local, on-device) |
| KV Store | react-native-mmkv (settings, theme) |
| Animations | react-native-reanimated |
| Testing | Jest + React Native Testing Library |
| Build | EAS Build |

## Project Structure

```
├── app/                    # Expo Router pages
│   ├── (tabs)/             # Bottom tab navigator
│   ├── expense/            # Expense screens
│   ├── budget/             # Budget screens
│   ├── goals/              # Investment goals
│   ├── hisaab/             # Family ledger
│   ├── insights/           # Analytics & charts
│   ├── settings/           # Settings & recycle bin
│   └── summary/            # Monthly summaries
├── components/             # Reusable UI components
│   ├── ui/                 # Generic (Card, Button, etc.)
│   ├── expense/            # Expense-specific
│   ├── budget/             # Budget-specific
│   └── charts/             # Chart wrappers
├── services/               # Business logic layer
├── database/               # SQLite schema & migrations
├── utils/                  # Helpers & formatters
├── constants/              # Theme, config, defaults
├── hooks/                  # Custom React hooks
└── docs/                   # Version docs (PRD, TDD, plans)
```

## Getting Started

### Prerequisites

- Node.js 18+
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- Android Studio (for Android builds)
- Java 21 (from Android Studio — Java 24 breaks NDK/CMake)

### Installation

```bash
git clone https://github.com/kaiser7292/artha.git
cd artha
npm install
```

### Development

```bash
npx expo start          # Start dev server
npx expo run:android    # Run on Android device/emulator
```

### Build APK

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
cd android && ./gradlew assembleRelease
```

The APK will be at `android/app/build/outputs/apk/release/app-release.apk`.

### Testing

```bash
npm test                # Run Jest tests
npm run typecheck       # TypeScript type checking
npm run lint            # ESLint
npm run format:check    # Prettier check
```

## Version History

| Version | Highlights |
|---------|-----------|
| **v7.3.0** | Universal recycle bin (9 tabs), bulk actions, account reactivation, expense detail account row |
| **v7.2.0** | Recycle bin tabs, CC reconciliation fixes, SMS scan date range |
| **v6.0.0** | 5 color themes + Gen Z visual overhaul (gradients, rounded corners, bold typography) |
| **v5.0.0** | Security audit remediation, architecture cleanup, performance optimizations |
| **v4.0.0** | Master data management, payment mode detection, insights comparison |
| **v3.0.0** | Excel export, notifications, date pickers, salary FY isolation |
| **v2.0.0** | Income tax rework, UX improvements, tags, insights dashboard |
| **v1.0.0** | Expense split, merchant bucketing, goals rework, color refresh |
| **MVP** | Core expense tracking, budgets, goals, SMS detection, hisaab, salary calculator |

## Architecture

- **100% local** — No cloud, no server, no sync. All data stays on your device.
- **SQLite** — Single database file, protected by OS-level full-disk encryption.
- **Encrypted backups** — AES-256-GCM with user-set password for device migration.
- **Indian FY** — April–March fiscal year (configurable in settings).
- **Review queue** — All auto-detected data goes through approve/edit/reject before affecting balances.

## License

Proprietary. All rights reserved. See [LICENSE](LICENSE) for the full terms.

This is closed-source software. The code is not available for use, copy,
modification, or redistribution without prior written permission. The
Android app is distributed via the Google Play Store for personal end-user
installation only.
