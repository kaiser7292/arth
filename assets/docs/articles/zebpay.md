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

## Set it up, step by step

The same steps are on the ZebPay connect screen, with Copy buttons.

**Create your key**

1. Open **build.zebpay.com** and sign in with your ZebPay account.
2. Create a new API key and fill in the form. Menu names may differ, so follow what your screen shows.
   - **Name:** `Arth`
   - **Permissions:** choose read-only permissions. Don't turn on trading or withdrawals.
   - **Bind IP:** leave blank. If you enter an IP, sync can stop when your phone's IP changes.
3. Enter the OTP sent to your email and phone.
4. Copy the **API Key** and **Secret Key** straight away. ZebPay only shows the secret once.

**Connect**

No TOTP is needed. The key is all Arth uses to connect.

5. **Settings tab → Integrations → Zebpay.** Paste your **API Key** and **Secret Key**.
6. Read the card, tick the box and tap **Connect Zebpay**.
7. Tap **Sync**, then **Link an Account**, then **Update Snapshot with These Values**.

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
