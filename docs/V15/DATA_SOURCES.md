# Artha v15 — Public Data Sources (Verified)

**Purpose:** Phase 2 of the v15 plan ships bundled reference data (IFSC, MCC, merchant brands, SMS sender IDs, SMS templates) so any Indian user gets accurate auto-setup on first install, not just the app owner. This file records where each dataset comes from, what its license is, how fresh it is, and what's verified vs. hand-curated.

**Verification date:** 2026-04-28.

**Migration number:** v14.7.0 (shipped 2026-04-28) claimed migration `014` for recurring reminders. v15 public-data tables will be **migration 015**.

**Rule of thumb:** Nothing here auto-fetches at runtime. The dev-only `scripts/build-data-bundles.ts` pulls from the sources below during a batch build, normalizes to JSON, and the outputs are committed under `assets/data/`. Devices only ever read the committed JSON.

---

## 1. IFSC → Bank mapping — VERIFIED ✅

**Upstream:** https://github.com/razorpay/ifsc

| Field | Value |
|---|---|
| License | MIT (code) + public-domain factual data |
| Latest release | v2.0.57 — 2026-03-23 |
| Repo activity | Pushed 2026-04-28 (today); actively maintained |
| Stars | 383 |
| Maintainer | Razorpay (company repo) |
| Scraper | Automated workflows that pull from RBI + NPCI |
| Access | GitHub releases (JSON dump) + free API at `ifsc.razorpay.com/{IFSC}` + SDKs (Node/PHP/Ruby/Go) |

**What we bundle:** The **4-char bank-code prefix slice** only, not the full 100k-branch dump. Example: `PUNB → Punjab National Bank`, `HDFC → HDFC Bank`, `ICIC → ICICI Bank`. This keeps our bundle ~15 KB instead of ~5 MB.

**Freshness cadence:** Razorpay cuts releases every 2–4 weeks. We re-run the build script each MINOR release.

**Attribution:** MIT requires license + copyright retention. We include `LICENSE-razorpay-ifsc` in `assets/data/licenses/`.

---

## 2. MCC codes (ISO 18245) — VERIFIED ✅

**Upstream:** https://github.com/greggles/mcc-codes

| Field | Value |
|---|---|
| License | **Unlicense** (public domain) |
| Latest push | 2024-08-16 |
| Stars | 526 |
| Row count | 981 codes (verified via API: `mcc_codes.csv` line count) |
| Formats available | CSV, JSON, JSONL, XLS, ODS, "small JSON" |
| Fields per row | `mcc`, `edited_description`, `combined_description`, `usda_description`, `irs_description`, `irs_reportable`, `id` |

**What we bundle:** The `mcc_codes.small.json` shape, augmented with our own `category_name` column that maps each MCC to one of Artha's 13 default categories (Food, Grocery, Shopping, Travel, etc.).

**Why this source:** The official Mastercard/Visa publications are PDFs (we tried the Visa manual URL — returns 404). greggles/mcc-codes is the de-facto community-canonical CSV form that aggregates Mastercard + USDA + IRS descriptions. Unlicense = zero redistribution constraints.

**Freshness cadence:** MCC codes change rarely (1–2 revisions/year). Annual refresh sufficient.

---

## 3. Merchant brand registry — HAND-CURATED 🛠

**Upstream:** None fully suitable — **Artha curates its own seed list.**

| Field | Value |
|---|---|
| License | Artha-authored (we own it) |
| Seed size | ~500 top Indian merchants at v15.1.0 |
| Format | `{ alias, brand_canonical, category_name, mcc_code }` |
| Example | `"AMZN*MKTPLACE" → { canonical: "Amazon", category: "Shopping", mcc: "5942" }` |

**Why hand-curated:** We searched for a public brand-alias dataset and found none with a usable license. Plaid's merchant enrichment exists but is closed/paid. Google Places is paid. Community merchant repos are either unlicensed (risky to bundle) or thin.

