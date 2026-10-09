---
title: Privacy and offline-first
slug: privacy-offline
summary: What Arth stores, where, and exactly when it uses the internet. No Arth server, no account, no telemetry.
tags: [privacy, offline, local, cloud, security, permissions, internet, network, hide amounts, brokers, AI download, calendar]
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
  - DPDP
  - Does the app need internet?
  - When does Arth use the internet?
  - Can I use Arth without SMS permission?
  - What does Arth read from my phone?
  - Why does Arth show an SMS disclosure?
  - Hide amounts on screen
---

Arth is a **local-first** app. There is no Arth server. No account to create. No email to verify. No phone number. Your financial data stays on your phone.

## What's stored on your phone

- **Your financial data** - expenses, accounts, categories, budgets, goals, investments, insurance policies, hisaab, reminders, smart rules, Vault entries. This is your full history.
- **App preferences** - theme, fiscal-year start, region, notification choices, and other display preferences.
- **Raw bank SMS copies** - the original bank SMS text that was parsed (or attempted), kept so you can inspect "Source SMS" on each expense.
- **Broker credentials**, if you connect a broker - stored encrypted in Android's secure storage.

## When Arth uses the internet

Everything you track works in airplane mode. Arth only goes online for optional extras you switch on yourself:

- **Broker connections** - [Zerodha Kite](kite-connect), [Angel One](angel-one) and [Zebpay](zebpay). Arth talks directly to the broker with your own API key. Nothing goes through an Arth server.
- **Help links** - links to a broker's terms or developer console open in your browser.

And a few things leave the phone only because you send them somewhere:

- **Backups** you save to Drive, email or elsewhere.
- **Calendar sync** to a Google calendar - Android's own sync uploads the events. Choose "Arth (this phone only)" to keep them local. See [Calendar sync](calendar-sync).
- **Reports** you share as a PDF, **Settle up** reminders you send, and SMS reports you choose to email.

What Arth does **not** have:

- No Arth server storing your data.
- No telemetry, analytics SDK or crash reporter.
- No ads.

## What Arth reads

Before asking for **SMS permission**, Arth shows a screen explaining exactly what it reads and why. You accept that first; only then does Android show its permission prompt. On a new phone you see it again.

With permission, Arth reads messages from registered banking / UPI sender IDs. The reading happens on-device. Arth then:

- Tries to extract transaction details using on-device pattern-matching rules.
- Stores the raw SMS text locally (never sent elsewhere).

SMS permission is **optional**. Skip it and everything still works manually.

## Hide amounts on screen

Tap the **eye** icon at the top of the Home tab to hide every amount in the app behind **••••** - handy on a train or when you're sharing your screen. See [Home screen cards](home-cards).

## OS-level protection

- On **Android**, your data lives in the app's private directory. When your phone has a passcode (PIN/pattern/biometric), Android's encryption protects the file.
- **App lock** is a separate optional layer: Settings tab → Preferences & Security → Security. With app lock on, notifications don't show amounts either. See [Locking the app with Face / Fingerprint](biometric-lock).

## Backups are encrypted separately

The `.arth` backup file uses **AES-256-GCM** with a key derived from your password. It's safe even if stored on Google Drive or email - without your password, it's unreadable. (Scheduled auto-backups are the exception: they're kept unencrypted inside the app's private storage on your phone. See [Backup and restore](backup-restore).)

## What you control

- **Turn off SMS** anytime from Settings tab → SMS Detection.
- **Disconnect a broker** from its screen under Settings tab → Integrations.
- **Delete individual expenses** - from the Transactions tab or the expense screen. They move to the Recycle Bin (Settings tab → Backup & Storage → Recycle Bin).
- **Delete by time range** - Settings tab → Backup & Storage → Clean Up Data. Pick a scope (Today / This Week / This Month / Quarter / Everything / Custom) and what types of data to remove.
- **Uninstall the app** → everything on the phone goes with it.

## Related

- Encrypted backups and device migration: [Backup and restore](backup-restore)
- How SMS parsing works: [How SMS detection works](sms-detection)
- App lock: [Locking the app with Face / Fingerprint](biometric-lock)
