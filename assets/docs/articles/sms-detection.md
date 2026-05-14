---
title: How SMS detection works
slug: sms-detection
summary: On-device parsing of bank SMS into expenses. Nothing leaves your phone. Android-only.
tags: [sms, auto-detect, privacy, android, permission, banks]
contextKeys: [sms-settings, review-queue]
phrasings:
  - How does SMS reading work?
  - Does Artha send my SMS anywhere?
  - Is reading my SMS safe?
  - Why does the app need SMS permission?
  - Can I use Artha without giving SMS access?
  - Some SMS are not being picked up
  - Artha missed an expense from my bank
  - How do I turn off SMS auto-detect?
  - Only some bank SMS work
  - Why did my SMS not create an expense?
  - Which banks are supported?
  - Rescan SMS history
---

When you turn on SMS detection, Artha reads bank / UPI SMS on your phone and turns them into expense entries you can review. Everything happens on-device.

## Where to find SMS settings

**Settings tab → SMS Detection.**

The screen has:

- A **master toggle** — on / off.
- **Date range** for scanning (default: last 180 days).
- **Scan Now** — rescans existing SMS.
- **Test a Sample** — paste any SMS to see how it would parse.

## What Artha reads

Only SMS from **registered bank / UPI senders** (DLT transactional codes). Personal messages, OTPs, and promotional SMS are ignored by the sender-allowlist. The built-in allowlist covers:

- 25+ Indian banks — all PSU banks (SBI, PNB, Canara, BoB, Union, Indian Bank, etc.), major private banks (HDFC, ICICI, Axis, Kotak, Yes), small finance banks, and credit-card issuers.
- UPI apps — PhonePe, GPay, Paytm, Amazon Pay, BHIM, Cred.
- Wallet providers.

## What happens when an SMS is parsed

Step by step, what Artha does the moment a bank SMS arrives (or during a Scan Now run):

1. **Check the sender.** Artha matches the sender code against the allowlist. If it's not a known bank or wallet, the SMS is ignored.
2. **Parse the message.** For a recognised bank, Artha applies that bank's parsing rules to extract fields from the body — amount, merchant, card last-4, date, direction (debit / credit), and balance (when present).
3. **Save the raw SMS body.** The original text is saved locally so you can later inspect "Source SMS" from the expense detail.
4. **Classify the transaction.** Based on what was parsed:
   - **Debit** → a pending expense lands in the Review Queue (Auto-Detected filter).
   - **Credit** → a pending credit lands in the Review Queue.
   - **Payment received on credit card** → Artha tries three routes, in order: (1) match to a pending forecast for the CC bill, (2) reclassify as a transfer from savings if a matching debit exists there, (3) otherwise create a pending credit.
   - **Reminder / due-date SMS** → creates or updates a forecast.
   - **Balance-only SMS** (no transaction, just a balance update) → silently updates the account's `last_known_balance`. Nothing in Review Queue.
5. **Wait for you.** The parsed row sits in the Review Queue. Nothing enters your budget, ledger, or account balance until you approve it.

## Privacy

- **Reading** happens via the Android OS on your device. No network call.
- **Parsing** runs entirely within the app on your phone.
- **Storage** — the raw SMS body is kept locally on your device; it is not transmitted.
- Artha has **zero** network permissions for normal use.

## Improving detection over time

- **3 category corrections for the same merchant** → Artha learns and auto-applies that category to future SMS from that merchant.
- **1 merchant rename** → the alias applies to future (and optionally past) SMS from that source.
- **Ships with ~200 merchant aliases + ~1500 bank patterns** out of the box, so the very first scan already handles most common transactions.
- **Smart rules** (Settings tab → Automation → Smart Rules) are the explicit override — define your own IF / THEN conditions that run before auto-detection.

## Common situations

**Some SMS from my bank are never picked up.** A few possible reasons:

1. The sender code might not be in the allowlist. Paste the full SMS header into Settings tab → SMS Detection → Test a Sample to check.
2. The SMS body format is unusual (template changed). Teach Artha the new format using [Smart SMS Templates](smart-sms-templates), or add a smart rule as a workaround.
3. The SMS date is outside your scanning window (default: last 180 days).

**A parsed SMS got the merchant wrong.** Open the pending expense in Review Queue → tap **Merchant** → rename → Save. Apply to past if you want history cleaned.

**Turn off SMS entirely.** Settings tab → SMS Detection → master toggle off. Everything still works manually. Existing pending SMS stay in Review Queue until you approve or reject.

**My credit card balance is stale even though I made purchases.** The purchase SMS may not have contained a balance. Artha flags the auto-detected balance as "stale" and uses the ledger-computed value instead. The Balance Source Card on the account-detail screen explains which number is in use.

**I want to rescan old SMS after installing.** Settings tab → SMS Detection → **Scan Now**. Scans within the configured date range.

## My bank isn't being detected

Artha ships parsers for ~30 Indian banks. If yours isn't on the list — or the format is unusual — you can teach Artha how to read it in a minute. See [Teach Artha to read any bank's SMS](smart-sms-templates).

## Related

- [The review queue](review-queue)
- [Fixing merchant names](merchant-aliases)
- [Privacy and offline-first](privacy-offline)
- [Auto-categorize with smart rules](smart-rules)
- [Smart SMS Templates](smart-sms-templates)
