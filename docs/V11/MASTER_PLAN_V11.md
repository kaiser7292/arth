# Artha V11 — MASTER PLAN

> **Analytics V2: Intelligent Insights with Drill-Down & Adaptive Forecasting**
> 6 phases | Version 10.0.7 → 11.0.0

---

## SESSION LOG

| # | Session Date | Tasks Completed | Notes |
|---|-------------|-----------------|-------|
| – | – | – | – |

## CURRENT STATE

```
PHASE: NOT STARTED
NEXT TASK: V11-0.1
TESTS: (carry forward from 10.x)
MIGRATIONS: (carry forward from 10.x)
VERSION: 10.0.7
```

---

## MANDATORY BEHAVIORS

1. Read this file at session start and after context compaction
2. Update SESSION LOG after every task
3. Update CURRENT STATE after every task
4. Mark checkboxes [x] as tasks complete
5. Follow task order — dependencies matter
6. Run tests after every task — don't accumulate untested code
7. When resuming after compaction: read CURRENT STATE → find next unchecked task → continue

---

## Context Recovery (After Compaction)

If you lose context, do this:

```
1. Read this file: docs/V11/MASTER_PLAN_V11.md
2. Check CURRENT STATE (above) — tells you phase + next task
3. Check SESSION LOG — tells you what was done today
4. Find the next task with [ ] checkbox
5. Read the prerequisite files listed in that task
6. Resume execution — do NOT ask the user "where were we?"
```

### Reference Documents (for deep context)

| Document | Location | What It Contains |
|----------|----------|-----------------|
| **V11 PRD** | `docs/V11/PRD_V11.md` | Feature requirements, user stories, acceptance criteria |
| **V11 TDD** | `docs/V11/TDD_V11.md` | Technical design, new tables, service architecture, type definitions |
| **Analytics Skill Design** | `~/.claude/work-docs/treasury/analysis/Artha_Analytics_Skill_Design.md` | Original 4-layer insight engine concept |
| **Transition Plan** | `~/.claude/work-docs/treasury/analysis/Artha_Analytics_V2_Transition_Plan.md` | What to keep/sunset/absorb/rebuild + TDD contracts + realistic forecasting + adaptive learning |
| **UX Journey** | `~/.claude/work-docs/treasury/analysis/Artha_Analytics_V2_UX_Journey.md` | Screen designs, component specs, navigation map, interaction specs |

---

## Feature Summary

| # | Area | Phase | Size | Description |
|---|------|-------|------|-------------|
| F1 | Types & Thresholds | 0 | S | All type definitions, magic numbers, scoring formulas |
| F2 | Data Layer | 0 | M | Parallel data fetching from existing services |
| F3 | Classification Engine | 1 | L | Fixed/Variable/Semi-Fixed classifier with learning pipeline |
| F4 | Realistic Forecast | 1 | XL | Split forecast (fixed + variable), replaces naive projection in Budget tab, Savings Tracker, Waterfall, Cockpit, and per-category forecasts |
| F5 | Pattern Detectors (6) | 2 | XL | Lifestyle creep, category drift, budget breach, micro-leak, weekend warrior, savings erosion |
| F6 | Insight Synthesizer | 2 | M | Ranking algorithm, cross-pattern synthesis, text generation |
| F7 | Drill-Down Builder | 3 | M | InsightNode tree construction, multi-dimension slicing |
| F8 | UI Components | 3 | L | InsightCard, DrillDownSheet, ForecastBreakdown, PatternRow, etc. |
| F9 | Analytics Screens | 4 | L | Dashboard, Insight Detail, Forecast, Pattern Library |
| F10 | Learning UX | 4 | M | Nudges, Monthly Review, Pattern Break alerts, Quick Setup |
| F11 | Pattern Detectors (+6) | 5 | L | Merchant shift, seasonal spike, goal jeopardy, CC creep, account concentration, recurring growth |
| F12 | Sunset & Cleanup | 5 | M | Remove old insights screens, consolidate health scores, navigation update |

---

## Dependency Graph

```
Phase 0 (Foundation)
  ├── types.ts, thresholds.ts, scoring.ts [NEW]
  └── data-layer.ts [NEW, calls existing services]
       │
  ┌────┴────────────────────┐
  │                          │
Phase 1 (Classification)    Phase 2 (Detection)
  ├── classifier.ts          ├── 6 pattern detectors
  ├── expense_classifications│ ├── insight-synthesizer.ts
  │   (new DB table)         │ └── text-templates.ts
  └── forecast-engine-v2.ts  │
       │                     │
       └─────────┬───────────┘
                 │
          Phase 3 (Drill-Down + Components)
            ├── drilldown-builder.ts
            ├── drill-helpers.ts
            └── 14 new UI components
                 │
          Phase 4 (Screens + Learning UX)
            ├── 5 new screens
            ├── Nudge system
            ├── Pattern Library
            └── Quick Setup
                 │
          Phase 5 (Expansion + Sunset)
            ├── 6 more detectors
            ├── Delete old app/insights/
            ├── Delete old utils/
            └── Navigation update
```

