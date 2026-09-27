---
title: Backup and restore
slug: backup-restore
summary: Save an encrypted .arth backup, turn on automatic backups, and restore everything - data and settings - on any Android phone running Arth.
tags: [backup, restore, auto backup, scheduled backup, settings, data, security, phone-transfer, migration, arth file, json]
contextKeys: [settings-backup, home]
phrasings:
  - How do I back up my data?
  - I got a new phone, how do I move Arth over?
  - Moving to a new device
  - Can I transfer my data to another phone?
  - My phone is dying, how do I save my data?
  - How do I restore from a backup?
  - What if I lose my phone?
  - Is my data safe if my phone is stolen?
  - Can I share data between phones?
  - Is the backup file encrypted?
  - I forgot my backup password
  - Can Arth back up automatically?
  - Auto backup
  - Are my settings in the backup?
  - Are broker credentials in the backup?
  - Restore a .json backup
---

Arth is local-only - there is no cloud sync. Moving to a new phone, or protecting yourself from losing your phone, means keeping a backup file yourself.

## Where to find it

**Settings tab → Backup & Storage → Backup & Restore.**

## Make an encrypted backup

1. Tap **Create Encrypted Backup**.
2. Enter a password (at least 8 characters). Pick something you'll remember - **there is no reset**. If you forget it, the file can't be opened.
3. Confirm the password.
4. Choose **Save to phone** (pick a folder) or **Share** (Google Drive, email, etc.). The file is named like `arth-backup-2026-09-27….arth`.

## What's in a backup

- **All your data** - every expense, account, investment, category, budget, reminder, smart rule, SMS template, hisaab entry, goal, yearly plan, loan, insurance policy, simulator scenario, Vault entry and tag.
- **Your settings** - theme and region, sorts and saved filter views, home card choices, notification and SMS settings, Arth AI settings and chat history, check-in decisions, dismissed duplicates and more.

What **stays on each phone** (not in the backup):

- **App lock** - you set it up again on the new phone, so a restore can't lock you out of a phone without fingerprint.
- **Zerodha credentials** and every broker's live session. Save your Zerodha API key and login to the [Vault](vault) (which is backed up), then use **Fill from Vault** to reconnect. Angel One and Zebpay credentials *are* in the backup (encrypted), so those reconnect on their own after a restore.
- **Calendar sync** choices, the **downloaded AI model**, and how far this phone's SMS inbox has been scanned.

## Auto backup

Turn on **Auto backup** in the Scheduled Backup section and choose how often: every 4, 6, 8, 12, 24 or 48 hours. Arth saves a backup at that interval, even when the app is closed.

- Auto-backups don't need a password. They're kept **inside Arth's private storage on this phone**, and the latest 10 are kept.
- Each one in the list has **Restore**, **Share** and **Delete**.
- Turn on the **Auto Backup** notification (Settings → Notifications) to hear when one is saved.

> Auto-backups live on the phone itself, so they're lost if you uninstall Arth or lose the phone. Use **Share** now and then to copy one somewhere safe - or make an encrypted backup.

> **Moving to a new phone? Use an encrypted backup.** Auto-backups don't include the key that unlocks your Vault's secret fields. Restoring one on the same phone is fine, but on a new phone your Vault passwords and PINs (and Angel One / Zebpay credentials) couldn't be read. An encrypted `.arth` backup carries that key safely.

## Restore

1. Install Arth, open it, complete onboarding (you can skip any step).
2. **Settings tab → Backup & Storage → Backup & Restore → Select Backup File.**
3. Pick an `.arth` file (older `.artha` files work too) or an auto-backup `.json` file.
4. For an `.arth` file, enter its password.
5. Confirm. Arth **replaces all your current data** with the backup, then restores your settings.

> Restore replaces everything on the device. Anything you entered since installing is overwritten.

Older backups made before settings were included restore your data and leave the phone's current settings as they are.

## What if I forget the password?

There is no way to recover it. The file is encrypted with AES-256-GCM using your password; without it nothing can read the file. Save the password in a password manager.

## Common situations

**"Does restore merge or replace?"** Replace. Always.

**"Backup file is huge."** Expected for long-time users. Years of data can reach 20-50 MB.

**"Can I send the backup to someone else to restore?"** Yes, with your password. They'll see all your financial data and Vault entries - treat it like a password.

**"Zerodha isn't connected after restoring."** Zerodha credentials aren't in backups. Open Settings → Integrations → Zerodha Kite and use **Fill from Vault**, or enter them again. Angel One and Zebpay just need a **Sync**.

**"Moving Android → iPhone."** Not supported - Arth is Android-only for now.

## Related

- [Privacy and offline-first](privacy-offline)
- [Vault - storing credentials and passwords](vault)
- [Notifications and the home screen widget](notifications)
- [Locking the app with Face / Fingerprint](biometric-lock)
