# Making UI changes

Two commands and two files. Nothing here needs a device or a Gradle build.

## See it

```
npm run preview
```

Serves the whole design system at http://localhost:8090 with the real tokens,
the real NativeWind classes and real text wrapping at phone width. There is a
light/dark toggle in the top right. Edits hot-reload.

This is not a mock. It renders the actual components from `components/ui`, plus
the two compositions that have historically broken: a ledger row, and the
YoY / Compare numeric table.

## Change it

### `constants/design-tokens.js` — the one job file

| Want to change | Edit |
|---|---|
| Any colour, light or dark | `SEMANTIC` |
| Text sizes and line heights | `TYPE` |
| Corner radii | `RADIUS` |
| Animation durations | `MOTION` |
| Chart / account-type colours | `DATA` |
| **How a component is shaped** — padding, label size, pressed and disabled states | **`COMPONENTS`** |

After touching `SEMANTIC` or `RADIUS`, run `node scripts/generate-theme.js` —
`global.css` is generated from them. `theme.test.ts` fails if you forget.

### The component file itself

Only when you are changing *structure* — adding a prop, changing what elements
are rendered. Appearance belongs in `COMPONENTS`.

## Check it

```
npm run verify
```

Typecheck (regenerating the route map first), the three audits, and the tests.
About 30 seconds.

The audits exist because each one caught a bug that had already shipped:

- `audit-hooks` — a hook inside a class component, invisible to tsc and the
  tests, which crashed the app on launch.
- `audit-sheets` — `flex-1` on a direct child of `Sheet` lays out at zero
  height and the content is silently never drawn; also flags any hand-rolled
  sheet.
- `resolve-classes` — every token resolves in both schemes, and no legacy or
  `dark:` class survives.

## Rules that keep this cheap

1. **Never a hex in a component.** Use a semantic role, so both schemes stay
   correct. `theme.data.*` is the exception, for colour that encodes data.
2. **Never `text-xs` / `text-sm`.** Use the scale: `text-label` (11),
   `text-meta` (13), `text-body` (15), `text-heading` (17), `text-title`,
   `text-display`, `text-hero`.
3. **Never `rounded-lg` / `rounded-2xl`.** Use `rounded-control`,
   `rounded-card`, `rounded-sheet`.
4. **Never hand-roll a bottom sheet.** Use `<Sheet>`; `audit-sheets` fails the
   build otherwise.
5. **`flex-1` is for flex ROWS.** On a direct child of `Sheet` it collapses to
   zero height.

## Why the harness has its own root

`app/_layout.tsx` initialises SQLite, MMKV, the SMS scan, notification channels
and background tasks on mount — none of which exist in a browser. `preview/` is
a second Expo Router root that does none of that, and `app.config.js` points
Expo at it only when `ARTH_PREVIEW=1`. Without that flag the config is
identical, so prebuild and the release build are unaffected.
