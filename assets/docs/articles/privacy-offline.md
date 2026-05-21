---
title: Privacy and offline-first
slug: privacy-offline
summary: What Arth stores, where, and what never leaves your phone. No cloud, no account, no telemetry.
tags: [privacy, offline, local, cloud, security, permissions]
contextKeys: [onboarding, settings-about]
phrasings:
  - Is my data safe?
  - Does Arth send anything to the cloud?
  - Is Arth offline?
  - Where is my data stored?
  - Do I need an account?
  - Is this free?
  - What happens if I go offline?
  - Privacy policy
  - GDPR
  - Does the app need internet?
  - Can I use Arth without SMS permission?
  - What does Arth read from my phone?
---

Arth is a **local-first** app. There is no server. No account to create. No email to verify. No phone number. Nothing is transmitted.

## What's stored on your phone

- **Your financial data** — expenses, accounts, categories, budgets, goals, hisaab, reminders, smart rules. This is your full history.
- **App preferences** — theme, fiscal-year start, biometric lock prefs, last-backup timestamp, and a handful of display preferences.
- **Raw bank SMS copies** — the original bank SMS text that was parsed (or attempted), kept so you can inspect "Source SMS" on each expense.

That's all. No photos, no contacts, no files outside of backups you explicitly save.

## What touches the network

**Nothing during normal use.** Arth has:
- No server or cloud connection.
- No telemetry.
- No analytics SDK.
- No crash reporter.
- No ads.
- No in-app purchases server.

The app works identically in airplane mode.

## What Arth reads

When you grant **SMS permission**, Arth reads messages from registered banking / UPI sender IDs (transactional-route DLT codes). The reading happens on-device — the OS hands parsed SMS bodies to the app in memory. Arth then:
- Tries to extract transaction details using on-device pattern-matching rules.
- Stores the raw SMS text locally (never sent elsewhere).

SMS permission is **optional**. Skip it and everything still works manually.

## OS-level protection

- On **Android**, your data lives in the app's private directory. When your phone has a passcode (PIN/pattern/biometric), Android's full-disk encryption protects the file.
- On **iOS** (when the variant ships), same story — Data Protection covers the app sandbox when the device has a passcode.
- **Biometric app-lock** is a separate optional layer: Settings tab → Security & Privacy → App Lock → turn it on.

## Backups are encrypted separately

The `.artha` backup file uses **AES-256-GCM** with a key derived from your password (PBKDF2, 256-bit). The file is safe even if stored on Google Drive / iCloud / email — without your password, it's unreadable.

## What you control

- **Turn off SMS** anytime from Settings tab → SMS Detection.
- **Delete individual expenses** — swipe on any row in the Transactions tab, or open one and tap Delete. It moves to the Recycle Bin (Settings tab → Backup & Storage → Recycle Bin).
- **Delete by time range** — Settings tab → Backup & Storage → Clean Up Data. Pick a scope (Today / This Week / This Month / This Quarter / Everything / Custom range) and what object types to remove.
- **Wipe everything** — same Clean Up Data row, pick "Everything".
- **Uninstall the app** → everything goes with it.

## What we don't do

- No tracking.
- No analytics provider.
- No email or phone required.
- No server storing your data. Ever.
- No ads.

## Related
- Encrypted backups and device migration: [Backup and restore](backup-restore)
- How SMS parsing works: [How SMS detection works](sms-detection)
- Biometric app-lock: [Locking the app with Face/Fingerprint](biometric-lock)
