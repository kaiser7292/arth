---
title: Backup and restore
slug: backup-restore
summary: Export an encrypted .artha file; restore it on any Android device running Artha.
tags: [backup, restore, data, security, phone-transfer, migration]
contextKeys: [settings-backup, home]
phrasings:
  - How do I back up my data?
  - I got a new phone, how do I move Artha over?
  - Moving to a new device
  - Can I transfer my data to another phone?
  - My phone is dying, how do I save my data?
  - How do I restore from a backup?
  - What if I lose my phone?
  - Is my data safe if my phone is stolen?
  - Can I share data between phones?
  - Is the backup file encrypted?
  - I forgot my backup password
---

Artha is local-only — there is no cloud sync. Moving to a new phone, or protecting yourself from a phone loss, means making a backup file yourself. Backups are encrypted with a password you set.

## Where to find it

**Settings tab → Backup & Storage → Backup & Restore.**

## Make a backup

1. Open **Settings tab → Backup & Storage → Backup & Restore**.
2. Tap **Create Backup**.
3. Enter a password. Pick something you'll remember — **there is no reset**. If you forget it, the file is unreadable.
4. Confirm the password.
5. Tap **Save**. Android opens the file picker — choose where to save (Google Drive, Files, email to yourself, etc.). The file is named `artha-backup-YYYY-MM-DD.artha`.

The file contains every expense, account, category, budget, reminder, smart rule, hisaab entry, goal, investment bucket, yearly plan, and tag. What's **excluded**: biometric app-lock settings (security by design — you re-enable on the new device) and recycle-bin trash older than 30 days.

## Restore on a new phone

1. Install Artha, open it, complete onboarding (you can skip any step).
2. **Settings tab → Backup & Storage → Backup & Restore**.
3. Tap **Restore from Backup**.
4. Pick the `.artha` file.
5. Enter the password you set.
6. Artha **replaces all your current data** with everything from the backup. Takes a few seconds.

> Restore replaces everything on the device. Any data you entered since installing is overwritten.

## What if I forget the password?

There is no way to recover it. The file is encrypted with your password using AES-256-GCM; without the key nothing can read it. Pick a memorable password, or save it alongside the file in a password manager.

## Common situations

**"Can I auto-backup?"**
Not yet. Backup is a manual tap. Set a monthly reminder in your phone calendar.

**"Does restore merge or replace?"**
Replace. Always. Merging would be unsafe across different phones.

**"Backup file is huge."**
Expected for long-time users. Backup files are not compressed; 5+ years of data can reach 20–50 MB.

**"Can I send the backup to someone else and they restore it?"**
Yes, with their consent and your password. They'll see all your financial data — treat it like a password.

**"Moving Android → iOS."**
Not supported yet — the iOS variant of Artha is planned but not shipped. Android-to-Android works.

## Related
- Why Artha doesn't use the cloud: [Privacy and offline-first](privacy-offline)
- Turning on biometric app-lock: [Locking the app with Face/Fingerprint](biometric-lock)
