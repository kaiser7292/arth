# Artha (अर्थ) — Version 6 Technical Design Document

**Version:** 6.0 (Draft)
**Date:** 2026-04-14
**Status:** Implemented
**Predecessor:** V5 TDD at `docs/V5/TDD_V5.md`

---

## 1. Overview

V6 is a visual identity and personalization release. It adds a dynamic accent color system with 5 themes, migrates all static `primary-*` NativeWind classes to runtime inline styles, introduces gradient components via `expo-linear-gradient`, and applies a Gen Z-inspired design refresh. Architecture remains 100% local (SQLite + MMKV, no cloud).

**Schema version after V6:** 26 migrations (unchanged from V5)
**Tables:** 26 (unchanged)
**New files:** 3 (`constants/accent-palettes.ts`, `utils/accent.ts`, expo deps)
**Deleted files:** 0
**Modified files:** ~55
**New dependencies:** `expo-linear-gradient`, `expo-blur`
**Removed dependencies:** None

---

## 2. Schema Changes

None. V6 has zero database migrations.

---

## 3. Accent Theme Engine

### 3.1 New File: `constants/accent-palettes.ts`

Defines the 5 color theme palettes with full 50-900 shade scales.

```typescript
export type AccentThemeId = "ocean" | "mint" | "sunset" | "lavender" | "rose";

export interface AccentPalette {
  id: AccentThemeId;
  name: string;
  50: string; 100: string; 200: string; 300: string; 400: string;
  500: string; 600: string; 700: string; 800: string; 900: string;
}

export const ACCENT_PALETTES: Record<AccentThemeId, AccentPalette> = {
  ocean: { id: "ocean", name: "Ocean", 50: "#EFF6FF", ..., 900: "#1E3A8A" },
  mint: { id: "mint", name: "Mint", 50: "#ECFDF5", ..., 900: "#064E3B" },
  sunset: { id: "sunset", name: "Sunset", 50: "#FFFBEB", ..., 900: "#78350F" },
  lavender: { id: "lavender", name: "Lavender", 50: "#F5F3FF", ..., 900: "#4C1D95" },
  rose: { id: "rose", name: "Rose", 50: "#FFF1F2", ..., 900: "#881337" },
};

export const ACCENT_THEME_LIST: AccentPalette[] = Object.values(ACCENT_PALETTES);
export const DEFAULT_ACCENT_THEME: AccentThemeId = "ocean";
```

**Extensibility:** Adding a new theme requires only adding an entry to `ACCENT_PALETTES`. No other file changes needed — the theme picker auto-populates from `ACCENT_THEME_LIST`.

### 3.2 New File: `utils/accent.ts`

Utility functions for accent color resolution.

```typescript
type Shade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
type Mode = "light" | "dark";

// Pick shade based on light/dark mode
export function ac(p: AccentPalette, mode: Mode, light: Shade, dark: Shade): string;

// Append alpha hex to a palette shade
export function acAlpha(p: AccentPalette, shade: Shade, alpha: number): string;
```

### 3.3 MMKV Persistence: `services/settings.ts`

Added `ACCENT_THEME` key to MMKV storage:

```typescript
export function getAccentTheme(): AccentThemeId;
export function setAccentTheme(theme: AccentThemeId): void;
```

Reads/writes are synchronous via MMKV. Default: `"ocean"`.

### 3.4 React Context: `hooks/use-color-scheme.ts`

The hook was rewritten to be the central reactivity hub:

**`AccentProvider`** — React Context component wrapping the app. Manages:
- `accentTheme` state (initialized from MMKV)
- `setAccentTheme` function (writes to MMKV + updates state)
- Provides context to all children

**`useColorScheme()` hook** now returns:
```typescript
{
  colorScheme: "light" | "dark";
  setColorScheme: (scheme) => void;
  colors: {
    ...Colors[resolved],         // base tokens
    tint: accent[600|400],       // overridden with accent
    blue: accent[600|300],       // overridden with accent
    tabIconSelected: accent[600|400],  // overridden with accent
  };
  accent: AccentPalette;         // full palette object
  accentTheme: AccentThemeId;    // current theme ID
  setAccentTheme: (id) => void;  // setter
}
```

Colors are computed via `useMemo` — accent rarely changes, so re-renders are minimal.

### 3.5 App Root: `app/_layout.tsx`

Wrapped entire app with `<AccentProvider>`:
```tsx
<ErrorBoundary>
  <AccentProvider>
    <StatusBar style="auto" />
    <Stack>...</Stack>
  </AccentProvider>
</ErrorBoundary>
```

---

## 4. NativeWind → Inline Style Migration

### 4.1 Why Migration Was Needed

NativeWind classes (`bg-primary-500`, `text-primary-200`, `border-primary-700`) are resolved statically from `tailwind.config.js` at build time. They cannot change at runtime when the user switches themes. All accent-dependent styles had to move to inline React Native styles.

### 4.2 Migration Pattern

**Before:**
```tsx
<View className="bg-primary-50 dark:bg-primary-900 border-primary-200 dark:border-primary-700">
  <Text className="text-primary-500 dark:text-primary-200">Action</Text>
</View>
```

