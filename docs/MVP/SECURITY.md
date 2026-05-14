# Security & Vulnerability Assessment

**Version:** 0.1 (Draft)
**Author:** Sourav Baid + Claude
**Date:** 2026-04-12
**Related:** [PRD](PRD.md) | [TDD](TDD.md) | [DevOps & SDLC](DEVOPS.md) | [Test Strategy](TEST_STRATEGY.md)

---

## 1. Threat Model

### 1.1 What We're Protecting

This app handles **highly sensitive personal financial data**:

| Data Type | Sensitivity | Examples |
|-----------|------------|---------|
| **Bank transactions** | HIGH | Transaction amounts, merchant names, card numbers (partial) |
| **Account balances** | HIGH | Bank balances, CC limits, outstanding amounts |
| **Investment portfolio** | HIGH | MF holdings, brokerage values, FD amounts |
| **Salary & income** | HIGH | Annual salary, CTC, bonus, savings rate, tax regime, EPF contributions |
| **Family financial data** | HIGH | Hisaab balances, who owes what |
| **Gmail OAuth tokens** | CRITICAL | Access to read user's emails |
| **SMS data** | HIGH | Raw bank SMS text |
| **Spending patterns** | MEDIUM | Where, when, how much the user spends |
| **Goals & milestones** | MEDIUM | Life goals with monetary targets |

### 1.2 Attack Surface

```
┌─────────────────────────────────────────────────────┐
│                   MOBILE DEVICE                      │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │              OUR APP                         │    │
│  │                                             │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  │    │
│  │  │ SQLite   │  │ Gmail    │  │ Backup   │  │    │
│  │  │ Database │  │ OAuth    │  │ Files    │  │    │
│  │  │ (local)  │  │ Tokens   │  │ (.accmgr)│  │    │
│  │  └──────────┘  └──────────┘  └──────────┘  │    │
│  │        ▲              ▲             ▲        │    │
│  └────────┼──────────────┼─────────────┼────────┘    │
│           │              │             │             │
│     ①Device        ②Network       ③File            │
│      theft          sniffing       sharing           │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Other    │  │ Malicious│  │ SMS/Notification  │  │
│  │ apps     │  │ apps     │  │ listeners         │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
│       ④              ⑤                ⑥             │
└─────────────────────────────────────────────────────┘
```

### 1.3 Threat Scenarios

| # | Threat | Likelihood | Impact | Mitigation |
|---|--------|-----------|--------|------------|
| ① | Phone stolen, data accessed | MEDIUM | HIGH | Biometric lock, OS-level full-disk encryption (Android FDE/FBE), auto-lock timer |
| ② | Network interception of Gmail API calls | LOW | HIGH | All Gmail API calls use HTTPS/TLS. OAuth tokens stored in secure keychain. |
| ③ | Backup file intercepted during transfer | MEDIUM | HIGH | Backup encrypted with user-set password (AES-256). No plaintext in backup file. |
| ④ | Other app reads our SQLite DB | LOW | HIGH | Android sandboxing prevents cross-app file access. OS-level encryption protects data at rest. |
| ⑤ | Malicious app with SMS permission reads same bank SMS | LOW | MEDIUM | We can't control other apps. Our SMS data stays local. |
| ⑥ | SMS/notification listener on rooted device | LOW | MEDIUM | Warn user if rooted device detected. Our data stays encrypted regardless. |

---

## 2. OWASP Mobile Top 10 — Our Posture

Based on **OWASP Mobile Top 10 (2024)**:

| # | Risk | Relevance | Our Approach |
|---|------|-----------|-------------|
| **M1** | Improper Credential Usage | HIGH — Gmail OAuth tokens | Tokens stored in `expo-secure-store` (Android Keystore). Never in SQLite or plain files. Never logged. Never hardcoded. |
| **M2** | Inadequate Supply Chain Security | MEDIUM — npm packages | Use `npm audit` before every APK build. Pin dependency versions. Only use well-maintained Expo packages. |
| **M3** | Insecure Authentication/Authorization | LOW — single-user local app | No server auth needed. Optional biometric lock for app access. No passwords to manage. |
| **M4** | Insufficient Input Validation | MEDIUM — user inputs | Validate all manual inputs (expense amount > 0, date format, category exists). Sanitize parsed SMS/email data before DB insert. No SQL injection possible with parameterized queries. |
| **M5** | Insecure Communication | LOW — minimal network use | Only network call is Gmail API (HTTPS). No custom backend. No unencrypted HTTP. Certificate pinning not needed (Google manages Gmail API certs). |
| **M6** | Inadequate Privacy Controls | HIGH — financial data | All data local. No telemetry. No analytics. No crash reporting to external services. No data leaves device unless user explicitly backs up or exports. |
| **M7** | Insufficient Binary Protection | LOW — personal app | Not a concern for personal use. If app goes public: enable ProGuard (Android), code obfuscation. |
| **M8** | Security Misconfiguration | MEDIUM | Debug mode disabled in production builds. No development flags in release APK. Expo config properly stripped. |
| **M9** | Insecure Data Storage | HIGH | SQLite protected by OS-level full-disk encryption (Android FDE/FBE, iOS Data Protection). OAuth tokens in Secure Store. Backup files AES-256 encrypted. No sensitive data in AsyncStorage or plain files. |
| **M10** | Insufficient Cryptography | MEDIUM | Use established libraries (expo-crypto). AES-256 for backups. No custom crypto. No weak algorithms (no MD5/SHA1 for anything security-related). |