---

## Phase 0: Foundation — 8 tasks

**Goal:** Type system, scoring math, thresholds, data layer. No UI. No DB changes.

- [ ] **V11-0.1** Create `utils/analytics/types.ts`
  - Define: `PatternType`, `Severity`, `PatternResult`, `RankedInsight`, `ActionSuggestion`, `InsightNode`, `DrillDimension`, `AnalyticsDashboard`, `DrillableAmount`, `ClassifiedExpense`
  - Prerequisites: Read `Artha_Analytics_V2_Transition_Plan.md` Part 5 (TDD Contracts → Type Definitions)
  - Test: TypeScript compiles with no errors

- [ ] **V11-0.2** Create `utils/analytics/thresholds.ts`
  - Export single `THRESHOLDS` const object with all magic numbers
  - Categories: lifestyle creep, category drift, merchant shift, weekend warrior, micro-leak, budget breach, goal jeopardy, savings erosion, CC creep, account concentration, recurring growth, scoring weights, dashboard limits, confidence, realistic forecast
  - Prerequisites: Read Transition Plan Part 8 (Thresholds)
  - Test: All values are numbers, no undefined

- [ ] **V11-0.3** Create `utils/analytics/scoring.ts`
  - Functions: `calculateImpact()`, `calculateActionability()`, `calculateUrgency()`, `calculateConfidence()`, `calculateInsightScore()`, `rankInsights()`
  - Pure functions, no DB calls
  - Prerequisites: Read Transition Plan Part 5.3 (Scoring Test Contract)
  - Test: Write `__tests__/utils/analytics/scoring.test.ts` FIRST, then implement

- [ ] **V11-0.4** Create `utils/analytics/text-templates.ts`
  - Functions: `generateInsightTitle()`, `generateInsightDetail()`, `generateActionText()`
  - Template strings for each PatternType × Severity combination
  - Prerequisites: Read Skill Design "Insight Examples" section
  - Test: Each PatternType produces non-empty title and detail strings

- [ ] **V11-0.5** Create `utils/analytics/drill-helpers.ts`
  - Functions: `groupByCategory()`, `groupByMerchant()`, `groupByWeek()`, `groupByAccount()`, `groupByPaymentMode()`, `calculatePercentOfParent()`, `flattenTree()`
  - Pure functions that take expense arrays + return InsightNode trees
  - Prerequisites: Read Transition Plan Part 5.4 (Drill-Down Builder Test Contract)
  - Test: Write `__tests__/utils/analytics/drill-helpers.test.ts` FIRST

- [ ] **V11-0.6** Create `services/analytics/data-layer.ts`
  - Function: `fetchAnalyticsDatasets(userId, dateRange)` → returns all 10 datasets in parallel
  - Calls existing services: `getExpenses()`, `getBudgetsForMonth()`, `deriveYearlyPlan()`, `getSpendingInsights()`, etc.
  - Uses `Promise.all()` for parallelism
  - Prerequisites: Read Transition Plan Part 1 (Layer 1 datasets table)
  - Test: Mock services, verify all 10 datasets returned

- [ ] **V11-0.7** Create `services/analytics/index.ts`
  - Public API: `getAnalyticsDashboard(userId, month?)` → `AnalyticsDashboard`
  - Orchestrates: data-layer → detectors → synthesizer → return ranked insights
  - For now: returns empty insights (detectors come in Phase 2)
  - Prerequisites: All V11-0.x tasks complete
  - Test: Returns valid AnalyticsDashboard shape with empty insights array

- [ ] **V11-0.8** Run full test suite, verify zero regressions
  - `npx jest --passWithNoTests`
  - Verify all new tests pass
  - Update CURRENT STATE

---

## Phase 1: Classification Engine + Realistic Forecast — 13 tasks

**Goal:** New DB table, transaction classifier, adaptive forecast. The core fix for the "rent on day 1 projects ₹7.5L" problem.

- [ ] **V11-1.1** Create database migration: `expense_classifications` table
  - Schema: id, user_id, merchant_normalized, category_id, amount_range_low, amount_range_high, classification (fixed/variable/semi_fixed), frequency, expected_day_of_month, confidence, source (auto_detected/user_confirmed/user_corrected), occurrence_count, last_seen_date, last_confirmed_date, is_active, deactivated_reason, created_at, updated_at
  - Prerequisites: Read Transition Plan Appendix D → Data Model for Learning
  - Test: Migration runs, table exists, columns have correct types

