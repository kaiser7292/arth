# Artha V14 — Advisor Pack · Technical Design

**Corresponds to:** `PRD_V14.md`
**Target release:** v14.0.0

---

## Architecture overview

V14 adds three screens backed by **pure computation** over existing data. No new tables. No new SMS patterns. Existing `useDataRefresh` + `bumpDataVersion()` give us free live updates.

```
┌─────────────────────────────────────────────────────────┐
│  Goals Tab                                              │
│  ├── tile → /goals/debt-payoff       (F1)               │
│  ├── tile → /insights/subscriptions  (F2)               │
│  └── tile → /goals/emergency-fund    (F3)               │
│                                                         │
│  Home                                                   │
│  └── AdvisorCard (rotating)          (cross-cutting)    │
└─────────────────────────────────────────────────────────┘
          │              │              │
          ▼              ▼              ▼
┌─────────────────┐ ┌────────────┐ ┌────────────────┐
│ services/       │ │ services/  │ │ services/      │
│ debt-payoff.ts  │ │ subscrip-  │ │ emergency-     │
│                 │ │ tions.ts   │ │ fund.ts        │
└─────────────────┘ └────────────┘ └────────────────┘
          │              │              │
          ▼              ▼              ▼
   existing:
   • account-balance.ts  (CC utilized, savings balance)
   • financial-account.ts (loan last_known_balance)
   • recurring-detector.ts (subscription scan)
   • expense.ts (6-month average)
   • balance-sheet.ts (liquid funds, already built)
   • yearly-plan.ts (monthly surplus)
```

---

## Schema

**No new tables.** Two small additions:

### 1. New settings keys (MMKV only)

```ts
// constants/app.ts or services/settings.ts
SETTINGS_KEYS.debtApr = "debt_apr_overrides";   // JSON: { [accountId: string]: number }
SETTINGS_KEYS.debtStrategy = "debt_strategy";   // "avalanche" | "snowball"
SETTINGS_KEYS.subscriptionReviewState = "sub_review_state"; // { [merchant: string]: "active" | "review" | "hidden" }
SETTINGS_KEYS.subscriptionCancelReminders = "sub_cancel_reminders"; // [{ merchant, remindDate, notifId }]
SETTINGS_KEYS.emergencyFundTarget = "efund_target_months"; // number, default 6
```

All live in MMKV (settings-level, not per-transaction). No migration needed.

### 2. No DB migration

Loans keep their `last_known_balance` scalar — still best-effort. Loan principal history is V15+.

---

## F1 — Debt Payoff Planner

### Service: `services/debt-payoff.ts` (new)

```ts
export interface Debt {
  accountId: string;
  type: "credit_card" | "loan";
  label: string;              // "HDFC ••••1234" or account_label
  outstanding: number;        // CC: utilized from ledger closing; Loan: last_known_balance
  aprPct: number;             // from settings override, else default
  minPayment: number;         // CC: max(5% of outstanding, 500); Loan: 0 (unknown EMI)
  sharedPoolId?: string;      // bank_name for shared CCs, so siblings are treated as one debt
}

export async function listActiveDebts(userId: string): Promise<Debt[]>;

export interface PayoffPlan {
  strategy: "avalanche" | "snowball";
  monthlyExtra: number;       // user input, above minimums
  monthsToPayoff: number;
  totalInterest: number;
  allocation: Array<{
    month: number;            // 1-based, 1 = next cycle
    perDebt: Array<{ accountId: string; payment: number; closingBalance: number }>;
  }>;
}

export function computePayoffPlan(debts: Debt[], monthlyExtra: number, strategy: "avalanche" | "snowball"): PayoffPlan;
```

**Algorithm:**
- Sort debts per strategy (avalanche = descending APR; snowball = ascending outstanding).
- Simulate month-by-month (max 600 iterations = 50 years safety):
  1. Every debt accrues `monthly_interest = outstanding * apr / 12`.
  2. Every debt pays `minPayment` (capped at outstanding).
  3. Remaining `extra` applies to the head-of-list debt until cleared, then cascades.
  4. Stop when all debts == 0.
