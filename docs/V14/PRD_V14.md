# Artha V14 — Advisor Pack

**Status:** Proposed
**Target release:** v14.0.0
**Theme:** Reposition Artha from a *tracker* to an *advisor*

---

## Why V14

Through V13, Artha became a faithful ledger: every rupee spent, every credit-card cycle, every demat snapshot, every FY balance sheet. What it doesn't yet do is **tell the user what to do with that data**.

V14 closes that gap with three small, opinionated features that ride on existing data and convert observation into action:

1. **Debt Payoff Planner** — "here's how fast you can pay off your CCs and loans"
2. **Subscription Audit** — "here's every recurring charge and whether it's worth it"
3. **Emergency Fund Score** — "here's how long you could survive without income"

Each is S-to-M effort. Together they reposition the product without any cross-cutting UX surgery.

---

## F1 — Debt Payoff Planner

### Problem
The user has multiple credit cards (sometimes shared pools), loans, and a monthly surplus. Today they have no way to answer: *If I pay ₹X/month, when will I be debt-free, and which debt should I attack first?*

### Who it's for
Users with at least one active liability (CC utilized > 0 or loan last_known_balance > 0) and some visible monthly surplus (from Yearly Plan or Reality Check).

### User story
> As a user viewing my Balance Sheet or Credit Card reconciliation, I want to see how many months it takes to clear my debt at my current surplus — and compare two payoff strategies so I can pick one.

### Functionality

**Page: `/goals/debt-payoff`** (new tile on the Goals tab)

**Inputs the user provides:**
- **Monthly extra payment** — pre-filled from Yearly Plan net surplus / 12, user can override.
- **Strategy** — Avalanche (highest APR first) or Snowball (smallest balance first).

**Inputs the app infers:**
- Current utilized amount per CC (from ledger closing in the utilized model).
- Last_known_balance for loans (best-effort; no principal history yet).
- APR per debt — defaulted to 36% for CCs and 12% for loans; editable per debt in a settings panel.
- Minimum payment per CC — 5% of outstanding or ₹500, whichever greater.

**What the app outputs:**
- **Payoff date** — the month by which the last debt is cleared.
- **Total interest paid** across the journey.
- **Monthly allocation table** — for the next 6 months, showing how the extra payment is split across debts given the chosen strategy.
- **Strategy comparison** — side-by-side "avalanche saves you ₹X vs snowball" with an explainer.

**User actions:**
- Change strategy → numbers re-compute live.
- Tap a debt row → jump to that account's ledger.
- **(Optional for v14.0)** "Snooze this card" — exclude from the plan temporarily.

### Non-goals for v14.0
- Loan amortization (needs principal history — deferred to V15).
- Auto-updating APR from bank SMS (future).
- Multi-goal optimization (pay off debt AND invest simultaneously).

### Success criteria
- Users with ≥ 1 debt open the screen at least once within 7 days of install.
- Monthly allocation is numerically correct for avalanche and snowball given editable APR.
- Adding/removing a CC from the ledger updates the payoff table without a reload.

---

## F2 — Subscription Audit

### Problem
Monthly recurring charges (Netflix, Spotify, Jio, Adobe, etc.) are hidden in normal expense flow. The user has no single surface to see *what am I paying every month I might not need?*

### Who it's for
Everyone. This is the easiest "aha" feature — most users underestimate their subscription load by 2–3×.

### User story
> As a user who suspects I'm paying for too many subscriptions, I want one screen that shows every recurring charge I have, total monthly and annual outflow, and a simple way to mark ones I want to cancel.

### Functionality

**Page: `/insights/subscriptions`** (tile under Insights or on Home as a WidgetCard)

**What it shows:**
- **Top card:** Total monthly subscription outflow + annual projection.
- **Per-subscription list** — each recurring charge detected by the existing recurring-detector service, sorted by monthly amount descending. Rows show:
  - Merchant name
  - Monthly amount (or annual if yearly-billed)
  - Last charged date + next charged (projected)
  - Category
  - Status badge: **Active** / **Unused 90d** (heuristic: no related login/search pattern? — for v14.0 just "Active")
  - Quick action: **Mark for review** / **Hide** / **Cancel reminder**

