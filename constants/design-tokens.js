/**
 * Arth design tokens — THE single source of truth for colour, radius, type and motion.
 *
 * Consumed by three places, all from this one file:
 *   1. `tailwind.config.js`        — maps SEMANTIC roles to `rgb(var(--color-x) / <alpha-value>)`
 *   2. `scripts/generate-theme.js` — emits the `:root` / `.dark:root` blocks in `global.css`
 *   3. `hooks/use-theme.ts`        — hands raw values to JS consumers (icon `color=`, SVG fills)
 *
 * Authored as CommonJS with a sibling `design-tokens.d.ts` so Node (tailwind config, scripts)
 * and TypeScript (the app) can both read it without an `allowJs` flag or a build step.
 *
 * Colours are stored as unquoted RGB channel triplets ("15 118 110"), NOT hex. This is required,
 * not stylistic: Tailwind's `withAlphaValue` cannot parse `var(--x)` when the variable holds a hex
 * string, so `bg-primary/10` would SILENTLY drop the alpha and render the flat colour. The triplet
 * form lets `rgb(var(--color-primary) / 0.1)` resolve correctly.
 */

/** Brand ramp. Note 900 (#134E4A) is the Android adaptive-icon background in app.json. */
const teal = {
  50: "240 253 250",
  100: "204 251 241",
  200: "153 246 228",
  300: "94 234 212",
  400: "45 212 191",
  500: "20 184 166",
  600: "13 148 136",
  700: "15 118 110",
  800: "17 94 89",
  900: "19 78 74",
};

/**
 * Semantic roles. Every key here becomes a CSS variable in both themes and a Tailwind colour.
 * A role must exist in BOTH `light` and `dark` — `scripts/verify-theme.js` enforces it.
 *
 * There are deliberately no `*Soft` / `*Bg` tint roles: registering the base colour in Tailwind
 * means `bg-success/10` now works, which is what the old `acAlpha()` helper and the `StatusColors
 * .successBg` entries existed to fake.
 */
const SEMANTIC = {
  light: {
    background: "247 248 248", //  #F7F8F8  screen ground
    card: "255 255 255", //  #FFFFFF  raised surface
    foreground: "18 24 27", //  #12181B  primary text
    mutedForeground: "93 107 111", //  #5D6B6F  secondary text — 5.2:1 (was #68787C at 4.32, failed AA)
    faintForeground: "147 162 166", //  #93A2A6  tertiary text / disabled
    border: "228 233 233", //  #E4E9E9  hairlines
    primary: teal[700], //  #0F766E  5.5:1 on card — AA for text
    primaryForeground: "255 255 255",
    accent: "180 83 9", //  #B45309  amber DARKENED for text (raw amber is 2.1:1 — fails)
    accentSolid: "245 158 11", //  #F59E0B  raw amber, fills and indicators ONLY
    success: "21 128 61", //  #15803D  5.3:1 (replaces #22C55E, which was 2.3:1 and failed)
    danger: "220 38 38", //  #DC2626  4.8:1
    warning: "180 83 9", //  #B45309
  },
  dark: {
    background: "13 17 19", //  #0D1113
    card: "22 28 31", //  #161C1F
    foreground: "242 245 245", //  #F2F5F5
    mutedForeground: "155 170 174", //  #9BAAAE
    faintForeground: "110 126 131", //  #6E7E83
    border: "36 45 49", //  #242D31
    primary: teal[400], //  #2DD4BF  10.1:1 on card
    primaryForeground: "4 33 30", //  #04211E
    accent: "251 191 36", //  #FBBF24  amber is safe as text on a dark ground
    accentSolid: "251 191 36",
    success: "74 222 128", //  #4ADE80
    danger: "248 113 113", //  #F87171
    warning: "251 191 36", //  #FBBF24
  },
};

/**
 * Type scale. Replaces the 269 arbitrary `text-[Npx]` values and the unused display/title/headline
 * scale that shipped in tailwind.config with zero adoption.
 *
 * `label` (11.5px) is the floor — nothing below it ships. The old codebase had 221 uses under 12px,
 * including 6 at 8px.
 */
const TYPE = {
  hero: ["36px", { lineHeight: "40px", letterSpacing: "-0.03em" }],
  display: ["28px", { lineHeight: "34px", letterSpacing: "-0.025em" }],
  title: ["22px", { lineHeight: "28px", letterSpacing: "-0.02em" }],
  heading: ["17px", { lineHeight: "24px", letterSpacing: "-0.01em" }],
  body: ["15px", { lineHeight: "21px" }],
  meta: ["13px", { lineHeight: "17px" }],
  label: ["11px", { lineHeight: "14px" }],
};

