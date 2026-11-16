# Design System

**Source of truth:** `constants/design-tokens.js`. Colour, type, radius, motion, money tones and the
shape of every shared component live there. `tailwind.config.js`, `scripts/generate-theme.js`
(the `:root` / `.dark:root` blocks in `global.css`) and `hooks/use-theme.ts` all read it. If this
page and that file disagree, the file wins; fix this page.

To see everything at once: `npm run preview` opens the gallery in `preview/index.tsx`.

The transactions screens follow `docs/TRANSACTIONS_DESIGN_SYSTEM_PLAN.md`, and
`__tests__/unit/design-tokens-usage.test.ts` fails if they drift off the rules below.

## Rules

1. **Type scale only.** `text-label` … `text-hero`. Never `text-xs/sm/base/lg/xl/2xl/3xl`, never
   `text-[Npx]`, never an inline `fontSize`.
2. **Radius tokens only.** `rounded-control` / `rounded-card` / `rounded-sheet` / `rounded-pill`.
   Where a number is unavoidable (an animated style), derive it from `RADIUS`.
3. **Colour through the theme.** `useTheme()` for JS colours, the semantic Tailwind classes
   (`text-muted-foreground`, `bg-card`, `bg-primary/10`) for classes. `theme.alpha(role, a)` for a
   tint of a role; `tint(color, a)` (`constants/brand.ts`) for a data colour such as a category's.
   Never `hex + "14"`. Never `useColorScheme().colors` (that hook is only for the scheme itself).
4. **Shared parts over private copies.** If a chip, row, switch or heading exists in
   `components/ui`, use it; change its look in `COMPONENTS`, not at the call site.

## Colour

Semantic roles, defined for both schemes (`SEMANTIC` in the tokens, checked by
`scripts/verify-theme.js` and `__tests__/unit/theme.test.ts`):

| Role | Light | Dark | Use |
|---|---|---|---|
| `background` | #F7F8F8 | #0D1113 | screen ground |
| `card` | #FFFFFF | #161C1F | raised surfaces |
| `foreground` | #12181B | #F2F5F5 | primary text |
| `mutedForeground` | #5D6B6F | #9BAAAE | secondary text (AA) |
| `faintForeground` | #93A2A6 | #6E7E83 | tertiary text, disabled |
| `border` | #E4E9E9 | #242D31 | hairlines |
| `primary` | #0F766E (teal 700) | #2DD4BF (teal 400) | interactive, selection |
| `accent` | #B45309 | #FBBF24 | amber as text |
| `accentSolid` | #F59E0B | #FBBF24 | amber fills only (fails AA as text) |
| `success` | #15803D | #4ADE80 | money in, done |
| `danger` | #DC2626 | #F87171 | over budget, failures, delete |
| `warning` | #B45309 | #FBBF24 | needs review, partial |

