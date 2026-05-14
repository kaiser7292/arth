---
title: Teach Artha to read any bank's SMS
slug: smart-sms-templates
summary: Paste an SMS, tap the amount / merchant / card / date to teach Artha any bank's format. Runs entirely on your device, no cloud.
tags: [sms, templates, automation, parser, bank, custom, unrecognised]
contextKeys: [settings-sms-templates, unrecognised-sms]
phrasings:
  - My bank's SMS isn't being detected
  - How to teach Artha a new bank
  - Custom SMS parsing
  - Add support for my bank
  - Artha is missing my bank's transactions
  - Smart SMS Templates
  - Bank not supported
  - Tag SMS fields
  - Auto-tag SMS
  - Guess the SMS fields
  - Long press to tag part of a word
  - Ref note multi word
  - Diagnose my template
  - Template not matching
  - Unrecognised SMS not showing
  - Where can I see SMS Artha couldn't read
---

Artha ships with parsers for ~30 Indian banks. If your bank isn't in that list — or it sends a format Artha hasn't seen before — you can teach it in a minute.

## Where to find it

**Settings tab → Automation → Smart SMS Templates.**

The list shows any templates you've built. The **Browse unrecognised SMS** row is always at the top — it tells you how many recent SMS Artha couldn't read (or confirms none are pending). Tap it to teach any of them.

Shortcut: the same browser is also reachable from **Settings tab → SMS Detection** when there are unrecognised SMS waiting — a row appears at the bottom of that card.

## How it works

You give Artha **one real SMS** from the bank. You **tap** the amount, merchant name, card number, and any other useful fields. Artha learns the pattern on your device. Next time an SMS from that bank arrives in the same format, it parses automatically.

No code, no cloud, no AI. You tell Artha where the fields live.

## Step by step

### Step 1 — Find an SMS to teach

Two ways in:

- **Automatic** — Artha collects SMS it couldn't parse. Tap **Browse unrecognised SMS** from the Smart Templates list. The Unrecognised screen shows the last 30 days, grouped by sender and format so a daily balance SMS doesn't bloat the list. Has a search box (sender + body) and a **Group similar** toggle that collapses repeating patterns into one row with a ×N badge.
- **Manual** — copy an SMS from your Messages app, then tap the **+** button on Smart SMS Templates and paste it.

### Step 2 — Resume or start fresh

If you started teaching a template earlier and didn't save, the paste screen offers **Continue** (resume) or **Discard** (start over).

### Step 3 — Tag the fields

The tag screen shows:

- A row per field (Amount, Account, Merchant, Date, Balance, Ref / Note), each with a colour dot.
- The SMS body rendered as tappable tokens below.

Tap a field row to activate it — a coloured banner appears at the top confirming the active field. Then tap the word(s) in the SMS.

- **One tap** tags a single word.
- **Long-press** a word to open the character sub-selector — you pick just part of the word. Use this when the number is stuck to a prefix (e.g. tag just `1,500.00` out of `Rs.1,500.00`).
- **Tap a tagged word** to untag just that word (multi-word tags keep the rest intact).

### Step 4 — Auto-tag for a head start

Tap **Guess it for me** (top-right of card 1). Artha scans the SMS and pre-fills amount, account, date, ref, and balance where it's confident. It only fills fields you haven't tagged yet — your manual taps always win.

### Step 5 — Clear a field

Each field row with a tag shows a ✕ button. Tap it to clear just that field without touching the others.

### Step 6 — Pick the transaction type

- **Expense** — money going out (debit).
- **Credit** — money coming in.
- **Refund** — returned to your card.

### Step 7 — Sender ID and match mode

Every Indian SMS carries a sender ID in the header — like `VM-HDFCBK-S`, `AD-MYTNEU-T`, `JD-AXISBK`. The **middle part** (`HDFCBK`, `MYTNEU`, `AXISBK`) is the bank / wallet / brand code. The prefix (`VM`, `AD`, `JD`) is the phone company that delivered the message and can change over time.

You tell Artha which sender(s) your template should handle:

- **Paste the sender** as you see it in your messages app (e.g. `VM-MYTNEU-S`).
- Pick a **Match mode**:
  - **Code** *(recommended)* — Artha auto-extracts the middle code and matches any sender with the same code. `VM-MYTNEU-S`, `AD-MYTNEU-T`, `JD-MYTNEU` all match. Survives the brand switching phone companies — which is the #1 reason templates silently stop working.
  - **Exact** — only the exact sender you pasted. Strict. Use if you specifically want to scope to one phone-company route.
  - **Contains** — any sender with your text anywhere in it. Use for weird sender IDs that don't fit the usual pattern.
- Below the input, Artha shows a preview of what will and won't match.

If you launched from the Unrecognised SMS list, the sender is pre-filled from the pending SMS.

**Why this matters for wallets.** Wallets like TataNeu, Amazon Pay, Paytm, Airtel Money send SMSes too, but Artha doesn't ship with a built-in list of their sender codes. The sender ID is what lets Artha route future SMSes from these brands to your template.

### Step 8 — Bank or Wallet name

