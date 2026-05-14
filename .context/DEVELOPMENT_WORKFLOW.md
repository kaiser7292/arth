# Development Workflow

## Session Workflow

1. Read CLAUDE.md (project context file at repo root)
2. Check "Current in-flight work" and version roadmap sections
3. For shipped versions, consult `docs/V<n>/` (PRD/TDD/MASTER_PLAN)
4. Propose changes, wait for approval, then execute
5. After completing: update roadmap, run tests, bump version if needed

## Rules of Engagement

1. **Propose before coding** — Always propose code changes and get approval before editing
2. **One task at a time** — Complete fully before starting the next
3. **Read before coding** — Understand the relevant service/screen files first
4. **Test on each task** — Run tests after every change
5. **Data refresh mandatory** — Every DB write MUST call `bumpDataVersion()` so screens auto-refresh
6. **No speculation** — If a referenced doc can't be found, STOP and ask

## Testing

### Run Tests
```bash
cd ~/accounts-manager-app && npx jest
```

### Run Specific Test
```bash
npx jest __tests__/unit/loan-engine.test.ts
```

### TypeScript Check
```bash
npx tsc --noEmit
```

### Test Coverage
- **69 test files** total (55 unit + 14 integration)
- **1335+ tests** passing (as of v17.5.26)
- Unit tests: pure function testing (engines, validators, formatters)
- Integration tests: DB-backed tests with mock SQLite

### Test Conventions
- Unit tests in `__tests__/unit/`
- Integration tests in `__tests__/integration/`
- Fixtures in `__tests__/fixtures/`
- Mock DB objects must include all required fields (check TABLE_SCHEMAS)
- Jest preset: `jest-expo`

## Code Style

### Formatter: Prettier
```json
{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "trailingComma": "all",
  "printWidth": 80,
  "bracketSpacing": true
}
```

### Linter: ESLint (Expo config)
```bash
npx expo lint
```

### TypeScript
- `strict: true`
- Path alias: `@/*` → `./*`
- Extends: `expo/tsconfig.base`

### Import Conventions
```typescript
// External packages first
import { View, Text } from "react-native";
import { router } from "expo-router";

// Internal imports with @ alias
import { formatAmount } from "@/utils/format";
import { Card } from "@/components/ui";
import { createExpense } from "@/services/expense-crud";
```

## Key Patterns

### Service Layer
- All business logic in `services/` directory
- Services handle DB reads/writes, never UI components
- Every mutation ends with `bumpDataVersion()`
- Error handling: throw descriptive errors, catch in UI

### Screen Pattern
```typescript
export default function ScreenName() {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const { dataVersion } = useDataRefresh();

  useFocusEffect(useCallback(() => {
    loadData();
  }, [dataVersion]));

  async function loadData() { /* service calls */ }

  if (!loaded) return <Loading />;
  return <ScreenContainer>...</ScreenContainer>;
}
```

### Data Mutation Pattern
```typescript
// In service file
export async function updateSomething(id: string, data: Partial<Thing>) {
  const db = getDatabase();
  await db.runAsync(`UPDATE things SET ... WHERE id = ?`, [...values, id]);
  bumpDataVersion(); // CRITICAL — triggers UI refresh
}
```

### Bottom Sheet Pattern
- Complex inputs use slide-up BottomSheet components
- Sheets are separate components in `components/` subdirectories
- Parent passes `visible` + `onDismiss` + `onSubmit` props
- Sheet handles its own internal state

## Checklist After Every Code Change

1. **Hardcoding** — No hex colors, magic numbers, or locale assumptions
2. **Design system** — Uses theme tokens, proper typography scale, Card/Button components
3. **Data integrity** — bumpDataVersion() called, FK cascades maintained
4. **Documentation** — CLAUDE.md updated with session notes if significant
5. **Tests** — Relevant test suites pass, mocks updated for new columns
6. **Architecture** — No N+1 queries, proper async, no UI-thread blocking
7. **Security** — Parameterized SQL, no string interpolation in queries

## File Naming

- Screens: kebab-case (expo-router convention): `account-ledger.tsx`
- Services: kebab-case: `expense-crud.ts`, `loan-engine.ts`
- Components: PascalCase: `PrepaymentSheet.tsx`, `DonutChart.tsx`
- Utils: kebab-case: `format.ts`, `date.ts`
- Constants: kebab-case: `theme.ts`, `routes.ts`
- Tests: match source with `.test.ts` suffix
