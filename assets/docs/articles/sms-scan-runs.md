---
title: SMS Scan Runs
slug: sms-scan-runs
summary: Review the history of every SMS scan Arth has run — what was found, what was skipped, and why.
tags: [SMS scan, scan runs, scan history, bank SMS, template, filtered, unrecognized, skipped, OTP, SMS pipeline, diagnose]
contextKeys: [sms-scan-runs, settings-sms]
phrasings:
  - View SMS scan history
  - Why was my SMS skipped?
  - Why did Arth not detect my transaction?
  - SMS scan run details
  - What is unrecognized SMS?
  - What does filtered mean in scan runs?
  - Bank pattern match
  - SMS template match
  - What happened during an SMS scan?
  - SMS scan results
  - How many SMS were scanned?
  - Scan run categories
  - Check if a specific SMS was processed
  - Search SMS scan history
  - Diagnose missing transaction
---

**SMS Scan Runs** (Settings → SMS → Scan Runs) shows a log of every scan Arth has run on your bank SMS messages — what it found, what it created, and why anything was ignored.

This screen is useful when an expected transaction did not show up after a scan, or when you want to understand exactly how a particular SMS was handled.

## Scan run list

The main screen shows every scan in reverse chronological order. Each row shows the scan date, whether it was triggered manually or automatically, and a summary count — how many SMS were processed and how many expenses or credits were created.

Tap any scan run to see the per-SMS breakdown.

## Categories

Inside a scan run, messages are grouped into five categories:

**Bank Pattern Matches** — messages that were recognised by Arth's built-in bank parsers (covers most major private and public sector banks). These produced an expense or credit in the review queue.

**Template Matches** — messages recognised by one of your custom Smart SMS Templates. These also produced an expense or credit in the review queue.

**Filtered Out** — messages that were matched by a parser or template but excluded because they belong to an account you did not include in this scan (for example, you ran a scan for one specific account and the SMS belonged to a different account).

**Unrecognized** — messages from senders that look like banks but whose format did not match any built-in parser or custom template. These are the messages to pay attention to if a transaction is missing — add a Smart SMS Template for the format so future scans catch it.

**Skipped** — messages that Arth intentionally did not attempt to parse. This includes OTPs, promotional messages, balance enquiry confirmations, and other non-transaction SMS. Skipped messages are not failures; they are expected noise.

## Viewing an individual SMS

Tap any category row to see the list of SMS in that group. Tap any message to open the detail view, which shows:

- The raw SMS body (up to 500 characters)
- The sender address
- The date and time received
- For matched messages: the parsed fields — Amount, Merchant, Type, Balance

This is the fastest way to diagnose why a transaction was or was not created. If the raw body contains the transaction details but it shows in Unrecognized, the format is not covered by a built-in parser and you can use the body to write a custom template.

## Searching within a category

On the category detail screen, a search bar filters the SMS list by body text, sender, or merchant name. This is helpful when you know the bank or merchant name and want to find how that SMS was handled.

## Navigating back

Inside a scan run, the hardware back button navigates through view levels in order: SMS detail → category list → scan run summary → scan run list. It does not jump straight to the list from deep inside — press back repeatedly to step back up.

## Common situations

**"A transaction didn't show up after a scan."** Open the most recent scan run. Check Unrecognized — if the SMS is there, it was seen but not parsed. Use the raw body to create a Smart SMS Template. If it is not in any category, the SMS sender was not in your bank sender list and the message was not read at all — add the sender under Settings → SMS → Senders.

**"Everything shows as Filtered Out."** If you ran a scan for a single account, messages from other accounts are filtered. Run a full scan (all accounts) to process everything.

**"I have thousands of Skipped messages."** This is normal. Banks send a high volume of OTPs and promotional messages. The Skipped category is shown for transparency but does not indicate a problem.

**"The scan shows 0 results."** Check that you have granted SMS read permission to Arth in your Android settings. Also check that your bank's sender name is included in Settings → SMS → Senders.

## Related

- Write a parser for an unrecognised bank: [Smart SMS Templates](sms-templates)
- Manage which accounts are scanned: [Setting up your accounts](accounts)
- Review and approve detected transactions: [Review queue](review-queue)
