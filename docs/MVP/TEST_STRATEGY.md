# Test Strategy

**Version:** 0.1 (Draft)
**Author:** Sourav Baid + Claude
**Date:** 2026-04-12
**Related:** [PRD](PRD.md) | [TDD](TDD.md) | [DevOps & SDLC](DEVOPS.md) | [Security](SECURITY.md)

---

## 1. Testing Philosophy

- **Correctness over coverage** — Test what matters (calculations, parsing, data integrity), not boilerplate.
- **Local-only** — No test servers, no mocked APIs for most tests. SQLite is the database, test against it directly.
- **Fast feedback** — Unit tests run in <10 seconds. E2E tests run against a real APK on Android.
- **Performance is not a concern** — 100K-250K transactions/year is well within SQLite's comfort zone. No load testing needed.

---

## 2. Testing Pyramid

```
                    ┌─────────┐
                    │  Manual  │   ← You test on Android phone
                    │  (Phone) │      5-10 scenarios per feature
                    ├─────────┤
                  ┌─┤   E2E   ├─┐   ← Maestro flows
                  │ │(Maestro)│ │     10-20 critical user journeys
                  │ ├─────────┤ │
                ┌─┤ │  Integ- │ ├─┐  ← Service layer tests
                │ │ │  ration │ │ │    SQLite + parsers + calculators
                │ │ ├─────────┤ │ │
              ┌─┤ │ │  Unit   │ │ ├─┐ ← Pure functions, parsers, formatters
              │ │ │ │  Tests  │ │ │ │   Majority of tests here
              └─┴─┴─┴─────────┴─┴─┴─┘
```

| Level | Tool | Count Target | Run Time | What It Tests |
|-------|------|-------------|----------|---------------|
| **Unit** | Jest + React Native Testing Library | 100-200 tests | <10 sec | Pure functions, calculations, formatters, parsers |
| **Integration** | Jest + expo-sqlite (in-memory) | 30-50 tests | <30 sec | Service layer with real SQLite, multi-table operations |
| **E2E** | Maestro | 10-20 flows | 5-10 min | Full user journeys on Android emulator or device |
| **Manual** | You on Android phone | 5-10 per feature | 15-30 min | Real-world testing, UX feedback, edge cases |

---

## 3. What to Test at Each Level

### 3.1 Unit Tests (Jest)

**Test these — they're the core logic:**