/**
 * NO overrides of Tailwind's own scale.
 *
 * `text-xs` and `text-sm` were briefly redefined to 13px and 15px, to fix the finding that 89% of
 * Arth's text was 14px or smaller. That was the wrong instrument for this app and is reverted.
 *
 * Arth is information-dense: thousands of side-by-side label/value rows, fixed-width numeric
 * columns, chips and badges. Widening every glyph by 7-8% tipped those rows into wrapping onto two
 * lines, and the vertical growth pushed whole screens down. Two rounds of layout fixes later, the
 * damage clearly outweighed the legibility gain.
 *
 * The original argument still stands, and is where the work went instead: hierarchy comes from
 * making the FEW important things large, not from nudging everything up a point. That is what the
 * TYPE scale above is for - hero at 36px on Home and the ledger - and it costs the dense screens
 * nothing.
 *
 * What IS kept from that pass: the 269 arbitrary text-[Npx] values are gone, and nothing renders
 * below 11px any more. Six sites were at 8px.
 */
const SCALE_OVERRIDES = {};

/** Card surfaces get `card`; controls and chips get `control`. Resolves the lg/xl/2xl free-for-all. */
const RADIUS = { control: "10px", card: "16px", sheet: "20px" };

const MOTION = {
  fast: 140,
  base: 220,
  slow: 320,
  easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
};

/**
 * Data colours — categorical, NOT semantic. These are read only from JS (chart fills, account
 * avatars) and are deliberately absent from the CSS variables: NativeWind strips any variable no
 * emitted utility references, so a CSS-only token consumed from JS resolves to undefined at runtime.
 */
const DATA = {
  accountType: {
    savings: "13 148 136",
    bank: "13 148 136",
    credit_card: "180 83 9",
    wallet: "139 92 246",
    demat: "20 184 166",
    loan: "220 38 38",
    pension: "99 102 241",
  },
  transfer: "139 92 246",
  series: ["15 118 110", "180 83 9", "139 92 246", "37 99 235", "219 39 119", "5 150 105"],
};


/**
 * COMPONENT RECIPES - the one place to change how the app looks.
 *
 * Colour, type, radius and motion are the tokens above. This is the other half: the SHAPE of
 * each component - its padding, its label size, how a pressed or disabled state reads. Those
 * decisions used to be written into each component file, so "make buttons less chunky" or
 * "tighten the cards" meant hunting through components/ui and hoping you found them all.
 *
 * Every value here is a Tailwind class string (or a plain number where the prop is not a class).
 * Change one line, run `npm run preview`, and see it applied across the whole design system
 * before you build anything.
 *
 * Rules that keep this honest:
 *   - Recipes describe SHAPE, never colour. Colour comes from a semantic role so both schemes
 *     stay correct; a hex here would be a light-mode-only decision.
 *   - Use the radius tokens (rounded-control / rounded-card / rounded-sheet) rather than
 *     rounded-lg / rounded-2xl, so a radius change is one edit in RADIUS above.
 *   - Use the type scale (text-label ... text-hero), never text-xs / text-sm.
 *
 * Every recipe is on the scale. The last four holdouts moved across deliberately, reviewed in
 * the preview before shipping rather than guessed at:
 *
 *   card.title   12px -> 11px, and off text-xs      52 card headers
 *   input.base   8px -> 10px radius, 16px -> 15px   121 inputs
 *   input.label / .hint / .error   12px -> 11px
 *   chip.label   12px -> 13px - the one that GREW, because 12px sat between two scale
 *                steps and the larger one is the right size for a tap target's label.
 */
const COMPONENTS = {
  button: {
    base: "flex-row items-center justify-center rounded-control",
    pad: "px-6 py-3",
    label: "text-body font-semibold",
    /** Applied on press-in. Kept as a number: it is an opacity, not a class. */
    pressedOpacity: 0.85,
    disabled: "opacity-50",
  },
  card: {
    base: "rounded-card bg-card p-5",
    title: "text-label font-semibold tracking-wider uppercase text-muted-foreground mb-3",
  },
  input: {
    base: "rounded-control border px-3 py-3 text-body text-foreground bg-card",
    label: "text-label font-semibold text-muted-foreground mb-1.5",
    hint: "text-label mt-1 ml-1",
    error: "text-label text-danger mt-1",
  },
  chip: {
    base: "px-3 py-1.5 rounded-full",
    label: "text-meta",
  },
  badge: {
    sm: { pad: "px-2 py-0.5", label: "text-label font-semibold", icon: 10 },
    md: { pad: "px-2.5 py-1", label: "text-meta font-semibold", icon: 12 },
    /** Background alpha for the default tinted tone. */
    tintAlpha: 0.12,
  },
  listRow: {
    base: "flex-row items-center py-3",
    icon: 18,
    title: "text-body text-foreground",
    subtitle: "text-meta text-muted-foreground",
  },
  separator: "h-px bg-border",
  sheet: {
    /** Numbers, not classes: these land in a style object on an animated panel. */
    radius: 20,
    backdrop: "rgba(0,0,0,0.45)",
    maxHeightPct: 92,
    handle: "w-10 h-1 rounded-full",
  },
  progress: { height: 8 },
};

module.exports = { teal, SEMANTIC, TYPE, SCALE_OVERRIDES, RADIUS, MOTION, DATA, COMPONENTS };
