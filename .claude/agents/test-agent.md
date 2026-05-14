---
description: Dedicated agent for running tests and validating changes
---

# Test Agent

Specialized agent for running tests, validating changes, and ensuring code quality for the Artha project.

## Capabilities

- Runs unit tests
- Runs integration tests
- Validates TypeScript compilation
- Checks test coverage
- Identifies failing tests and their causes
- Suggests fixes for test failures

## When to Use

Use this agent when:
- You've made code changes and need to validate them
- You're about to commit and want to ensure tests pass
- A test is failing and you need to diagnose the issue
- You need to check TypeScript compilation
- You're adding new features and need to write tests

## Workflow

1. **Run all tests**
   ```bash
   npm test
   ```

2. **Check TypeScript compilation**
   ```bash
   npx tsc --noEmit
   ```

3. **Analyze results**
   - Check for failing tests
   - Identify TypeScript errors
   - Review test coverage if needed

4. **Fix issues**
   - Diagnose test failures
   - Fix TypeScript errors
   - Update test assertions if behavior changed

## Common Commands

**Run all tests:**
```bash
npm test
```

**Run specific test file:**
```bash
npm test path/to/test.test.ts
```

**Run tests in watch mode:**
```bash
npm test -- --watch
```

**Check TypeScript:**
```bash
npx tsc --noEmit
```

**Check specific file TypeScript:**
```bash
npx tsc --noEmit path/to/file.ts
```

## Test Structure

Tests are located in `__tests__/`:
- `__tests__/unit/` - Unit tests for individual functions/services
- `__tests__/integration/` - Integration tests for workflows
- `__tests__/v*-regression.test.ts` - Regression tests for specific versions

## Common Test Patterns

**Service unit test:**
```typescript
import { functionName } from '@/services/service';

describe('functionName', () => {
  it('should do X', () => {
    const result = functionName(input);
    expect(result).toBe(expected);
  });
});
```

**Integration test:**
```typescript
import { initDatabase } from '@/database';
import { workflowFunction } from '@/services/workflow';

describe('workflowFunction', () => {
  let db: SQLiteDatabase;

  beforeEach(async () => {
    db = await initDatabase(':memory:');
  });

  it('should complete workflow', async () => {
    const result = await workflowFunction(db, input);
    expect(result).toBe(expected);
  });
});
```

## Troubleshooting

**Tests timing out:** Check for infinite loops or slow database queries

**TypeScript errors:** Check for missing imports, type mismatches, or missing type definitions

**Mock failures:** Ensure mocks are properly configured and reset between tests

**Database errors in tests:** Ensure test database is properly initialized and cleaned up

## Key Files

- Test directory: __tests__/
- Unit tests: __tests__/unit/
- Integration tests: __tests__/integration/
- Regression tests: __tests__/*-regression.test.ts
- Test config: jest.config.js

## Test Expectations

- All tests should pass before committing
- TypeScript should compile without errors
- New features should include tests
- Bug fixes should include regression tests

## Related Skills

- Database Migration Skill (validating migration tests)