- [ ] **V11-1.2** Create `services/analytics/classifier.ts`
  - Functions: `classifyExpense()`, `getFixedCategories()`, `isInfrequentLargeTransaction()`, `matchesRecurring()`
  - Uses: `expense_classifications` table + `recurring_transactions` + category defaults
  - Prerequisites: Read Transition Plan Appendix D → Classification Logic (Step 2)
  - Test: Write `__tests__/services/analytics/classifier.test.ts` FIRST (see TDD contracts)

- [ ] **V11-1.3** Create `services/analytics/pattern-learner.ts`
  - Functions: `detectNewPatterns()`, `updatePatternConfidence()`, `deactivateStalePattern()`, `confirmPattern()`, `correctPattern()`
  - Auto-detects patterns from expense history (seeded from existing `recurring_transactions`)
  - Confidence scaling: 2 occurrences=0.5, 3=0.7, 4+=0.9, user_confirmed=1.0
  - Prerequisites: Read Transition Plan Appendix D → Adaptive Learning (Confidence Progression)
  - Test: Pattern detected after 2+ consistent occurrences, confidence increases over time

- [ ] **V11-1.4** Seed initial classifications from existing `recurring_transactions`
  - One-time migration function: `seedClassificationsFromRecurring(userId)`
  - Maps: merchant_normalized, amount, frequency → new `expense_classifications` rows
  - Source: `auto_detected`, confidence based on occurrence_count
  - Prerequisites: V11-1.1 + V11-1.2
  - Test: Existing recurring items appear in classifications table with correct confidence

- [ ] **V11-1.5** Create `services/analytics/forecast-engine-v2.ts`
  - Function: `forecastMonthEndRealistic(input)` → `RealisticForecast`
  - Splits: fixed (done) + fixed (pending) + variable (projected)
  - Variable rate: calculated from variable expenses ONLY (excludes fixed)
  - Variable days: counted from first variable expense date, not month start
  - Blends with historical for early-month stability
  - Prerequisites: Read Transition Plan Appendix D → The New Forecast Formula (Step 4)
  - Test: Write `__tests__/services/analytics/forecast-engine-v2.test.ts` FIRST (see TDD contracts — "Day 1 after rent" test cases)

- [ ] **V11-1.6** Create `services/analytics/forecast-engine-v2.ts` (continued)
  - Function: `forecastCategoryRealistic()` → `CategoryForecast`
  - Per-category fixed/variable split
  - `breachDriver` field: 'fixed_costs_exceed_budget' vs 'variable_pace_too_high'
  - Function: `projectYearEndRealistic()` → fixed annual + variable monthly × 12
  - Prerequisites: V11-1.5
  - Test: Rent category does NOT trigger false breach alarm on day 1

- [ ] **V11-1.7** Wire realistic forecast into existing cockpit (behind flag)
  - Add MMKV flag: `analytics_v2_forecast` (default: true for new engine)
  - `services/financial-cockpit.ts`: if flag on, use `forecastMonthEndRealistic()` for projections
  - Existing cockpit behavior preserved when flag is off
  - Prerequisites: V11-1.5, V11-1.6
  - Test: Cockpit returns same structure, but with realistic numbers

- [ ] **V11-1.8** Replace naive projection in Budget Compliance (monthly)
  - File: `utils/budget-compliance.ts` line 57 (`dailySpendRate * daysTotal`)
  - Replace with: call `forecastMonthEndRealistic()` when flag on, use its total
  - The daily spend rate display stays (informational), but the *projected month-end* uses realistic engine
  - Budget tab "Month-End Projection" widget now shows split-aware numbers
  - Prerequisites: V11-1.5, V11-1.7 (flag wiring)
  - Test: Day 1 with ₹30K rent → projected NOT ₹9L. Budget tab shows sensible projection.

- [ ] **V11-1.9** Replace naive projection in Budget Compliance (annual)
  - File: `utils/budget-compliance.ts` line 93-95 (`annualSpentYTD / monthsElapsed * 12`)
  - Replace with: sum of known fixed annual costs + variable annual rate from realistic engine
  - Alternatively: use `projectYearEndRealistic()` from V11-1.6 output
  - Budget tab "Annual On Track" now accounts for lumpy fixed costs (insurance, subscriptions)
  - Prerequisites: V11-1.6, V11-1.8
  - Test: Annual projection not wildly inflated in months with large fixed payments

- [ ] **V11-1.10** Replace naive projection in Savings Tracker
  - File: `utils/savings-calculations.ts` line 112-113 (`actualSaved + avgMonthlySavings * monthsRemaining`)
  - Problem: if early FY months have high fixed costs, avgMonthlySavings is artificially low
  - Replace with: income − `projectYearEndRealistic()` annual spend projection
  - Savings Tracker "Year-End Projection" and "Projected Rate" now use realistic engine
  - Prerequisites: V11-1.6, V11-1.7
  - Test: Savings projection after heavy-fixed-cost month still shows realistic year-end number

