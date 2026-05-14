# Artha Privacy Policy

**Last Updated:** April 14, 2026
**App Version:** 5.0.0
**Developer:** Sourav Baid

---

## Summary

Artha is a personal finance tracking app that stores all your data locally on your device. We do not collect, transmit, or share any of your personal or financial information with anyone. Your data never leaves your phone unless you explicitly choose to create a backup file.

---

## 1. Data We Process

Artha processes the following types of data, all stored locally on your device:

### Financial Transaction Data
- Expense amounts, descriptions, dates, and categories
- Budget allocations and spending breakdowns
- Financial goals, savings targets, and yearly plans
- Income and salary information you enter manually

### Bank SMS Messages (Optional)
- If you grant SMS permission, Artha reads bank transaction SMS from your phone's inbox
- SMS content is parsed locally on your device to detect expenses
- Raw SMS text is stored temporarily for review; you approve or reject each detected transaction
- **SMS data is never sent to any server or third party**
- You can disable SMS reading at any time from Settings

### Financial Account Information
- Account names, types, and identifiers (e.g., last 4 digits of card numbers)
- Account balances and payment mode preferences

### Backup Files (User-Initiated)
- When you create a backup, your data is encrypted with AES-256-GCM using a password you set
- The encrypted backup file is saved to a location you choose (e.g., phone storage, Google Drive)
- We have no access to your backup files or passwords

---

## 2. How We Use Your Data

All data processing happens locally on your device. We use your data to:

- Display your expenses, budgets, and financial summaries
- Categorize transactions and track spending patterns
- Generate insights and comparison reports
- Detect recurring transactions from your expense history
- Auto-detect bank transactions from SMS (only when you enable this feature)

We do **NOT** use your data to:
- Send information to any server or cloud service
- Display advertisements or targeted content
- Build user profiles or analytics
- Share with any third party for any purpose

---

## 3. SMS Permission (READ_SMS)

### Why We Request This Permission
Artha requests the READ_SMS permission to help you automatically track expenses by reading bank transaction alerts from your SMS inbox. This is an optional feature that you can decline or disable at any time.

### How SMS Data Is Handled
- SMS messages are read from your phone's local inbox only
- Only messages from recognized bank senders are processed (e.g., HDFCBK, SBIINB, ICICIB)
- SMS parsing happens entirely on your device using local pattern matching
- Detected transactions go into a review queue where you approve, edit, or reject each one
- No SMS content is ever transmitted over the internet
- No SMS content is shared with any third party

### Your Control
- You can deny the SMS permission and use Artha with manual expense entry only
- You can disable SMS detection at any time in Settings
- You can delete any auto-detected transaction from your expense history

---

## 4. Data Storage and Security

### Local Storage
- All data is stored in an SQLite database on your device
- The database is protected by your device's operating system encryption (Android full-disk encryption)
- No data is stored on any external server

### Backup Encryption
- Backup files are encrypted using AES-256-GCM, an industry-standard encryption algorithm
- Encryption keys are derived from your password using PBKDF2 with 600,000 iterations
- Without your password, backup files cannot be decrypted
- We do not store or have access to your backup passwords

### App Settings
- Preferences (theme, notification settings, SMS detection toggle) are stored locally using MMKV key-value storage
- These settings contain no sensitive financial data

---

## 5. Data Sharing

**Artha does not share your data with anyone.**

- No analytics services (no Google Analytics, Firebase, Segment, or similar)
- No crash reporting services
- No advertising networks
- No third-party SDKs that collect user data
- No server-side data processing

The only way data leaves your device is when you explicitly create an encrypted backup file and choose to share or store it using your device's share functionality.

---

## 6. Your Rights and Control

You have full control over your data:

| Right | How to Exercise |
|-------|----------------|
| **Access your data** | All data is visible in the app at all times |
| **Export your data** | Create an encrypted backup from Settings > Backup & Restore |
| **Delete specific data** | Delete any expense, budget, or goal from within the app |
| **Delete all data** | Uninstall the app to remove all data permanently |
| **Restore deleted items** | Recently deleted expenses are available in the Recycle Bin for 30 days |
| **Disable SMS reading** | Toggle off in Settings at any time |
| **Revoke permissions** | Use Android Settings > Apps > Artha > Permissions |

---

## 7. Children's Privacy

Artha is a personal finance management tool intended for adults. It is not designed for or directed at children under the age of 13. We do not knowingly collect data from children.

---

## 8. Compliance

### Digital Personal Data Protection Act, 2023 (India)
Artha is designed with DPDP Act principles:
- **Consent:** All data processing requires your explicit action (manual entry or SMS permission grant)
- **Data minimization:** We only process data necessary for expense tracking
- **Right to deletion:** You can delete any or all data at any time
- **Data portability:** Backup/export functionality is available

### General Data Protection Regulation (GDPR)
For users in the European Union:
- **Lawful basis:** Consent (you explicitly enter data or grant SMS permission)
- **Data processing:** All processing is local; no data is transferred outside your device
- **No third-party processors:** No data sharing agreements are needed because no data is shared
- **Right to erasure:** Fully supported via in-app deletion and device uninstall

---

## 9. Financial Services Disclaimer

Artha is a **personal expense tracking tool**. It does NOT:
- Provide investment advice or financial planning services
- Initiate, authorize, or process any payments or fund transfers
- Access your bank accounts or financial institution systems
- Act as a payment instrument or digital wallet

Artha reads bank SMS messages only to help you log expenses. It has no capability to interact with your bank or financial accounts.

---

## 10. Changes to This Policy

We may update this privacy policy from time to time. Changes will be reflected in the "Last Updated" date at the top. Continued use of the app after changes constitutes acceptance of the updated policy.

---

## 11. Contact

If you have questions about this privacy policy or Artha's data practices:

- **Developer:** Sourav Baid
- **Email:** kaiser.sb7292@gmail.com
- **GitHub:** https://github.com/sourav-ctm/accounts-manager-app

---

*This privacy policy applies to the Artha mobile application available on Google Play Store.*
