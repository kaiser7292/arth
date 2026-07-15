---
title: Kite Connect (Zerodha)
slug: kite-connect
summary: Link your Zerodha account to fetch live demat prices and update your balance sheet and home screen with current market values.
tags: [Kite Connect, Zerodha, demat, live prices, portfolio, market value, API, equity, stock price, NAV, mutual fund]
contextKeys: [kite-connect, settings-kite]
phrasings:
  - How do I link Zerodha to Arth?
  - Kite Connect setup
  - Live demat prices
  - Zerodha API in Arth
  - Update demat value automatically
  - Fetch portfolio value
  - Kite Connect API key
  - Why is my demat value not updating?
  - Live portfolio value in balance sheet
  - Zerodha integration
  - Connect demat account to Arth
---

**Kite Connect** is Zerodha's developer API. When you link it to Arth, your demat account value updates automatically with live market prices instead of relying on the cost basis or a manually entered snapshot.

## Prerequisites

You need an active **Zerodha Kite Connect subscription**. This is a paid developer plan separate from your regular Zerodha trading account. Sign up at kite.trade and generate an API key and API secret from the developer console.

## Linking your account

1. Open **Settings → Integrations → Kite Connect**.
2. Enter your **API key** and **API secret** from the Zerodha developer console.
3. Tap **Connect**. Arth opens a Zerodha login page inside the app.
4. Log in with your Zerodha credentials (user ID and password, followed by the two-factor TOTP or PIN).
5. On success, Arth receives an access token from Zerodha and stores it securely on your device.

The access token expires every day at 6:00 AM IST (Zerodha's standard session reset). You will need to re-authenticate each morning if you want fresh prices that day.

## What updates after linking

Once connected, Arth can fetch your current portfolio holdings and their market values from Zerodha. These prices flow into:

- **Demat account balance** on the Home tab and account ledger
- **Balance Sheet** — the Live column shows current market value instead of cost basis
- **Year-over-Year comparison** — the demat value reflects live prices

Prices update each time you open the relevant screen, as long as the Kite Connect session is active.

## Disconnecting

Open Settings → Integrations → Kite Connect and tap **Disconnect**. Arth deletes the stored access token. Demat values revert to the last manually recorded snapshot (cost basis) until you reconnect.

## Common situations

**"My demat value is not updating even though I'm connected."** The Kite Connect access token expires at 6 AM IST every day. Open Settings → Integrations → Kite Connect and reconnect by logging in again.

**"I don't have a Kite Connect subscription."** You can still track your demat account in Arth — enter the current market value manually on the demat account detail screen whenever you want to update it. The Balance Sheet will use that figure.

**"I don't see Kite Connect in Settings."** The integration may be behind a feature flag if it was recently added. Check that your app is on the latest version.

**"Arth shows a different value than my Zerodha portfolio."** Arth fetches the value from Kite Connect's holdings API, which reflects settled holdings. Intraday positions may not be included. Check the Zerodha app for real-time intraday view.

## Related

- See your net worth with live prices: [Balance Sheet](balance-sheet)
- Set up your demat account: [Setting up your accounts](accounts)