- [ ] **V11-1.11** Replace naive projection in Money Waterfall
  - File: `utils/financial-cockpit.ts` line 240-241 (`expensesActualYTD / monthsElapsed * 12` fallback)
  - Replace fallback with: `projectYearEndRealistic()` when classification data exists
  - Waterfall "Expenses Projected Annual" now reflects fixed annual + variable extrapolation
  - Prerequisites: V11-1.6, V11-1.7
  - Test: Waterfall projected annual doesn't spike in Jan (after insurance + school fees month)

- [ ] **V11-1.12** Replace naive projection in existing Forecast Engine
  - File: `utils/forecast-engine.ts` function `forecastMonthEnd()` line 120
  - This is the per-category forecast used by category-level breach alerts
  - Update: when classification data available, use fixed/variable split per category
  - When no classification data (cold start): fall back to existing pace+historical blend
  - Prerequisites: V11-1.5, V11-1.2 (classifier)
  - Test: Category forecast for "Rent" category doesn't project 30x on day 1

- [ ] **V11-1.13** Run full test suite + manual verification
  - Verify ALL projection surfaces produce sensible numbers:
    - Budget tab monthly projection ✓
    - Budget tab annual on-track ✓
    - Savings tracker year-end ✓
    - Money waterfall projected annual ✓
    - Existing forecast engine per-category ✓
    - Cockpit reality check ✓
  - Verify existing behavior still works when flag is off
  - Update CURRENT STATE

---

## Phase 2: Pattern Detectors + Synthesizer — 10 tasks

**Goal:** First 6 pattern detectors + insight ranking + text generation. Insights exist but no UI yet.

- [ ] **V11-2.1** Create `services/analytics/pattern-detectors/lifestyle-creep.ts`
  - Compares rolling 3-month average to same period last year
  - Excludes one-time spikes (>3x category avg)
  - Adjusts for income changes (if salary rose proportionally, no creep)
  - Prerequisites: Read Transition Plan Part 5.2 (Lifestyle Creep test contract)
  - Test: Write test FIRST, then implement

- [ ] **V11-2.2** Create `services/analytics/pattern-detectors/category-drift.ts`
  - Detects 3+ consecutive months of increasing spend in a category
  - Direction threshold: >10% rise counts as "increasing"
  - Prerequisites: Read Transition Plan Group A, Detector #2
  - Test: Write test FIRST

- [ ] **V11-2.3** Create `services/analytics/pattern-detectors/budget-breach.ts`
  - Uses REALISTIC forecast (not naive daily rate)
  - Only alerts on variable overspend. Fixed within budget = silent.
  - `breachDriver`: distinguishes "budget too low for fixed" vs "variable pace too high"
  - Prerequisites: V11-1.5 (realistic forecast), Transition Plan Detector #7
  - Test: Write test FIRST. Key test: "Does NOT raise alarm for rent on day 1"

- [ ] **V11-2.4** Create `services/analytics/pattern-detectors/micro-leak.ts`
  - Finds merchants with >4 txns/month under ₹500 each
  - Calculates total as % of monthly spend
  - Excludes essential small transactions (is_right_spend=1)
  - Prerequisites: Transition Plan Detector #6
  - Test: Write test FIRST

- [ ] **V11-2.5** Create `services/analytics/pattern-detectors/weekend-warrior.ts`
  - Weekend avg/day > 1.5x weekday for 2+ consecutive months
  - Breaks down by category (which categories drive weekend spending)
  - Prerequisites: Transition Plan Detector #5
  - Test: Write test FIRST

- [ ] **V11-2.6** Create `services/analytics/pattern-detectors/savings-erosion.ts`
  - Savings rate declined for 3+ consecutive months
  - Calculates discretionary cut needed to restore target
  - Absorbs logic from old `utils/course-correction.ts`
  - Prerequisites: Transition Plan Detector #9
  - Test: Write test FIRST

- [ ] **V11-2.7** Create `services/analytics/pattern-detectors/index.ts`
  - Exports all 6 detectors
  - Function: `runAllDetectors(datasets)` → `PatternResult[]`
  - Runs detectors in parallel, filters nulls, returns found patterns
  - Test: Given datasets that trigger all 6, returns 6 PatternResults

- [ ] **V11-2.8** Create `services/analytics/insight-synthesizer.ts`
  - Functions: `synthesizeInsights()`, `deduplicateByCategory()`, `crossPatternSynthesize()`, `generateActions()`
  - Ranking: score = impact×0.4 + actionability×0.3 + urgency×0.2 + confidence×0.1
  - Dedup: if 2 patterns flag same category, merge into strongest one
  - Cross-pattern: connect lifestyle creep + savings erosion into combined insight
  - Prerequisites: Read Transition Plan Part 5.5 (Synthesizer Test Contract)
  - Test: Write test FIRST

