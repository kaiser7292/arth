---
title: Minimum balance alerts on savings accounts
slug: min-balance-alert
summary: Set a minimum balance for any savings account. Arth shows an alert on Home when the balance drops below. Fully opt-in, per-account.
tags: [savings, alerts, balance, minimum, warning]
contextKeys: [settings-accounts, account-detail, home]
phrasings:
  - Set minimum balance on my account
  - Alert me if balance drops
  - Low balance warning
  - Avoid dropping below minimum
  - Balance threshold alert
  - Warn me before I'm below the minimum
---

Indian banks often require you to keep a minimum balance in your savings account - drop below and they charge a non-maintenance fee. Arth can warn you on the Home screen whenever a savings account dips below the threshold you set.

## Where to find it

**Settings tab → Master Data → Accounts → tap any savings account → Minimum Balance Alert.**

The feature is **off by default** (threshold = 0). Set any positive rupee amount to turn it on for that account.

## How it works

1. You set a minimum balance for a savings account (say ₹10,000).
2. Arth continuously tracks the account's closing balance - expenses, credits, transfers, adjustments all feed in.
3. If the balance drops below ₹10,000, a red alert appears at the top of your Home screen:
   *"HDFC Savings is below minimum - ₹8,450 of min ₹10,000 · shortfall ₹1,550."*
4. Tap the alert to jump straight to that account's ledger.
5. Tap **Dismiss** to acknowledge it for the rest of the month.

## Behaviour details

- **Savings only.** Credit cards, wallets, loans, and demat accounts ignore this field - the concept doesn't map cleanly to them.
- **Each account, independently.** One account breaching doesn't trigger alerts for your other accounts.
- **Dismiss is per-month.** If you dismiss in April, the alert won't re-show that month. On May 1 it re-arms - if you're still below, it'll warn you again.
- **Alert recomputes live.** As soon as a credit pushes the balance back above the threshold, the alert disappears on next Home refresh (no need to dismiss).
- **No notifications.** The alert is visual on Home only. Arth doesn't send push notifications for min-balance breaches.

## What counts as "below minimum"

Arth uses the **ledger-computed closing balance** - the same number you see on the account's ledger screen. That's:
- Your opening balance for the month
- **Minus** expenses posted to this account
- **Plus** credits
- **Minus** transfers out
- **Plus** transfers in
- Adjustments

If the resulting closing is less than your minimum, you'll see the alert.

## Common situations

**"I got the alert but the balance looks fine in my banking app."**
Arth's number is based on your tracked transactions. If you have unreviewed SMS in the Review Queue, or a recent expense hasn't been categorized yet, Arth's number can lag your bank's. Approve the pending items, then refresh Home.

**"I want to turn off the alert for one account."**
Settings tab → Master Data → Accounts → tap the account → set Minimum Balance to 0 or clear the field. Save.

**"Can I get an alert when balance drops by a percentage, not a fixed amount?"**
Not yet. v1 only supports fixed rupee thresholds. Percentage-based thresholds may come later.

**"Can I set this for a credit card?"**
No - credit cards have a separate "utilized" / "available limit" model, not a minimum balance. If you want CC alerts, see the CC dashboard on Home.

## Privacy

The threshold is stored on your device only. It **does** travel with your backup file (encrypted with your password) so a new device inherits your thresholds.

The "dismissed this month" state is device-local only - it does **not** travel with backups. A fresh restore on a new device will re-show any active breaches.

## Related
- [Backup and restore](backup-restore)
- [Privacy and offline-first](privacy-offline)
