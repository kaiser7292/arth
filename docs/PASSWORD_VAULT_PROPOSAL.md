# Password Vault — Product Proposal

**Version:** 1.1 | **Date:** July 2026 | **Status:** Draft for review

---

## 1. Why This Belongs in Arth

A generic password manager saves everything. Arth's vault is focused on your financial and personal digital life. That focus creates things a generic tool can't offer:

- **Linked credentials** — the vault entry for your HDFC CC is connected to the HDFC CC account in your ledger. Open the ledger, tap the lock icon, your net banking login is right there.
- **Statement password auto-fill** — when importing a bank PDF for reconciliation, Arth checks if you've saved a password for that bank and offers to apply it without typing.
- **Subscription renewal awareness** — subscription entries carry a renewal date. Since your CC statement already shows the charge, Arth can connect the dots.
- **Already in your backup** — vault data travels with your encrypted Arth backup. One restore recovers your transactions, balances, and credentials together.

Arth is 100% local with biometric lock already in place. There is no server to breach.

---

## 2. Login Methods — The Core Concept

Not every account has a password. The vault models HOW you log in, not just what your password is. This is what makes it useful for modern accounts.

| Login method | What gets stored | Examples |
|-------------|-----------------|---------|
| **Username + Password** | Username, password | HDFC NetBanking, Netflix, Steam |
| **Email + Password** | Email, password | Gmail, Hotstar, Spotify |
| **Google Sign-In** | Which Google email to use | No password — just the right account |
| **Apple Sign-In** | Which Apple ID to use | No password — just the right account |
| **Phone OTP** | Phone number registered | WhatsApp, CRED, Paytm — login is just OTP |
| **PIN only** | 4–6 digit PIN | UPI PIN, ATM PIN, app MPIN |
| **Social (Facebook / Twitter)** | Which account is linked | No password — just the right profile |

When you add an entry, you pick the login method first — and only the relevant fields appear.

---

## 3. What Goes in the Vault

### Finance (linked to Arth accounts)

| Entry type | Key fields | Examples |
|------------|-----------|---------|
| **Net Banking** | Username, password, URL | HDFC NetBanking, SBI YONO, Axis Mobile |
| **Credit Card PIN** | 4-digit PIN | HDFC Tata Neu, ICICI Amazon CC |
| **ATM PIN** | 4-digit PIN | SBI ATM, ICICI ATM |
| **UPI** | UPI ID, UPI PIN, linked bank | sourav@okaxis, PhonePe MPIN |
| **Demat / Trading** | Client ID, password, TOTP secret | Zerodha, Groww, Angel One |
| **Investment Platform** | Login ID, password, MPIN | CAMS, KFintech, MF Central |
| **Insurance Portal** | Policy number, username, password | LIC, HDFC Life, Star Health |
| **Loan Portal** | Loan account number, username, password | Axis EMI portal |
| **Statement Password** | PDF password | Linked to bank account — auto-fills in reconciliation |
| **Customer Care** | Phone number, IVR sequence | HDFC CC disputes, ICICI relationship manager |

### Personal

| Entry type | Key fields | Examples |
|------------|-----------|---------|
| **Email Account** | Email address, password, recovery info | Gmail, Outlook, Yahoo |
| **Gaming Account** | Username / gamertag, email linked, password | Steam, PlayStation Network, Xbox, Epic Games, Battle.net |
| **Subscription / OTT** | Email, password, plan, renewal date, linked payment | Netflix, Hotstar, Spotify, Prime Video, ZEE5, Sony LIV |
| **Social / Content** | Login method (Google/email/phone), linked account | Instagram, YouTube, Twitter/X |
| **App Store** | Email / Apple ID | Google Play, Apple App Store |
| **Work / Productivity** | Email, login method | Google Workspace, Microsoft 365, Slack |
| **Custom** | Any label + value, masked or plain | Referral codes, WiFi passwords, anything else |

---

## 4. Security Model

Arth already provides two layers:

1. **Biometric lock** — app doesn't open without fingerprint / face
2. **OS-level SQLite encryption** — database files are encrypted by the OS

The vault adds a third layer for the most sensitive values:

3. **Android Keystore encryption** — passwords and PINs are encrypted with a key stored in the hardware-backed Android Keystore before being written to SQLite. Even if someone extracted the SQLite file, individual secrets are unreadable without the device's hardware key.

**In practice:**
- Open Arth → biometric unlock → vault accessible for the session
- Sensitive fields (passwords, PINs) are masked by default — tap the eye icon to reveal
- Copying a value → clipboard auto-clears after 30 seconds with a countdown toast
- Screenshots blocked on vault screens (Android `FLAG_SECURE`)
- Optional setting: "Require biometric each time a password is revealed" — default ON

---

## 5. User Scenarios

### Finance scenarios

**A. Looking up net banking login**
User wants to log into HDFC NetBanking. Opens Arth → Vault → search "HDFC" → Net Banking entry → tap eye icon → password revealed → copy → paste in browser. Clipboard auto-clears in 30 seconds.