- [ ] **V11-2.9** Wire detectors + synthesizer into `services/analytics/index.ts`
  - `getAnalyticsDashboard()` now: fetches data → classifies → runs 6 detectors → synthesizes → returns ranked insights
  - Prerequisites: All V11-2.x tasks
  - Test: Integration test — provide realistic expense data, get ranked insights back

- [ ] **V11-2.10** Run full test suite + verify all 6 detectors produce expected results on real-ish data
  - Create test fixture: 6 months of sample expenses designed to trigger each detector
  - Update CURRENT STATE

---

## Phase 3: Drill-Down + UI Components — 12 tasks

**Goal:** Build all new UI components. No screens yet — components only, with Storybook-style test renders.

- [ ] **V11-3.1** Create `services/analytics/drilldown-builder.ts`
  - Function: `buildDrillTree(insight, expenses)` → InsightNode
  - Builds multi-dimension tree: by category, by merchant, by week, by account
  - Every node has `transactionIds` populated (the iron rule)
  - Uses drill-helpers from V11-0.5
  - Prerequisites: Read Transition Plan Part 5.4 (Drill-Down Builder Test Contract)
  - Test: Write test FIRST. Key test: "parent transactionIds = union of children"

- [ ] **V11-3.2** Create `components/analytics/ConfidenceDots.tsx`
  - Props: `level: 0-5`, `label?: string`
  - 5 dots, filled up to level, accent color for filled, muted for empty
  - Animated: dots fill sequentially (100ms per dot)
  - accessibilityLabel: "Confidence: {label}, {level} out of 5"
  - Design: Follow StatusPill sizing (text-xs, rounded-full)

- [ ] **V11-3.3** Create `components/analytics/MiniTrendSpark.tsx`
  - Props: `data: number[]` (3-6 values), `color?: string`, `height?: number`
  - SVG polyline sparkline, no axes, no labels
  - Width: fills container. Height: 24px default.
  - Animated: stroke-dashoffset draws the line (400ms)
  - Design: Uses react-native-svg (existing dependency)

- [ ] **V11-3.4** Create `components/analytics/ImpactBadge.tsx`
  - Props: `amount: number`, `type: 'over' | 'under' | 'neutral'`, `label?: string`
  - Pill-shaped badge: "₹4,200 over" in red, "↓9.3%" in green, etc.
  - Design: StatusPill pattern with amount formatting

- [ ] **V11-3.5** Create `components/analytics/InsightCard.tsx`
  - Props: `insight: RankedInsight`, `onPress: (id) => void`, `showSpark?: boolean`
  - Layout: severity icon (left) + title/detail/metric (center) + chevron (right)
  - Optional: MiniTrendSpark below title
  - Optional: ActionSuggestion text at bottom
  - Animation: Spring scale 0.97x on press
  - Haptic: Light on press
  - Design: Card component (elevated, rounded-2xl, p-5)

- [ ] **V11-3.6** Create `components/analytics/ActionSuggestionCard.tsx`
  - Props: `action: ActionSuggestion`
  - Card with accent[50] background, accent border
  - 💡 icon + text + savings amount + difficulty pill
  - Design: accent background variant of Card

- [ ] **V11-3.7** Create `components/analytics/ForecastBreakdown.tsx`
  - Props: `forecast: RealisticForecast`, `budget: number`
  - 3 progress bars: Fixed (done), Fixed (pending), Variable (projected)
  - Summary: projected total, budget, breathing room
  - ConfidenceDots at bottom
  - Design: Card with MetricRow + ProgressBar (existing components)

- [ ] **V11-3.8** Create `components/analytics/DrillDimensionTabs.tsx`
  - Props: `dimensions: DrillDimension[]`, `activeKey: string`, `onSelect: (key) => void`
  - Horizontal ScrollView of pill buttons (icon + label)
  - Active pill: accent background, white text
  - Inactive pill: surface background, secondary text
  - Design: Similar to filter tabs in review-queue

- [ ] **V11-3.9** Create `components/analytics/DrillGroupRow.tsx`
  - Props: `node: InsightNode`, `maxAmount: number`, `onPress: (node) => void`
  - Layout: icon + label + amount + % + chevron
  - ProgressBar below (proportional to maxAmount)
  - Transaction count as subtitle
  - Haptic: Light on press
  - Design: ListRow + ProgressBar combined

- [ ] **V11-3.10** Create `components/analytics/PatternRow.tsx`
  - Props: `classification: ExpenseClassification`, `onEdit: () => void`
  - Layout: category icon + merchant/name + amount + frequency + confidence + edit button
  - StatusPill for source (confirmed/auto-detected)
  - ConfidenceDots inline
  - Design: ListRow pattern with right-side action

- [ ] **V11-3.11** Create `components/analytics/LearningNudge.tsx`
  - Props: `pattern: PendingClassification`, `onConfirm: () => void`, `onDeny: () => void`, `onDismiss: () => void`
  - Card with accent[50] background
  - "This looks like a monthly expense. Is it?" + evidence (past occurrences)
  - Two buttons: [Yes, monthly] [No, one-time]
  - Dismiss link: "Don't ask again for this"
  - Animation: FadeIn on appear, FadeOut+SlideOut on dismiss
  - Haptic: Success on confirm

