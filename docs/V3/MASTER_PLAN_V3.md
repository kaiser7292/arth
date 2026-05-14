# Artha V3 — MASTER PLAN

> **Actionable Savings, External Collaboration & Smart Automation**
> 48 tasks | 7 phases | Version 2.0.0 → 3.0.0

---

## SESSION LOG

| # | Session Date | Tasks Completed | Notes |
|---|-------------|-----------------|-------|
| 1 | 2026-04-13 | V3-0.1 to V3-0.6 | Phase 0 complete: Home dashboard, route groups, settings reorg, notification infra + prefs, 16 new tests (933 total) |
| 2 | 2026-04-13 | V3-1.1 to V3-1.5 | Phase 1 complete: PDF export, Excel export, format picker, wired to 3 screens, 30 new tests (963 total) |
| 3 | 2026-04-13 | V3-2.1 to V3-2.5 | Phase 2 complete: SMS notification wiring, overdue/upcoming scheduler, deep-linking (Phase 0), 11 new tests (974 total) |
| 4 | 2026-04-13 | B1-B10 (Bug Fixes) | 10 bugs fixed: household self-split (migration 022), outflow breakdown, date pickers (7 screens + DateInput component), FK constraints, budget edge cases, tag picker keyboard, SMS improvements, settings/insights layout, salary FY isolation + copy-forward. 8 new tests (982 total) |
| 5 | 2026-04-13 | V3-6.2 + V3-6.3 (partial) | Documentation: PRD_V3, TDD_V3, MASTER_PLAN update, CLAUDE.md update. APK build (v2.0.0 interim) |

## CURRENT STATE

```
PHASE: Bug Fix Interlude (complete) → Phase 3 next
TASK: V3-3.1 — Migration 023 (statement_imports)
STATUS: Ready to start
TESTS: 982 (917 + 16 Phase 0 + 30 Phase 1 + 11 Phase 2 + 8 Bug Fixes)
MIGRATIONS: 22 (14 MVP + 3 V1 + 4 V2 + 1 V3 bug fix)
```

---

## MANDATORY BEHAVIORS

1. Read this file at session start and after context compaction
2. Update SESSION LOG after every task
3. Update CURRENT STATE after every task
4. Mark checkboxes [x] as tasks complete
5. Follow task order — dependencies matter

---

## Phase 0: Navigation Future-Proofing + Notification Infrastructure (F6) — 6 tasks

- [x] **V3-0.1** Home Screen Dashboard Redesign
  - Prereqs: `app/(tabs)/index.tsx`
  - Add Savings Advisor + Reconciliation cards to Home dashboard
  - AC: Home has categorized card layout with new feature placeholders

- [x] **V3-0.2** Create Route Groups (advisor + reconciliation)
  - Prereqs: `app/insights/_layout.tsx` (pattern)
  - Create `app/advisor/_layout.tsx` + `app/reconciliation/_layout.tsx` with placeholder screens
  - AC: Routes registered, navigation from Home works

- [x] **V3-0.3** Settings Screen Reorganization
  - Prereqs: `app/(tabs)/settings.tsx`
  - Group settings into sections, add notification preferences entry
  - AC: Settings has clear section grouping

- [x] **V3-0.4** Notification Infrastructure Setup
  - Install `expo-notifications`, create `services/notifications.ts`
  - AC: Notification service created, MMKV settings for toggles

- [x] **V3-0.5** Notification Preferences Screen
  - Create `app/settings/notifications.tsx`
  - AC: Toggle switches per notification type, persists via MMKV

- [x] **V3-0.6** Phase 0 Tests
  - AC: ~15 new tests pass

## Phase 1: Hisaab Export — PDF & Excel (F1) — 5 tasks

- [x] **V3-1.1** PDF Generation Service (`services/hisaab-export-pdf.ts`)
- [x] **V3-1.2** Hisaab Excel Export Service (`services/hisaab-export-excel.ts`)
- [x] **V3-1.3** Export Format Picker Component (`components/hisaab/ExportFormatPicker.tsx`)
- [x] **V3-1.4** Wire Export to Hisaab Screens
- [x] **V3-1.5** Phase 1 Tests (~30 new tests)