**Curation process (documented for future maintainers):**
1. Pull the top N merchants by SMS frequency from Artha's own telemetry (user-provided corrections, anonymized) and internal dogfood data.
2. For each, manually record: canonical name, 2–5 common SMS aliases (e.g., `SWGGY*BLR`, `Swiggy Ltd`, `SWIGGY ONLINE`), the MCC that best fits, and the Artha category.
3. Review PR before merging to `assets/data/merchant-brands.json`.

**Augmentation path:** If we later decide to pull from Google Places (free-tier caps apply), that's a v16 feature gated behind the Phase 3 opt-in online refresh toggle.

---

## 4. SMS sender ID → Bank mapping — PARTIALLY VERIFIED ⚠

**Upstream:** **No single canonical public dump exists.** TRAI maintains the DLT registry but does not publish the Principal Entity list as a downloadable file. Community GitHub repos we considered either have no license or are not actively maintained.

**Sources we evaluated (and their status):**

| Source | Verdict |
|---|---|
| TRAI press-release portal | No downloadable list found |
| Operator DLT portals (Vilpower, Videocon, Tanla, Jio) | Login-walled; templates scraped per Principal Entity but no bulk API |
| `abhi245y/sms_finance_tracker` (GitHub) | MIT, but only 6 banks, code-embedded (not structured data) |
| Generic GitHub search for "trai dlt sender mapping" | 0 results |
| Generic GitHub search for "sms header bank india" | 0 results |

**Plan:** Artha maintains its own `assets/data/sms-senders.json` (~500 codes), seeded from:
1. Artha's existing hardcoded `BANK_SENDERS` array (~30 codes — starting point).
2. Observed headers from user SMS samples during dogfood + beta.
3. Manual expansion based on published bank communications pages (each bank publishes its own registered headers on its website as compliance disclosure).

**Format:** `{ sender_code, bank_name, bank_type, confidence }`. Example: `{ "HDFCBK", "HDFC Bank", "commercial", 0.95 }`.

**License:** Artha-authored.

**Attribution:** Each entry's `confidence` field tracks how we verified it (`official-bank-website`, `trai-dlt-portal`, `observed-in-user-sms-with-consent`).

---

## 5. SMS template registry — PARTIALLY VERIFIED ⚠

**Upstream:** **Operator DLT portals (Vilpower, Tanla, etc.)** — individual template searches work but no bulk export exists.

**Why this matters:** Since 2020 every commercial SMS in India must be registered on a DLT platform with a fixed template body like `{#var#} debited from A/c XX{#var#} on {#var#} towards {#var#}. Avl Bal: Rs.{#var#}`. Scraping 100–200 of these per top bank gives us a coverage floor that hardcoded regexes alone can't match.

**Plan:**
- **v15.1.0:** Hand-curate ~150 **transactional** templates + ~30 **reminder-hint** templates across 20 banks (ICICI, HDFC, Axis, SBI, Kotak, Federal, Citi, Amex, RBL, HSBC, AU SFB, IDFC First, PNB, BoB, Canara, Union Bank, IndusInd, Yes, BOI, Karur Vysya). Each template gets a regex, a `priority`, and a `tx_type`.
- **Safety:** Hardcoded `BANK_PATTERNS` in `services/sms/bank-patterns.ts` continue to run FIRST. Template patterns only fire on unmatched SMS. This means a broken new template can never regress an existing user's parsing.
- **Source:** Templates sourced from the bank's own "SMS notifications" page (many banks publish examples in their customer communication sections) + the owner's `~/Downloads/Artha/Bank SMS Example.txt` corpus.

**Format:**
```json
{
  "id": "icici-debit-upi-v1",
  "bank_name": "ICICI Bank",
  "pattern_regex": "^Acct XX(\\d{4}) debited with Rs\\.(\\S+)...",
  "tx_type": "debit_upi",
  "priority": 100
}
```