- [ ] **V11-3.12** Create `components/analytics/MonthlyReviewCard.tsx`
  - Props: `pendingPatterns: PendingClassification[]`, `onConfirmAll: () => void`, `onConfirmOne: (id) => void`, `onDenyOne: (id) => void`
  - Card with accent border
  - "Quick check (takes 30 seconds)" header
  - List of patterns with [✓] [✗] per row
  - Swipeable rows (right=confirm, left=deny) using SwipeableRow
  - [Confirm All] [Skip for Now] buttons at bottom
  - Animation: Row scales + fades out on confirm/deny
  - Haptic: Success per confirmation

---

## Phase 4: Screens + Learning UX — 10 tasks

**Goal:** Wire components into screens. User can see and interact with analytics.

- [ ] **V11-4.1** Create `app/analytics/_layout.tsx`
  - Stack navigation with standard Artha header styling
  - Screens: index, insight-detail, forecast, patterns, compare, quick-setup

- [ ] **V11-4.2** Create `app/analytics/index.tsx` (Analytics Dashboard)
  - Sections: ForecastBreakdown card → InsightCards (top 5) → SpendingPulse → Quick Actions
  - Cold-start variant: range forecast + "still learning" banner + Quick Setup link
  - Refresh: listens to MMKV dataVersion
  - Loading: LoadingState component (existing)
  - Empty: "Track spending for a month to see insights"
  - Prerequisites: All Phase 3 components
  - Test: Renders without crash, shows forecast card + insight cards

- [ ] **V11-4.3** Create `app/analytics/insight-detail.tsx`
  - Params: insightId (from route)
  - Sections: Hero (severity + title + metric + progress) → ActionSuggestionCard → DrillDimensionTabs → DrillGroupRows
  - Tapping a DrillGroupRow → pushes to transaction list filtered by transactionIds
  - "Show all N transactions" expander at bottom
  - Prerequisites: V11-3.1 (drilldown-builder), components
  - Test: Renders insight, switching tabs changes drill content

- [ ] **V11-4.4** Create `app/analytics/forecast.tsx` (Forecast Detail)
  - Sections: Projection Summary → Fixed (done) list → Fixed (pending) list → Variable breakdown (per-category pace) → Categories at Risk
  - Fixed items link to expense detail (/expense/[id])
  - Pending items have [Already paid] [Not this month] actions
  - "Categories at Risk" only shows variable breaches (not fixed)
  - Prerequisites: V11-1.5 (realistic forecast)
  - Test: Renders forecast breakdown, fixed items show correctly

- [ ] **V11-4.5** Create `app/analytics/patterns.tsx` (Pattern Library)
  - Sections: Learning Status banner → Filter tabs (All/Fixed/Semi/Variable) → PatternRow list → "Add Pattern Manually" button
  - Tapping Edit → opens PatternEditSheet
  - Long press → context menu (Edit, Delete, View History)
  - Empty state: brain icon + "No patterns yet" + "Set up manually" link
  - Prerequisites: V11-1.3 (pattern-learner), PatternRow component
  - Test: Lists patterns from expense_classifications table

- [ ] **V11-4.6** Create `components/analytics/PatternEditSheet.tsx` (Bottom sheet)
  - Modal bottom sheet (follows SplitSheet pattern)
  - Fields: Classification (radio pills), Amount (input or range), Frequency (radio pills), Expected Day (input)
  - [Delete Pattern] [Save Changes] buttons
  - "Changing this will update your forecast immediately" warning
  - On save: updates classification + bumps dataVersion
  - Haptic: Success on save
  - Prerequisites: UX Journey Part 2 Screen 4

- [ ] **V11-4.7** Implement Nudge system
  - Create `services/analytics/nudge-manager.ts`
  - Functions: `getActiveNudges(userId)` → max 2, filtered by dismissed, sorted by amount
  - MMKV keys: `nudge_dismissed_{id}`, `monthly_review_shown_{YYYY-MM}`
  - Rules: max 2/session, only amounts >₹1000, never repeat after answered
  - Show LearningNudge on expense detail (inline below hero card)
  - Show MonthlyReviewCard on analytics dashboard (month 2-3, once/month)
  - Prerequisites: V11-1.3 (pattern-learner), LearningNudge + MonthlyReviewCard components
  - Test: Returns max 2 nudges, respects dismissals

- [ ] **V11-4.8** Create `app/analytics/quick-setup.tsx` (Optional Onboarding)
  - Form: Name + Amount + Frequency + Day + Category per fixed expense
  - Common Templates chips (Rent, EMI, Insurance, Subscriptions, etc.)
  - [Save & Start] pre-seeds expense_classifications with confidence=1.0
  - [Skip] closes and sets MMKV flag
  - NOT mandatory, accessible from cold-start banner or Settings
  - Test: Creates classifications on save

