---
title: FDs, transfers to yourself and SIPs
slug: money-events
summary: Bank messages that aren't really spending or income - opening or closing an FD, moving money between your own accounts, and SIP auto-debits.
tags: [fd, fixed-deposit, term-deposit, self-transfer, own-account, sip, mutual-fund, money-events]
contextKeys: [review-queue, transactions]
phrasings:
  - My FD shows as an expense
  - FD maturity shows as income
  - Closure of TD credit
  - Money I moved to my other account counts as spending
  - Transfer between my own accounts
  - Is this name me
  - Your name in bank SMS
  - SIP shows as spending
  - Link SIP to bucket
  - SIP bounced
---

Some bank messages aren't spending or income at all. Arth spots four kinds and asks you once, with a one-tap card in the review queue and Catch Up.

## A new fixed deposit

A debit like "FD through MOBILE" is money going into an FD, not spending. The card says **Looks like a new fixed deposit**.

- **Set up FD** opens the fixed deposit screen with the bank, amount, date and account filled in. Add the rate and maturity date, or leave them for later.
- **It's not an FD** keeps it as a normal expense.

Once it's an FD it stops counting as spending and shows in your net worth.

## An FD that closed

A credit like "Closure of TD A/c ..." is your own money coming back. When the message names the FD's number, Arth closes that FD by itself and records the interest. It also works when you close an FD early.

If Arth can't tell which FD it was, the card says **FD / TD closed**:

- **Choose the FD** - pick it from your open FDs.
- **Record this FD** - shown when the money that went into it is in your transactions. Arth sets up the FD and closes it in one go.
- **It's a regular credit** - keep it as money in.

## Money between your own accounts

When the debit and the credit are both in Arth (for example an IMPS from HDFC that lands in SBI), Arth turns them into one transfer automatically. Neither side counts as spending or income, and you can undo it from the transaction.

When only one side is there yet, the card says **Your own account**:

- **Pick account** - choose the other account.
- **Add account** - when the message names an account Arth doesn't have yet.
- **It's not mine** - keep it as it is.

### Your name in bank messages

Banks print your name on transfers to yourself, like "Transferred to Mr. RAHULVERMA". Arth asks once, on Home, when it keeps seeing the same name. You can add or remove names in **Settings → Your Name in Bank SMS**. Shortened spellings ("RAHUL VER", "RAHULVERMA") match too.

## SIPs

Auto-debits to a mutual fund (BSE StAR MF, CAMS, KFintech, a fund house, Groww, Zerodha Coin...) show as **SIP · investment**.

- **Link to bucket** - pick an investment bucket. Tick **Always do this** and future SIPs to that fund link by themselves.
- **It's not a SIP** - keep it as a normal expense.

If a SIP bounces, Arth sends a notification so you can top up the account before the next one.

## Related

- [The review queue](review-queue)
- [Catch Up](catch-up)
- [Recording transfers between accounts](transfers)
- [Investments](investments)
