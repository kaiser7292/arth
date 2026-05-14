# Artha (अर्थ) — Project Overview

## What Is Artha?

Artha is a personal finance mobile app for Android (iOS planned) built with React Native + Expo. It replaces Excel-based finance tracking with a full-featured mobile app.

**Current Version:** 17.6.5 (versionCode 170605)
**Repository:** github.com/kaiser7292/artha
**Owner:** Sourav Baid (kaiser7292)

## Core Philosophy

1. **100% local, no cloud** — No server, no sync, no telemetry. SQLite on device (plaintext; protected by OS-level full-disk encryption). Backup/restore via AES-256-GCM encrypted `.accmgr` files.
2. **Manual override on everything** — Every record (auto-detected or manual) supports add/edit/delete.
3. **Indian finance context** — Indian FY (April 1 – March 31), INR as default currency, Indian number formatting (lakhs/crores), PSU bank SMS parsing.
4. **Privacy first** — No analytics, no crash reporting, no network calls. Data never leaves the device except via user-initiated encrypted backup.

## Feature Set (as of v17.6.5)

| Domain | Capabilities |
|--------|-------------|
| **Expense Tracking** | Manual entry, SMS auto-detection (14+ private banks, 11 PSU banks, wallets), categories, tags, payment modes, merchants, split expenses (single/multi-person), split-tender purchases, refunds, credits |
| **Budget** | Monthly budgets per category, rolling surplus, month-end projection with confidence, Spending Pulse, course correction |
| **Hisaab (Family Ledger)** | Per-person ledger, settlements, debits/credits, export to PDF/Excel, opening/closing balance on filtered views |
| **Insights & Analytics** | Spending patterns, lifestyle creep YoY, forecast, merchant analysis, category breakdown, compare periods, insight drills |
| **Goals & Planning** | Yearly plan (income allocation), investment buckets, life milestones, YoY comparison (6 categories), savings rate tracking |
| **Loans & Debt** | Full amortization engine, EMI tracking, prepayments (reduce tenure/reduce EMI), manual corrections, foreclosure quotes, SMS-based installment matching |
| **Investments** | Demat accounts (portfolio + fund snapshots), demat-aware transfers, investment bucket contributions, capital gains tracking |
| **Cash-flow Simulator** | Named scenarios, planned entries (outgoing/incoming/collect/pay-back), fulfillment matching, stale entry resolution, hisaab inclusion, per-account trajectory, warnings |
| **Reconciliation** | Account ledger (bank/CC/wallet/demat/loan), balance source tracking (SMS vs manual), credit card pool management, duplicate detection |
| **Smart Automation** | Smart Rules (auto-categorize by merchant/amount/account), Smart SMS Templates (user-authored regex parsers), Merchant Aliases, Recurring Reminders |
| **Security** | Biometric app lock (fingerprint/face + device passcode fallback), configurable timeout |
| **Data Management** | Encrypted backup/restore, Excel import, data cleanup, recycle bin (soft delete + 30-day auto-purge), audit log |
| **Help Center** | 28 in-app help articles, semantic search with synonyms, context-aware article suggestions |
| **Notifications** | Daily expense reminders, monthly summary, overdue/upcoming reminder alerts, min-balance breach alerts |
| **Personalization** | 5 accent color themes, currency/number format/date format preferences, configurable home cards, saved filter views |

## Key Design Decisions

- No external dependencies for core logic (no Firebase, no Supabase, no Redux)
- SQLite as the single source of truth (41 migrations to date)
- MMKV for device-local settings that don't travel with backup (biometric, theme, filter dismissals)
- File-based routing (Expo Router)
- NativeWind (Tailwind CSS for React Native) for styling
- All DB operations are async; no heavy sync on UI thread
- Universal review queue for all auto-detected data
- Fiscal year drives all yearly computations