- [ ] **V11-4.9** Move `app/insights/compare.tsx` → `app/analytics/compare.tsx`
  - Copy file, update imports
  - Verify it works at new route
  - Keep old file temporarily (removed in Phase 5)

- [ ] **V11-4.10** Wire analytics tab into bottom navigation
  - Update `app/(tabs)/_layout.tsx`: add "Analytics" tab
  - Icon: "analytics-outline" or "bar-chart-outline" (Ionicons)
  - For now: keep old "Insights" tab too (both visible during transition)
  - Test: Analytics tab navigates to new dashboard

---

## Phase 5: Expansion + Sunset — 12 tasks

**Goal:** Remaining 6 detectors, remove old insights, clean up.

- [ ] **V11-5.1** Create `services/analytics/pattern-detectors/merchant-shift.ts`
  - Detects top-5 merchant changes (new entrant, dropped out)
  - Prerequisites: Transition Plan Detector #3
  - Test: Write test FIRST

- [ ] **V11-5.2** Create `services/analytics/pattern-detectors/seasonal-spike.ts`
  - Compares current month to same month last FY
  - Flags >25% deviation with category breakdown
  - Prerequisites: Transition Plan Detector #4
  - Test: Write test FIRST

- [ ] **V11-5.3** Create `services/analytics/pattern-detectors/goal-jeopardy.ts`
  - Cross-references spending pace with milestone timelines
  - Calculates months of delay caused by specific overspend categories
  - Prerequisites: Transition Plan Detector #8
  - Test: Write test FIRST

- [ ] **V11-5.4** Create `services/analytics/pattern-detectors/credit-card-creep.ts`
  - CC spend as % of total increasing for 3+ months
  - OR total_due growing month-over-month
  - Prerequisites: Transition Plan Detector #10
  - Test: Write test FIRST

- [ ] **V11-5.5** Create `services/analytics/pattern-detectors/account-concentration.ts`
  - Flags >80% spending from single account
  - Prerequisites: Transition Plan Detector #11
  - Test: Write test FIRST

- [ ] **V11-5.6** Create `services/analytics/pattern-detectors/recurring-growth.ts`
  - Total recurring costs grew >10% in a month
  - Lists specific new/increased items
  - Prerequisites: Transition Plan Detector #12
  - Test: Write test FIRST

- [ ] **V11-5.7** Update `pattern-detectors/index.ts` to include all 12
  - Verify all 12 run in integration test
  - Test: Full test fixture triggers all 12

- [ ] **V11-5.8** Create Pattern Break alerts
  - Create `components/analytics/PatternBreakCard.tsx`
  - Create `components/analytics/AmountChangeCard.tsx`
  - Wire into analytics dashboard (show when expected recurring is late)
  - Prerequisites: UX Journey Nudge Type C and D

- [ ] **V11-5.9** Delete old `app/insights/` directory
  - Remove: index.tsx, merchants.tsx, accounts.tsx, payment-methods.tsx, right-spend.tsx, compare.tsx (moved), _layout.tsx
  - Remove: `app/advisor/index.tsx`
  - Verify: `grep -r "from.*insights" --include="*.ts" --include="*.tsx"` = 0 results
  - Test: App compiles, no broken imports

- [ ] **V11-5.10** Delete deprecated utilities
  - Remove: `utils/financial-health.ts` (consolidated into cockpit)
  - Remove: `utils/course-correction.ts` (absorbed into savings-erosion detector)
  - Verify: no imports remain
  - Test: App compiles

- [ ] **V11-5.11** Update bottom navigation
  - Remove old "Insights" tab
  - Rename "Analytics" position/icon if needed
  - Update any deep links pointing to old routes
  - Test: No navigation errors

- [ ] **V11-5.12** Final QA + Version Bump
  - Run full test suite
  - Type check: `npx tsc --noEmit`
  - Bump version to 11.0.0 in app.json
  - Update CLAUDE.md version table
  - Create git tag: v11.0.0
  - Update CURRENT STATE to COMPLETE

---

## Task Sizing & Estimates

| Phase | Tasks | Estimated Effort | Dependencies |
|-------|-------|-----------------|--------------|
| Phase 0 | 8 | 1-2 sessions | None |
| Phase 1 | 13 | 3-4 sessions | Phase 0 |
| Phase 2 | 10 | 2-3 sessions | Phase 0 + Phase 1 (for budget-breach) |
| Phase 3 | 12 | 3-4 sessions | Phase 0 + Phase 2 |
| Phase 4 | 10 | 3-4 sessions | Phase 3 |
| Phase 5 | 12 | 2-3 sessions | Phase 4 |
| **Total** | **65 tasks** | **~14-20 sessions** | |

