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

## Set it up, step by step

Arth connects with **your own** Kite Connect API key ("bring your own key"). There is no shared Arth server in between. The same steps are on the Zerodha connect screen, with Copy buttons.

**Create your app**

1. Open **developers.kite.trade/apps** and sign up or log in. This login can be separate from your Zerodha trading login.
2. Choose a plan. Zerodha lists Personal as free, and it includes your holdings. Check their current pricing before you pay for anything.
3. Go to **My Apps** and tap **Create New App**. If the form asks for anything else, fill that in as it asks.
   - **App Name:** `Arth`
   - **Zerodha Client ID:** your Zerodha user ID, such as AB1234
   - **Redirect URL:** `https://127.0.0.1`. Enter it exactly. Your login stays on your phone.
   - **Postback URL:** leave blank
4. Save the app, then copy its **API Key** and **API Secret**.

**Get your TOTP key (optional)**

Only needed if you want Arth to fill in the 6-digit code at login. Otherwise skip this and type the code yourself.

5. In Kite, tap your Client ID, then **My profile** or **Settings**, then **Password & Security**.
6. Tap **Enable External TOTP** and enter the OTP sent to your email.
7. Tap **Can't scan?** and copy the key. Save it in the **TOTP key** field in Arth, and add it to your authenticator app as a time-based key.
8. To finish, enter the 6-digit code from your authenticator app and your Kite password, then tap **Enable**.

Already using TOTP? Use the key you saved when you set it up. If you don't have it, leave **TOTP key** blank.

**Connect**

9. **Settings tab → Integrations → Zerodha Kite.** Enter your **API Key** and **API Secret**.
10. Optional: add your **User ID**, **Password** and **TOTP key** under **Zerodha login**. Arth fills them in on Zerodha's page, and you still tap Login yourself.
11. Read the card, tick the box and tap **Connect**. Zerodha's own login page opens, so log in there.
12. Link your demat account, then tap **Update snapshot with these values**.

Zerodha asks you to log in again each day. That's Zerodha's rule, and it applies to every app that connects to Kite.

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

1. The first time, tap **Link demat account** and pick your Zerodha demat account. Arth tries to match it automatically by your BO number.
2. Tap **Update snapshot with these values**. Arth saves today's **portfolio value** and **funds** (idle cash) together to that demat account.

The snapshot feeds the Investments card, your demat account, and [Net Worth](balance-sheet).

## Daily login

Zerodha ends every Kite Connect session at around **6 AM** each day. When the session has expired, the screen asks you to **Reconnect**. With your login saved, reconnecting is a couple of taps, and Arth syncs straight after.

## Disconnecting

Tap **Disconnect Kite** at the bottom of the Zerodha screen. Arth removes the session. Your API key stays saved so reconnecting is quick; tap **Clear** on the credentials screen to remove it. To revoke Arth's access completely, delete the app in the Kite Connect developer console.

## Common situations

**"Token is invalid or has expired."** Your daily session has ended. Tap **Reconnect**.

**"Connect fails straight away."** Check the API key and API secret are copied exactly, with no extra spaces, and that the redirect URL is set in your Kite Connect app.

**"My demat value didn't change."** Syncing only shows the numbers. Tap **Update snapshot with these values** to save them to your demat account.

**"I don't have Kite Connect."** You can still track the account - record a snapshot yourself on the demat account screen.

## Related

- [Investments and fixed deposits](investments)
- [Angel One](angel-one)
- [Zebpay](zebpay)
- [Vault - storing credentials and passwords](vault)
- [Net Worth](balance-sheet)
