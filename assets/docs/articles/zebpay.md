---
title: Zebpay
slug: zebpay
summary: Connect Zebpay with your own API key to see your crypto holdings and INR balance, and save them as a snapshot on an investment account.
tags: [Zebpay, crypto, bitcoin, cryptocurrency, portfolio, API key, secret key, integration, BYOK, snapshot, broker]
contextKeys: [zebpay-connect, settings-zebpay]
phrasings:
  - How do I connect Zebpay?
  - Track crypto in Arth
  - Bitcoin portfolio
  - Zebpay API key
  - Where do I get a Zebpay secret key?
  - Crypto value in net worth
  - Update crypto snapshot
---

Connect Zebpay to see your crypto holdings and INR wallet balance inside Arth. The connection is **read-only** - Arth can't trade or move money.

## Before you start: your own API key

1. Go to **build.zebpay.com** and sign in with your Zebpay account.
2. Create a new app. You get an **API Key** and a **Secret Key**.

No OTP or PIN is needed - the API key identifies you.

## Set it up in Arth

1. **Settings tab → Integrations → Zebpay.**
2. Paste your **API Key** and **Secret Key**.
3. Read the terms card and tick the agreement box.
4. Tap **Connect Zebpay**, then **Sync**.

## Where your credentials go

- Your API key and secret are stored **encrypted on this phone** and sent only to Zebpay.
- They're included, encrypted, in your Arth backup, so Zebpay reconnects after a restore. You can also tap **Save to Vault** to keep a copy in the [Vault](vault) and **Fill from Vault** later.

## What you'll see

- **Summary** - current value, invested, P&L and available INR funds.
- **Crypto** holdings and **Open orders**.

Search and sort work the same way as for Zerodha and Angel One.

## Save the value to an account

1. Tap **Link an Account** and choose the investment account that should hold your crypto value. Arth remembers the choice on this phone.
2. Tap **Update Snapshot with These Values**. Arth saves today's crypto value as the portfolio and your INR wallet balance as the funds.

The value then shows on the Investments card and in [Net Worth](balance-sheet).

## Disconnecting

Tap **Disconnect Zebpay** on the Zebpay screen. To delete your saved key too, tap **Update Credentials → Remove**. To revoke access fully, delete the app on build.zebpay.com.

## Related

- [Investments and fixed deposits](investments)
- [Zerodha Kite](kite-connect)
- [Angel One](angel-one)