## Phase 2: Push Notifications (F2) — 5 tasks

- [x] **V3-2.1** Wire Notifications to SMS Background Task
- [x] **V3-2.2** Overdue Forecast Notifications (`services/notification-scheduler.ts`)
- [x] **V3-2.3** Upcoming Due Notifications
- [x] **V3-2.4** Notification Tap Deep-Linking
- [x] **V3-2.5** Phase 2 Tests (~11 new tests)

## Bug Fix Interlude (Post-Phase 2) — 10 bugs

Discovered during user testing of Phases 0-2. All fixed before proceeding to Phase 3.

- [x] **B1** Household Self-Split FK Constraint
  - Migration 022 (`household_self_split`): Added `self_share_amount REAL` and `self_is_paid INTEGER` to `household_expenses`
  - App user can now participate in splits without needing a `hisaab_persons` record (avoids FK constraint)
  - Files: `database/migrations/022_household_self_split.ts`, `services/household-expense.ts`, `app/hisaab/household.tsx`

- [x] **B2** Yearly Plan Outflow Breakdown Missing
  - Plan Summary card showed only "Total Outflow" — added Expenses, Investments, Milestones detail rows before the total
  - File: `app/goals/yearly-plan.tsx`

- [x] **B3** Date Inputs — No Native Date Picker
  - All date fields were manual text inputs (YYYY-MM-DD). Created reusable `DateInput` component (152 lines) combining TextInput + native picker
  - New: `components/ui/DateInput.tsx` (exported from `components/ui/index.ts`)
  - New dep: `@react-native-community/datetimepicker`
  - Updated 7 screens: `milestones.tsx`, `milestone-detail.tsx`, `investment-detail.tsx`, `ledger.tsx` (2 fields), `add.tsx`, `[id].tsx`, `settings.tsx` (2 fields)

- [x] **B4** Household Expense Creation FK Constraint
  - Creating household expenses failed due to FK constraints on person splits
  - Fixed validation and creation flow in `services/household-expense.ts`
  - File: `app/hisaab/household.tsx`

- [x] **B5** Budget Forecast Matching Edge Cases
  - Expense filter queries had edge cases with multi-select account/category/payment mode filtering
  - File: `services/expense.ts`, `app/(tabs)/budget.tsx`

- [x] **B6** Tag Picker Keyboard Covering Content
  - When opening TagPicker on expense add/edit screens, the keyboard covered the dropdown
  - Added `onOpen` prop to TagPicker, ScrollView refs + `scrollToEnd()` with 150ms delay
  - Files: `components/expense/TagPicker.tsx`, `app/expense/add.tsx`, `app/expense/[id].tsx`

- [x] **B7** SMS Listener Edge Cases
  - Improved error handling and edge case coverage in SMS background processing
  - Files: `services/sms/sms-listener.ts`, `services/sms/sms-to-expense.ts`

- [x] **B8** SMS Parser Improvements
  - Minor parsing fix for edge case merchant detection
  - File: `services/sms/sms-parser.ts`

- [x] **B9** Insights & Settings Layout Fixes
  - Stack header styles inconsistent with design system (missing theme tokens)
  - Files: `app/insights/_layout.tsx`, `app/settings/_layout.tsx`

- [x] **B10** Salary Calculator FY Isolation + Copy-Forward
  - **FY Isolation Bug:** Saving income for one FY overwrote all FYs. Root cause: `getSalaryProfileByPlanId` fallback loaded a profile from a different FY, then UPDATE overwrote it instead of CREATE. Fixed by removing the fallback and resetting form on FY change.
  - **Copy-Forward Feature:** When no profile exists for selected FY but previous FY has data, shows "Copy As-Is" or "Copy with Hike %" options. Hike applies to CTC only. Populates form for review (no auto-save).
  - File: `app/goals/salary-calculator.tsx` (+195 lines)

**Test impact:** +8 new tests (974 → 982), 34 files changed, 1 new migration, 1 new component, 1 new dependency

---

## Phase 3: Statement Reconciliation (F5) — 10 tasks