This is the label Artha uses when it shows you matched expenses (e.g. "TataNeu" under the expense row). For well-known banks, start typing and pick from the suggestion list. For wallets or anything not in the list, type freeform.

### Step 9 — (Optional) Check the pattern

Below the details card is a collapsible **Pattern Preview (advanced)** section. Expand it to see the matching pattern if you want to verify what will actually be detected.

### Step 10 — Test the template

- **Test this SMS** — paste a second sample from the same bank and tap Test. Artha shows what it extracts.
- **Test against recent** — runs the template against the last 30 days of unrecognised SMS from this bank and tells you how many would now match. Great sanity check before saving.

### Step 11 — Save

If a template already exists for this bank + transaction type, Artha warns you and offers to **edit the existing one** instead of creating a duplicate. On save, you land back on the Smart SMS Templates list.

## What fields can I tag?

You can tag up to six fields. Only **Amount** is required — the rest are optional.

- **Amount** *(required)* — the rupee value of the transaction. Example: `INR 521.98`. Long-press to tag only the digits when stuck to a prefix like `Rs.` or `₹`.
- **Account** — which account the money moved through. Two formats accepted:
  - **Digits** like `XX2445` or `****1234` — Artha matches these against the last 3–6 digits of your saved card / savings account.
  - **Text** like `TataNeu` or `Amazon Pay Wallet` — Artha matches this case-insensitively against the label of a wallet account you've already created.
- **Merchant** — who you paid. Multi-word supported. Example: `BOOKMYSHOW`, `AMAZON PAY IN E COMMERC`.
- **Date** — the transaction date. Several D-M-Y formats accepted: `30-04-26`, `30/04/2026`, `30-APR-2026`, `30/APR/2026`.
- **Balance** — optional balance reading from the SMS (e.g. `Bal: INR 638,980.02`). Used to auto-update the account's last-known balance.
- **Ref / Note** — free-text remarks / description. Use this for the "reason" of the transaction. Accepts letters, digits, spaces, slashes, and common punctuation. Examples: `UPI/554478`, `IMPS/P2A/455612/FROM JOHN`, `Remarks: DIVIDEND Q2`.

## Editing an existing template

Open the template from the list. Artha reloads your original SMS sample **with your previous tags highlighted** — you don't re-tag from scratch. Adjust what needs fixing, save.

## Diagnose — checking if a template actually works

Each template card has a **Diagnose** button. Tap it and Artha runs your template's pattern against the last 30 days of real SMS on your phone and reports:

- ✅ How many SMS would have matched.
- A few sample matches (so you can eyeball that they're the right kind of SMS).
- If nothing matched, a few sample SMS that **looked related** but your pattern didn't catch — useful hints for what to fix.

Use this right after saving a new template to confirm Artha will actually catch future SMS, and any time you suspect a template has silently stopped matching (for instance, when a bank changes their SMS format).

## How templates interact with Artha's built-in parsers

Artha always tries its built-in parsers first. Your templates run as a fallback — they only fire when nothing hardcoded matched. This means:

- Your templates can never override a working built-in parser.
- A broken template can't cause a working SMS to stop parsing.
- If Artha ships a built-in parser for your bank in a future release, it'll take over and your template becomes redundant (harmless).

## Privacy

The sample SMS is stored on your device with the template so Artha can show you what it learned from. It travels with your backup file (encrypted with your password). If your SMS contains the full card number, OTP, or other sensitive details, **remove them from the sample before saving**.

Templates never leave your device. No cloud, no shared library, no analytics.

## Common situations

**I tagged the wrong word.** Tap the tagged word — just that word untags. Or tap the ✕ on the field row to clear the whole field.

**Save is disabled.** You need at least the amount tagged plus a bank name. If a field has a red warning below card 1, follow the explanation — usually the fix is long-pressing to tag only the digits, not the `Rs.` prefix.

**Test with another SMS didn't match.** The template is too specific. Use **Test against recent** to see how many real SMS it catches. If that's low, go back and tag fewer optional fields, or use long-press to tag tighter substrings so the surrounding anchor text has more room to vary.

**I need to tag a descriptive reference / remarks.** Use the **Ref / Note** field. It accepts multi-word remarks and slash-separated payloads (e.g. `IMPS/P2A/455612/FROM JOHN SMITH`, `Remarks: DIVIDEND INCOME Q2 2025`).

**I saved a template but nothing's being picked up.** Most common cause: the SMS came from a sender Artha didn't originally know about. When you teach a template from the Browse unrecognised SMS list, Artha automatically registers the sender against your chosen bank. If Diagnose shows 0 matches despite SMS clearly present, open the template, tap **Test against recent**, and tighten or loosen anchor text as needed.

**Delete a template.** List screen → tap **Delete** on the card.

**I already have a template for this bank — Artha won't let me make a second.** Artha warns you to prevent accidental duplicates. Choose **Edit Existing** to update the old one, or **Save Anyway** if you genuinely want two templates for the same bank + type.

## Related

- [How SMS detection works](sms-detection)
- [Privacy and offline-first](privacy-offline)
- [Auto-categorize with smart rules](smart-rules)