**`tx_type` taxonomy:**
- `debit`, `debit_upi`, `debit_card`, `debit_emi` — outgoing expense
- `credit`, `credit_upi`, `credit_refund` — incoming money
- `statement` — statement-generated notification (not a transaction)
- `reminder_hint` — **new for v15.** Future-dated obligation. Feeds the v14.7.0 reminder engine, does **NOT** create an expense.
- `skip` — OTPs, declined, state changes (mandate revoked, etc.)

**License:** Artha-authored (regex is our derivative work; underlying template bodies are factual/utilitarian and not copyrightable per Indian IP norms for SMS alerts).

---

## 5a. Reminder-hint templates (bridge to v14.7.0 reminder engine) — NEW

**Why this exists:** v14.7.0 added a reminder model where rules carry a `next_due_date` and advance only when fulfilled by a real expense. SMS already contains "due by / auto-debit / mandate" messages that announce future obligations. Parsing these lets us **pre-populate reminders** without the user manually creating a rule from a source expense.

**Examples from `~/Downloads/Artha/Bank SMS Example.txt`:**

| Bank | Template (paraphrased) | Extracts |
|---|---|---|
| ICICI | `Payment of INR {amt} towards Merchant {name} to be debited from ICICI Bank Credit Card {last4}, as per Standing Instruction {ref}, is due by {DD/MM/YYYY}` | amount, merchant, account, due_date, mandate_ref |
| Axis | `EMI of INR {amt} for Axis Bank Loan A/c {last4} is due on {DD-MM-YY}` | amount, account, due_date, type=EMI |
| HDFC | `Amount Due Rs.{amt} on HDFC Bank Credit Card {last4}. Pay instantly by {DD/MMM/YYYY}` | amount, card, due_date, type=bill |
| Axis | `INR {amt} for {merchant} will be auto debited via Axis Bank Credit Card no. {last4} by {DD-MM-YY}` | amount, merchant, card, due_date |
| ICICI | `AIRTEL POSTPAID bill of Rs {amt} for {phone} is due on {DD-MM-YYYY}` | amount, biller, due_date |
| SBI | `UPI-Mandate successfully created towards {merchant} for Rs{amt}. Funds blocked frm A/cXXXXXX{last4}.{umn}` | amount, merchant, account, umn, state=created |
| SBI | `UPI-Mandate successfully Revoked by {merchant} for Rs{amt}` | state=revoked (reminder should be cancelled) |

**Handoff to v14.7.0 reminder engine — open question:**
- Option A: `reminder_hint` matches insert directly into `recurring_expense_rules` with `is_user_confirmed=0`; user sees them in a "Suggested reminders" inbox on Home and taps Accept/Dismiss. Requires a new column + UI.
- Option B: `reminder_hint` matches land in a new staging table `reminder_suggestions(id, matched_pattern_id, sms_body, extracted_fields_json, seen_at, resolved)`; reminder owner writes the UI later.

**Recommendation: Option B** — keeps v15 Phase 2 from needing to modify v14.7.0's rule schema or UI. v16 can build the Accept/Dismiss UX once the data is flowing.

**Anti-double-count rule:** If a `reminder_hint` matches and the reminder already exists (by merchant + ±7 day due-date window), we do NOT insert a duplicate. If a real debit SMS arrives after the hint, v14.7.0's suggestion banner should still fire to link it.

**License:** Artha-authored.

---

## 6. UPI VPA suffix → PSP/Bank mapping — NOT AVAILABLE FROM UPSTREAM ❌

**Upstream:** **NPCI does not publish a downloadable VPA-suffix → PSP mapping.**

**What we tried:**
- `npci.org.in/what-we-do/upi/product-overview` — no data
- `npci.org.in/what-we-do/upi/live-members` — redirect loop, no scraped data
- `npci.org.in/what-we-do/upi/3rd-party-apps` — redirect to members page
- GitHub search — zero repositories