- [ ] **V3-3.1** Migration 023 — `statement_imports` + `statement_entries` tables
- [ ] **V3-3.2** Bank Statement Parser (`services/statement-parser.ts`)
- [ ] **V3-3.3** Reconciliation Matching Engine (`services/reconciliation.ts`)
- [ ] **V3-3.4** Import Screen (`app/reconciliation/index.tsx`)
- [ ] **V3-3.5** Results Screen (`app/reconciliation/results.tsx`)
- [ ] **V3-3.6** Create Expenses from Unmatched Statement Entries
- [ ] **V3-3.7** Reconciliation History (`app/reconciliation/history.tsx`)
- [ ] **V3-3.8** Wire to Home + Navigation
- [ ] **V3-3.9** Bank Format Presets (`constants/bank-statement-formats.ts`)
- [ ] **V3-3.10** Phase 3 Tests (~30 new tests)

## Phase 4: Credit Card & Membership Recommendation Engine (F4) — 12 tasks

- [ ] **V3-4.1** Credit Card Database (`constants/credit-cards.ts`)
- [ ] **V3-4.2** Membership/Loyalty Database (`constants/memberships.ts`)
- [ ] **V3-4.3** Category-to-MCC Mapping (`services/category-mcc-mapper.ts`)
- [ ] **V3-4.4** Spending Pattern Analyzer (`services/spending-analyzer.ts`)
- [ ] **V3-4.5** Recommendation Engine Core (`services/recommendation-engine.ts`)
- [ ] **V3-4.6** Membership Recommendation (add to recommendation engine)
- [ ] **V3-4.7** Advisor Hub Screen (`app/advisor/index.tsx`)
- [ ] **V3-4.8** Card Recommendations Screen (`app/advisor/card-recommendations.tsx`)
- [ ] **V3-4.9** Analyze My Card Screen (`app/advisor/analyze-card.tsx`)
- [ ] **V3-4.10** Membership Recommendations Screen (`app/advisor/memberships.tsx`)
- [ ] **V3-4.11** Disclaimers & Legal (`constants/disclaimers.ts`)
- [ ] **V3-4.12** Phase 4 Tests (~40 new tests)

## Phase 5: Play Store Publishing + Business Plan (F3) — 6 tasks

- [ ] **V3-5.1** Privacy Policy Screen (`app/settings/privacy-policy.tsx`)
- [ ] **V3-5.2** Terms of Service Screen (`app/settings/terms-of-service.tsx`)
- [ ] **V3-5.3** Business Plan Document (`docs/V3/BUSINESS_PLAN.md`)
- [ ] **V3-5.4** App Store Assets (descriptions, feature list, content rating)
- [ ] **V3-5.5** Premium Gate — Optional (`services/premium.ts` + `components/ui/PremiumGate.tsx`)
- [ ] **V3-5.6** Phase 5 Tests (~10 new tests)

## Phase 6: Testing, Documentation & APK Build — 4 tasks

- [ ] **V3-6.1** Cross-Feature Integration Tests (~20 new tests)
- [ ] **V3-6.2** V3 Documentation (PRD, TDD, update CLAUDE.md)
- [ ] **V3-6.3** V3 APK Build (version 3.0.0)
- [ ] **V3-6.4** Play Store Prep — Optional (signed AAB, listing draft)

---

## Business Presentation (Post V3-Build)

After all phases, create `docs/V3/BUSINESS_PRESENTATION.md` using PM skills:
- Value Proposition, User Personas, Competitive Analysis, SWOT, Customer Journey, TAM/SAM/SOM, GTM, Elevator Pitch

---

## V4 Forward Look

V4 feature backlog is documented at `docs/V4/V4_FEATURE_BACKLOG.md`. Key themes:
- **Master Data Management** — Editable merchant name mappings, account-payment mode linking (one account → many modes), account editing on expenses
- **Insights Enhancements** — Week-on-week comparison, custom date range comparison (pick any two periods)
- **Transaction Timestamps** — Time precision on detail pages (auto-detected from SMS, start-of-day for manual), timestamps immutable on edit

V4 work begins only after all V3 phases (3-6) are complete.
