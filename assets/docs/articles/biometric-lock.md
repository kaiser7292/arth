---
title: Locking the app with Face / Fingerprint
slug: biometric-lock
summary: Optional biometric app-lock. Arth asks for Face / Fingerprint before opening, with a configurable timeout and device-passcode fallback.
tags: [security, privacy, biometric, fingerprint, face-id, face-unlock, lock, passcode, app-lock]
contextKeys: [settings-security, app-launch, lock-screen]
phrasings:
  - How do I lock the app with fingerprint?
  - Face unlock Arth
  - Biometric app lock
  - Can I require Face ID?
  - App lock timeout
  - Require fingerprint every time
  - How to turn off app lock
  - Biometric fallback to passcode
  - Is biometric lock safe?
  - Does the lock sync to backups?
  - Why is the app locking after every background?
  - Lock now button
  - UI security settings
  - UI app lock toggle
---

Arth can require a biometric check (Face ID / fingerprint) before opening. This is an **optional** extra layer on top of the OS-level disk encryption. Off by default.

## Turn it on

1. Open the **Settings tab → Security & Privacy → App Lock**.
2. Toggle **App Lock** on.
3. Arth asks for a biometric check right away — this proves you can authenticate on this device.
4. Pick a **timeout** — how long after you last unlocked before the app re-locks:
   - **Immediately** — every time you open the app.
   - **After 1 minute** / **After 5 minutes** / **After 15 minutes** — a grace window after you last unlocked.
   - **Never** — the app only re-locks on cold start (after a reboot or app-kill).
5. Done. The next time the app launches, or comes back to the foreground after the timeout, you'll see the lock screen.

## Turn it off

Same screen — toggle off. **Turning off ALSO requires a biometric check**, so someone with physical access to your unlocked phone can't silently disable the lock.

## Lock Now button

On the same Security & Privacy screen there's a **Lock Now** button. Useful if you're handing your phone to someone for a second and want to force a re-auth on next open.

## Fallbacks

- **Device passcode** is always accepted as a fallback if biometric fails. So if your finger is wet, or a mask blocks Face ID, typing your phone's lock-screen PIN gets you in.
- If you've disabled the device passcode entirely (not recommended), biometric is the only path. Failing biometric repeatedly locks you out briefly — follow your OS's standard recovery.

## What data the lock protects

Everything in the app. The lock screen blocks the entire UI until you authenticate. Arth **never reads your biometric data itself** — that stays in the secure enclave (Android StrongBox / iOS Secure Enclave). Arth just gets a yes / no from the OS.

## Lock preferences are device-local

The lock settings (toggle, timeout) are **not** included in encrypted backup files. On purpose:

- **Portability** — a backup file is meant to be restorable on any device; forcing a biometric config into it would be fragile.
- **Security** — if someone else restored your backup on their phone, they'd inherit your lock setup and could brute-force it.

Consequence: after restoring a backup on a new device, the lock is off by default. Turn it back on from Settings.

## Common situations

**App locks every time I switch to another app for 3 seconds.** Your timeout is set to **Immediately**. Change it to 1 or 5 minutes in Security & Privacy → App Lock.

**I'm travelling and don't have biometric set up on this loaner phone.** Turn the lock off before handing the phone to someone. If you're locked out on a restore, the device-passcode fallback covers that.

**I tried to turn the lock off but it's asking for biometric — I want out!** Expected behavior — this is the anti-bypass guard. If biometric is broken, use the device-passcode fallback — same lock screen, just pick **Use passcode**.

**What if I forget my password but have biometric?** There's no Arth "password". Biometric / device-passcode is the only auth. There's nothing to forget.

**Does the lock work with the Android pattern lock?** Yes — it uses whatever device credential the OS supports as fallback (PIN, pattern, passcode).

## Related

- [Privacy and offline-first](privacy-offline)
- [Backup and restore](backup-restore)