**Plan:** Bundle a **small, static hand-curated** mapping (~20 suffixes covering 95% of UPI volume):

| Suffix | PSP / TPAP | Bank partner |
|---|---|---|
| `@ybl` | PhonePe | Yes Bank |
| `@ibl` | PhonePe | ICICI Bank |
| `@axl` | PhonePe | Axis Bank |
| `@oksbi` | Google Pay | SBI |
| `@okaxis` | Google Pay | Axis Bank |
| `@okhdfcbank` | Google Pay | HDFC Bank |
| `@okicici` | Google Pay | ICICI Bank |
| `@paytm` | Paytm | Paytm Payments Bank |
| `@apl` | Amazon Pay | Axis Bank |
| `@upi` | BHIM | NPCI |
| `@hdfcbank` | HDFC Bank app | HDFC Bank |
| `@icici` | iMobile Pay | ICICI Bank |
| `@kotak` | Kotak 811 | Kotak Mahindra |
| `@sbi` | YONO / SBI Pay | SBI |
| `@fbl` | Federal Bank | Federal Bank |

**Refresh:** Manual review each MINOR release. PSPs change rarely.

---

## Summary table — ship readiness

| Dataset | Source | License | Verified | Action |
|---|---|---|---|---|
| IFSC prefixes | razorpay/ifsc | MIT | ✅ Fully | Pull in build script |
| MCC codes | greggles/mcc-codes | Unlicense | ✅ Fully | Pull in build script |
| Merchant brands | Artha-curated | Artha-owned | 🛠 Seed ~500 | Hand-author JSON |
| SMS sender IDs | Artha-curated + dogfood | Artha-owned | ⚠ Partial | Expand from 30 → 500 |
| SMS transactional templates | Artha-curated | Artha-owned | ⚠ Partial | Curate ~150 across 20 banks |
| **SMS reminder-hint templates** | **Artha-curated from own SMS corpus** | **Artha-owned** | **⚠ Partial** | **Curate ~30 across top 6 banks; bridges to v14.7.0 reminders** |
| UPI VPA suffixes | Hand-curated | Artha-owned | ❌ Not available upstream | Bundle 20 static entries |

**Net assessment:** Phase 2 is feasible. The two high-volume datasets (IFSC, MCC) are fully verified with clean licenses. The three Artha-curated datasets (merchant brands, sender IDs, templates) are lower volume and entirely within our control — we own the licensing, so bundling is safe.

---

## Licenses checklist for v15.1.0 ship

Before shipping `assets/data/`, add:
- `assets/data/licenses/LICENSE-razorpay-ifsc.txt` (copy MIT text)
- `assets/data/licenses/LICENSE-greggles-mcc.txt` (copy Unlicense text)
- `assets/data/licenses/README.md` — points each bundle to its license file
- `docs/V15/DATA_ATTRIBUTIONS.md` — user-visible attribution for Settings → About → Data credits

---

## Open questions / decisions before Phase 2 kickoff

1. **Telemetry for merchant-brand curation.** RESOLVED 2026-04-28 — no telemetry. Seed curation is purely from the owner's SMS corpus (`~/Downloads/Artha/Bank SMS Example.txt`). Initial seed size will be ~200 merchants, not 500.
2. **DLT template scraping ethics/legality.** Scraping operator DLT portals may violate their ToS even though the underlying data is factual. Recommend: start with the owner's SMS corpus + public bank-website sources only; add DLT-portal sources only after a legal review.
3. **Bundle signing.** For Phase 3 (online refresh, deferred), we'll need a signing key pair. Not required for v15.1.0.
4. **Reminder-hint handoff model.** Recommend Option B (staging table `reminder_suggestions`) — keeps v15 Phase 2 from modifying v14.7.0 schema. Accept/Dismiss UX can ship in v16 once the data is flowing. **Needs owner confirmation.**
