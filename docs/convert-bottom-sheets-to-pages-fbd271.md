# Convert Bottom Sheets to Full Pages

Convert all keyboard-heavy bottom sheets to full-page forms for better UX, improved keyboard handling, and design system adherence.

## Comprehensive Analysis

### Bottom Sheets WITH Keyboard Input (Convert to Pages)
1. **Loan Prepayment** - `components/loans/PrepaymentSheet.tsx`
   - Inputs: Amount, date, strategy toggle, override charges
   - Used from: `app/loans/[id].tsx`

2. **Simulator Entry** - `components/simulator/EntryEditSheet.tsx`
   - Inputs: Amount, date, account, category, merchant, description, person, transfer
   - Used from: `app/simulator/[id].tsx`

3. **Split Expense** - `components/expense/SplitSheet.tsx`
   - Inputs: Person name (new person), exact amount, percentage
   - Used from: `app/expense/add.tsx`, expense detail, review queue

4. **Recurring Rule** - `components/expense/RecurringRuleSheet.tsx`
   - Inputs: Notes field (multiline)
   - Used from: `app/expense/[id].tsx`

5. **Multi-Split Expense** - `components/expense/MultiSplitSheet.tsx`
   - Inputs: Person name, description, amount per split
   - Used from: `app/expense/add.tsx`

6. **Loan Manual Correction** - `components/loans/ManualCorrectionSheet.tsx`
   - Inputs: Outstanding principal, EMI, tenure, reason
   - Used from: `app/loans/[id].tsx`

7. **Hisaab Inclusion** - `components/simulator/HisaabInclusionSheet.tsx`
   - Inputs: Percentage and amount per person
   - Used from: `app/simulator/[id].tsx`

8. **Pattern Edit** - `components/analytics/PatternEditSheet.tsx`
   - Inputs: Amount, expected day
   - Used from: Analytics pages

### Bottom Sheets WITHOUT Keyboard Input (Keep as Sheets)
- All picker sheets (AccountPicker, CategoryPicker, etc.) - Selection only
- `LinkExpenseSheet` - List selection only
- `ForeclosureQuoteSheet` - Read-only quote display
- `StaleEntryResolveSheet` - Calendar picker only, no text input

## Design System & Page Patterns

### Target Pattern (from existing form pages)
Based on `app/loans/add.tsx`, `app/expense/add.tsx`, `app/settings/smart-rules/[id].tsx`:

**Structure:**
```
ScreenContainer (padTop={false} keyboardAware)
  └─ ScrollView
      ├─ Header (back button, title)
      ├─ Form sections (Card components)
      │   ├─ Input fields (using Input component)
      │   ├─ Toggle/Select components
      │   └─ Helper text
      └─ Save/Cancel buttons (fixed at bottom)
```

**Key Components:**
- `ScreenContainer` with `keyboardAware={true}` for keyboard handling
- `ScrollView` with `keyboardShouldPersistTaps="handled"`
- `Card` for grouping related fields
- `Input` for text/number inputs
- `Toggle` for binary choices
- `Button` for save/cancel actions
- `router.push()` for navigation, `router.back()` to return

**Navigation Pattern:**
- Pass data via URL params (`useLocalSearchParams()`)
- On submit: save data → `router.back()`
- On cancel: `router.back()`

## Implementation Plan

### Phase 1: High-Priority (User-identified)
1. **Loan Prepayment Page**
   - Create: `app/loans/[id]/prepayment.tsx`
   - Convert from `PrepaymentSheet` component
   - Route: `/loans/[id]/prepayment`
   - Params: `loanId`, optional `prepaymentId` (for edit)
   - Header: "Record Prepayment" / "Edit Prepayment"
   - Form: Amount, date picker, strategy toggle, override charges section
   - Call site: `app/loans/[id].tsx` → `router.push({ pathname: "/loans/[id]/prepayment", params: { loanId } })`

2. **Simulator Entry Page**
   - Create: `app/simulator/[id]/add-entry.tsx`
   - Convert from `EntryEditSheet` component
   - Route: `/simulator/[id]/add-entry`
   - Params: `scenarioId`, optional `entryId` (for edit)
   - Header: "Add Entry" / "Edit Entry"
   - Form: Flavor chips, amount, date, account picker, category, merchant, description, person picker
   - Call site: `app/simulator/[id].tsx` → `router.push({ pathname: "/simulator/[id]/add-entry", params: { scenarioId, entryId } })`

### Phase 2: Medium-Priority
3. **Split Expense Page**
   - Create: `app/expense/split.tsx`
   - Convert from `SplitSheet` component
   - Route: `/expense/split`
   - Params: `expenseId`, `totalAmount`, `preselectedPersonId?`, `lockedMode?`
   - Header: "Split Expense"
   - Form: Multi-step (Paid by → Split mode → Person selection → Preview)
   - Call sites: Expense add, detail, review queue