**B. Credentials from the ledger (in context)**
User is reviewing their HDFC CC ledger and needs to dispute a charge online. Taps the lock icon in the ledger header → vault entry opens inline without leaving the ledger screen.

**C. Statement password auto-fill during reconciliation**
User imports an ICICI CC PDF for reconciliation. Arth checks the vault for a Statement Password entry linked to the ICICI CC account. If found: *"Use saved ICICI CC statement password?"* — one tap applies it. No typing.

**D. New account → save credentials prompt**
User adds a new Axis CC to Arth. After saving: *"Add credentials for this account to your vault?"* → vault creation screen opens pre-filled with bank name and account type.

**E. Customer care during a dispute**
User sees an unexpected charge on their ICICI CC ledger. Long-presses account name → *"View Customer Care"* → shows number + IVR path.

### Personal scenarios

**F. Finding the Netflix password**
User is on their TV trying to log into Netflix. Opens Arth vault → search "Netflix" → email + password revealed.

**G. Which Google account is linked to a service**
User tries to log into a subscription service and can't remember which Google account they used. Opens vault → finds the entry → sees "Sign in with Google — use sourav@gmail.com".

**H. Phone-linked app (no password)**
User gets a new phone and needs to re-activate CRED. Opens vault → finds CRED entry → login method is "Phone OTP" → sees which phone number is registered (7xxxxxx836). No password needed — they just need the OTP on that number.

**I. Gaming account on a new device**
User wants to log into Steam on a new laptop. Opens vault → Steam entry → username, password, and the linked email address (needed for Steam Guard 2FA).

**J. Subscription renewal**
User's Hotstar subscription is up for renewal. Vault entry shows renewal date and which CC is linked for payment — they can go straight to that CC's ledger to verify the charge hit.

**K. Backup and restore**
User gets a new phone. Restores Arth backup. All vault entries — banking credentials, Netflix login, gaming accounts, everything — are restored in one step.

---

## 6. UX Flow

### Entry Points
- **Home screen top bar** — custom `VaultIcon` (`components/ui/VaultIcon.tsx`, size 16, `textSecondary`) placed to the left of the SMS scan button in the same row. Same 32×32 rounded-full button, same background, same icon size and colour. The icon is a safe door: rounded rect body, circular combination dial with a pointer hand and centre dot, vertical handle bar on the right — outline style matching Ionicons at 24×24 viewBox.
- Account Ledger header: lock icon → linked vault entry for that account
- After adding a new financial account: "Add credentials?" prompt
- During PDF import for reconciliation: "Use saved password?" if a Statement Password entry exists for that bank

### Main Vault Screen

```
[🔍 Search _______________]

FINANCE
  HDFC NetBanking           ••••••••  →
  SBI YONO                  ••••••••  →
  Axis Neo CC PIN           ••••      →
  sourav@okaxis UPI PIN     ••••      →
  ICICI CC Statement PDF    ••••••••  →
  Zerodha                   ••••••••  → [123 456] (TOTP)
  HDFC CC Customer Care     1800-202…  →

SUBSCRIPTIONS
  Netflix                   Email + Pwd  Apr 2027 ↻  →
  Hotstar                   Google →  sourav@gmail   →
  Spotify                   Email + Pwd  Jun 2027 ↻  →

GAMING
  Steam                     Username + Pwd  →
  PlayStation Network       Email + Pwd     →

EMAIL
  Gmail (primary)           sourav@gmail.com  →
  Gmail (work)              sourav@coupa…     →

OTHER
  CRED                      📱 Phone OTP  →
  Instagram                 Google →  sourav@gmail  →
```

### Add Entry Screen

Step 1 — pick category (Finance / Subscription / Gaming / Email / Social / Custom)
Step 2 — pick login method (Username+Pwd / Email+Pwd / Google / Apple / Phone OTP / PIN / Custom)
Step 3 — fill only the fields relevant to that method:

- **Email+Pwd**: Email field + Password field (masked)
- **Google Sign-In**: "Which Google account?" dropdown (pulls from saved Gmail entries) + Notes
- **Phone OTP**: Phone number + Notes (no password field shown)
- **PIN only**: PIN field (masked, numeric)

Optional on all entries:
- Link to Arth financial account (for banking entries)
- Renewal date + linked payment method (for subscriptions)
- Notes (plain text)
- `+ Add custom field` with per-field mask toggle

### View Entry Screen
- All sensitive fields shown as `••••••••`
- Eye icon: tap to reveal (biometric prompt if setting is on)
- Copy icon: copies to clipboard, starts 30-second auto-clear countdown
- TOTP: live 6-digit code with circular countdown ring (refreshes every 30 sec)
- Login method shown clearly: *"Sign in with Google — use sourav@gmail.com"* or *"Phone OTP — registered on 7xxxxxx836"*

---

## 7. Reconciliation Integration

When the user starts a PDF import on the Reconciliation screen:

```
[Upload PDF]
     │
     ▼
Arth checks vault for Statement Password entries
linked to the selected Arth account
     │
     ├── Found → "Use saved password for HDFC CC?"  [Use it]  [Enter manually]
     │           Tapping [Use it] applies the saved password silently
     │
     └── Not found → Password input field shown as normal
                     After successful import: "Save this password to vault?"  [Save]  [No]
```

The vault query is: `SELECT * FROM vault_entries WHERE category = 'statement_pwd' AND linked_account_id = ?`

If the saved password is wrong (decryption fails): clear error, fall back to manual input, offer to update the saved password.

---

## 8. Technical Design

### Updated Database Table

**`vault_entries`**
```sql
id                  TEXT PRIMARY KEY
title               TEXT NOT NULL
category            TEXT NOT NULL
  -- Finance: 'netbanking' | 'cc_pin' | 'atm_pin' | 'upi' | 'demat'
  --          | 'investment' | 'insurance' | 'loan' | 'statement_pwd' | 'customer_care'
  -- Personal: 'email' | 'gaming' | 'subscription' | 'social' | 'custom'
login_method        TEXT NOT NULL
  -- 'password' | 'email_password' | 'google' | 'apple'
  -- | 'facebook' | 'phone_otp' | 'pin' | 'none'
linked_account_id   TEXT REFERENCES financial_accounts(id)
username            TEXT              -- plain
email               TEXT              -- plain (the login email or the linked Google/Apple ID)
phone_number        TEXT              -- plain (for phone OTP accounts)
password_enc        TEXT              -- Keystore-encrypted
pin_enc             TEXT              -- Keystore-encrypted (4–6 digits)
url                 TEXT              -- plain
totp_secret_enc     TEXT              -- Keystore-encrypted TOTP seed
renewal_date        TEXT              -- ISO date, for subscriptions
renewal_payment_id  TEXT REFERENCES financial_accounts(id) -- which CC/UPI pays this
plan_info           TEXT              -- plan name / tier, plain
phone_ivr           TEXT              -- IVR sequence, plain (customer care entries)
notes               TEXT              -- plain
custom_fields       TEXT              -- JSON: [{label, value_enc, masked}]
last_accessed_at    TEXT
created_at          TEXT NOT NULL
updated_at          TEXT
deleted_at          TEXT
```

Must be added to:
- `database/migrations/index.ts`
- `TABLE_SCHEMAS` in backup system
- `BACKUP_TABLES` in `services/backup.ts`

### New Services

```
services/vault/
├── vault-crud.ts        — CRUD: create, read, update, soft-delete
├── vault-crypto.ts      — Encrypt/decrypt via Android Keystore
├── vault-totp.ts        — Live TOTP code generation from stored seed
└── vault-search.ts      — Search across title, email, username, url, linked account name
```

### New Screens

```
app/vault/
├── index.tsx            — Main vault list (grouped by category, search)
├── add.tsx              — Step 1: category → Step 2: login method → Step 3: fields
├── [entryId].tsx        — View entry (masked fields, reveal, copy, TOTP)
└── edit.tsx             — Edit entry
```

### Clipboard auto-clear
On copy of any sensitive field: store timestamp in MMKV. AppState `change` listener on foreground: if 30 seconds elapsed since last copy, run `Clipboard.setString('')` and show a dismissible toast: *"Clipboard cleared."*

### Subscription renewal badge
On app launch, check `vault_entries` where `category = 'subscription'` and `renewal_date` within the next 7 days. Show a badge on the Vault tab and a card on the Home screen: *"Hotstar renews in 3 days — linked to HDFC CC ****8957."*

---

## 9. Out of Scope (v1)

- **Password generation** — suggest strong random passwords (v2)
- **Breach detection** — requires HaveIBeenPwned API call (violates local-only principle)
- **Browser autofill / keyboard extension** — requires Android accessibility service
- **Cross-device sync** — backup restore covers migration
- **Password strength scoring** — v2
- **Password expiry reminders** — v2 (e.g. "HDFC password unchanged for 6 months")
- **Secure sharing** — out of scope for personal use

---

## 10. Implementation Phases

### Phase 1 — Core vault
- `vault_entries` table + migration
- Android Keystore encryption for sensitive fields
- Add / view / edit / delete entries
- All login method types (password, Google, phone OTP, PIN, none)
- Category grouping + search
- Masked fields with tap-to-reveal (biometric re-auth optional)
- Copy with 30-second clipboard auto-clear
- Screenshot block (`FLAG_SECURE`)
- Included in backup/restore

### Phase 2 — Integrations
- Link vault entries to `financial_accounts`
- Lock icon on account ledger header → inline vault entry view
- "Add credentials?" prompt when creating a new Arth account
- **Reconciliation auto-fill**: check vault for Statement Password when importing PDF
- "Save to vault?" prompt after manually entering a PDF password that worked

### Phase 3 — Smart features
- TOTP generation for trading accounts (Zerodha, Groww, Angel One)
- Subscription renewal reminder (badge + Home card, 7-day lookahead)
- Subscription → linked CC connection (tap renewal → open that CC ledger)
- Password strength indicator on entry creation
- Customer care directory pre-seeded with common bank/CC numbers