---

## Testing Strategy

### TDD Approach (Mandatory)

For every service/utility file:
1. Create test file FIRST (`__tests__/{path}/{filename}.test.ts`)
2. Write test cases from TDD contracts (Transition Plan Part 5)
3. Run tests → all FAIL (red)
4. Implement the function
5. Run tests → all PASS (green)
6. Refactor if needed
7. Move to next task

### Test File Locations

```
__tests__/
├── utils/analytics/
│   ├── scoring.test.ts
│   ├── drill-helpers.test.ts
│   ├── text-templates.test.ts
│   └── thresholds.test.ts
├── services/analytics/
│   ├── classifier.test.ts
│   ├── forecast-engine-v2.test.ts
│   ├── pattern-learner.test.ts
│   ├── data-layer.test.ts
│   ├── drilldown-builder.test.ts
│   ├── insight-synthesizer.test.ts
│   └── pattern-detectors/
│       ├── lifestyle-creep.test.ts
│       ├── category-drift.test.ts
│       ├── budget-breach.test.ts
│       ├── micro-leak.test.ts
│       ├── weekend-warrior.test.ts
│       ├── savings-erosion.test.ts
│       ├── merchant-shift.test.ts
│       ├── seasonal-spike.test.ts
│       ├── goal-jeopardy.test.ts
│       ├── credit-card-creep.test.ts
│       ├── account-concentration.test.ts
│       └── recurring-growth.test.ts
└── components/analytics/
    ├── InsightCard.test.tsx
    ├── ForecastBreakdown.test.tsx
    ├── DrillDownSheet.test.tsx
    └── PatternRow.test.tsx
```

---

## Version Bump Plan

| Milestone | Version | When |
|-----------|---------|------|
| Phase 0 complete | 10.1.0 | Types + scoring + data layer ready |
| Phase 1 complete | 10.2.0 | Realistic forecast working |
| Phase 2 complete | 10.3.0 | 6 detectors + synthesizer |
| Phase 3 complete | 10.4.0 | All components built |
| Phase 4 complete | 10.5.0 | All screens + learning UX live |
| Phase 5 complete | 11.0.0 | Old system removed, full v11 |

---

## Files Created / Modified (Summary)

### New Files (33)

```
services/analytics/
  ├── index.ts
  ├── data-layer.ts
  ├── classifier.ts
  ├── pattern-learner.ts
  ├── forecast-engine-v2.ts
  ├── insight-synthesizer.ts
  ├── drilldown-builder.ts
  ├── nudge-manager.ts
  └── pattern-detectors/
      ├── index.ts
      ├── lifestyle-creep.ts
      ├── category-drift.ts
      ├── budget-breach.ts
      ├── micro-leak.ts
      ├── weekend-warrior.ts
      ├── savings-erosion.ts
      ├── merchant-shift.ts
      ├── seasonal-spike.ts
      ├── goal-jeopardy.ts
      ├── credit-card-creep.ts
      ├── account-concentration.ts
      └── recurring-growth.ts

utils/analytics/
  ├── types.ts
  ├── thresholds.ts
  ├── scoring.ts
  ├── text-templates.ts
  └── drill-helpers.ts

components/analytics/
  ├── InsightCard.tsx
  ├── ActionSuggestionCard.tsx
  ├── ForecastBreakdown.tsx
  ├── DrillDimensionTabs.tsx
  ├── DrillGroupRow.tsx
  ├── PatternRow.tsx
  ├── PatternEditSheet.tsx
  ├── LearningNudge.tsx
  ├── MonthlyReviewCard.tsx
  ├── PatternBreakCard.tsx
  ├── AmountChangeCard.tsx
  ├── ConfidenceDots.tsx
  ├── MiniTrendSpark.tsx
  └── ImpactBadge.tsx

app/analytics/
  ├── _layout.tsx
  ├── index.tsx
  ├── insight-detail.tsx
  ├── forecast.tsx
  ├── patterns.tsx
  ├── compare.tsx (moved)
  └── quick-setup.tsx

database/migrations/
  └── 0XX_expense_classifications.ts
```

### Modified Files

```
services/financial-cockpit.ts          (wire realistic forecast)
app/(tabs)/_layout.tsx                 (add Analytics tab)
database/TABLE_SCHEMAS.ts              (add expense_classifications)
app.json                               (version bump)
CLAUDE.md                              (update version table)
```

### Deleted Files (Phase 5)

```
app/insights/index.tsx
app/insights/merchants.tsx
app/insights/accounts.tsx
app/insights/payment-methods.tsx
app/insights/right-spend.tsx
app/insights/compare.tsx
app/insights/_layout.tsx
app/advisor/index.tsx
utils/financial-health.ts
utils/course-correction.ts
```

---

*This is the single source of truth for V11. Read CURRENT STATE to know where you are. Read the next [ ] task to know what to do.*
