# Arth household relay

A locked mailbox for household sync. Phones in a household send each other end-to-end encrypted
changes through it; it stores opaque envelopes under random IDs and can't read them. Design:
`docs/HOUSEHOLD_PHASE1_DESIGN.md`, section 5.

Runs on Cloudflare (Worker + D1) at `https://sync.souravbaid.com`, on the same account as the
website. Free tier is plenty to start (about 1,000 active households).

## Test

```bash
cd relay
npm test
```

Uses Node's built-in SQLite in place of D1 (Node 22.5 or newer). No packages to install.

## First deploy (once)

1. Sign in to Cloudflare from this machine: `npx wrangler@4 login` (opens the browser).
2. Create the database: `npx wrangler@4 d1 create arth-relay`. Copy the `database_id` it prints into
   `wrangler.toml`.
3. Create the tables: `npm run db:init`.
4. Deploy: `npm run deploy`. Wrangler adds `sync.souravbaid.com` as a custom domain on the
   souravbaid.com zone.
5. Check: open `https://sync.souravbaid.com/v1/health`. It should say `{"ok":true}`.

## Later deploys

`npm test`, then `npm run deploy`. A schema change needs its own `wrangler d1 execute` with an
`ALTER TABLE`; the phones only depend on the API in `src/worker.js`.

## Privacy rules (don't break these)

They back the Play Store Data safety answers and the privacy policy.

- Never store or log an IP address or anything derived from one. Rate limiting uses the
  `CREATE_LIMITER` binding, which counts in memory.
- Never log request bodies. `observability` stays off; no analytics.
- Keep the deletions: acknowledged ops, ops older than 90 days, invites after 24 hours, a member's
  ops as soon as they leave, households idle for a year (daily cron).
