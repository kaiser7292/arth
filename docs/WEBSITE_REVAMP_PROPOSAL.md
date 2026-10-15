# souravbaid.com Revamp — Proposal

**Status:** Proposal — awaiting owner approval. No site code changed.
**Date:** 2026-10-16

---

## 0. Where the site is today

`docs/` is served at souravbaid.com: one long landing page (`index.html`, ~106 KB) plus Contact, Legal and Design System pages.

The landing page is polished: hand-built phone mockups with invented data, three pinned scroll walkthroughs (how SMS becomes a transaction, automation, insights), a privacy band, SMS examples, broker cards and Play early-access steps. **Its problem is scope, not quality.** It describes roughly the app of v2–v3:

- The features grid has **6 areas**. The app now has about 20.
- **Missing completely:** Password Vault, Catch Up and check-ins, the tax engine and salary/income calculator, insurance and risk coverage, FDs and the investments hub, the cash-flow simulator, statement reconciliation, Reports (financial health, retirement, loan payoff, spending personality), Year in Review, net worth over time, calendar sync, home-screen widget, voice entry, Export for AI and AI-assisted setup, encrypted scheduled backups, app lock, recycle bin and the help centre.
- Every product claim lives on one page, so there's nowhere to go deeper on any feature, and nothing for search engines to rank beyond the homepage.
- No FAQ, no "what's new", no security explainer. These are the things a cautious finance-app user looks for before handing over SMS access.

## 1. The goal

Keep everything that already works (the visual language, mockups, privacy stance, early-access flow) and turn it from a single-page launch teaser into a **product site**:
- it covers the whole app,
- it answers trust questions up front,
- it lets people go deep on whatever they care about.

## 2. Proposed site map

| Page | What's on it |
|---|---|
| **Home** (`/`) | Sharper hero, the "one message, everything updates" walkthrough (kept), a new **feature map** of all areas in 5 groups, privacy band, trust strip (open-source licences, no sign-up, encrypted backups), early access CTA |
| **Features** (`/features`) | One section per group, each with a phone mockup and 3–5 capabilities: **Track** (SMS auto-detect, Catch Up, review queue, voice, widget), **Plan** (budgets, yearly plan, buckets, milestones, simulator), **Grow** (investments + brokers, FDs, net worth over time, capital gains), **Protect** (loans engine, insurance & risk coverage, tax engine, Password Vault), **Understand** (insights, Reports, Year in Review, Export for AI) |
| **Privacy & Security** (`/privacy-security`) | Plain-English explainer: where data lives, what the SMS permission is used for, what talks to the internet (only brokers you connect, directly from the phone), encrypted backups, app lock, Android backup off. A diagram of the data flow. *Separate from the legal privacy policy.* |
| **What's new** (`/whats-new`) | Release notes in plain language, newest first, built from the GitHub releases (v4.x onward) |
| **FAQ** (`/faq`) | ~15 questions: Is it free? iPhone? Which banks? What if I change phones? Can my bank see this? Does it need internet? |
| **Contact / Legal** | Kept, restyled to match |
| **Design System** | Kept as is, but taken out of the main nav (footer only) |

Shared header and footer on every page. Nav: Features · Privacy · What's new · FAQ · **Get early access**.

## 3. "More mature": what changes in feel

- **Copy:** outcome-led and calmer. Fewer slogans ("Zero compromise"), more specifics ("Reads SMS from 25+ Indian banks. Approve each one before it counts.").
- **Proof over promises:** numbers that are true and checkable (banks supported, account types, tests passing, open-source licences listed in-app), and screenshots of real flows as mockups.
- **New mockups** (hand-built, invented data, same as now): Year in Review, net worth chart, Password Vault, Catch Up deck, Reports.
- **Consistency:** one type scale, one card style, one section rhythm. Today each section has its own one-off CSS.
- **Basics done properly:** per-page titles and descriptions, Open Graph image, sitemap.xml, a 404 page, accessible contrast and focus states, works without JavaScript (the reveal animations become progressive enhancement), good at phone width.
- **Stays a static site** in `docs/`: plain HTML/CSS with a small shared stylesheet. No framework or build step, so you can still edit it by hand.

## 4. Accuracy fixes found on the way
- "0 Bytes of your financial data ever sent to any server": true for Arth's own servers. But broker sync talks to Zerodha / Angel / ZebPay directly from the phone, and Export for AI is a file *you* choose to share. The new privacy page should say this precisely instead of overclaiming.
- "25+ banks" and the broker list: re-checked against `services/sms/bank-patterns.ts` and the connect screens before publishing.

## 5. Decisions for you
1. **Site map:** all pages above, or start smaller (Home + Features + FAQ)?
2. **What's new page:** maintain it with every release (I'd add it to the release checklist), or skip?
3. **Tone:** keep the playful headlines ("Teach it once. It never asks again.") or go more restrained?
4. **Publishing:** the site is served through Cloudflare from this repo's `docs/` folder, so pushing to `master` publishes it. Do you want to review it locally first (I'll open it in the preview pane), then push?
