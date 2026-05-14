# Artha UI Audit — Color & Theme Polish Proposal

**Date:** 2026-04-14
**Scope:** Visual/cosmetic only — zero functional changes
**Goal:** Make every screen feel cohesive, theme-aware, and polished across all 5 accent themes + light/dark mode

---

## Executive Summary

The app has a solid design system foundation (accent palettes, `ac()` helper, NativeWind tokens, `acAlpha()`), but it's inconsistently applied. **180+ instances** of hardcoded colors, manual dark mode ternaries, and mixed opacity patterns create visual inconsistencies — especially when switching accent themes or toggling dark mode.

This proposal groups all fixes into 6 focused sweeps, ordered by visual impact.

---

## Sweep 1: Dark Mode Ternary Cleanup (30+ instances)

**What:** Replace all `colorScheme === "dark" ? accent[X] : accent[Y]` with `ac(accent, colorScheme, lightShade, darkShade)`.

**Why:** The `ac()` helper exists for exactly this purpose. Manual ternaries are verbose, error-prone, and scattered across 20+ files.

**Files affected:**

| File | Count |
|------|-------|
| `app/expense/[id].tsx` | 4 |
| `app/expense/add.tsx` | 3 |
| `app/expense/review-queue.tsx` | 5 |
| `app/goals/savings-tracker.tsx` | 2 |
| `app/goals/capital-gains-reference.tsx` | 3 |
| `app/goals/investment-detail.tsx` | 3 |
| `app/goals/milestone-detail.tsx` | 3 |
| `app/goals/milestones.tsx` | 2 |
| `app/goals/yearly-plan.tsx` | 2 |
| `app/goals/salary-calculator.tsx` | 2 |
| `app/goals/investment-buckets.tsx` | 2 |
| `components/goals/SalarySummary.tsx` | 3 |
| `components/expense/salary-helpers.tsx` | 1 |

**Example:**
```tsx
// Before
style={{ color: colorScheme === "dark" ? accent[200] : accent[500] }}

// After
style={{ color: ac(accent, colorScheme, 500, 200) }}
```

**Effort:** S — mechanical find-and-replace

---

## Sweep 2: Centralize Status Colors (140+ references)

**What:** Move hardcoded status hex values to a `Colors.status` object in `constants/theme.ts`.

**Why:** `#16A34A` (success), `#DC2626` (danger), `#D97706` (warning), `#6B7280` (muted) appear 140+ times as raw hex. A single source of truth makes future palette adjustments trivial.

**Proposed additions to `constants/theme.ts`:**
```ts
export const StatusColors = {
  success: "#16A34A",
  danger: "#DC2626",
  warning: "#D97706",
  muted: "#6B7280",
} as const;
```

**Files with heaviest usage:**
- `app/(tabs)/goals.tsx` — status map colors
- `app/expense/duplicate-review.tsx` — reject/keep colors
- `app/expense/review-queue.tsx` — overdue/matched badges
- `app/(tabs)/expenses.tsx` — pending review indicators
- `app/settings/backup-restore.tsx` — warning/success states
- `app/settings/import-excel.tsx` — error/success states

**Effort:** M — define constant, then find-and-replace across ~40 files

---

## Sweep 3: Hardcoded Secondary Text & Icon Colors (50+ instances)

**What:** Replace hardcoded `#6B7280`, `#9CA3AF`, `#A0A0A0` with `colors.textSecondary` (from `useColorScheme()`).

**Why:** These are all secondary/muted text and icon colors. Using the theme token means they'll adapt correctly if the palette ever changes.

**Worst offenders:**

| File | Count | Pattern |
|------|-------|---------|
| `app/hisaab/household.tsx` | 8+ | `color="#9CA3AF"` on chevrons, secondary text |
| `app/summary/[month].tsx` | 7+ | `text-[#6B7280]` for labels |
| `app/(tabs)/goals.tsx` | 8+ | `color="#9CA3AF"` on all chevron icons |
| `components/expense/ExpenseFormFields.tsx` | 10+ | Picker icons, labels |
| `app/expense/[id].tsx` | 7+ | Detail screen icons |
| `app/settings/account-master.tsx` | 6+ | List item icons |