| Area | What to Test | Examples |
|------|-------------|---------|
| **SMS Parsing** | Extract amount, merchant, date from bank SMS text | ICICI debit SMS → Rs 500, Swiggy, 12-Apr-26 |
| **Forecast Parsing** | Extract amount, due_date, type from reminder SMS | SI reminder → Rs 199, NETFLIX, due 09-Apr-26, isForecast=true |
| **Forecast Matching** | Debit SMS matched to existing forecast | Rs 199 NETFLIX debit → matches open forecast → nature flips to realized |
| **Email Parsing** | Extract financial data from email body | CAMS statement → fund name, units, NAV, value |
| **Smart Categorization** | Merchant keyword → category mapping | "SWIGGY" → Food, "SHELL" → Car & Vehicles |
| **Budget Calculations** | Actuals vs budget, remaining, per-day budget | Budget Rs 18K, spent Rs 12K, 10 days left → Rs 600/day |
| **Goal Calculations** | Savings rate, course correction, trajectory | Target 25%, actual 20%, 8 months left → save Rs X extra |
| **Investment-Milestone Linking** | Bucket contribution auto-updates linked milestone progress | Add Rs 10K to "House Fund" bucket → "House Down Payment" milestone current_saved increments by Rs 10K |
| **Tax Slab Calculation** | New & Old regime tax for given taxable income | CTC Rs 18L → taxable ~Rs 12.5L → New regime tax ~Rs 82.5K (after rebate/cess) |
| **87A Rebate Edge Cases** | Rebate boundary at Rs 12L taxable (New regime) | Taxable Rs 12,00,000 → full rebate Rs 60K; Taxable Rs 12,00,001 → NO rebate |
| **EPF Calculations** | Full basic vs restricted mode | Basic Rs 6L → Full: Rs 72K/yr, Restricted: Rs 21,600/yr (12% of Rs 1,800 × 12) |
| **CTC Breakdown** | Split CTC into components | CTC Rs 18L, 40% Basic → Basic 7.2L, HRA 3.6L, EPF 86.4K, Gratuity 34.6K, Special = remainder |
| **Surcharge Thresholds** | Correct surcharge at income boundaries | Income Rs 50L → 0%, Rs 50.01L → 10%, Rs 1Cr → 15%, Rs 2Cr → 25% |
| **Professional Tax Lookup** | State-based PT rates | Maharashtra → Rs 2,500/yr, Karnataka → Rs 2,400/yr, Delhi → Rs 0 |
| **Formatters** | Currency formatting, date formatting | 1500.50 → "Rs 1,500.50", date → "12 Apr 2026" |
| **Validators** | Input validation for expense, budget, goal | Amount > 0, date is valid, category exists |
| **Backup encryption** | Encrypt/decrypt roundtrip | Data → encrypt → decrypt → same data |
| **Unknown Fallback** | Uncategorized merchant → Unknown category assigned | "RANDOM_MERCHANT_XYZ" → Unknown category, confidence: 0, source: "fallback" |
| **Pattern Expansion** | All 50+ bank patterns parse correctly | IDFC debit SMS → amount, card, date; Amex spend → amount, merchant |
| **Account Discovery** | SMS with card info creates/updates FinancialAccount | "ICICI Card XX3001" SMS → creates account with identifier "3001", bank "ICICI", type "credit_card" |
| **Refund Matching** | Refund SMS linked to original expense | Rs 500 refund to Card 3001 → finds original Rs 500 debit from Card 3001 within 30 days → links via FK |
| **NACH Parsing** | NACH debit/bounce SMS parsed correctly | "NACH debit Rs.199 from A/c XX1234 towards NETFLIX" → amount 199, merchant NETFLIX, type nach_debit |
| **Recurring Detection** | Expenses with consistent intervals detected | 3x Netflix Rs 199 at ~30-day intervals → monthly recurring detected, next_expected_date predicted |

**Don't test these at unit level:**
- UI rendering (covered by E2E)
- Navigation (covered by E2E)
- SQLite queries (covered by integration)
- Component styling

### 3.2 Integration Tests (Jest + SQLite)

**Test the service layer with real database operations:**

| Area | What to Test | Examples |
|------|-------------|---------|
| **Expense CRUD** | Create, read, update, delete with SQLite | Add expense → verify in DB → update → verify → delete |
| **Budget engine** | Actuals computed from real expense records | Insert 5 expenses → calculate budget compliance → verify totals |
| **Goal engine** | Savings rate from real income/expense data | Set plan, add expenses, verify savings rate calculation |
| **Review queue** | Approve/edit/reject changes record status | Create pending → approve → verify status = approved |
| **Investment-Milestone link** | Contributions auto-update milestone | Link bucket → add contribution → verify milestone current_saved incremented; delete contribution → verify decremented |
| **Salary profile CRUD** | Create, update, delete salary profiles | Create CTC profile → verify computed fields → update to direct mode → verify |
| **Merchant learning** | Category corrections update mappings | Wrong category → correct → verify mapping updated |
| **Backup/restore** | Full roundtrip — export and import | Create data → backup → wipe → restore → verify all data intact |
| **Template** | Export config, import on clean setup | Setup categories → export template → clean DB → import → verify |

### 3.3 E2E Tests (Maestro)

**Test critical user journeys on a real app:**

| Flow | Steps | Validates |
|------|-------|-----------|
| **Add manual expense** | Open app → tap "+" → fill amount, category → save → verify in list | F1: Manual entry works end-to-end |
| **Review queue approve** | Seed pending expense → open review → swipe right → verify approved | F4: Approve flow works |
| **Review queue reject** | Open review → swipe left → verify rejected, not in budget | F4: Reject flow works |
| **Budget view** | Add expenses → open budget → verify progress bars correct | F7: Budget dashboard accurate |
| **Set yearly plan** | Open goals → set plan → verify dashboard updates | F14: Yearly plan works |
| **Investment contribution** | Open bucket → add contribution → verify Goal/Done/Left | F16: Investment tracking works |
| **Backup & restore** | Add data → create backup → wipe → restore → verify | F13a: Backup roundtrip works |
| **Template save/load** | Setup categories → save template → reset → load template → verify | F13b: Template system works |
| **Onboarding flow** | Fresh install → complete all onboarding screens → reach home | Onboarding doesn't crash |
| **Settings changes** | Change category name → verify reflected in expense list | Settings propagate correctly |

