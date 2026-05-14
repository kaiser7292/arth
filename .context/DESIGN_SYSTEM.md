# Design System

## Visual Identity

**Aesthetic:** Notion-inspired. Clean, spacious, modern finance. Warm neutral surfaces with blue primary accent.

**Theme:** Automatic light/dark mode based on system preference.

## Color Tokens

### Primary Palette (Blue)
| Token | Value | Usage |
|-------|-------|-------|
| primary.50 | #EFF6FF | Lightest tint backgrounds |
| primary.100 | #DBEAFE | Light badge backgrounds |
| primary.400 | #60A5FA | Dark mode tint |
| primary.500 | #3B82F6 | Medium emphasis |
| primary.600 | #2563EB | Light mode primary (buttons, links, icons) |

### Semantic Colors
| Token (Light) | Token (Dark) | Usage |
|---------------|--------------|-------|
| #1A1A1A | #FFFFFF | Primary text |
| #6B7280 | #A0A0A0 | Secondary text |
| #F9F9F7 | #111111 | Screen background |
| #F7F7F5 | #1E1E1E | Card surfaces |
| #E5E5E3 | #2E2E2E | Borders, dividers |
| #2563EB | #60A5FA | Tint (interactive elements) |

### Status Colors
| Name | Light | Dark | Usage |
|------|-------|------|-------|
| success | #22C55E | #4ADE80 | Positive amounts, gains |
| danger | #EF4444 | #F87171 | Negative, over-budget, delete |
| warning | #F59E0B | #FBBF24 | Alerts, approaching limit |
| muted | #9CA3AF | #6B7280 | Disabled, placeholder |

### Accent Themes (5 presets)
Users can choose from 5 accent color palettes. The accent is used for interactive elements, badges, and highlights. Default is blue.

## Typography Scale

| Usage | Style | Weight | Size |
|-------|-------|--------|------|
| Screen title (Stack header) | `headerTitleStyle` | 700 (bold) | 18px |
| Section header | `text-base font-bold` | 700 | 16px |
| Card title | `text-sm font-semibold` | 600 | 14px |
| Body text | `text-sm` | 400 | 14px |
| Caption / label | `text-xs` | 400–600 | 12px |
| Section label (uppercase) | `text-xs font-semibold uppercase tracking-wider` | 600 | 12px |
| Large amount | `text-lg font-bold` | 700 | 18px |
| Inline amount | `text-sm font-bold` | 700 | 14px |

## Spacing

| Context | Value | NativeWind Class |
|---------|-------|-----------------|
| Screen horizontal padding | 16px | `px-4` |
| Screen vertical padding | 16px | `py-4` |
| Card internal padding | 16px | (via Card component) |
| Card margin bottom | 8–16px | `mb-2` to `mb-4` |
| Between form fields | 12px | `mb-3` |
| Bottom scroll padding | 32–80px | `paddingBottom: 32` |
| FAB position | bottom-right | `bottom-6 right-6` |

## Component Library

### Core Components (in `components/ui/`)
- **Button** — Primary action button with loading state, haptic feedback
- **Card** — Elevated surface with consistent border radius, padding, shadow
- **Input** — Text input with label, error state
- **ScreenContainer** — Wrapper with safe area, optional top padding
- **CalendarModal** — Date picker modal (replaces raw text date input)
- **CollapsibleSection** — Expandable/collapsible content
- **SimpleMarkdown** — Renders markdown in help articles

### Layout Rules
- All screens use `<ScreenContainer padTop={false}>` under Stack headers
- ScrollViews: `showsVerticalScrollIndicator={false}`, bottom padding for content
- FlatList for long lists with `keyExtractor` and pagination
- Bottom sheets for complex input flows (not new screens)

### Stack Header Pattern
```tsx
<Stack
  screenOptions={{
    headerStyle: { backgroundColor: theme.background },
    headerTitleStyle: { fontWeight: "700", fontSize: 18, color: theme.text },
    headerTintColor: theme.tint,
    headerShadowVisible: false,
  }}
>
```

### Empty State Pattern
- Centered icon (48px, muted color)
- Title: `text-lg font-medium`
- Subtitle: `text-sm text-center`

### FAB Pattern
```
absolute bottom-6 right-6 w-14 h-14 rounded-full bg-primary-500
items-center justify-center shadow-lg
```

## NativeWind (Tailwind CSS for RN)

- Dark mode via `class` strategy (`dark:` prefix)
- Custom colors defined in `tailwind.config.js`
- Content paths: `./app/**/*.{ts,tsx}`, `./components/**/*.{ts,tsx}`
- Custom border radius: `rounded-card` (16px), `rounded-button` (14px)
- Custom font sizes: display/title/headline/body/caption/label/micro

## Shadows
- **card:** Soft, diffused (iOS: shadowOpacity 0.06, shadowRadius 8; Android: elevation 2)
- **dropdown:** Medium (iOS: shadowOpacity 0.08, shadowRadius 12; Android: elevation 4)
- **fab:** Strong (iOS: shadowOpacity 0.12, shadowRadius 12; Android: elevation 8)
- **tabBar:** Upward subtle (iOS: shadowOpacity 0.05, offset -2; Android: elevation 4)

## Icons
- **Library:** @expo/vector-icons (Ionicons)
- **Size convention:** 18px for small, 24px for medium, 28px for FAB, 48px for empty states
- **Color:** Always use theme tokens (tint for interactive, muted for decorative)