Data colours (JS only, not CSS variables): `DATA.accountType`, `DATA.transfer` (purple
#8B5CF6), `DATA.series` for charts. Read them from `theme.data`.

### Money tones (`MONEY`)

Which way the money went, not whether it is "bad". Resolve with `moneyTone(theme, tone)` from
`components/ui`.

| Tone | Colour | For |
|---|---|---|
| `out` | foreground ink on a faint neutral fill | spending - the normal case, so not red |
| `in` | success | credits, refunds |
| `moved` | `DATA.transfer` purple | transfers between your own accounts |
| `over` | danger | over budget, failed - the only red money |

## Type (`TYPE`)

| Class | Size / line | Use |
|---|---|---|
| `text-hero` | 36 / 40 | the amount on a transaction, Home and ledger balances |
| `text-display` | 28 / 34 | large figures |
| `text-title` | 22 / 28 | screen and sheet titles ("Filters", "More") |
| `text-heading` | 17 / 24 | section titles, card headings |
| `text-body` | 15 / 21 | row titles, inputs, buttons |
| `text-meta` | 13 / 17 | row line 2, chips, hints |
| `text-label` | 12 / 16 | the floor: rail labels, badges, uppercase section labels |

`label` was 11px until Nov 2026. Uppercase section labels: `text-label font-semibold uppercase
tracking-wider text-muted-foreground` (what `SectionHeader` and `Card`'s title render).

Inter, registered natively at 400/500/600/700. `Text` turns tabular figures on by default so money
columns line up.

## Radius (`RADIUS`)

| Class | Value | Use |
|---|---|---|
| `rounded-control` | 10 | inputs, icon tiles, toolbar buttons, small boxes |
| `rounded-card` | 16 | cards, month / day drawers |
| `rounded-sheet` | 20 | bottom sheets |
| `rounded-pill` | 9999 | buttons, chips, badges |

## Motion (`MOTION`)

`fast` 140ms (presses), `base` 220ms (state changes), `slow` 320ms (screens), `count` 700ms
(number count-ups), `stagger` 60ms. One easing curve. Springs only for things a finger lets go
of, never for money. See `docs/MOTION_SYSTEM_PROPOSAL.md`.

## Shared parts (`components/ui`)

| Part | What it is |
|---|---|
| `Button` | pill button: `primary`, `secondary`, `outline`, `ghost`; loading, haptics |
| `Card` | `rounded-card bg-card p-5`, optional uppercase title |
| `Input` | labelled input with hint and error; `formula` for `=` maths |
| `Chip` / `ChipWrap` | one chip: `choice` (on/off, 36px), `removable` (applied filter with ✕), `category` (icon + the category's colour), `add` (dashed "+ Add category"), `status` (one status word, sentence case) |
| `FilterChip` | a `Chip` choice with a right margin, for older horizontal rows |
| `RadioRow`, `CheckRow` | 44px option rows with a sub-line, colour dot and trailing slot |
| `Segmented` | 2-4 option switch ("Any / Needs review / Approved") |
| `SearchField` | search box; default placeholder hints amount search (`>5000`); `size="lg"` and a `right` slot |
| `SectionTitle` | icon in a tinted square + title + hint; heads filter sections, form groups, detail cards |
| `SectionHeader` | the small uppercase label over a screen section |
| `ActionRow` | up to four round buttons with labels: a transaction's next steps |
| `MoneyChip` | an amount in a pill with an arrow, coloured by money tone |
| `FieldRow` | label left, value right, inside a card; tappable with a chevron |
| `Badge` | small status pill for non-transaction screens |
| `ListToolbar` | search, filter, sort, group, applied-filter chips; the same on every list |
| `FilterSheetParts` | the filter sheets' header, icon rail item, Cancel / Apply footer, `applyLabelFor` ("Show 24 transactions") |
| `Sheet`, `SelectSheet` | bottom sheet; a sheet of options |
| `SwipePager` | tabs with swipe (Transactions: All / Expenses / Credits / Transfers) |
| `EmptyState`, `LoadingState`, `LoadFailedBanner` | states |
| `ScreenContainer` | safe area; `padTop={false}` under a Stack header |

Transaction-specific parts in `components/expense`: `ExpenseListItem` (the row), `MonthDrawer`
(`DrawerHeader`, `MonthDrawerHeader`, `DrawerBody`, `DrawerEnd`), `TransactionFilterSheet`,
`FullScreenFilter` (the sheet every other list's filter opens), `ExpenseHeroCard`,
`ExpenseMetadata` (the Source card), `MoreActionsSheet`.

### Patterns

- **Transaction row:** icon tile · name and amount · line 2 = category chip · paid by · account ·
  one status chip. No date under a date heading.
- **Transaction detail and edit:** hero (icon, name, amount on `text-hero`, one meta line) →
  `ActionRow` → What / Where / Source cards. Edit uses the same three groups.
- **Filter sheet:** 20/80 icon rail, a `SectionTitle` per section, Cancel + "Show N …".
- **Stack headers:** `fontWeight: "700"`, `fontSize: 18`, `headerShadowVisible: false`
  (`components/ui/stack-options.tsx`).
- **Layout:** 16px side gutter (`px-4`); `showsVerticalScrollIndicator={false}`; sheets for
  multi-step input rather than new screens.

## Shadows (`constants/theme.ts` → `Shadows`)

`card`, `dropdown`, `fab`, `tabBar`. No elevation on Android cards (they get a hairline border
instead), because mid-transition elevation draws as dark boxes.

## Icons

`@expo/vector-icons/Ionicons`, imported directly (the package root bundles all 19 icon fonts).
Colour from the theme: `primary` for interactive, `mutedForeground` for decorative.
