---
title: Angel One
slug: angel-one
summary: Connect Angel One with your own SmartAPI key to see holdings, positions, orders and funds, and save portfolio snapshots to your demat account.
tags: [Angel One, SmartAPI, broker, demat, portfolio, holdings, positions, orders, TOTP, MPIN, API key, integration, BYOK, snapshot]
contextKeys: [angel-connect, settings-angel]
phrasings:
  - How do I connect Angel One?
  - Angel One SmartAPI setup
  - Angel One integration
  - Angel One TOTP secret
  - Where do I find the Angel One API key?
  - Angel One client ID
  - Update demat value from Angel One
  - Angel One portfolio in Arth
  - Is it safe to store my Angel One PIN?
---

Connect your Angel One account to see your portfolio inside Arth and save its value to your demat account. The connection is **read-only** - Arth can't place orders or move money.

## Before you start: your own SmartAPI app

Arth connects with **your own** SmartAPI key. There is no shared Arth server in between.

1. Go to **smartapi.angelone.in**, sign in and create an app.
2. Copy its **API Key** (smartapi.angelone.in → Apps → your app).
3. In the Angel One app, turn on TOTP (**Setup → Enable TOTP**) and copy the **secret key** shown - the text, not the QR code.

## Set it up in Arth

1. **Settings tab → Integrations → Angel One.**
2. Enter:
   - **API Key**
   - **Client ID** - the same ID you use to log in to Angel One
   - **Password / MPIN**
   - **TOTP Secret** - the 32-character key from step 3 above
3. Read the terms card and tick the agreement box.
4. Tap **Connect**.

Arth generates the 6-digit TOTP code itself and refreshes your session automatically, so you don't need to log in every day.

## Where your credentials go

- Everything is stored **encrypted on this phone** and sent only to Angel One.
- Because your PIN and TOTP secret are stored so Arth can refresh the session, anyone who can unlock your phone **and** Arth could use them. Keep Arth's [app lock](biometric-lock) on.
- Your credentials are included, encrypted, in your Arth backup, so Angel One reconnects after a restore. You can also tap **Save to Vault** to keep a copy in the [Vault](vault) and **Fill from Vault** later.

## What you'll see

- **Summary** - current value, invested, P&L, today's P&L and available funds.
- **Stocks**, **Open positions** and **Recent orders**.

Search by name or symbol, and sort by Value, P&L, P&L % or Name.

## Save the value to your demat account

1. Tap **Link a Demat Account** and pick your Angel One demat account. Arth remembers the choice on this phone.
2. Tap **Update Snapshot with These Values**. Arth saves today's **portfolio value** and **funds** together.

## Disconnecting

Tap **Disconnect Angel One** on the Angel One screen to end the session. To delete your saved credentials too, tap **Update Credentials → Remove**. To revoke access fully, delete the app on the SmartAPI dashboard.

## Common situations

**"Connect fails."** Check the TOTP secret is the text key (not a 6-digit code), and that your Client ID and MPIN are correct.

**"My demat value didn't change."** Tap **Update Snapshot with These Values** after syncing.

## Related

- [Investments and fixed deposits](investments)
- [Zerodha Kite](kite-connect)
- [Zebpay](zebpay)
- [Vault - storing credentials and passwords](vault)
