# Investments: a view that still works with 10+ FDs

Owner ask (Nov 2026): keep the chart, and rethink what's below it. Two cases matter:
- someone with ten or more fixed deposits
- cash sitting idle in a demat account

All figures below are made up.

## What's there now

1. The header and the value chart, with All / FD / Market / Pension and 5D–Max. **This stays as it is.**
2. Upcoming maturities.
3. Every account, grouped FD → Market → Pension, one full row each.

**Where it breaks**
- **Twelve FDs are twelve full rows.** The maturities list then repeats some of them, so Market and Pension end up two screens down.
- **No overview of the FDs as a set.** You can't see the total locked in, when the money comes back, or the average rate.
- **Idle cash is hidden.** Cash not deployed in a demat account is only on that account's own screen. ₹40,000 sitting there for two months never shows up.

## The proposal: three cards under the chart, then a list that folds

### 1. At a glance (one line of tiles, right under the chart)

| Value now | Put in | Idle cash | Back in 90 days |
|---|---|---|---|
| ₹18.4 L | ₹15.9 L | ₹42,000 | ₹3.1 L |

- Each tile opens its card below.
- **Idle cash** is the cash balance in every demat account.
- **Back in 90 days** is the FDs maturing in that time.
- A tile with nothing in it is left out. With no demat account, there's no Idle cash tile.

### 2. Idle cash: money not working

One row per demat account with cash in it:

> **Zerodha** · ₹32,000 idle · as of 2 days ago
> **Angel One** · ₹10,000 idle · as of 6 days ago

- **"As of":** the cash figure is from the last sync or manual update, so it's always dated. An old date asks for a sync, not trust.
- **Tap:** opens the account, where the cash can be updated.
- **Totals:** idle cash counts in Value now, as today. The tile just makes it visible.

### 3. FD ladder: when your money comes back

The FDs as one card, not one row each.

**Summary line**
> 12 FDs · ₹9.6 L · average 7.1% · next back 14 Dec

**Maturity buckets**, each folded to a single line until tapped:

| When | FDs | Amount back |
|---|---|---|
| This month | 1 | ₹1.02 L |
| Next 3 months | 3 | ₹2.1 L |
| 3–12 months | 5 | ₹4.0 L |
| Later | 3 | ₹2.5 L |

- **A small bar per bucket**, so a heavy month stands out. This replaces the separate Upcoming maturities card, so FDs no longer show twice.
- **A month-by-month bar chart** under the buckets: how much comes back each of the next 12 months.
- **Matured or closing soon:** an FD past its maturity that's still open says so: "Matured 3 Nov — renew or close?" Today it just sits in the list.

### 4. Accounts: folded groups with totals

- **Group headers fold.** FD, Market and Pension each show their count and total, folded by default once there are more than 5 accounts.
- **Search and Group by** (type, institution, maturity) in the usual toolbar, once there are 8 or more accounts.
- **Compact rows:** name, value and change on one line. Detail stays on the account's screen.

## What stays

- The header, the chart, its filters and periods.
- Every account screen, and how values are worked out.
- Sync, Add, and the FD form.

## Decided (owner, 28 Nov 2026)

1. **Idle cash:** the figure only, no flag.
2. **Upcoming maturities:** folded into the FD ladder.
3. **No By bank view** for FDs, and so no deposit insurance note.

Screens: the design canvas "Arth: Investments view".
