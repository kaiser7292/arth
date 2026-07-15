---
title: Vault — storing credentials and passwords
slug: vault
summary: Save banking credentials, card PINs, UPI IDs, and other sensitive information securely on your device.
tags: [vault, password, credentials, pin, UPI, banking, card, demat, security, secure storage, password manager]
contextKeys: [vault, settings-vault]
phrasings:
  - What is the Vault in Arth?
  - How do I store my bank password?
  - Save card PIN in Arth
  - Save UPI ID in Arth
  - Password vault
  - Is the vault encrypted?
  - How do I add a credential?
  - Vault categories
  - Save website login in Arth
  - Demat login in vault
  - Subscription credentials in Arth
  - How to find a saved password
  - Email password in Arth
  - Gaming account in vault
  - Vault login methods
---

The **Vault** is a secure on-device credential store inside Arth. Use it to keep banking passwords, card PINs, UPI IDs, demat logins, and any other sensitive detail in one place — protected by the same biometric or PIN lock as the rest of Arth, stored entirely on your device with no cloud sync.

## Categories

When you add a new Vault entry, you choose a category. The category determines which fields appear on the entry form.

- **Banking** — bank account username/password, net banking credentials
- **Card** — debit or credit card number, expiry, CVV, PIN
- **UPI** — UPI ID, registered mobile number, UPI PIN
- **Demat** — demat or trading account login
- **Statement password** — PDF passwords for bank or credit card statements
- **Email** — email address and password
- **Gaming** — gaming platform username and password
- **Subscription** — streaming or subscription service login
- **Social** — social media account credentials
- **Other** — freeform; use for anything that does not fit the above

## Login methods

Each entry has an optional **Login method** field that records how you authenticate — useful when an account supports multiple methods:

- **Password** — traditional username/password
- **Email and password** — login with email address plus password
- **Google** — signs in via Google account (no separate password stored)
- **Apple** — signs in via Apple ID
- **Phone OTP** — login via one-time password to your registered mobile
- **PIN** — numeric PIN only (common for banking apps)
- **None** — no login required or method not applicable

## Adding an entry

1. Open **Settings → Vault** or tap Vault from the main menu.
2. Tap the **+** button.
3. Choose a **category**.
4. Fill in the **name** (e.g. "HDFC NetBanking") and whichever fields are relevant — username, password, PIN, account number, expiry, etc.
5. Add a **renewal date** if the credential or subscription expires (Arth can remind you before it does).
6. Add any **notes** for context.
7. Tap **Save**.

## Finding a saved entry

Use the **search bar** at the top of the Vault screen to filter entries by name, username, or note text. Entries are also grouped by category so you can browse by type.

## Security

All Vault data is stored in Arth's local SQLite database on your device. It is protected by the same app-level biometric lock that secures the rest of Arth — no data is sent to any server. Arth does not encrypt the database itself beyond what your Android device's OS-level storage encryption provides. If you need an additional encryption layer, consider enabling full-device encryption in your Android settings.

Because the Vault is part of your Arth data, it is included in your **Arth backup file** — encrypted with AES-GCM using your chosen backup password. If you share a backup, the recipient can restore the Vault data after entering the correct backup password.

## Common situations

**"I saved a password but the Vault screen is blank when I reopen it."** The Vault screen requires biometric/PIN authentication each time it is opened. If authentication failed or timed out, the screen appears empty. Lock and unlock Arth, then navigate back to Vault.

**"I want to store a document PDF password."** Use the Statement password category. Enter the bank or institution name as the entry name, and the PDF password in the password field.

**"Can I use Vault as a full password manager?"** Vault is designed for financial credentials. It stores any text you enter but does not have browser autofill, password generation, or cross-device sync. For a full-featured password manager, use a dedicated app alongside Arth.

**"I deleted an entry by mistake."** Vault entries deleted in Arth go to the recycle bin (Settings → Recycle Bin) and can be restored within 30 days.

## Related

- Set up biometric lock: [Biometric and PIN lock](lock)
- Back up your data (includes Vault): [Backup and restore](backup)
- AI data access toggle for Vault: [AI assistant](ai-assistant)
