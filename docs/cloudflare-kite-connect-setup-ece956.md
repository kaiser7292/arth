# Cloudflare Domain + Kite Connect (Read-Only Portfolio) for Artha

Set up a secure Cloudflare domain with a Cloudflare Worker backend to handle Kite Connect OAuth and fetch portfolio/holdings data for personal use in the Artha app (no trading).

---

## Part 1: Cloudflare Domain Security Configuration

### DNS Settings
- **Proxy status**: Enable Cloudflare proxy (orange cloud) on all DNS records — hides origin IP
- **DNSSEC**: Enable in Domain > DNS > Settings — prevents DNS spoofing
- **CAA records**: Add CAA record restricting certificate issuance to Cloudflare only

### SSL/TLS
- **Encryption mode**: **Full (Strict)**
- **Always Use HTTPS**: Enable
- **Minimum TLS Version**: TLS 1.2
- **HSTS**: Enable (`max-age=31536000; includeSubDomains`)
- **Automatic HTTPS Rewrites**: Enable

### Security Settings
- **Bot Fight Mode**: Enable
- **Security Level**: "High" (since only you use it, aggressive blocking is fine)
- **Browser Integrity Check**: Enable

### Firewall Rules (personal use — lock it down tight)
- **Geo-blocking**: Restrict to India only (you're the only user)
- **Rate limiting**: 30 req/min on `/kite/*` endpoints
- **Block threat scores > 10**
- Consider IP allowlisting to only your phone's carrier IP range (optional, may be impractical with mobile IPs)

### Additional
- **Email**: Add SPF/DKIM/DMARC if you'll use email on this domain
- **Page Rules**: Cache nothing on `/kite/*` routes

---

## Part 2: Hosting — Cloudflare Workers

**Why Workers** (vs VPS or other serverless):
- Domain already on Cloudflare → zero extra DNS/origin config
- Free tier: 100K requests/day (you'll use maybe 10-20/day)
- No server to patch or maintain
- KV store for access token persistence
- Built-in secrets for `api_key` / `api_secret`
- No cold starts

---

## Part 3: Architecture (Read-Only)

### OAuth Flow
```
Artha App → WebView → kite.zerodha.com/connect/login?api_key=xxx
                              ↓ (login success)
               Redirect → https://yourdomain.com/kite/callback?request_token=yyy
                              ↓
               Worker exchanges request_token → access_token
               Stores access_token in KV (expires at 6 AM daily)
                              ↓
               Returns success → App closes WebView
```

### Worker Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/kite/callback` | GET | Receives Kite OAuth redirect, does token exchange |
| `/kite/holdings` | GET | Fetches holdings from `api.kite.trade/portfolio/holdings` |
| `/kite/positions` | GET | Fetches positions from `api.kite.trade/portfolio/positions` |
| `/kite/profile` | GET | Fetches user profile + margins |
| `/kite/status` | GET | Returns whether a valid session exists |

### Kite Connect APIs You'll Use (read-only)

| API | Endpoint | Purpose |
|-----|----------|---------|
| Holdings | `GET /portfolio/holdings` | Long-term stock portfolio |
| Positions | `GET /portfolio/positions` | Intraday + overnight positions |
| Profile | `GET /user/profile` | Account info |
| Margins | `GET /user/margins` | Available funds/margins |
| Quote | `GET /quote` | Current prices for held instruments |

No order, trade, or postback endpoints needed.

### Security

1. **`api_secret` as Worker secret** — never in code or client
2. **`access_token` stays server-side** — stored in KV, never sent to mobile app
3. **App ↔ Worker auth**: A static bearer token (stored in Artha app config + Worker secret) to authenticate requests from your app
4. **No CORS needed** — mobile app makes direct HTTPS calls, not browser requests
5. **Token expiry handling**: Kite tokens expire at 6 AM IST daily. Worker returns 401 → App triggers re-login WebView flow
6. **No postback URL needed** — you're not placing orders

### Kite Developer Portal Config
- **Redirect URL**: `https://yourdomain.com/kite/callback`
- **Postback URL**: Leave empty (not trading)
- Note down `api_key` and `api_secret`

---

## Part 4: Implementation Steps

1. **Cloudflare Dashboard** — Apply all security settings from Part 1
2. **Create Worker**: `npm create cloudflare@latest artha-kite-worker`
3. **Set secrets**:
   ```
   wrangler secret put KITE_API_KEY
   wrangler secret put KITE_API_SECRET
   wrangler secret put APP_BEARER_TOKEN
   ```
4. **Create KV namespace**: `wrangler kv namespace create KITE_TOKENS`
5. **Implement Worker** — OAuth callback + portfolio proxy endpoints (~100 lines)
6. **Deploy**: `wrangler deploy`
7. **Add custom domain route**: `yourdomain.com/kite/*` → Worker
8. **Register on Kite Developer Portal** — Set redirect URL
9. **Artha app** — Add settings screen to trigger Kite login + fetch portfolio data

---

## Part 5: Cost

| Service | Cost |
|---------|------|
| Cloudflare domain | Already bought |
| Cloudflare Workers free tier | $0 |
| Cloudflare KV free tier | $0 |
| **Kite Connect API** | **₹2000/month** |

> Note: ₹2000/month is Zerodha's charge for Kite Connect API access regardless of whether you trade or just read data. There is no cheaper read-only tier.

---

## Summary Checklist

- [ ] Enable DNSSEC + Full (Strict) SSL + HSTS + TLS 1.2 minimum
- [ ] Enable Bot Fight Mode, Browser Integrity Check, Security Level "High"
- [ ] Add geo-restriction (India only) + rate limiting on `/kite/*`
- [ ] Create Cloudflare Worker + KV namespace
- [ ] Store Kite API credentials as Worker secrets
- [ ] Implement OAuth callback + holdings/positions proxy
- [ ] Deploy Worker, attach custom domain route
- [ ] Register redirect URL on Kite Developer Portal
- [ ] Add Kite login flow in Artha app (WebView-based)
- [ ] Test: login → fetch holdings → display in app