**Example:**
```tsx
// Before
<Ionicons name="chevron-forward" size={18} color="#9CA3AF" />

// After
<Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
```

**Effort:** M — needs `useColorScheme()` import in files that don't have it yet

---

## Sweep 4: Surface & Card Color Standardization (15+ files)

**What:** Replace hardcoded surface colors with NativeWind tokens.

**Current mess (4 different patterns for the same thing):**
```tsx
// Pattern A — hardcoded both sides
bg-white dark:bg-[#1E1E1E]

// Pattern B — hardcoded + wrong dark value
bg-white dark:bg-[#1A1A1A]  ← wrong! should be #1E1E1E

// Pattern C — mixed
bg-[#F7F7F5] dark:bg-[#1E1E1E]

// Pattern D — correct token
bg-surface-light-alt dark:bg-surface-dark-alt  ✓
```

**Standardize all to Pattern D.**

**Files with wrong dark surface colors:**
- `app/settings/budget-config.tsx:294` — uses `#1A1A1A` (should be `#1E1E1E`)
- `app/expense/review-queue.tsx:405` — uses `#111111` as surface (that's the background, not surface)
- `app/settings/import-excel.tsx:367` — hardcodes both sides

**Effort:** S — straightforward class replacement

---

## Sweep 5: Alpha & Opacity Pattern Standardization (50+ instances)

**What:** Standardize all transparency patterns to use `acAlpha()` for accent colors and consistent NativeWind opacity for status colors.

**Current mess (5 different patterns for 10% opacity):**

| Pattern | Usage | Standard? |
|---------|-------|-----------|
| `accent[500] + "1A"` | 25+ places | No — manual hex concat |
| `accent[500] + "33"` | 3 places | No — wrong alpha (20% not 10%) |
| `bg-[#XXXXXX]/10` | 15+ places | Partial — NativeWind opacity |
| `acAlpha(accent, 500, 0.1)` | 10+ places | **Yes — this is the standard** |
| `rgba(37, 99, 235, 0.08)` | 48 places (goals screens) | No — hardcoded, not theme-aware |

**Standardize to:**
- Accent colors: `acAlpha(accent, shade, alpha)`
- Status colors: `StatusColors.success + "1A"` or NativeWind `bg-success/10`

**Effort:** M — 50+ replacements, needs care with alpha values

---

## Sweep 6: Icon Background Circle Consistency

**What:** Standardize icon circle sizes and opacity.

**Current variation:**

| Icon size | Circle found | Circle should be |
|-----------|-------------|-----------------|
| 14-16px | w-6 h-6, w-7 h-7 | **w-7 h-7** (28px) |
| 18px | w-8 h-8, w-9 h-9 | **w-9 h-9** (36px) |
| 20px | w-9 h-9, w-10 h-10 | **w-10 h-10** (40px) |
| 24-28px | w-12 h-12 | **w-12 h-12** (48px) |
| 32px | w-16 h-16 | **w-16 h-16** (64px) |

**Background opacity should be consistent:**
- Accent backgrounds: `acAlpha(accent, 500, 0.08)` (8% standard)
- Status backgrounds: `StatusColor + "14"` (8% standard)

**Effort:** S — mostly class name tweaks

---

## Bonus: Color Improvements That Would Look Better

These are subjective suggestions, not violations:

### B1: Warmer Empty States
Currently empty state icons use `#9CA3AF` (cold gray). Consider using a very light accent tint instead — makes empty screens feel intentional rather than broken.

### B2: Gradient Refinement
FAB and ProgressBar use `accent[400] → accent[600]`. Some accent themes (sunset, lavender) could use a wider spread like `accent[300] → accent[600]` for more visual depth.

### B3: Card Shadow in Light Mode
Cards currently rely on border only. A subtle shadow (`shadow-sm`) in light mode would add depth and make the card hierarchy clearer — especially on the home screen where cards are stacked.

### B4: Section Divider Refinement
Some screens use `border-b` between items, others use spacing. Standardizing to either thin hairline dividers OR spacing-only throughout would improve consistency.

### B5: Tab Bar Active Indicator
The active tab could use a subtle dot or underline in the accent color instead of just the icon color change, making it more visible.

### B6: Muted Backgrounds for Info Banners
The review queue and duplicate banners (now softened) set a good pattern. Apply the same muted treatment to all info/alert banners across the app (forecast alerts, course correction, etc.).

---

## Phase A: Design Standards — Lighter Colors & Consistent Icons

**This section defines the canonical standards before any sweep begins.**

### A1. Lighter Status Colors

Current status colors feel heavy and saturated. Replace with lighter, softer variants that still communicate meaning clearly.

| Role | Current (Heavy) | New (Lighter) | Usage |
|------|----------------|---------------|-------|
| **Success text/icon** | `#16A34A` | `#22C55E` | Checkmarks, positive balance, approved |
| **Success background** | `rgba(12,191,22,0.1)` or `#16A34A18` | `#22C55E14` (8%) | Tint behind success icons/badges |
| **Danger text/icon** | `#DC2626` | `#EF4444` | Delete, errors, deficit, overdue |
| **Danger background** | `rgba(255,51,51,0.1)` or `#DC262618` | `#EF444414` (8%) | Tint behind danger icons/badges |
| **Warning text/icon** | `#D97706` | `#F59E0B` | Pending, warnings, upcoming |
| **Warning background** | `#D9770618` or `rgba(245,158,11,0.15)` | `#F59E0B14` (8%) | Tint behind warning icons/badges |
| **Muted icon** | `#6B7280` | `#9CA3AF` | Secondary/tertiary icons, chevrons |
| **Muted text** | `#6B7280` | Use `colors.textSecondary` token | Labels, captions |

**Dark mode lighter variants:**

| Role | Current (Dark) | New (Dark Lighter) |
|------|---------------|-------------------|
| **Success** | `#16A34A` (same as light) | `#4ADE80` (green-400) |
| **Danger** | `#DC2626` (same as light) | `#F87171` (red-400) |
| **Warning** | `#D97706` (same as light) | `#FBBF24` (amber-400) |

Add to `constants/theme.ts`:
```ts
export const StatusColors = {
  light: {
    success:    "#22C55E",
    successBg:  "#22C55E14",
    danger:     "#EF4444",
    dangerBg:   "#EF444414",
    warning:    "#F59E0B",
    warningBg:  "#F59E0B14",
    muted:      "#9CA3AF",
  },
  dark: {
    success:    "#4ADE80",
    successBg:  "#4ADE8014",
    danger:     "#F87171",
    dangerBg:   "#F8717114",
    warning:    "#FBBF24",
    warningBg:  "#FBBF2414",
    muted:      "#6B7280",
  },
} as const;
```

### A2. Consistent Icon Circle System

Every icon with a background circle MUST follow this scale. No exceptions.

| Icon Size | Circle Size | NativeWind Class | Background Opacity |
|-----------|-------------|------------------|--------------------|
| 12px | 24px | `w-6 h-6 rounded-full` | 8% |
| 14-16px | 28px | `w-7 h-7 rounded-full` | 8% |
| 18px | 36px | `w-9 h-9 rounded-full` | 8% |
| 20px | 40px | `w-10 h-10 rounded-full` | 8% |
| 24px | 48px | `w-12 h-12 rounded-full` | 8% |
| 32px | 64px | `w-16 h-16 rounded-full` | 8% |
| 48px | 96px | `w-24 h-24 rounded-full` | 8% |

**Background color rules:**
- **Accent icons** (features, navigation cards): `acAlpha(accent, 500, 0.08)`
- **Status icons** (success/danger/warning): `StatusColors[colorScheme].successBg` / `dangerBg` / `warningBg`
- **Category icons** (from database): `category.color + "14"` (8%)
- **Muted icons** (chevrons, secondary): No background circle — standalone only

**Standard opacity: 8% (hex `14`).** Not 10% (`1A`), not 13% (`20`), not 15% (`26`). One number everywhere.

### A3. Icon Color Rules

| Context | Light Mode | Dark Mode | Helper |
|---------|-----------|-----------|--------|
| **Accent icon** (primary action) | `accent[500]` | `accent[300]` | `ac(accent, colorScheme, 500, 300)` |
| **Success icon** | `StatusColors.light.success` | `StatusColors.dark.success` | — |
| **Danger icon** | `StatusColors.light.danger` | `StatusColors.dark.danger` | — |
| **Warning icon** | `StatusColors.light.warning` | `StatusColors.dark.warning` | — |
| **Muted/secondary icon** | `colors.textSecondary` | `colors.textSecondary` | From `useColorScheme()` |
| **Category icon** | `category.color` | `category.color` | From database |

### A4. Background Tint Conventions

All soft-colored backgrounds (behind icons, badges, banners, status pills) use **one consistent opacity: 8%**.

**How to apply:**
```tsx
// Accent tint — use acAlpha
style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}

// Status tint — use StatusColors
style={{ backgroundColor: StatusColors[colorScheme].successBg }}

// Category tint — hex concat with "14"
style={{ backgroundColor: category.color + "14" }}
```

**Eliminate all of these inconsistent patterns:**
- ~~`color + "18"` (10%)~~ → use `"14"` (8%)
- ~~`color + "1A"` (10%)~~ → use `"14"` (8%)
- ~~`color + "20"` (13%)~~ → use `"14"` (8%)
- ~~`color + "26"` (15%)~~ → use `"14"` (8%)
- ~~`color + "33"` (20%)~~ → use `"14"` (8%)
- ~~`rgba(r,g,b,0.1)` (10%)~~ → use hex `"14"` (8%)
- ~~`rgba(r,g,b,0.08)` (8%)~~ → use hex `"14"` pattern

### A5. Banner & Alert Standards

All info/warning/alert banners use the same softened pattern:

```tsx
// Standard alert banner structure
<View 
  className="rounded-xl p-3 flex-row items-center"
  style={{ backgroundColor: StatusColors[colorScheme].warningBg }}
>
  <View className="w-7 h-7 rounded-full items-center justify-center mr-2.5"
    style={{ backgroundColor: StatusColors[colorScheme].warningBg }}>
    <Ionicons name="alert-circle" size={16} color={StatusColors[colorScheme].warning} />
  </View>
  <Text style={{ color: StatusColors[colorScheme].warning }}>...</Text>
</View>
```

### A6. Color Tokens Summary (Quick Reference)

```
ACCENT COLORS:
  Icon:       ac(accent, colorScheme, 500, 300)
  Background: acAlpha(accent, 500, 0.08)

STATUS COLORS (use StatusColors[colorScheme]):
  Success:    .success / .successBg
  Danger:     .danger / .dangerBg  
  Warning:    .warning / .warningBg
  Muted:      .muted (icon only, no bg)

SECONDARY:
  Text:       colors.textSecondary (from useColorScheme)
  Icons:      colors.textSecondary

CATEGORY:
  Icon:       category.color
  Background: category.color + "14"

OPACITY STANDARD: 8% everywhere (hex "14")
```

---

## Implementation Order

| Phase | Sweep | Effort | Files | Visual Impact |
|-------|-------|--------|-------|---------------|
| **A** | **Phase A: Add StatusColors + standards to theme.ts** | **S** | **1** | **Foundation — must do first** |
| 1 | Sweep 4: Surface colors | S | 15 | High — fixes dark mode bugs |
| 2 | Sweep 1: Dark mode ternaries | S | 20 | High — consistent accent theming |
| 3 | Sweep 2: Status color constants (use new StatusColors) | M | 40 | High — lighter, softer colors everywhere |
| 4 | Sweep 3: Secondary text/icon colors | M | 25 | Medium — subtle but consistent |
| 5 | Sweep 5: Alpha standardization (8% everywhere) | M | 30 | Medium — consistent tint backgrounds |
| 6 | Sweep 6: Icon circles (follow A2 scale) | S | 15 | Medium — consistent icon treatment |
| 7 | Bonus items (B1-B6) | L | 20+ | Medium — subjective polish |

**Total estimate:** ~145 files touched, 0 functional changes, 0 new dependencies

---

## Verification Plan

After each sweep:
1. `npx tsc --noEmit` — zero new TS errors
2. Visual check: light mode + dark mode
3. Visual check: cycle all 5 accent themes (ocean, mint, sunset, lavender, rose)
4. Spot-check: home, expenses, budget, goals, settings, hisaab screens
