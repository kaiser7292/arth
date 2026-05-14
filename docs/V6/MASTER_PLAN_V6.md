# Artha V6 — MASTER PLAN

> **Color Themes + Gen Z Visual Overhaul**
> 4 phases | Version 5.0.0 → 6.0.0

---

## SESSION LOG

| # | Session Date | Tasks Completed | Notes |
|---|-------------|-----------------|-------|
| 1 | 2026-04-14 | Phase 0: V6-0.1 through V6-0.4 | Theme engine foundation. Created accent-palettes.ts (5 themes), accent.ts (utilities), MMKV persistence, AccentProvider context. AccentProvider wraps app in _layout.tsx. Ocean = zero visual change. |
| 2 | 2026-04-14 | Phase 1: V6-1.1 | Settings theme picker UI. Row of 5 colored circles with labels, checkmark on selected. Instant apply via setAccentTheme(). |
| 3 | 2026-04-14 | Phase 2: V6-2.1 through V6-2.6 | Color migration. 191 primary-* NativeWind classes replaced across 52+ files. All hardcoded blue hex replaced where accent-related. 12 inline FABs replaced with reusable FAB component. primary block removed from tailwind.config.js. |
| 4 | 2026-04-14 | Phase 3: V6-3.1 through V6-3.10 | Gen Z visual overhaul. expo-linear-gradient + expo-blur installed. Gradient FAB, gradient ProgressBar, rounder Card/Input, softer shadows, bolder typography, pill buttons, softer StatusPill, tab bar shadow, press animations. |
| 5 | 2026-04-14 | Phase 4: V6-4.1 through V6-4.3 | QA. TypeScript: zero new errors. Jest: 1042/1047 pass (5 pre-existing). Version bumped to 6.0.0. Docs created. |

## CURRENT STATE

```
PHASE: COMPLETE ✅
ALL TASKS DONE (Phases 0-4)
TESTS: 1047 (1042 pass + 5 pre-existing failures)
MIGRATIONS: 26 (unchanged from V5)
VERSION: 6.0.0
```

---

## MANDATORY BEHAVIORS

1. Read this file at session start and after context compaction
2. Update SESSION LOG after every task
3. Update CURRENT STATE after every task
4. Mark checkboxes [x] as tasks complete
5. Follow task order — dependencies matter
6. Run tests after every task — don't accumulate untested code

---

## Feature Summary

| # | Area | Phase | Size | Description |
|---|------|-------|------|-------------|
| F1 | Theme Engine Foundation | 0 | M | Accent palettes, MMKV persistence, React Context, hook |
| F2 | Settings Theme Picker | 1 | S | Color circle picker UI in settings |
| F3 | Accent Color Migration | 2 | XL | Replace 191 primary-* classes across 52+ files |
| F4 | Gen Z Visual Overhaul | 3 | L | Gradients, rounder shapes, softer shadows, bolder type |
| F5 | QA & Polish | 4 | M | Type check, tests, version bump, docs |

---

## Dependency Graph

```
Phase 0 (Engine)
  ├── constants/accent-palettes.ts [NEW]
  ├── utils/accent.ts [NEW]
  ├── services/settings.ts
  └── hooks/use-color-scheme.ts + app/_layout.tsx
       │
  ┌────┴────┐
  │         │
Phase 1   Phase 2      (parallel after Phase 0)
(Picker)  (Color Sweep)
  │         │
  └────┬────┘
       │
  Phase 3 (Gen Z Polish)
       │
  Phase 4 (QA)
```

---

## Phase 0: Theme Engine Foundation — 4 tasks

- [x] **V6-0.1** Create `constants/accent-palettes.ts` with 5 theme palettes ✅
  - AccentThemeId type, AccentPalette interface, full 50-900 scales
  - Ocean, Mint, Sunset, Lavender, Rose
  - ACCENT_PALETTES record, ACCENT_THEME_LIST array, DEFAULT_ACCENT_THEME

- [x] **V6-0.2** Create `utils/accent.ts` with helper functions ✅
  - `ac(palette, mode, lightShade, darkShade)` — shade selection
  - `acAlpha(palette, shade, alpha)` — alpha transparency