### 3.4 Manual Testing (You on Android)

**What to check that automation can't:**

| Check | Why Manual |
|-------|-----------|
| **Touch targets** | Are buttons big enough? Can you easily tap categories? |
| **Text readability** | Is font size okay on your phone screen? |
| **SMS detection on real device** | Does it actually detect your real bank SMS? (Emulators can't test this) |
| **Email OAuth on real device** | Does Gmail OAuth flow work smoothly? Token persists? |
| **Swipe gestures** | Does approve/reject swiping feel natural? |
| **Dark mode** | Does it look good in dark mode? |
| **Battery impact** | Does background SMS/email monitoring drain battery? |
| **Notification behavior** | Do local notifications appear correctly? |
| **Data entry speed** | Can you add an expense in under 15 seconds? |
| **Overall "feel"** | Does the app feel responsive and pleasant to use? |

---

## 4. Test Tools

| Tool | Purpose | Install |
|------|---------|---------|
| **Jest** | Unit + integration test runner | Included with Expo |
| **React Native Testing Library** | Component rendering tests | `npm install --save-dev @testing-library/react-native` |
| **Maestro** | E2E mobile testing | `curl -fsSL "https://get.maestro.mobile.dev" \| bash` |
| **maestro-skill** | Generate Maestro flows from specs | Claude Code plugin |
| **expo-sqlite (in-memory)** | Integration test database | Use `:memory:` for test DB |

---

## 5. Test File Structure

```
__tests__/
├── unit/
│   ├── parsers/
│   │   ├── SmsParser.test.ts         # SMS text parsing
│   │   ├── BankPatterns.test.ts      # Bank-specific regex patterns
│   │   ├── ExpenseEmailParser.test.ts
│   │   ├── InvestmentEmailParser.test.ts
│   │   └── LiabilityEmailParser.test.ts
│   ├── categorization/
│   │   ├── RuleEngine.test.ts        # Keyword matching
│   │   └── LearningEngine.test.ts    # Correction tracking
│   ├── calculations/
│   │   ├── BudgetCalculator.test.ts  # Budget math
│   │   ├── SavingsRateTracker.test.ts
│   │   ├── CourseCorrection.test.ts
│   │   ├── TrajectoryAnalysis.test.ts
│   │   └── InvestmentTracker.test.ts
│   ├── formatters/
│   │   ├── CurrencyFormatter.test.ts
│   │   └── DateFormatter.test.ts
│   └── validators/
│       ├── ExpenseValidator.test.ts
│       └── GoalValidator.test.ts
├── integration/
│   ├── ExpenseService.test.ts        # CRUD + SQLite
│   ├── BudgetService.test.ts         # Budget engine + real data
│   ├── GoalService.test.ts           # Goal engine + real data
│   ├── ReviewQueue.test.ts           # Approve/reject flow
│   ├── MerchantLearning.test.ts      # Category correction learning
│   ├── BackupRestore.test.ts         # Full backup/restore cycle
│   └── TemplateSystem.test.ts        # Template export/import
└── fixtures/
    ├── sms-samples/                  # Real bank SMS text samples
    │   ├── icici.txt
    │   ├── hdfc.txt
    │   ├── sbi.txt
    │   └── axis.txt
    ├── email-samples/                # Sample email bodies
    │   ├── cams-statement.html
    │   ├── sip-confirmation.html
    │   ├── zerodha-contract.html
    │   └── cc-statement.html
    └── test-data/
        ├── sample-expenses.json
        ├── sample-budgets.json
        └── sample-goals.json

.maestro/
├── flows/
│   ├── 01-onboarding.yaml
│   ├── 02-add-expense.yaml
│   ├── 03-review-queue.yaml
│   ├── 04-budget-view.yaml
│   ├── 05-goal-setup.yaml
│   ├── 06-investment-contribution.yaml
│   ├── 07-backup-restore.yaml
│   ├── 08-template-save-load.yaml
│   ├── 09-settings-changes.yaml
│   └── 10-hisaab-entry.yaml          # Phase 2
├── subflows/
│   ├── login.yaml                     # (if biometric added)
│   └── add-sample-data.yaml           # Seed data for tests
└── config.yaml
```

---

## 6. Test Coverage Targets

| Layer | Target | Rationale |
|-------|--------|-----------|
| **SMS Parsing** | 95%+ per bank pattern | This is critical — wrong parsing = wrong data. Must cover all known bank formats. |
| **Forecast Parsing** | 100% | Every forecast SMS type must parse correctly and create forecast entries with correct due dates |
| **Forecast-to-Realized Matching** | 100% | Matching logic must handle exact matches, near-date matches, and no-match scenarios |
| **Email Parsing** | 90%+ per email type | High importance — financial data accuracy |
| **Budget calculations** | 100% | Math must be correct. No tolerance for calculation errors. |
| **Goal calculations** | 100% | Course correction and trajectory must be precise. |
| **Tax calculations** | 100% | Financial math must be exact — wrong tax = wrong in-hand salary = wrong yearly plan |
| **Investment-Milestone linking** | 100% | Auto-sync logic (increment/decrement) must be correct to avoid data drift |
| **Formatters/Validators** | 90%+ | Standard utility coverage |
| **Database CRUD** | 80%+ | Integration tests for all entities |
| **Backup/Restore** | 100% | Data loss is unacceptable. Full roundtrip verified. |
| **Pattern coverage (expanded)** | 100% | All 50+ bank patterns must have dedicated tests with real SMS format |
| **Account discovery** | 100% | Every account type (savings, CC, loan, wallet) must be discoverable from SMS |
| **Refund matching** | 100% | Match, no-match, multiple-match, and edge cases (exact amount, different card) |
| **Recurring detection** | 90% | Core algorithm + frequency classification. Edge cases (amount variation, irregular intervals) covered |
| **UI components** | Not measured | Covered by E2E and manual testing |
| **Overall line coverage** | 70-80% | Healthy for a mobile app without over-testing |

---

## 7. When to Run Tests

| Trigger | What Runs | Why |
|---------|-----------|-----|
| Every code change | Unit tests (auto via Jest watch mode) | Instant feedback during development |
| Before committing | Unit + integration tests | Don't commit broken code |
| Before building APK | Unit + integration + security audit | Don't send broken builds to phone |
| Before each feedback round | E2E tests (Maestro) | Verify critical flows before user testing |
| Weekly | Full test suite + security audit | Catch regressions |

---

## 8. UI Consistency & Rendering Guard Rails

These automated checks catch the exact class of bugs found during first device testing: broken styles, content behind status bars, missing database init, empty data on first launch. Every screen and every new feature must pass these.

### 8.1 ScreenContainer Lint Rule

**What it prevents:** Content clipped behind status bars / navigation headers on bezel-less phones.

**Rule:** Every `<ScreenContainer>` usage in `app/` must include `padTop={false}` because all screens render inside Tab or Stack navigators that provide their own headers.

**Automated check (run before every commit):**

```bash
# Fails if ANY ScreenContainer in app/ is missing padTop={false}
grep -rn "ScreenContainer" app/ | grep -v "padTop" | grep -v "import" | grep -v "_layout" && echo "FAIL: ScreenContainer missing padTop={false}" && exit 1
```

**Integration test:**

```typescript
// __tests__/unit/screen-container-usage.test.ts
import { execSync } from "child_process";

test("all ScreenContainer usages include padTop={false}", () => {
  const result = execSync(
    'grep -rn "ScreenContainer" app/ | grep -v "padTop" | grep -v "import" | grep -v "_layout"',
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  ).trim();
  expect(result).toBe(""); // No violations
});
```

### 8.2 NativeWind Rendering Smoke Test

**What it prevents:** NativeWind className interception silently breaking (e.g., React Compiler stripping it).

**Rule:** `app.json` must NOT include `reactCompiler: true` in experiments — it breaks NativeWind's className interception via react-native-css-interop.

**Automated check:**

```typescript
// __tests__/unit/app-config-guards.test.ts
import appJson from "../../app.json";

test("reactCompiler is NOT enabled (breaks NativeWind)", () => {
  expect(appJson.expo?.experiments?.reactCompiler).not.toBe(true);
});

test("edgeToEdgeEnabled is true (modern Android rendering)", () => {
  expect(appJson.expo?.androidNavigationBar?.visible).not.toBe("sticky-immersive");
});
```

### 8.3 Database Initialization Smoke Test

**What it prevents:** App screens silently failing because `initDatabase()` was never called, or default seed data is missing.

**Rule:** The root layout (`app/_layout.tsx`) must call `initDatabase()`, `seedDefaultCategories()`, and `seedDefaultPaymentModes()` before rendering child screens. A loading screen must be shown until the database is ready.

**Integration test:**

```typescript
// __tests__/integration/app-startup.test.ts
import { initDatabase } from "@/database";
import { seedDefaultCategories, getCategories } from "@/services/category";
import { seedDefaultPaymentModes, getPaymentModes } from "@/services/payment-mode";

test("startup sequence seeds default data on first launch", async () => {
  await initDatabase();
  await seedDefaultCategories("default-user");
  await seedDefaultPaymentModes("default-user");

  const categories = await getCategories("default-user");
  const paymentModes = await getPaymentModes("default-user");

  expect(categories.length).toBeGreaterThan(0);
  expect(paymentModes.length).toBeGreaterThan(0);
});

test("startup sequence is idempotent (second run doesn't duplicate)", async () => {
  await initDatabase();
  await seedDefaultCategories("default-user");
  await seedDefaultPaymentModes("default-user");

  // Run again
  await seedDefaultCategories("default-user");
  await seedDefaultPaymentModes("default-user");

  const categories = await getCategories("default-user");
  const firstRunCount = categories.length;

  expect(categories.length).toBe(firstRunCount); // No duplicates
});
```

### 8.4 User ID Consistency Check

**What it prevents:** Foreign key violations caused by mismatched user IDs (e.g., seed uses UUID but screens hardcode "default-user").

**Rule:** Until multi-user auth is implemented, all services and seed data must use the string `"default-user"` as user_id.

**Automated check:**

```bash
# Find any hardcoded user IDs that aren't "default-user" in service/database files
grep -rn "user_id" services/ database/ | grep -v "default-user" | grep -v "parameter" | grep -v "interface" | grep -v ".test." | grep -v "type "
```

### 8.5 First-Launch Checklist (Manual)

Run this checklist on every APK build — simulates a fresh install:

| # | Check | Pass Criteria |
|---|-------|--------------|
| 1 | **App loads** | Loading spinner appears, then home screen renders |
| 2 | **NativeWind styles visible** | Text is styled (sized, colored), not raw unstyled text |
| 3 | **No content behind status bar** | Top of screen content starts below the status bar |
| 4 | **Categories populated** | Settings → Categories shows default categories (not empty) |
| 5 | **Payment modes populated** | Settings → Payment Modes shows default modes (not empty) |
| 6 | **Add expense works** | Tap +, fill form, save — expense appears in list |
| 7 | **Add category works** | Settings → Categories → + → fill → save — appears in list |
| 8 | **All 5 tabs navigate** | Tap each tab — no crashes, correct screen shows |
| 9 | **Dark mode renders** | Switch to dark mode — backgrounds dark, text visible |
| 10 | **Scroll works** | Long content scrolls smoothly, no overlap |

### 8.6 When to Run UI Guard Tests

| Trigger | What Runs |
|---------|-----------|
| Adding a new screen | ScreenContainer lint rule (8.1) |
| Changing `app.json` | Config guard tests (8.2) |
| Changing `database/` or `services/` | Startup smoke test (8.3) |
| Before every APK build | All of 8.1–8.4 + first-launch checklist (8.5) |
| After any NativeWind/Expo SDK upgrade | Full UI guard suite + manual device check |

---

## 9. Bug Tracking from Manual Testing

When you test on your phone and find issues:

```
Format your feedback like this:

BUG: [Short description]
WHERE: [Which screen / feature]
STEPS: [What you did]
EXPECTED: [What should happen]
ACTUAL: [What actually happened]
SCREENSHOT: [Attach if possible]

Example:
BUG: Expense amount shows 0 after saving
WHERE: Add Expense screen
STEPS: Entered Rs 500, selected Food category, tapped Save
EXPECTED: Expense of Rs 500 appears in list
ACTUAL: Expense appears but amount shows Rs 0
```

Each bug becomes a test case — the fix includes a unit/integration test that prevents recurrence.