---

## 3. Security Controls by Feature

### 3.1 SMS Auto-Detection (Android)

| Control | Implementation |
|---------|---------------|
| **Permission** | Request `READ_SMS` at runtime with clear explanation of why |
| **Data handling** | SMS text parsed on-device, never sent anywhere |
| **Storage** | Raw SMS text stored in SQLite (protected by OS-level encryption) |
| **Partial card numbers** | Store only last 4 digits from SMS. Never full card/account numbers. |
| **Forecast data** | Forecast entries (future expected payments parsed from reminder SMS) follow the same security model — parsed locally, only last 4 digits stored, raw SMS text in encrypted SQLite. No new permissions or attack surface. |
| **Financial account data** | FinancialAccount records store only last 4 digits of card/account — never full numbers. Credit limits and balances are stored locally in encrypted SQLite. Account discovery is passive (from SMS already on device) — no new permissions or network access. |
| **NACH mandate info** | Only merchant name and amount stored for NACH mandates — no bank routing details, no full account numbers. Same local-only, encrypted storage model. |
| **Recurring detection** | Uses only local expense data already in the app. No external API calls. Detection runs on-device. No data leaves the device for recurring analysis. |
| **Refund linking** | Refund matching is purely local — searches existing expenses table. No external lookups. Refund link stored as a FK within the same encrypted database. |
| **Logging** | Never log SMS content. Log only: "SMS detected from [bank], amount parsed" |

### 3.2 Email (Gmail OAuth)

| Control | Implementation |
|---------|---------------|
| **OAuth scope** | Request MINIMAL scope: `gmail.readonly`. Never request write/send permissions. |
| **Token storage** | Access token + refresh token stored in `expo-secure-store` (hardware-backed keychain) |
| **Token refresh** | Handle silently. If refresh fails, prompt user to re-authenticate. Never store credentials. |
| **Email content** | Parsed on-device. Only extracted fields (amount, merchant, fund name) stored in SQLite. Raw email HTML NOT stored. |
| **Revocation** | User can disconnect Gmail from Settings. App deletes all tokens immediately. |

### 3.3 Backup & Restore

| Control | Implementation |
|---------|---------------|
| **Encryption** | AES-256-GCM encryption with user-chosen password |
| **Key derivation** | PBKDF2 with 600,000 iterations (OWASP recommendation) from user password |
| **File format** | `.accmgr` file = encrypted payload + salt + IV (no plaintext metadata) |
| **Password strength** | Minimum 8 characters. Warn if weak. Show strength indicator. |
| **No plaintext** | Even file headers are encrypted. File is opaque binary without the password. |
| **Transfer security** | User responsible for transfer method (email, Drive, USB). App warns: "Keep your backup password safe. Without it, the backup cannot be restored." |

### 3.4 Template Files

| Control | Implementation |
|---------|---------------|
| **No financial data** | Templates contain ONLY: category names, budget amounts, payment mode names, icons, colors. NEVER personal transactions, balances, or account info. |
| **Format** | `.accmgr-template` = plain JSON (not encrypted, since no sensitive data) |
| **Validation** | On import, validate schema. Reject malformed templates. No code execution from templates. |

### 3.5 Salary & Tax Data (Phase 1D)

| Control | Implementation |
|---------|---------------|
| **Storage** | Salary profiles (CTC, tax regime, deductions) stored in encrypted SQLite alongside other financial data. No separate storage needed. |
| **No network** | All tax calculations are performed 100% on-device. No external tax API calls. Tax slab data is hardcoded in the app. |
| **Sensitivity** | CTC and salary breakdown are HIGH sensitivity — same level as bank balances. Never logged, never exported in templates. Included in encrypted backups only. |
| **Tax slab updates** | Tax slabs are updated via app updates (code change), not via remote config. No external data fetch. |

### 3.6 Local Data Storage

| Control | Implementation |
|---------|---------------|
| **Database encryption** | SQLite is plaintext at the app level; protected by Android FDE/FBE and iOS Data Protection at the OS level. App-level SQLCipher not used (expo-sqlite limitation). |
| **Encryption key** | Derived from device-specific key stored in Android Keystore / iOS Keychain |
| **No plaintext cache** | MMKV (react-native-mmkv) used for non-sensitive settings only. Financial data only in encrypted SQLite. |
| **Screen capture** | Optionally disable screenshots in app (FLAG_SECURE on Android) when viewing sensitive data |

