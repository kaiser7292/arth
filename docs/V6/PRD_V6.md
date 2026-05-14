# Artha (अर्थ) — Version 6 Product Requirements Document

**Version:** 6.0 (Draft)
**Author:** Sourav Baid
**Date:** 2026-04-14
**Status:** Implemented
**Predecessor:** V5 PRD at `docs/V5/PRD_V5.md`

---

## 1. Executive Summary

Version 6 is a **visual identity and personalization release**. It introduces 5 selectable color themes and a comprehensive Gen Z-inspired design overhaul — rounder shapes, gradient accents, softer shadows, bolder typography, and more generous spacing.

V6 addresses:
- **Personalization** — Users can choose from 5 color themes (Ocean, Mint, Sunset, Lavender, Rose)
- **Visual modernity** — Updated design language inspired by Linear, Cash App, and Arc Browser
- **Design system evolution** — Gradient FABs, gradient progress bars, pill-shaped elements, glassmorphism foundation

### Why V6 Is a Major Version

The accent color system touches 52+ files, replaces all `primary-*` NativeWind classes with inline accent styles, introduces React Context for theme reactivity, adds 3 new files, and modifies the design tokens (border radii, typography scale, shadows). These are pervasive visual changes that warrant a major version bump per the project's versioning rules (>5 features/changes = MAJOR).

### Version Metrics

| Metric | V5 (Baseline) | V6 (Actual) |
|--------|--------------|-------------|
| Tests | 1,047 | 1,047 (unchanged) |
| Migrations | 26 | 26 (unchanged) |
| Services | ~43 | ~43 (unchanged) |
| Screens | ~56 | ~56 (unchanged) |
| Version | 5.0.0 | 6.0.0 |
| New files | — | 3 (accent-palettes.ts, accent.ts, GlassModal placeholder) |
| Modified files | — | ~55 |
| New dependencies | — | 2 (expo-linear-gradient, expo-blur) |

---

## 2. Color Theme System (F1)

### F1.1: Five Theme Presets

Users can select from 5 color themes that change the app's accent color globally. Each theme provides a full 50-900 shade scale for light/dark mode compatibility.

| # | Theme | Accent | Light Tint | Dark Tint | Personality |
|---|-------|--------|-----------|----------|-------------|
| 1 | **Ocean** | Blue | `#2563EB` | `#60A5FA` | Default — clean, professional |
| 2 | **Mint** | Green | `#059669` | `#34D399` | Fresh, money/growth |
| 3 | **Sunset** | Amber | `#D97706` | `#FBBF24` | Warm, energetic |
| 4 | **Lavender** | Purple | `#7C3AED` | `#A78BFA` | Trendy, Gen Z |
| 5 | **Rose** | Pink | `#E11D48` | `#FB7185` | Bold, confident |

**Behavior:**
- Theme selection is instant (no app restart required)
- Persisted via MMKV storage
- Ocean is the default, matching the pre-V6 blue exactly (zero visual change for existing users)
- Theme affects: buttons, FAB, progress bars, tab active state, links, banners, selected states, section action labels

**What does NOT change with theme:**
- Success green (#16A34A) — always green for "under budget"
- Danger red (#DC2626) — always red for "over budget"
- Warning amber (#D97706) — always amber for approaching limits
- Category-specific colors (food=orange, rent=blue, etc.)
- Text hierarchy (neutral grays)

### F1.2: Theme Picker UI

Located in Settings > Appearance section, below the light/dark mode toggle.

- Row of 5 colored circles (40px diameter)
- Each filled with the theme's accent-600 shade
- Selected theme shows a white checkmark and accent ring border
- Theme name label below each circle
- Tap = instant apply

---

## 3. Gen Z Visual Overhaul (F2)

### F2.1: Rounder Shapes

| Element | Before | After |
|---------|--------|-------|
| Card border-radius | 12px (rounded-xl) | 16px (rounded-2xl) |
| Button border-radius | 10px (rounded-button) | 14px |
| Input border-radius | rounded-lg | rounded-xl |
| Card padding | p-4 (16px) | p-5 (20px) |

### F2.2: Gradient Accents

- **FAB**: Solid color → LinearGradient (accent-400 → accent-600, diagonal)
- **Progress bars**: Solid color → LinearGradient (accent-400 → accent-600, horizontal) when no explicit color override
- **Size increase**: FAB 56px → 64px, FAB icon 28px → 32px, progress bar height 6px → 8px

### F2.3: Softer Shadows

All card and elevation shadows updated to more diffused, lower-opacity values:
- Cards: larger spread, lower opacity (more "floating" feel)
- Tab bar: upward shadow instead of border-top line
- FAB: softer elevation shadow

### F2.4: Bolder Typography

| Usage | Before | After |
|-------|--------|-------|
| Display (hero numbers) | 28px | 32px |
| Title (section headers) | 20px | 24px |

### F2.5: Press Animations

Buttons and FAB now animate both scale AND opacity on press:
- Scale: 1.0 → 0.97 (buttons) / 0.9 (FAB)
- Opacity: 1.0 → 0.92 (buttons) / 0.9 (FAB)
- Spring physics: damping 15, stiffness 300

### F2.6: Softer Status Pills

StatusPill background opacity reduced from hex `18` (~9.4%) to hex `12` (~7%) for a lighter, more modern appearance.

### F2.7: Tab Bar Modernization

- Removed `borderTopWidth` (no more visible top border)
- Added upward-cast shadow for subtle elevation
- Height increased: 56px → 60px base (plus safe area)
- Padding increased: 6px → 8px

---

## 4. What's NOT in V6

- **GlassModal (expo-blur)**: expo-blur is installed but glassmorphism modals are deferred to a future version. The foundation is in place.
- **No new screens**: V6 is purely visual — same features, same data, new look.
- **No schema changes**: Zero migrations added.
- **No new tests**: Visual changes are verified via device testing, not unit tests.

---

## 5. Design Decisions

### D1: Inline Styles Over NativeWind for Accent Colors

NativeWind classes are statically resolved from tailwind.config.js and cannot change at runtime. Since accent colors are user-selectable, all accent-dependent styles use inline React Native styles driven by the `useColorScheme()` hook.

### D2: React Context for Theme Reactivity

Without context, changing the accent theme would only affect the settings screen. `AccentProvider` wraps the entire app, ensuring all mounted components re-render when the theme changes.

### D3: Full 50-900 Shade Scale per Theme

Rather than just providing a single accent color, each theme includes 10 shades (50-900). This allows proper light/dark mode adaptation — light mode uses darker shades (500-700) for accents, dark mode uses lighter shades (200-400).

### D4: Ocean = Zero Visual Change

The Ocean (blue) theme uses the exact same hex values as the pre-V6 hardcoded blue. Existing users see zero visual difference until they actively change their theme.

### D5: Semantic Colors Are Theme-Independent

Budget over/under colors, danger/success/warning indicators, and category colors never change with the accent theme. Only the primary/brand accent changes.