- Return allocation for the first 6 months (UI shows these; rest is summary only).

**Shared-pool CCs:** combined into one Debt row for simulation. The pool's single ledger means we can treat it as a single outstanding amount; allocation within the pool is user's choice and not modeled.

### Screen: `app/goals/debt-payoff.tsx`

- Top card: hero with `monthsToPayoff` + `totalInterest`.
- Strategy toggle (two `FilterChip`s: Avalanche / Snowball).
- Monthly-extra input (pre-filled from Yearly Plan surplus / 12).
- Debt list — each row shows outstanding + APR (editable with pencil icon → bottom sheet to override APR).
- 6-month allocation table (horizontal scroll pattern borrowed from Balance Sheet).

### Edge cases
- No debts → empty state with CTA "Add a credit card or loan".
- `monthlyExtra` less than sum of minPayments → warning "You can't cover minimums; add ₹X/month".
- Snowball chosen but all debts are same balance → falls back to avalanche deterministically.

---

## F2 — Subscription Audit

### Service: `services/subscriptions.ts` (new)

Reuses the existing `recurring-detector.ts` output; adds audit-level aggregation and review state.

```ts
export interface Subscription {
  merchant: string;
  normalizedMerchant: string;
  monthlyAmount: number;      // normalized to monthly (yearly → /12)
  cadence: "monthly" | "yearly" | "weekly";
  lastChargedDate: string;
  nextChargedDate: string;    // projected from cadence
  categoryId: string | null;
  categoryName: string | null;
  reviewState: "active" | "review" | "hidden";
  hasCancelReminder: boolean;
  recentCharges: Array<{ date: string; amount: number; expenseId: string }>;
}

export async function listSubscriptions(userId: string): Promise<Subscription[]>;
export async function setSubscriptionState(merchant: string, state: "active" | "review" | "hidden"): Promise<void>;
export async function scheduleCancelReminder(merchant: string, nextChargedDate: string): Promise<void>;
export async function cancelCancelReminder(merchant: string): Promise<void>;
```

- `listSubscriptions` uses `findRecurringCharges(userId)` (already in `recurring-detector.ts`); merges with MMKV `subscriptionReviewState`.
- `scheduleCancelReminder` uses existing `notification-scheduler.ts`:
  - Remind 3 days before `nextChargedDate` at 10am local.
  - Store `notifId` in `subscriptionCancelReminders` so we can cancel on dismiss.

### Screen: `app/insights/subscriptions.tsx`

- Top card: `Total monthly · ₹X/mo · Projected annual · ₹Y`
- Filter chips: `All | Review | Hidden`
- List rows:
  - Merchant name + last-charged date
  - Monthly amount
  - Category badge (muted if "Subscriptions" mis-categorized)
  - Action menu (`•••`): Mark for review / Hide / Cancel reminder
- Miscategorisation prompt (if > 5 uncategorised-as-Subscriptions): `AlertBanner` with "Recategorise"

---

## F3 — Emergency Fund Score

### Service: `services/emergency-fund.ts` (new)

```ts
export interface EmergencyFundState {
  liquidFunds: number;           // savings + wallet − CC utilized (from balance-sheet math)
  monthlyExpenseAvg: number;     // trailing 6-month avg of realized expenses
  coverageMonths: number;        // liquidFunds / monthlyExpenseAvg
  targetMonths: number;          // user setting, default 6
  gapAmount: number;             // targetMonths * monthlyExpenseAvg - liquidFunds (0 if covered)
  tier: "below_starter" | "starter" | "comfortable" | "resilient";
  monthlyExpenseHistory: Array<{ month: string; total: number }>; // last 6
}

export async function getEmergencyFundState(userId: string): Promise<EmergencyFundState>;
export async function setEmergencyFundTarget(months: number): Promise<void>;
```

