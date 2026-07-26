# Risk & Insurance Coverage — Feature Proposal

## Summary

Add a lightweight insurance/risk-coverage tracker that lets users register their policies (term, health, home, car, life) and feeds coverage data into the retirement report, financial health report, and Goals screen. No premium payment tracking — just "what's covered and is it enough?"

---

## Problem

The retirement report already flags "No health insurance" and "No term insurance" as critical risks, but it has zero actual data — it always shows these flags because there's no place to record insurance. The financial health report's emergency-fund dimension also ignores insurance entirely, even though adequate health cover directly reduces the emergency buffer needed.

Users who _do_ have insurance get inaccurate risk assessments. Users who _don't_ get no guidance on what adequate coverage looks like.

---

## Where It Lives

**Goals > Track** section — new "Risk Coverage" card between "Loans & Debt" and "Balance Sheet."

Rationale: Insurance protects the financial plan (like loans affect it), it's not spending analysis (Insights) or budgeting. The Track section already houses Loans & Debt and Balance Sheet — insurance is the third leg of "know what you have and owe."

### Navigation

```
Goals tab
  └─ Track section
       ├─ Loans & Debt          (existing)
       ├─ Risk Coverage          (NEW) → /goals/risk-coverage
       └─ Balance Sheet          (existing)
```

The Risk Coverage screen shows all policies in a list grouped by type, with an "Add Policy" FAB. Tapping a policy opens an edit sheet.

---

## Data Model

### New table: `insurance_policies`

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUID |
| `user_id` | INTEGER | FK → users |
| `policy_type` | TEXT | `term` · `health` · `home` · `car` · `life` · `other` |
| `provider_name` | TEXT | e.g. "HDFC Life", "Star Health" |
| `policy_number` | TEXT | Optional, for user reference |
| `sum_insured` | REAL | Coverage amount in ₹ |
| `annual_premium` | REAL | What user pays per year |
| `premium_frequency` | TEXT | `annual` · `semi_annual` · `quarterly` · `monthly` |
| `start_date` | TEXT | Policy start (ISO date) |
| `expiry_date` | TEXT | Policy end / renewal date (ISO date) |
| `is_active` | INTEGER | 1 = active, 0 = lapsed/cancelled |
| `notes` | TEXT | Optional user notes |
| `covers_family` | INTEGER | 1 = family floater, 0 = individual |
| `family_members_covered` | INTEGER | Number of people covered (health) |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |
| `deleted_at` | TEXT | Soft delete (standard pattern) |

No riders, sub-products, or claim history — intentionally minimal.

### Migration

Single migration file: `database/migrations/052_insurance_policies.ts`

### Backup

Add `insurance_policies` to `BACKUP_TABLES` in `services/backup.ts` and `TABLE_SCHEMAS` in `database/TABLE_SCHEMAS.ts`.

---

## Adequacy Heuristics

Simple rules-of-thumb, not financial advice. Shown as guidance, not prescriptions.

| Type | "Adequate" threshold | Source |
|------|---------------------|--------|
| **Term** | Sum insured ≥ 10× annual income | Industry standard rule of thumb |
| **Health** | ≥ ₹10L per family member covered | Metro healthcare cost baseline |
| **Home** | ≥ estimated home value (user-entered or skip) | Replacement cost principle |
| **Car** | Any active policy = adequate | Legally mandatory, no amount heuristic |
| **Life** (endowment/ULIP) | No adequacy check — just tracked | Too product-specific to assess |

Display: green checkmark if adequate, amber warning if under threshold, red if no policy of that type exists.

---

## Integration Points

### 1. Retirement Report (`services/reports/retirement-report.ts`)

**Risk flags** (currently hardcoded "No health/term insurance"):
- If user has active term policy: replace flag with coverage assessment ("Term cover ₹1 Cr — 8× income, recommended 10×")
- If user has active health policy: replace flag with adequacy check ("Health cover ₹5L for 4 members — recommended ₹40L")
- If no policy of a critical type: keep existing flag but add "Add in Goals > Risk Coverage"

**Readiness score — emergency fund component** (15% weight):
- Current: purely `totalAssets / monthlyExpenses`
- Proposed: if health cover ≥ ₹10L/member, add +2 bonus points (capped at 15). Rationale: adequate health insurance reduces the emergency buffer needed for medical shocks.

**Retirement inputs** (no change):
- Insurance premiums are a known recurring expense, but they're already captured as expenses in the transaction flow. No double-counting needed.

**New report section: "Risk Coverage Summary"**
- Placed between "Risk Flags" and "Action Items"
- Shows a compact table: policy type, provider, sum insured, premium, adequacy status
- Only appears if user has ≥ 1 policy registered

**Post-retirement phase advice:**
- Currently says "ensure health insurance continues." With data, it can say "Your Star Health policy (₹15L) expires at age 62 — plan for renewal or senior citizen policy."

### 2. Financial Health Report (`services/reports/financial-health-report.ts`)

