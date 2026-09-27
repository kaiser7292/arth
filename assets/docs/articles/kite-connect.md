---
title: Zerodha Kite
slug: kite-connect
summary: Connect Zerodha with your own Kite Connect API key to see your stocks, mutual funds, SIPs and orders, and save portfolio snapshots to your demat account.
tags: [Kite Connect, Zerodha, Kite, demat, portfolio, holdings, mutual fund, SIP, orders, positions, API key, API secret, TOTP, broker, integration, BYOK, snapshot]
contextKeys: [kite-connect, settings-kite]
phrasings:
  - How do I link Zerodha to Arth?
  - Kite Connect setup
  - Zerodha integration
  - Kite Connect API key
  - Where do I find the API secret?
  - Redirect URL for Kite Connect
  - Token is invalid or has expired
  - Failed to initiate Kite login
  - Why do I have to log in to Zerodha every day?
  - Fill Zerodha login automatically
  - Zerodha TOTP key
  - Update demat value from Zerodha
  - Update snapshot
  - Mutual fund P&L shows zero
  - See my SIPs in Arth
  - Connect demat account to Arth
  - Is it safe to give Arth my API secret?
---

Connect your Zerodha account to see your holdings inside Arth and save their value to your demat account. The connection is **read-only** - Arth can't place orders or move money.

## Before you start: your own Kite Connect app

Arth connects with **your own** Kite Connect API key ("bring your own key"). There is no shared Arth server in between.

1. Go to **developers.kite.trade/apps** and sign in with your Zerodha account.
2. **Create an app.** Zerodha may charge for Kite Connect - check their current pricing.
3. Set the **Redirect URL** to `https://127.0.0.1`. Any URL works; Arth reads the login result itself.
4. Copy the **API Key** and **API Secret** from the app's details page.

## Set it up in Arth

1. **Settings tab → Integrations → Zerodha Kite.**
2. Enter your **API Key** and **API Secret**.
3. *(Optional)* Fill in the **Zerodha login** card - **User ID**, **Password** and **TOTP key**. Arth then fills these in on Zerodha's login page for you. You still tap Login yourself. A TOTP key on its own is enough to fill the 6-digit code.
4. Read the terms card and tick the agreement box.
5. Tap **Connect**. Zerodha's own login page opens. Log in (or let Arth fill it), and Arth finishes the connection.

The **TOTP key** is the text code Zerodha shows when you set up TOTP ("Can't scan the QR code?").

## Where your credentials go

- Your API key, API secret and login are stored **encrypted on this phone**.
- You sign in on Zerodha's own page, and Arth talks **directly to Zerodha**. Your API secret itself is never sent - only a one-way checksum made from it.
- The login fill only happens on kite.zerodha.com.
- Credentials are **not in backups**. Tap **Save to Vault** so the [Vault](vault) (which is backed up) keeps a copy. After a restore, use **Fill from Vault** to reconnect.

## What you'll see

After connecting, the Zerodha screen shows:

- **Summary** - current value, invested, P&L and available funds.
- **Stocks** and **Mutual funds** - one row each with quantity, average price, latest price or NAV, value and P&L. Mutual funds show the date of the NAV so you can spot a stale value.
- **Open positions**, **Active SIPs**, **Recent stock orders** and **Recent MF orders**.

Search by name or symbol, and sort by Value, P&L, P&L % or Name. Arth remembers your sort.

## Save the value to your demat account

1. The first time, tap **Link Demat Account** and pick your Zerodha demat account. Arth tries to match it automatically by your BO number.
2. Tap **Update Snapshot with These Values**. Arth saves today's **portfolio value** and **funds** (idle cash) together to that demat account.

The snapshot feeds the Investments card, your demat account, and [Net Worth](balance-sheet).

## Daily login

Zerodha ends every Kite Connect session at around **6 AM** each day. When the session has expired, the screen asks you to **Reconnect**. With your login saved, reconnecting is a couple of taps, and Arth syncs straight after.

## Disconnecting

Tap **Disconnect Kite** at the bottom of the Zerodha screen. Arth removes the session. Your API key stays saved so reconnecting is quick; tap **Clear** on the credentials screen to remove it. To revoke Arth's access completely, delete the app in the Kite Connect developer console.

## Common situations

**"Token is invalid or has expired."** Your daily session has ended. Tap **Reconnect**.

**"Connect fails straight away."** Check the API key and API secret are copied exactly, with no extra spaces, and that the redirect URL is set in your Kite Connect app.

**"My demat value didn't change."** Syncing only shows the numbers. Tap **Update Snapshot with These Values** to save them to your demat account.

**"I don't have Kite Connect."** You can still track the account - record a snapshot yourself on the demat account screen.

## Related

- [Investments and fixed deposits](investments)
- [Angel One](angel-one)
- [Zebpay](zebpay)
- [Vault - storing credentials and passwords](vault)
- [Net Worth](balance-sheet)