4. **Multi-Split Expense Page**
   - Create: `app/expense/multi-split.tsx`
   - Convert from `MultiSplitSheet` component
   - Route: `/expense/multi-split`
   - Params: `expenseId`, `totalAmount`
   - Header: "Multi-Split Expense"
   - Form: Add/remove splits, person picker, amount per split, description, fee handling
   - Call site: Expense add page

### Phase 3: Lower-Priority
5. **Recurring Rule Page**
   - Create: `app/expense/[id]/reminder.tsx`
   - Convert from `RecurringRuleSheet` component
   - Route: `/expense/[id]/reminder`
   - Params: `expenseId`, `defaultStartDate`, optional `ruleId` (for edit)
   - Header: "Set Reminder" / "Edit Reminder"
   - Form: Frequency chips, start date, end date, notes
   - Call site: `app/expense/[id].tsx`

6. **Loan Manual Correction Page**
   - Create: `app/loans/[id]/correction.tsx`
   - Convert from `ManualCorrectionSheet` component
   - Route: `/loans/[id]/correction`
   - Params: `loanId`, optional `correctionId` (for edit)
   - Header: "Manual Correction" / "Edit Correction"
   - Form: Effective date, outstanding principal, EMI, tenure, reason
   - Call site: `app/loans/[id].tsx`

7. **Hisaab Inclusion Page**
   - Create: `app/simulator/[id]/hisaab-inclusion.tsx`
   - Convert from `HisaabInclusionSheet` component
   - Route: `/simulator/[id]/hisaab-inclusion`
   - Params: `scenarioId`
   - Header: "Include Hisaab Balances"
   - Form: List of persons with toggle, %/amount inputs per person
   - Call site: `app/simulator/[id].tsx`

8. **Pattern Edit Page**
   - Create: `app/analytics/pattern/[id]/edit.tsx`
   - Convert from `PatternEditSheet` component
   - Route: `/analytics/pattern/[id]/edit`
   - Params: `patternId`
   - Header: "Edit Pattern"
   - Form: Amount, frequency, expected day
   - Call site: Analytics pages

## Page Design Specifications

### Standard Form Page Layout
```
┌─────────────────────────────────────┐
│ ← Back    Title (bold, large)       │
├─────────────────────────────────────┤
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ Card 1: Primary Inputs          │ │
│ │ • Input field (label + value)    │ │
│ │ • Input field (label + value)    │ │
│ │ • Helper text (optional)         │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ Card 2: Secondary Inputs        │ │
│ │ • Toggle/Select                 │ │
│ │ • Date picker                   │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [Preview/Summary card if needed]   │
│                                     │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ [Cancel]  [Save]                │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### Component Usage
- **Header**: `View` with back button (`Ionicons` chevron-back) and `Text` title
- **Cards**: `Card` component for grouping related fields
- **Inputs**: `Input` component with label, placeholder, keyboardType
- **Date Picker**: Pressable with CalendarModal
- **Toggles**: `Toggle` component from goals or custom implementation
- **Buttons**: `Button` component (outline for cancel, filled for save)
- **Spacing**: 4px (mx-4) horizontal, 3-4px (my-3/my-4) vertical between cards

### Color Scheme
- Surface colors from `useColorScheme()`
- Accent color for primary actions
- Border colors for inputs and cards
- Text colors: primary (labels), secondary (placeholders/helpers)

## Files Modified
**New Pages (8):**
- `app/loans/[id]/prepayment.tsx`
- `app/simulator/[id]/add-entry.tsx`
- `app/expense/split.tsx`
- `app/expense/multi-split.tsx`
- `app/expense/[id]/reminder.tsx`
- `app/loans/[id]/correction.tsx`
- `app/simulator/[id]/hisaab-inclusion.tsx`
- `app/analytics/pattern/[id]/edit.tsx`

**Updated Call Sites:**
- `app/loans/[id].tsx` (prepayment, correction)
- `app/simulator/[id].tsx` (entry, hisaab inclusion)
- `app/expense/add.tsx` (split, multi-split)
- `app/expense/[id].tsx` (reminder)
- Analytics pages (pattern edit)

**Deprecated Components (can delete after migration):**
- `components/loans/PrepaymentSheet.tsx`
- `components/simulator/EntryEditSheet.tsx`
- `components/expense/SplitSheet.tsx`
- `components/expense/RecurringRuleSheet.tsx`
- `components/expense/MultiSplitSheet.tsx`
- `components/loans/ManualCorrectionSheet.tsx`
- `components/simulator/HisaabInclusionSheet.tsx`
- `components/analytics/PatternEditSheet.tsx`