- [x] **V6-0.3** Add MMKV persistence to `services/settings.ts` ✅
  - `getAccentTheme()` / `setAccentTheme()` functions
  - ACCENT_THEME key constant

- [x] **V6-0.4** Rewrite `hooks/use-color-scheme.ts` with AccentProvider ✅
  - React Context for accent theme state
  - Hook returns: colors (accent-derived), accent (palette), accentTheme (ID), setAccentTheme
  - Colors computed via useMemo with accent overrides for tint/blue/tabIconSelected
  - Wrapped app with AccentProvider in app/_layout.tsx

---

## Phase 1: Settings Theme Picker — 1 task

- [x] **V6-1.1** Add color theme picker to settings ✅
  - "Color Theme" section below light/dark toggle
  - Row of 5 circles (40px) filled with theme accent-600
  - Selected: white checkmark + accent ring border
  - Theme name labels below circles
  - Tap = instant apply via setAccentTheme()

---

## Phase 2: Accent Color Migration — 6 task groups

- [x] **V6-2.1** Migrate UI components (Button, Card, FAB, DateInput, SectionHeader) ✅
  - All primary-* classes → accent inline styles
  - ~30 replacements

- [x] **V6-2.2** Migrate expense components ✅
  - ExpenseHeroCard, ExpenseFormFields, ForecastMatchCard, etc.
  - ~30 replacements

- [x] **V6-2.3** Migrate tab screens (index, expenses, budget, goals, settings) ✅
  - ~40 replacements

- [x] **V6-2.4** Migrate settings sub-screens ✅
  - templates, categories, payment-modes, import-excel, backup-restore, etc.
  - ~40 replacements

- [x] **V6-2.5** Migrate other screens (insights, hisaab, goals, advisor, budget) ✅
  - ~50 replacements

- [x] **V6-2.6** Remove `primary` block from tailwind.config.js ✅
  - Grep verified: zero remaining primary-* classes in source

---

## Phase 3: Gen Z Visual Overhaul — 10 tasks

- [x] **V6-3.1** Install expo-linear-gradient and expo-blur ✅
  - npx expo install expo-linear-gradient expo-blur

- [x] **V6-3.2** Update tailwind.config.js radii and typography ✅
  - Card radius: 12px → 16px, Button radius: 10px → 14px
  - Display: 28px → 32px, Title: 20px → 24px

- [x] **V6-3.3** Soften shadows in constants/theme.ts ✅
  - All shadows: larger radius, lower opacity, more diffused
  - New tabBar shadow preset

- [x] **V6-3.4** Update Card.tsx ✅
  - rounded-xl → rounded-2xl, p-4 → p-5

- [x] **V6-3.5** Update Button.tsx ✅
  - Accent inline styles, scale + opacity press animation

- [x] **V6-3.6** Update FAB.tsx with gradient ✅
  - LinearGradient (accent-400 → accent-600), size 56 → 64, icon 28 → 32
  - Opacity press animation added

- [x] **V6-3.7** Update ProgressBar.tsx with gradient ✅
  - LinearGradient fill when no explicit color, height 6 → 8

- [x] **V6-3.8** Update tab bar in _layout.tsx ✅
  - Removed borderTopWidth, added Shadows.tabBar, height 56 → 60, padding 6 → 8

- [x] **V6-3.9** Update Input.tsx ✅
  - rounded-lg → rounded-xl

- [x] **V6-3.10** Update StatusPill.tsx ✅
  - Background opacity hex suffix: 18 → 12 (softer)

---

## Phase 4: QA & Polish — 3 tasks

- [x] **V6-4.1** TypeScript type check ✅
  - Zero new errors in V6-modified files
  - All errors pre-existing (test files, backup, SMS parser)

- [x] **V6-4.2** Jest regression test ✅
  - 1042 of 1047 tests pass
  - 5 failures pre-existing in database.test.ts (migration runner)

- [x] **V6-4.3** Version bump + documentation ✅
  - app.json: 5.0.0 → 6.0.0
  - CLAUDE.md: updated app version
  - Created docs/V6/PRD_V6.md, TDD_V6.md, MASTER_PLAN_V6.md
