# Test baseline — recorded at the start of the design revamp

Measured on `master` @ `052aa1c`, **before** any revamp commit, with the working tree stashed.

```
Test Suites: 15 failed, 60 passed, 75 total
Tests:       24 failed, 1356 passed, 1380 total
```

## Why this file exists

The revamp's safety net is *"this is a UI-only change, so if `npx jest` goes red we touched logic
we shouldn't have."* That invariant is worthless against an already-red suite — a real regression
would hide among failures everyone has learned to ignore.

So the rule is **the failure set must not grow**, not "the suite must be green":

```bash
npx jest 2>&1 | grep '^FAIL' | sort -u
```

Compare against the list below. A suite appearing that is not on this list is a regression
introduced by the revamp and must be investigated before the commit lands.

## Known-failing suites (pre-existing, unrelated to the revamp)

- `__tests__/integration/budget.test.ts`
- `__tests__/integration/category.test.ts`
- `__tests__/integration/database.test.ts`
- `__tests__/integration/expense.test.ts`
- `__tests__/integration/forecast-matching.test.ts`
- `__tests__/integration/payment-mode.test.ts`
- `__tests__/integration/pension-account-user-journey.test.ts`
- `__tests__/integration/v5-cross-feature.test.ts`
- `__tests__/unit/expense-validation.test.ts`
- `__tests__/unit/notification-scheduler.test.ts`
- `__tests__/unit/pension-account-progression.test.ts`
- `__tests__/unit/pension-account-regression.test.ts`
- `__tests__/unit/public-data-seed.test.ts`
- `__tests__/unit/smart-categorizer.test.ts`
- `__tests__/unit/ui-guard-rails.test.ts`

These are logic/fixture failures in the SQLite-backed integration tests and a few unit suites.
They are **not** part of the revamp's scope and are deliberately left alone — fixing them would
mix behavioural changes into a UI-only branch. Worth a separate pass afterwards.