**After:**
```tsx
const { accent, colorScheme } = useColorScheme();
<View style={{
  backgroundColor: ac(accent, colorScheme, 50, 900),
  borderColor: ac(accent, colorScheme, 200, 700),
}}>
  <Text style={{ color: ac(accent, colorScheme, 500, 200) }}>Action</Text>
</View>
```

### 4.3 Migration Scope

| Group | Files | Replacements |
|-------|-------|-------------|
| UI components (Button, Card, FAB, DateInput, SectionHeader, Input) | 6 | ~30 |
| Expense components | ~8 | ~30 |
| Tab screens (index, expenses, budget, goals, settings) | 5 | ~40 |
| Settings sub-screens | ~10 | ~40 |
| Other screens (insights, hisaab, goals, advisor, budget) | ~15 | ~50 |
| Hardcoded hex replacements | ~8 | ~25 |
| **Total** | **~52** | **~215** |

### 4.4 Tailwind Config Cleanup

Removed the entire `primary` color block from `tailwind.config.js`. The `primary-*` classes no longer resolve to anything — prevents accidental use of static blue.

---

## 5. Gen Z Visual Changes

### 5.1 Border Radii (`tailwind.config.js`)

```javascript
borderRadius: {
  card: "16px",    // was 12px
  button: "14px",  // was 10px
}
```

### 5.2 Typography Scale (`tailwind.config.js`)

```javascript
fontSize: {
  display: ["32px", { lineHeight: "40px" }],  // was 28px/36px
  title: ["24px", { lineHeight: "32px" }],     // was 20px/28px
}
```

### 5.3 Shadows (`constants/theme.ts`)

All shadows updated to softer, more diffused values:

```typescript
card: {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,   // was higher
  shadowRadius: 12,       // was smaller
  elevation: 3,
}
```

New `tabBar` shadow preset for upward-cast shadow on tab bar.

### 5.4 Gradient Components

**FAB.tsx:**
- `LinearGradient` background: `colors={[accent[400], accent[600]]}`, diagonal
- Size: 56px → 64px, icon: 28px → 32px
- Press animation: scale + opacity (spring physics)

**ProgressBar.tsx:**
- When no explicit color override: `LinearGradient` fill (accent[400] → accent[600], horizontal)
- When color specified: solid color `View` fallback
- Height: 6px → 8px

### 5.5 Component Updates

| Component | Change |
|-----------|--------|
| `Card.tsx` | `rounded-xl` → `rounded-2xl`, `p-4` → `p-5` |
| `Button.tsx` | Accent inline styles, scale+opacity press animation |
| `FAB.tsx` | Gradient fill, size 64, icon 32, opacity animation |
| `ProgressBar.tsx` | Gradient fill, height 8 |
| `Input.tsx` | `rounded-lg` → `rounded-xl` |
| `StatusPill.tsx` | Background opacity hex `18` → `12` |
| Tab bar (`_layout.tsx`) | No border-top, shadow, height 60, padding 8 |

---

## 6. New Dependencies

### 6.1 `expo-linear-gradient`

Used for gradient FAB backgrounds and progress bar fills. Expo-managed package — no native module configuration needed.

### 6.2 `expo-blur`

Installed for future glassmorphism modal support. Not actively used in V6 components yet — foundation for V7+.

---

## 7. File Inventory

### New Files
| File | Purpose |
|------|---------|
| `constants/accent-palettes.ts` | 5 theme palette definitions with full shade scales |
| `utils/accent.ts` | `ac()` and `acAlpha()` utility functions |

### Key Modified Files
| File | Change |
|------|--------|
| `hooks/use-color-scheme.ts` | AccentProvider context + accent-aware colors |
| `services/settings.ts` | MMKV getAccentTheme/setAccentTheme |
| `app/_layout.tsx` | AccentProvider wrapper |
| `app/(tabs)/_layout.tsx` | Tab bar shadow, height, accent colors |
| `app/(tabs)/settings.tsx` | Theme picker UI + accent migration |
| `constants/theme.ts` | Softer shadows, tabBar preset |
| `tailwind.config.js` | Remove primary block, update radii/typography |
| `components/ui/Button.tsx` | Accent styles, press animation |
| `components/ui/Card.tsx` | Rounder, more padding |
| `components/ui/FAB.tsx` | Gradient, larger |
| `components/ui/ProgressBar.tsx` | Gradient, taller |
| `components/ui/Input.tsx` | Rounder |
| `components/ui/StatusPill.tsx` | Softer opacity |
| `components/ui/SectionHeader.tsx` | Accent tint |
| `components/ui/DateInput.tsx` | Accent styles |
| ~40 screen files | primary-* → accent inline styles |

---

## 8. Testing Strategy

V6 is a visual-only release. Testing approach:

1. **TypeScript type check**: Zero new errors introduced (all errors pre-existing)
2. **Jest regression**: 1042 of 1047 tests pass (5 failures pre-existing in database.test.ts)
3. **Device testing**: Manual verification of all 10 combos (5 themes × light/dark mode)
4. **Semantic color verification**: Red/green/amber indicators unaffected by theme changes
5. **Category color verification**: Category-specific colors unchanged
