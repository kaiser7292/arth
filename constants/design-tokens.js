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
  label: ["11.5px", { lineHeight: "14px" }],
};

/**
 * Overrides for Tailwind's own scale.
 *
 * `text-xs` and `text-sm` account for 2,723 of the app's text sites — 89% of all text is 14px or
 * smaller, which is why Arth reads as dense and flat. Redefining these two steps moves every one of
 * those sites at once, with no call-site churn and a one-line revert if the device shows clipping
 * against the fixed heights used throughout (h-9, h-14, maxHeight: 320).
 *
 * The alternative — rewriting 2,723 class names — would produce an enormous diff, carry the same
 * clipping risk, and still not create hierarchy. Hierarchy comes from making the few important
 * things large, which is per-screen work, not a find-and-replace.
 *
 * After the override, `text-xs` and `text-meta` are the same size, as are `text-sm` and `text-body`.
 * New code should prefer the semantic names.
 */
const SCALE_OVERRIDES = {
  // Leading is held near Tailwind's original (16px / 20px) on purpose.
  //
  // The first version raised line-height along with font size - xs 16->18, sm 20->22 - and the
  // leading grew MORE than the glyphs did, 13% and 10%. Across 2,723 text elements that is what
  // pushed whole screens down, not the letters themselves. sm now consumes exactly the vertical
  // space it always did while rendering a point larger; xs takes one extra pixel.
  xs: ["13px", { lineHeight: "17px" }], // was 12px/16px x 1591 uses
  sm: ["15px", { lineHeight: "20px" }], // was 14px/20px x 1132 uses
};

/** Card surfaces get `card`; controls and chips get `control`. Resolves the lg/xl/2xl free-for-all. */
const RADIUS = { control: "10px", card: "14px", sheet: "20px" };

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

module.exports = { teal, SEMANTIC, TYPE, SCALE_OVERRIDES, RADIUS, MOTION, DATA };
