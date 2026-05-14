# Testing Strategy

## Overview

- **Framework:** Jest + jest-expo
- **UI Testing Library:** @testing-library/react-native
- **E2E:** Maestro (placeholder — `.maestro/.gitkeep` exists, not actively used)
- **Total Test Files:** 69 (55 unit + 14 integration)
- **Total Tests:** 1335+ passing

## Test Structure

```
__tests__/
├── unit/                    # Pure function tests (no DB)
│   ├── loan-engine.test.ts
│   ├── simulator-engine.test.ts
│   ├── smart-rules-evaluator.test.ts
│   ├── sms-parser.test.ts
│   ├── sms-template-compiler.test.ts
│   ├── expense-validation.test.ts
│   ├── budget-helpers.test.ts
│   ├── yoy-comparison.test.ts
│   ├── duplicate-detection.test.ts
│   └── ... (55 files)
├── integration/             # DB-backed tests
│   ├── database.test.ts     # Migration count verification
│   ├── expense.test.ts      # Full expense CRUD cycle
│   ├── backup.test.ts       # Backup/restore round-trip
│   ├── simulator.test.ts    # Scenario lifecycle
│   ├── yearly-plan.test.ts  # Plan + bucket operations
│   └── ... (14 files)
└── fixtures/                # Shared test data
```

## Running Tests

```bash
# All tests
npx jest

# Specific file
npx jest __tests__/unit/loan-engine.test.ts

# Pattern match
npx jest --testPathPattern="simulator"

# Watch mode
npx jest --watch
```

## Test Categories

### Unit Tests (no DB, no mocks of DB)
- Pure mathematical functions (loan engine, tax engine, forecast)
- Validators (expense validation, date formatting)
- Classifiers (SMS parser, spending classifier)
- Comparators (YoY comparison, budget compliance)
- Template compilers (SMS template regex compilation)
- Detection algorithms (duplicate detection, recurring patterns)

### Integration Tests (mock DB via jest mock)
- Full CRUD cycles with FK cascade verification
- Migration count verification (ensures new migrations registered)
- Backup/restore round-trip
- Multi-service interactions
- Simulator lifecycle (scenarios, entries, reconciliation)

## Key Testing Patterns

### Mock Database
```typescript
const mockDb = {
  runAsync: jest.fn(),
  getFirstAsync: jest.fn(),
  getAllAsync: jest.fn(),
  withTransactionAsync: jest.fn(async (fn) => { await fn(); }),
  execAsync: jest.fn(),
};
```

### Mock Expense Object
Must include ALL required fields from TABLE_SCHEMAS. When new columns are added via migration, test mocks must be updated.

### Service Mocking
```typescript
jest.mock("@/services/expense-crud", () => ({
  createExpense: jest.fn(),
  updateExpense: jest.fn(),
}));
```

## What Gets Tested

| Area | Coverage |
|------|----------|
| Loan amortization math | Comprehensive (edge cases, prepayments, rounding) |
| SMS parsing | Per-bank fixtures, normalization pipeline |
| Budget calculations | Rolling surplus, projection, compliance |
| Expense validation | Required fields, amount formats, date validation |
| Duplicate detection | Sign guardrail, tolerance, grouping |
| Simulator engine | Fulfillment matching, warning generation |
| Smart rules | Condition evaluation, action application |
| Template compiler | Regex generation from tagged spans |
| YoY comparison | Category scoring, gap semantics |
| Biometric lock | Decision tree for when to lock |

## What Is NOT Tested (gaps)

- UI rendering (components not snapshot-tested)
- E2E flows (Maestro placeholder only)
- SMS reader (hardware-dependent)
- Notification scheduling (OS-dependent)
- File system operations (backup encryption)
- Navigation flows

## Test Quality Rules

1. **No flaky tests** — Tests must be deterministic (no Date.now() without mocking)
2. **Mock boundaries** — Mock at the service/DB boundary, not internal helpers
3. **Fixture reuse** — Shared fixtures in `__tests__/fixtures/`
4. **Migration tracking** — `database.test.ts` verifies exact migration count (catches unregistered migrations)
5. **Regression tests** — Every user-reported bug gets a test before the fix