**Quick review flow:**
- Tap **Mark for review** → subscription is flagged in a "Review queue" tab.
- Tap **Cancel reminder** → creates a local notification 3 days before next charge: *"Cancel [Netflix] before ₹499 charges on [date]?"*
- Notifications use the existing `notification-scheduler` service.

**Categorisation sanity-check:** users often mis-categorise subscriptions as "Entertainment" vs "Subscriptions". This screen shows a muted prompt at the top when > 5 recurring charges are *not* categorised as Subscriptions: *"Recategorise these 7 charges as Subscriptions?"*

### Non-goals for v14.0
- Auto-cancel (impossible without bank API).
- Price-increase detection (future).
- Duplicate subscription detection (e.g., paying for Netflix twice across accounts).

### Success criteria
- Every recurring expense the recurring-detector has identified appears in the list.
- Total monthly outflow equals the sum of per-row monthlies (within rounding).
- Mark-for-review and Cancel-reminder actions persist across sessions.

---

## F3 — Emergency Fund Score

### Problem
*Do I have enough cash to survive if my income stops?* is the single most-asked personal-finance question. The balance sheet tells the user their savings balance but doesn't contextualise it against expenses.

### Who it's for
Everyone with savings balances and at least 3 months of expense history.

### User story
> As a user viewing my Goals tab, I want a single number that tells me how many months of my average expenses my liquid funds can cover — and the gap to a target (3 / 6 / 12 months).

### Functionality

**Integrates into:** the existing HealthScoreRing on the Home screen (new segment), plus a detailed `/goals/emergency-fund` page.

**The metric:**
```
Liquid funds = sum of savings + wallets − total CC utilized
Average monthly expenses = trailing 6-month average of realized expenses
Coverage (months) = Liquid funds ÷ Average monthly expenses
```

**Targets:**
- 3 months — "Starter"
- 6 months — "Comfortable"
- 12 months — "Resilient"

**What the page shows:**
- **Big number:** coverage in months (e.g., "4.2 months").
- **Progress bar** to next tier with gap amount ("₹38,000 more to reach 6-month").
- **Average monthly expense** with a sparkline of the last 6 months so user can sanity-check what "average" means.
- **Liquid funds breakdown** — savings + wallet − CC utilized, sourced from the balance sheet.
- **Monthly-savings recommendation** — "To reach 6-month in 12 months, add ₹X/month" — reuses Reality Check pacing math.

**User actions:**
- Tap breakdown row → balance sheet / bank accounts.
- Set a custom target (not 3/6/12) — saved in settings.

### Non-goals for v14.0
- Differentiating "truly liquid" (savings account) vs "semi-liquid" (demat fund). Keep it simple.
- Dependants-adjusted target (future: "6 months * household size").

### Success criteria
- Coverage months is computed correctly and updates live on any expense or balance change.
- User can set a custom target and the gap math stays correct.
- HealthScoreRing reflects the tier with a semantic color (error < 3 months, warning 3–6, success > 6).

---

## Cross-cutting UX

**Goals tab additions:** three new tiles — Debt Payoff, Subscriptions, Emergency Fund — below YoY Comparison. Each tile matches the existing YoY/Balance Sheet pattern (icon chip + title + one-line description + chevron).

**Home screen:** a single new **"Advisor" card** that rotates through the three features, showing the most actionable of the day:
- If debt > 0 and no payoff plan exists → "Plan your debt payoff"
- Else if subscriptions total > threshold → "Review your ₹X/month in subscriptions"
- Else if emergency fund < 3 months → "Your emergency fund covers 2.1 months"
- Else → "You're on track 🎯"

Rotation is deterministic per day, driven by data state. No notifications until user enables them per-feature.

---

## Out of scope for V14

- FI / Retirement projection (saved for V15 Strategic Cluster)
- 12-month cashflow calendar (saved for V15)
- Capital gains dashboard (capital-gains.ts exists; own release in V16)
- Android home-screen widget (platform surface work; standalone V17)

---

## Metrics we'll watch post-launch

- Advisor card view rate (Home screen impression share)
- Debt Payoff screen open rate among users with debt > 0
- Subscription cancel-reminder creation rate
- Emergency Fund target change rate (tells us if 6-month default is wrong)

---

## Versioning

Three user-facing features = MINOR bump per project rule (1–5 features → MINOR).
**Target version: 14.0.0** as a theme marker even though semver would suggest 13.3.0; V14 is the "Advisor" theme and deserves the theme bump.