**Emergency Fund dimension** (15% weight):
- Current: `liquidAssets / monthlyExpenseAvg` → emergency months
- Proposed: if health insurance is adequate, reduce the target from 6 months to 4 months (health emergencies are the #1 reason for large emergency funds). This gives adequately insured users a fairer score.

### 3. Goals Screen Card

New card in Track section:

```
┌─────────────────────────────────────┐
│  🛡  Risk Coverage                  │
│  3 active policies · 1 gap          │
│  ████████░░  75% covered            │
└─────────────────────────────────────┘
```

- Shows count of active policies and number of coverage gaps (types with no/inadequate policy)
- Progress bar: `coveredTypes / totalRelevantTypes` (term, health, home = 3 relevant types; car only if user has car-related expenses)
- Taps through to `/goals/risk-coverage`

### 4. Home Screen (optional, future)

Could add a "Policy expiring soon" advisory card if any policy expires within 30 days. Deferred — not in v1.

---

## Screens

### `/goals/risk-coverage` — Policy List

- Grouped by type: Term, Health, Home, Car, Life/Other
- Each group shows: count of policies, total sum insured, adequacy badge
- Each policy row: provider name, sum insured, expiry date, active/lapsed badge
- FAB: "Add Policy" → opens AddPolicySheet
- Empty state: illustration + "Track your insurance policies to get better retirement and health assessments"

### `AddPolicySheet` / `EditPolicySheet` (bottom sheet)

Fields (all in a single scrollable sheet):
1. Policy type (chip selector: Term · Health · Home · Car · Life · Other)
2. Provider name (TextInput)
3. Policy number (TextInput, optional)
4. Sum insured (NumberInput with ₹ prefix)
5. Annual premium (NumberInput with ₹ prefix)
6. Premium frequency (chip: Annual · Semi-annual · Quarterly · Monthly)
7. Start date (DatePicker)
8. Expiry date (DatePicker)
9. Family floater toggle (health only)
10. Family members covered (NumberInput, health only)
11. Notes (TextInput, optional)

Save button at bottom. Delete button in edit mode (soft delete).

---

## Service Layer

### `services/insurance-policy.ts`

```
- getAllPolicies(userId)           → InsurancePolicy[]
- getPoliciesByType(userId, type) → InsurancePolicy[]
- getActivePolicies(userId)       → InsurancePolicy[]
- addPolicy(data)                 → InsurancePolicy
- updatePolicy(id, data)          → void
- deletePolicy(id)                → void  (soft delete)
- getInsuranceAdequacy(userId)    → InsuranceAdequacy
  {
    termCover: { sumInsured, annualIncome, ratio, isAdequate },
    healthCover: { sumInsured, perMember, familySize, isAdequate },
    homeCover: { sumInsured, isAdequate },
    carCover: { hasActive: boolean },
    gaps: string[],       // e.g. ["No term insurance", "Health cover below ₹10L/member"]
    overallScore: number, // 0-100
  }
```

### Integration functions

```
- getInsuranceRiskFlags(userId)   → RiskFlag[]  (replaces hardcoded flags in retirement report)
- getInsuranceScoreBonus(userId)  → number      (0-2 bonus for readiness score)
- getExpiringPolicies(userId, withinDays) → InsurancePolicy[]  (future: home advisory)
```

---

## Implementation Phases

### Phase 1: Core (MVP)
1. Database migration + TABLE_SCHEMAS + backup registration
2. `services/insurance-policy.ts` — CRUD + adequacy computation
3. `/goals/risk-coverage` screen + Add/Edit sheets
4. Goals tab card in Track section
5. Retirement report integration (risk flags + report section)

### Phase 2: Deeper Integration
6. Financial health report — adjusted emergency fund target
7. Readiness score bonus points for adequate coverage
8. PDF export — include risk coverage section

### Phase 3: Polish (future)
9. Home screen expiry advisory
10. Renewal reminders via notifications
11. Premium-to-expense linking (auto-match annual premium transactions)

---

## What This Does NOT Do

- **No premium payment tracking** — premiums are already expenses in the transaction flow
- **No claim management** — out of scope for a personal finance app
- **No policy comparison or recommendations** — we show adequacy, not product advice
- **No rider/sub-product tracking** — base policy only
- **No OCR/document scanning** — manual entry only
- **No financial advice** — heuristics are clearly labeled as rules of thumb

---

## Resolved Questions

1. **Car insurance**: Always show as a type option (decided: always have car insurance).
2. **Home value**: Skip home adequacy — no home value field. Home policies are tracked but not assessed.
3. **Multiple health policies**: Sum them for adequacy check (confirmed).
4. **Pension/NPS**: Not required — deferred indefinitely.

---

## Design Notes

- Icon: `shield-checkmark-outline` (Ionicons) — distinct from the umbrella used for retirement
- Color: `#8B5CF6` (purple) — unused in the current Goals palette, distinct from blue (retirement) and green (health)
- Card style: matches existing Track section cards (icon + title + subtitle + chevron)
- Sheets: follow existing pattern from loan management (bottom sheet with form fields)
