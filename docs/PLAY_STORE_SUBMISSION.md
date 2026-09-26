# Play Store Submission — Policy Forms

Draft answers for every policy form in Play Console (App content section), based on what the
code does as of v4.1.6. If a feature changes how data leaves the phone, update this file,
`docs/legal.html#privacy` and the Data safety form together.

Privacy policy URL: `https://souravbaid.com/legal.html#privacy`

---

## 1. SMS permission declaration (Permissions Declaration Form)

**Core functionality:** SMS-based money management — the app tracks the user's own bank,
card and UPI transactions from transaction alert SMS.

**Why the app needs READ_SMS (paste into the form):**

> Arth is a personal finance app that tracks the user's spending and account balances. Its core
> feature reads bank, credit card and UPI transaction alert SMS on the device to record each
> transaction (amount, date, merchant, account last 4 digits, balance) without manual entry.
> Most Indian banks do not offer account-aggregation APIs to individual users, so transaction SMS
> are the only reliable, real-time record of a user's transactions. Messages from non-financial
> senders are ignored. All SMS processing happens on the device; no SMS content is uploaded or
> shared with any server. Each detected transaction goes to a review queue where the user
> approves or rejects it. Before the Android permission prompt, the app shows a full-screen
> disclosure explaining what is read, why, and that nothing leaves the device, with explicit
> "Agree and continue" / "No thanks" choices. Users can turn SMS reading off at any time.

**Demo video (required):** record on a phone with a fresh install, showing:
1. Onboarding reaching the "Allow Arth to read your SMS?" screen, scrolling through it.
2. Tapping "Agree and continue", then the Android permission prompt, then Allow.
3. A scan finding bank SMS and the transactions arriving in the review queue.
4. Approving one, and it appearing in the account ledger.
5. Settings → turning SMS reading off.

Upload the video to YouTube as *unlisted* and paste the link. Use a test phone or blur real
amounts/account numbers — the video is seen by Google reviewers.

## 2. Data safety form

Play's rule: data is "collected" when it is sent off the device. Data processed only on the
phone (SMS, transactions, everything in the database) is **not** collected and is not declared.

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** (broker connections send user IDs off the device) |
| Is all user data encrypted in transit? | **Yes** (every network call is HTTPS) |
| Do you provide a way for users to request that their data is deleted? | **Yes** — explain: no account exists; all data is on the device and is removed by deleting records, disconnecting brokers, clearing app storage or uninstalling |

**Data types to declare:**

| Data type | Collected | Shared | Ephemeral | Required? | Purpose |
|---|---|---|---|---|---|
| Personal info → **User IDs** (Zerodha / Angel One client ID) | Yes | No | Yes | Optional | App functionality |
| Financial info → **Other financial info** (broker access token / API keys sent to the broker to fetch holdings) | Yes | No | Yes | Optional | App functionality |

Not declared, with reasoning (keep in case Google asks):
- **SMS, transactions, balances, Vault** — processed and stored only on the device.
- **Voice** — speech is recognised by the phone's system speech service, not by code in Arth;
  Arth only receives text. If Google pushes back, add Audio → Voice or sound recordings
  (collected, ephemeral, optional, app functionality).
- **AI model download** — a file download; no user data is sent.
- **Sharing** — sending credentials to a broker because the user asked to connect it is a
  user-initiated transfer, which Play exempts from "sharing".

## 3. Other App content forms

| Form | Answer |
|---|---|
| **Ads** | No, the app contains no ads |
| **App access** | All functionality is available without an account. Broker screens (Kite, Angel One, Zebpay) need the reviewer's own broker account; say they are optional read-only portfolio views. |
| **Content rating** (IARC questionnaire) | Category: Utility / Productivity. No violence, sexual content, gambling, user-to-user communication or location sharing. Expected rating: Everyone / 3+. |
| **Target audience** | 18 and over only (financial app; avoids the Families policy) |
| **News app** | No |
| **Health apps** | No |
| **Government app** | No |
| **Financial features** | Tick *personal finance / budgeting & expense tracking*, and *portfolio tracking* if listed. Do **not** tick lending, trading, payments or crypto exchange: loans are tracked, not offered, and broker links are read-only (no orders are placed). |
| **Data safety** | Section 2 above |

## 4. Open items before submitting

- **Kite Connect terms.** Every Play user's Kite login would go through your Kite Connect app
  and server. Check that Zerodha's Kite Connect terms allow a public app to use your API key
  for other people's accounts (a personal-use app may not). If not, hide Kite in the Play build
  or have users enter their own API key and secret.
- **Server logs.** The policy says the connection server does not store tokens. Confirm the
  server doesn't log request bodies (check the Node app and nginx/Caddy access logs on the VM).
- **Terms of Use** in `legal.html` are fine for Play; no changes needed.