- Uses `getBalanceSheetColumn` (Live) to source `liquidFunds` in one call.
- 6-month expense history queried once, average computed client-side.
- Tier mapping: < 3 → below_starter; 3–6 → starter; 6–12 → comfortable; > 12 → resilient.

### Screen: `app/goals/emergency-fund.tsx`

- Hero: big `coverageMonths` (1 decimal), colored by tier.
- `ProgressBar` to next tier with gap amount.
- 6-month expense sparkline (`TrendLineChart`).
- Liquid funds breakdown (rows with chevrons → respective screens).
- Target selector: `FilterChip` row — `3 mo | 6 mo | 12 mo | Custom`.
- Recommendation card: "To reach 6-month in 12 months, add ₹X/month" — if `gapAmount > 0`.

### Integration with HealthScoreRing

The existing `components/cockpit/HealthScoreRing` takes segments. Add an "Emergency Fund" segment weighted to `tier`:
- resilient → 100%
- comfortable → 75%
- starter → 50%
- below_starter → 25% (or 0% if `liquidFunds ≤ 0`)

No code change to the ring itself — we just pass a new segment when calling it from Home.

---

## Cross-cutting: Home AdvisorCard

New component `components/home/AdvisorCard.tsx`.

```ts
interface AdvisorCardProps {
  debtCount: number;
  totalSubscriptionMonthly: number;
  emergencyFundTier: EmergencyFundState["tier"];
}
```

Deterministic per-day rotation (hash `YYYY-MM-DD` → pick 1 of 4 messages):
1. Debt payoff (if `debtCount > 0`)
2. Subscription review (if `totalSubscriptionMonthly > threshold`)
3. Emergency fund (if tier below comfortable)
4. On-track celebration

Rotation is deterministic so it doesn't flicker on re-render within the same day.

Tap → routes to the relevant feature screen.

---

## Dependencies

| Feature | Depends on | Status |
|---|---|---|
| Debt Payoff | `getComputedBalances` (CC utilized) | Exists |
| Debt Payoff | Yearly Plan surplus | Exists |
| Debt Payoff | APR override storage | New MMKV key |
| Subscription Audit | `recurring-detector` | Exists |
| Subscription Audit | `notification-scheduler` | Exists |
| Subscription Audit | Review state storage | New MMKV key |
| Emergency Fund | `getBalanceSheetColumn` | Exists (v13.2) |
| Emergency Fund | 6-month expense history | `getExpenseTotal` + loop (exists) |
| Emergency Fund | `HealthScoreRing` | Exists |

---

## Testing plan

### Unit tests
- `services/debt-payoff.ts` — property-tests the simulator:
  - Single debt at 0% APR → months = ceil(outstanding / monthly).
  - Two debts, avalanche vs snowball → higher-APR-first clears first under avalanche.
  - Zero extra, zero min → stops at max-iteration cap without infinite loop.
- `services/emergency-fund.ts` — `coverageMonths` math and tier boundaries at 3 / 6 / 12 exactly.
- `services/subscriptions.ts` — cadence conversion to monthly (yearly / 12, weekly × 4.33).

### Integration
- Debt-payoff end-to-end: seed 2 CCs + 1 loan → render screen → assert payoff months.
- Subscription audit: seed recurring expenses → reviewState transitions persist across reloads.
- Emergency fund: change target → recommendation amount recomputes.

### Manual QA
- Advisor card rotation: change device date → verify different tip shows.
- Notifications: schedule cancel reminder → fast-forward device clock → verify notification fires.

---

## Rollout

- **v14.0.0** ships all three features behind no flags (small, deterministic, low-risk).
- Backfill on upgrade: run `findRecurringCharges` once after migrations; cache results in MMKV so the Subscriptions screen opens fast the first time.
- Users with no debt see the Debt Payoff tile but tapping lands on the empty state with the CTA.

---

## Out-of-scope confirmations

- No loan amortization (principal history missing).
- No bank-API pulls.
- No cross-goal optimization (invest vs. debt vs. efund tradeoffs).
- No AI-generated advice. Every number is deterministically computed.
