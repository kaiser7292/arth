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

1. Open the **Home tab** and swipe to the **Vault** page (or tap **Vault** at the top).
2. Tap the **+** button.
3. Choose a **category**.
4. Fill in the **name** (e.g. "HDFC NetBanking") and whichever fields are relevant — username, password, PIN, account number, expiry, etc.
5. Add a **renewal date** if the credential or subscription expires (Arth can remind you before it does).
6. Add any **notes** for context.
7. Tap **Save**.

## Demat entries: TOTP codes and broker keys

**Demat** entries have extra optional fields:

- **TOTP Secret** - the text key your broker shows when you set up two-factor login (letters A-Z and digits 2-7, not a 6-digit code). The entry screen then shows a live **TOTP Code** you can copy, so you don't need a separate authenticator app open.
- **API Key** and **API Secret** - for connecting the broker to Arth.

## Broker connections and the Vault

The [Zerodha Kite](kite-connect), [Angel One](angel-one) and [Zebpay](zebpay) screens each have **Save to Vault** / **Update Vault** and **Fill from Vault** buttons:

- **Save to Vault** keeps one Vault entry per broker with your API key, API secret, TOTP secret, login ID and password.
- **Fill from Vault** puts them back - handy after restoring a backup on a new phone.
- For Zerodha, Arth can use the linked Vault entry to fill your user ID, password and TOTP code on Zerodha's login page each day. Values are only filled on kite.zerodha.com.

When you add a savings, credit card or loan account, Arth also offers **Add credentials** to create a Vault entry for it.

## Finding a saved entry

Use the **search bar** at the top of the Vault screen to filter entries by name, username, or note text. Entries are also grouped by category so you can browse by type.

## Security

Vault entries are stored in Arth's local database on your device - nothing is sent to any server. **Passwords, PINs, TOTP secrets, API keys and other secret fields are encrypted** (AES-256) with a key kept in Android's secure storage. Entry names, categories and renewal dates are not encrypted, so Arth can list and search them. On top of that, your phone's own storage encryption and Arth's app lock protect everything.

The Vault is included in your **Arth backup file** - encrypted with your backup password - along with the key needed to read the secret fields on a new phone. Anyone who has your backup file **and** its password can see your Vault. Treat both carefully.

## Common situations

**"I saved a password but the Vault screen is blank when I reopen it."** The Vault screen requires biometric/PIN authentication each time it is opened. If authentication failed or timed out, the screen appears empty. Lock and unlock Arth, then navigate back to Vault.

**"I want to store a document PDF password."** Use the Statement password category. Enter the bank or institution name as the entry name, and the PDF password in the password field.

**"Can I use Vault as a full password manager?"** Vault is designed for financial credentials. It stores any text you enter but does not have browser autofill, password generation, or cross-device sync. For a full-featured password manager, use a dedicated app alongside Arth.

**"I deleted an entry by mistake."** Vault entries deleted in Arth go to the recycle bin (Settings → Recycle Bin) and can be restored within 30 days.

## Related

- Set up biometric lock: [Locking the app with Face / Fingerprint](biometric-lock)
- Back up your data (includes Vault): [Backup and restore](backup-restore)
