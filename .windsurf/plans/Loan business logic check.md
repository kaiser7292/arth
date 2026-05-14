# Loan Correction and Prepayment Business Logic Analysis

Analysis of manual correction and prepayment logic in loans to identify business logic gaps and complexity issues with improvement recommendations.

## Current Implementation

### Manual Correction (correction.tsx + loan-accounts.ts)
- Allows overriding outstanding principal, EMI amount, and tenure remaining
- Validates EMI > monthly interest
- Regenerates schedule from correction date forward
- Has deactivate functionality (soft delete)

### Prepayment (prepayment.tsx + loan-accounts.ts)
- Part-payment or foreclosure
- Strategy: reduce_tenure or reduce_emi
- Computes impact preview (charge, GST, net applied, interest saved, months saved/new EMI)
- Allows charge override
- Regenerates full schedule on save
- For small prepayments (< current EMI), automatically uses reduce_tenure

## Business Logic Gaps

### Validation Gaps
- **No future date validation** - Can set correction/prepayment dates in the future
- **No amount limit validation** - Prepayment amount can exceed outstanding principal
- **No date conflict validation** - Can set correction date before disbursement or after loan closure
- **No duplicate detection** - Can create multiple corrections/prepayments on same date
- **No charge validation** - Charge + GST can exceed prepayment amount (net applied becomes negative)
- **No tenure consistency check** - tenure_remaining may not match outstanding + EMI combination

### Business Logic Gaps
- **No audit trail** - No tracking of who made corrections/prepayments and when
- **No correction history** - Can't view historical corrections on loan detail page
- **No edit support for corrections** - Only deactivate and recreate (can't modify existing)
- **No partial EMI support** - Can't handle shortfalls or excess EMI payments
- **No interest-only payments** - Can't record interest-only EMI periods
- **No rate change corrections** - Only outstanding/EMI/tenure overrides, not interest rate changes
- **No planned vs actual** - No distinction between planned and actual prepayments
- **No reconciliation** - No integration with bank statements for verification

### UX Gaps
- **No schedule preview for corrections** - Can't see new schedule before saving
- **No schedule preview for prepayments** - Can't see impact on future installments
- **No warning for overlapping corrections** - Multiple corrections on same period can conflict
- **No confirmation dialog** - Schedule regeneration happens without user awareness
- **No correction history view** - Can't see what corrections exist before adding new ones

### Data Integrity Gaps
- **No conflict detection** - Corrections can conflict with paid installments
- **No constraint enforcement** - DB lacks constraints for date ranges and amounts
- **No consistency checks** - No verification that schedule matches corrections/prepayments

## Complexity Issues

### Performance Complexity
- **Full schedule regeneration** - Every correction/prepayment triggers complete schedule rebuild (expensive for 360+ month loans)
- **No incremental updates** - Always full rebuild instead of targeted updates
- **Impact computation on every keystroke** - `computePrepaymentImpact` called without debouncing
- **N+1 queries** - Multiple DB calls for schedule, prepayments, corrections

### Data Transformation Complexity
- **Multiple type conversions** - toScheduleEngineType, toPrepaymentEngineType, toCorrectionEngineType
- **Parameter mapping** - loanToParams, loanToTerms transformations
- **Repeated transformations** - Same data converted multiple times across layers

### State Management Complexity
- **Complex UI state** - Prepayment form has overrideExpanded, chargeOverride, gstOverride
- **Conditional strategy visibility** - Toggle shown/hidden based on amount vs EMI
- **Impact computation dependencies** - Depends on schedule, prepayments, loan params, date
- **Split validation logic** - Some in UI, some in service layer

### Validation Complexity
- **Scattered validation** - validateCorrection function has complex rules not in UI
- **No validation schema** - No centralized validation rules
- **Mixed validation approaches** - Some fields validated in UI, some in service

## Improvement Recommendations

### 1. Add Missing Validation (High Priority)
```typescript
// Add to validateCorrection and prepayment logic
- effective_date must be <= today
- prepayment_date must be <= today
- prepayment amount must be <= outstanding principal
- prepayment amount must be > 0
- charge + gst must be <= prepayment amount
- Check for duplicate corrections/prepayments on same date
- Check for conflicts with paid installments