---

## 4. Secure Coding Practices

### 4.1 What We Will Enforce

| Practice | How |
|----------|-----|
| **No hardcoded secrets** | `security-audit` skill scans every commit. 60 regex patterns catch API keys, tokens, credentials. |
| **Parameterized SQL** | All SQLite queries use parameterized statements (`?` placeholders). Never string interpolation. |
| **Input validation** | All user inputs validated before DB write. Amount must be numeric > 0. Dates must be valid. |
| **No eval/dynamic code** | Never use `eval()`, `new Function()`, or any dynamic code execution |
| **Dependency auditing** | `npm audit` run before every build. Fix critical/high vulnerabilities before APK generation. |
| **No sensitive logging** | Never `console.log` financial amounts, account numbers, tokens, or SMS text. Use sanitized log messages. |

### 4.2 Skills That Enforce Security

| Skill | What It Does | When It Runs |
|-------|-------------|-------------|
| **`agamm/claude-code-owasp`** | Auto-activates during code review. Checks OWASP Top 10:2025, ASVS 5.0, 20+ language-specific security quirks. | During coding — always active |
| **`YangKuoshih/security-audit`** | Scans for hardcoded secrets (60 patterns), OWASP vulnerabilities (15 patterns). Markdown/SARIF report. | Before every APK build (`/security-audit`) |
| **`vlad-ko/claude-wizard`** | Phase 7 (adversarial self-review) checks for security holes, null edges, race conditions. | Part of every feature implementation |

---

## 5. Permission Model (Android)

| Permission | Why Needed | When Requested | Can User Deny? |
|------------|-----------|----------------|---------------|
| `READ_SMS` | Auto-detect bank transaction SMS | During onboarding (with explanation) | YES — app works without it, just no SMS auto-detection |
| `INTERNET` | Gmail API for email parsing, backup to cloud drive | Automatic (no prompt needed) | N/A |
| `POST_NOTIFICATIONS` | Local notifications for detected expenses, alerts | During onboarding | YES — app works without it |
| `READ_EXTERNAL_STORAGE` | Restore backup from device storage | When user taps "Restore" | YES — can't restore without it |
| `WRITE_EXTERNAL_STORAGE` | Save backup to device storage | When user taps "Create Backup" | YES — can't backup without it |
| `USE_BIOMETRIC` | Optional fingerprint/face lock | When user enables in settings | YES — optional feature |

**Principle: Request permissions contextually, not all at once. Explain why before asking.**

---

## 6. Security Audit Checklist (Run Before Every Release)

```
PRE-RELEASE SECURITY CHECKLIST
================================

[ ] 1. Run /security-audit — zero Critical/High findings
[ ] 2. Run npm audit — zero critical/high vulnerabilities
[ ] 3. Gmail OAuth tokens stored in Secure Store (not AsyncStorage/SQLite)
[ ] 4. SQLite relies on OS-level encryption (no app-level SQLCipher)
[ ] 5. No console.log of financial data, tokens, or SMS text
[ ] 6. No hardcoded API keys, secrets, or credentials
[ ] 7. All SQL queries use parameterized statements
[ ] 8. All user inputs validated before database write
[ ] 9. Backup encryption tested (encrypt → decrypt → data intact)
[ ] 10. Debug mode disabled in production build
[ ] 11. No development/test credentials in release APK
[ ] 12. Template files contain no personal financial data
[ ] 13. Permissions requested contextually with user explanation
[ ] 14. export-compliance: app doesn't use restricted encryption (check EAR)
```

---

## 7. Incident Response (If Something Goes Wrong)

Since this is a local-only personal app, "incidents" are primarily about data loss or corruption:

| Incident | Response |
|----------|----------|
| **Phone lost/stolen** | Data is encrypted. Remote wipe via Find My Device. Restore from last backup on new phone. |
| **Database corruption** | Restore from most recent backup. Auto-backups minimize data loss window. |
| **Gmail token compromised** | Revoke access from Google Account settings. Re-authenticate in app. |
| **Backup file leaked** | File is AES-256 encrypted. Without password, attacker gets nothing. Change backup password on next backup. |
| **App crash/data loss** | Check auto-backup. If no backup: data is lost. This is why auto-backup defaults to daily. |

---

## 8. Future Security Considerations

| When | What | Why |
|------|------|-----|
| **If app goes public** | ProGuard / R8 code obfuscation | Prevent reverse engineering |
| **If app goes public** | Certificate pinning for Gmail API | Prevent MITM on rooted devices |
| **If multi-user cloud added** | Server-side auth, E2E encryption, access control | Data isolation between users |
| **If bank API integration added** | PCI-DSS compliance review | Handling direct bank credentials |
| **If payment processing added** | Full security audit by third party | Financial regulatory compliance |

For the current scope (personal app, local-only, no cloud), the controls in this document are sufficient.
