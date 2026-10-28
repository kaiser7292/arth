# Household — Phase 1 design

**Status:** design agreed, not built · **Date:** 2026-10-28 · **Owner:** Sourav

Phase 1 of "Together": 2–5 people form a **household**, each chooses what to share, and every phone in the household stays up to date through an end-to-end encrypted relay. Combined month view, shared budgets, shared goals and settle-up are later phases and build on this.

The Hisaab file import idea is dropped. Hisaab between household members is not part of Phase 1 either; it can come later on top of the same sync.

---

## 1. Scope

**In Phase 1**
- Start a household, give it a name (up to 5 members).
- Invite by QR code (in person) or by link (WhatsApp etc.), with the inviter approving each join and both phones showing the same 6-digit check code.
- Each member chooses what to share, with a preview of exactly what the others will see.
- Sync through an encrypted relay on Cloudflare: when Arth opens, after a change, and in the background (Android reliably, iPhone when iOS allows).
- Together screen: members, last synced, sharing settings, activity feed of what others shared.
- Home card: "Home · Aastha shared 3 transactions".
- Leave a household; the creator can remove a member (keys change so the removed phone can't read anything new).
- Survives backup / restore and moving to a new phone.

**Not in Phase 1:** "Our month" combined view and charts (Phase 2), budgets (3), goals (4), settle-up and check-in (5), Hisaab sync, more than one household per person, comments on transactions.

---

## 2. How it feels (user flows)

### 2.1 Start a household
Settings → **Household** → **Start a household** → name it ("Home") → the QR screen appears straight away (2.2). The person who starts it is the **creator**.

### 2.2 Invite
The QR screen shows a QR code and **Send invite link**. Both carry the same one-time invite, valid for 24 hours.

- In person: the other person opens Arth → Settings → Household → **Join a household** → scans.
- Remote: they tap the link on WhatsApp; it opens Arth on the join screen.

### 2.3 Join and approve
1. Joining phone: "Join Sourav's household 'Home'?" → **Join**. It shows a check code, e.g. **482 913**, and "Waiting for Sourav to approve".
2. Inviting phone (open on the invite screen, or as a notification next time Arth opens): "Aastha's Pixel 8 wants to join · code **482 913**" → **Approve** / **Decline**.
3. Matching codes prove nobody intercepted the link. In person they glance at both screens; remotely, read it out on a call. (The help text says so; we don't force it.)
4. On approve, the joining phone receives the household key and lands on **What to share** (2.4).

Any existing member can create invites; only the creator approves joins in Phase 1 (one person in charge keeps it simple; can relax later).

### 2.4 Choose what to share
Defaults in **bold**:

| Choice | Default | What others see |
|---|---|---|
| Household categories in full | **On** | Each approved transaction in a household category: date, amount you paid, your share (after splits), household category, merchant |
| Totals of everything else | **On** | Per month, per your own category: one total (e.g. "Shopping ₹4,800"). No transactions, no merchants |
| Every transaction | Off | All approved spends and credits, like a joint account. Turning it on replaces the two above |
| Savings rate | Off | Per month, a percentage. Never income or salary |
| Account balances | Off | Name, type and balance of each account you tick |

Below the switches, **"Others will see"** previews this month with the current choices. Changing a choice later takes effect from the next sync; turning something off removes what was shared under it from everyone's phone.

Never shared, whatever the settings: pending (unapproved) items, raw SMS text, account numbers, notes, the Vault, broker data, loans, income amounts, other people in your Hisaab.

### 2.5 Household categories
Categories are per phone (Aastha's "Grocery" may be your "Groceries"). The household keeps its own short list, set by the creator: default **Groceries, Rent, Utilities, Household help, Fuel** (editable). Each member maps their own categories onto it once, with name matching doing most of the work ("Grocery" → Groceries). Unmapped categories count under "Totals of everything else".

### 2.6 Everyday
- You approve a ₹2,300 BigBasket expense in Groceries. Within seconds (if online) it is queued, encrypted and sent.
- Aastha opens Arth: "Synced just now". The Home card and activity feed show "Sourav · Groceries · BigBasket ₹2,300".
- Editing or deleting it updates or removes it on her phone. Rejecting or moving it to a non-household category removes it.
- Offline: changes wait in an outbox and go when back online.

### 2.7 Leave, remove, close
- **Leave** (any member): your entries are deleted from the relay straight away and from the other phones on their next sync; you keep your own data; shared items from others are deleted from your phone.
- **Remove member** (creator): same effect for that member, plus a new household key is issued to the remaining phones, so the removed phone can't read anything sent afterwards. What they already received stays on their phone; the app says so plainly.
- When the last member leaves, the relay deletes the household.

### 2.8 New phone, restore, reinstall
The encrypted backup includes the household, its key and your member keys. Restoring on a new phone continues as the same member; nothing to scan again. If the old phone is still in use, the first one to sync after the move wins and the other shows "Home is now on your other phone" and stops syncing.

---

## 3. Sync design

### 3.1 Model: one log per member
Each member only ever writes their **own** log: a numbered list of changes (1, 2, 3 …). Nobody edits anyone else's records, so there are no merge conflicts. Each phone remembers, per member, the last number it has applied.

A change (an **op**) before encryption:

```json
{ "v": 1, "hh": "<household id>", "m": "<member id>", "dev": "<device id>",
  "seq": 42, "at": 1793158652987, "kind": "tx.upsert", "body": { ... } }
```

| kind | body | notes |
|---|---|---|
| `member.profile` | name, colour, public keys | first op of every member |
| `member.settings` | the sharing choices | so others know what to expect |
| `tx.upsert` | share id, date, paid, my share, household category or own category name, merchant, kind (spend / refund) | share id is random, not the local expense id |
| `tx.delete` | share id | |
| `total.month` | month, category name, amount | replaces that month's totals |
| `savings.month` | month, rate % | |
| `balance.set` / `balance.delete` | account label, type, balance, as-of | |
| `household.rename`, `household.categories` | | creator only |
| `member.approve`, `member.remove`, `household.rekey` | | creator only; receivers check the author |
| `snapshot.begin` / `snapshot.end` | | wraps a full re-send of the member's current state (3.4) |

Ops are applied idempotently (the same op twice changes nothing) and per member in order.

### 3.2 Envelope
Each op is serialised, **signed** with the author's signing key (Ed25519) and **encrypted** with the household key (XSalsa20-Poly1305, random 24-byte nonce). The relay only ever stores the ciphertext under `(household id, member id, seq)`. Receivers decrypt, then check the signature against that member's public key, so one member can't forge another's entries even though they share the household key.

### 3.3 When it syncs
1. Arth comes to the foreground (and on cold start, after the database is ready, off the start-up path).
2. 5 seconds after a local change that affects shared data (debounced).
3. Background: `expo-background-fetch` task, about hourly on Android; iOS runs it when it decides to.
4. Pull to refresh on the Together screen.

A sync: send the outbox → fetch new ops for every member since the cursors → apply in a single database transaction → acknowledge cursors to the relay → `bumpDataVersion()`. A failure sets `last_sync_error` (shown as "Couldn't sync · Retry") and never throws into screen load callbacks.

### 3.4 Catching up and snapshots
The relay deletes ops once every active member has acknowledged them, and anything older than 90 days. A phone that falls further behind (or a newly approved member) asks for a resync; every other member's phone then sends a **snapshot**: its full current shared state for the last 13 months, chunked into ops between `snapshot.begin` and `snapshot.end`. The receiver replaces that member's items with the snapshot.

### 3.5 Publishing local changes
A publisher hooks the existing write paths (approve, edit, reject, delete, restore from recycle bin, category change, split change, bulk approve) through one function, `queueHouseholdChanges(expenseIds)`, which recomputes what should be shared for those expenses and writes the difference to the outbox. Monthly totals and savings rate are recomputed for affected months. Turning on a household or changing sharing settings triggers a full recompute (a snapshot).

Only approved, non-deleted debits and credits count, excluding transfers, forecasts and ledger adjustments. "My share" uses `effectiveAmountSql` so splits and linked refunds match the rest of the app.

---

## 4. Keys and security

| Key | What | Where it lives |
|---|---|---|
| Household key | 32 random bytes | SecureStore `household_key_<id>`; in the encrypted backup |
| Member keys | X25519 (to receive keys) + Ed25519 (to sign ops) | SecureStore `household_member_<id>`; in the encrypted backup |
| Relay token | `HMAC-SHA256(household key, "arth-relay-v1")` | derived, never stored; the relay stores only its SHA-256 |
| Invite secret | 32 random bytes, one use, 24 h | only in the QR / link fragment and the inviter's phone |

**Invite and join, in detail**
1. Inviter makes `invite id` + `invite secret`; registers the invite id with the relay (expiry 24 h). QR / link: `arth://household/join#i=<id>&s=<secret>`. The part after `#` never leaves the phones.
2. Joiner makes its member keys and posts, encrypted with the invite secret: name, device name, public keys.
3. Inviter decrypts. Both phones compute the check code: first 6 digits of `SHA-256(inviter public key ‖ joiner public key ‖ invite secret)`.
4. On approve, the inviter encrypts `{household id, name, household key, members and their public keys}` to the joiner's X25519 key and posts it; the relay deletes the invite after the joiner collects it.

**Removing a member:** the creator makes a new household key, encrypts it to each remaining member's public key, posts a `household.rekey` op signed with the creator key, and swaps the relay token (authorised with the old one). Old ops stay readable with the old key until they expire; new ones use the new key. Keys carry a version number.

**Libraries:** `tweetnacl` (pure JS, widely audited; box, secretbox, sign) with randomness from `expo-crypto`; `react-native-aes-crypto` HMAC/SHA-256 already in the app. No new native crypto.

**What the relay can see:** random household and member IDs, how many ops and how big, when, and the IP address of each request (as any web server does). Not names, amounts, categories, merchants or anything else.

---

## 5. Relay (Cloudflare)

- **Where:** a Cloudflare Worker at `sync.souravbaid.com` on the account that already serves the site, with a D1 (SQLite) database. Code in a new `relay/` folder in this repo, deployed with `wrangler`.
- **Cost:** free tier (100k requests/day, D1 5 GB / 100k row writes a day). A household syncing ~20 times a day per person uses ~100 requests a day, so roughly 1,000 active households fit in the free tier; beyond that it's Cloudflare's $5/month plan.
- **Upkeep:** none day to day. Cloudflare's dashboard shows request counts and errors.

### 5.1 API (all HTTPS, JSON, `Authorization: Bearer <relay token>` except where noted)

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/households` | create (no auth; body has token hash). Rate-limited per IP |
| PUT | `/v1/h/:hh/log/:member/:seq` | upload one op (≤ 64 KB). Same seq twice = no-op |
| GET | `/v1/h/:hh/log?since=m1:12,m2:40` | ops after each cursor, up to 500 per page |
| POST | `/v1/h/:hh/ack` | this phone's cursors (lets the relay prune) |
| POST | `/v1/h/:hh/token` | swap token (rekey), authorised with the current token |
| DELETE | `/v1/h/:hh/member/:member` | leave: delete that member's log and cursor now |
| DELETE | `/v1/h/:hh` | close household |
| POST | `/v1/invites` | register invite (auth: household token) |
| POST/GET | `/v1/invites/:id/request` | joiner posts / inviter reads join request (auth: invite proof) |
| POST/GET | `/v1/invites/:id/accept` | inviter posts / joiner collects the key bundle |

### 5.2 Tables (relay)
`households(id, token_hash, created_at, last_active_at)` · `log(hh, member, seq, blob, size, created_at)` · `cursors(hh, member, acked_json, updated_at)` · `invites(id, hh, expires_at, request_blob, accept_blob)`.

### 5.3 Limits and clean-up
64 KB per op · 2,000 ops per household per day · 10 household creations per IP per day (Cloudflare rate-limiting binding, in memory; no IP is ever stored) · ops deleted when acknowledged by all active members or after 90 days · invites after 24 h · households idle for 12 months deleted · Worker logs nothing about request bodies; no analytics.

---

## 6. Changes in the app

### 6.1 Database — migration `086_households.ts`
All new tables, so no changes to existing columns.

| Table | Columns |
|---|---|
| `households` | id, name, my_member_id, my_device_id, role ('creator'/'member'), relay_url, key_version, status ('active'/'left'/'removed'/'moved'), share_household_categories, share_other_totals, share_all_transactions, share_savings_rate, share_balances, created_at, joined_at, left_at, last_sync_at, last_sync_error |
| `household_members` | id, household_id, name, colour, x25519_public, ed25519_public, role, joined_at, removed_at |
| `household_categories` | id, household_id, name, sort_order |
| `household_category_map` | household_id, local_category_id, household_category_id |
| `household_balance_accounts` | household_id, account_id (which balances I share) |
| `household_items` | id (share id), household_id, member_id, kind, month, date, paid, my_share, category_name, merchant, payload_json, local_ref (my expense id, for my own items), updated_at, deleted_at |
| `household_outbox` | household_id, seq, op_json, created_at, sent_at |
| `household_cursors` | household_id, member_id, last_seq |
| `household_events` | id, household_id, member_id, type, payload_json, at (activity feed: joined, left, renamed, shared N items) |

Checklist from CLAUDE.md, all in the same change:
1. Migration with `CREATE TABLE IF NOT EXISTS` + indexes; register in `database/migrations/index.ts`.
2. Every table and column in `TABLE_SCHEMAS.ts`.
3. All tables in `BACKUP_TABLES` (others' shared items too, so a restore doesn't need a full resync).
4. Cascades in `data-cleanup.ts`; deleting a category removes its `household_category_map` rows; `permanentlyDeleteExpense` queues a `tx.delete`.
5. Household keys added to the backup payload next to `vaultKey`, and restored the same way.
6. MMKV: only `household_bg_sync_registered` (device-only) in `SETTINGS_REGISTRY`.
7. Guard tests (`backup-coverage`, `settings-backup-coverage`) must pass.

### 6.2 Code

| Where | What |
|---|---|
| `services/household/crypto.ts` | keys, envelope seal/open, check code, relay token |
| `services/household/relay-client.ts` | the API in 5.1, timeouts, retries |
| `services/household/store.ts` | the tables above |
| `services/household/publisher.ts` | `queueHouseholdChanges`, totals, snapshots |
| `services/household/sync.ts` | push / pull / apply / ack, single-flight, error state |
| `services/household/invite.ts` | create / join / approve / decline |
| `services/feature-flags.ts` | `household` flag, off until released |
| `app/settings/household/*` | start, invite (QR + link), join (scan), approve, share choices + preview, category mapping, members, leave/remove |
| `components/home/HouseholdCard.tsx` | Home card |
| `app/_layout.tsx` | `arth://household/join` deep link; sync on foreground; background task registration |
| `assets/docs/articles/household.md` | help article |

### 6.3 New packages
- `expo-camera` (QR scanning; native, so a release build plus an R8 check on the Pixel). The camera permission text in `app.json` says "only when you take a photo of a payment or receipt", so it changes to also cover scanning a household QR code.
- `react-native-qrcode-svg` (pure JS, uses the existing `react-native-svg`).
- `tweetnacl` (pure JS).

### 6.4 Where it appears
Phase 1: Settings → Household, and the Home card. Phase 2 (Our month) is the point to decide on a Together tab.

---

## 7. Privacy wording (change when Phase 1 ships, not before)

**Home page:** "0 Arth servers holding your data" becomes **"0 Arth servers that can read your data. Households sync through a relay that only ever holds locked envelopes."** Trust strip: "Zero data collection" stays.

**FAQ, new question "How do households work?":** "You and up to four others share what you choose: household spending, totals, a savings rate. Changes travel through Arth's relay already locked with a key only your household's phones have. The relay can't open them and deletes them once everyone has them. Leave any time and what you shared disappears from the others' phones."

**FAQ "Where is my data stored?"** adds: "If you join a household, what you choose to share also goes to the other members' phones, end-to-end encrypted."

**Privacy policy (`legal.html`), new section "Households (optional)":**
- What is sent: only what you choose on the What to share screen.
- How: end-to-end encrypted on your phone; we and Cloudflare cannot read it.
- What the relay stores: encrypted entries, random IDs, sizes and times; your IP address is seen by Cloudflare when your phone connects, as with any website.
- How long: until every member's phone has it, at most 90 days; invites 24 hours; inactive households deleted after 12 months.
- Leaving: removes your shared items from the other members' phones; closing the household deletes it from the relay.
- Who runs it: Sourav Baid, on Cloudflare (named as the hosting provider).
- The opening line "no servers that receive your data" changes to "no servers that can read your data".

**Play Store data safety** (checked against Google's guidance, support.google.com/googleplay/android-developer/answer/10787469, on 2026-10-28):

Google's rules that decide it:
- "Collected" = sent off the device. **Not collected:** data "unreadable by you or anyone other than the sender and recipient as a result of end-to-end encryption", and the encrypted data "must not be readable by any intermediary entity, including the developer".
- **Not "shared":** transfers to a service provider working on your behalf (Cloudflare hosting the relay), and transfers from "a specific user-initiated action" the user expects (joining a household and choosing what to share).
- **Pseudonymous identifiers must be declared** if they can reasonably be re-associated with a user. IP addresses are declared according to how they're used.

What that means for households:

| Data | Readable by the relay? | Declare? |
|---|---|---|
| Transactions, totals, savings rate, balances, names, category names, merchants | No: end-to-end encrypted, keys only on household phones | **No** (E2E exemption) |
| Household key, invite secret | Never leave the phones unencrypted (invite secret travels in the link fragment, never sent to the relay) | No |
| Household and member IDs in the relay's addresses and tables | Yes: random, but persistent per member while in the household | **Yes:** Device or other IDs · collected · not shared · not ephemeral · optional · App functionality |
| IP address | Seen by Cloudflare to answer the request; the Worker never stores it | No, if the Worker stores nothing IP-based (see below). If Google questions it: Device or other IDs, ephemeral |

Form answers after Phase 1 (on top of today's broker entries in `docs/PLAY_STORE_SUBMISSION.md`):
- Collects data: **Yes** (already yes because of broker IDs). Add **Device or other IDs** as above.
- Shares data: **No** change.
- Encrypted in transit: **Yes** (HTTPS, and E2E on top).
- Deletion: **Yes**. Explain: leaving a household deletes your entries from the relay; the relay deletes everything within 90 days anyway; closing the household deletes it.

Design rules this adds, so the answers stay true:
1. The Worker never writes an IP address (or anything derived from one) to D1 or logs. The "10 creations per IP per day" limit uses Cloudflare's rate-limiting binding, which counts in memory, not D1.
2. The device id and names only ever travel inside encrypted ops (already so).
3. Leaving calls a new `DELETE /v1/h/:hh/member/:member` that deletes that member's log and cursor rows on the relay immediately.
4. No analytics, crash reporting or logging of request bodies on the relay.

The listing will still show "No data shared with third parties", and the household content itself doesn't appear in the Data safety section at all.

---

## 8. Testing

- Unit: envelope round-trip, tampered ciphertext and wrong signature rejected, check code identical on both sides, op application idempotent and ordered, publisher output for splits / refunds / rejects / category moves, settings off → deletes.
- Integration: two or three in-memory "phones" against an in-memory relay: create, invite, approve, share, edit, leave, remove + rekey, resync via snapshot, restore from backup.
- Relay: Worker tests with Miniflare (auth, limits, pruning, invites expiring).
- Device: Pixel ↔ iPhone pairing by QR and by link; airplane mode and back; background sync on Android; backup → restore onto the emulator.

---

## 9. Build order

1. Relay Worker + tests, deployed to `sync.souravbaid.com`.
2. Crypto, migration 086, store, backup integration.
3. Start / invite / join / approve screens with QR and link.
4. Share choices, preview, category mapping, publisher.
5. Sync engine, background task, activity feed, Home card.
6. Leave / remove / rekey, new-phone handling, error states.
7. Help article, privacy and site wording, What's new; Pixel + iPhone tests; turn the `household` flag on and release.

---

## 10. Decisions (accepted by Sourav, 2026-10-28)

1. Relay address `sync.souravbaid.com`, on your Cloudflare account: OK?
2. Maximum 5 members: OK?
3. Defaults: household categories **on**, totals **on**, savings rate **off**, balances **off**: OK? (The mockup showed savings rate on.)
4. Only the creator approves joins and removes members in Phase 1: OK?
5. Default household categories: Groceries, Rent, Utilities, Household help, Fuel. Anything to add (e.g. Kids, Pets)?

> Note: everything in `docs/` is served publicly on souravbaid.com. This document contains no secrets.
