const fs = require("fs");
const path = require("path");

/**
 * Resolve the token file by walking up from this config's own directory.
 *
 * A plain `require("./constants/design-tokens.js")` breaks the Android build: NativeWind/Metro
 * resolves tailwind.config.js relative to `android/` during Expo autolinking, so the build copies
 * this file to `android/tailwind.config.js` (see .github/workflows/build-apk.yml). From there a
 * relative require points at `android/constants/...`, which does not exist. Walking up finds the
 * real file from either location.
 */
function loadTokens() {
  let dir = __dirname;
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, "constants", "design-tokens.js");
    if (fs.existsSync(candidate)) return require(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("tailwind.config.js: cannot locate constants/design-tokens.js from " + __dirname);
}

const { SEMANTIC, TYPE, RADIUS } = loadTokens();

/**
 * Maps a semantic role to a Tailwind colour backed by its CSS variable.
 *
 * The `<alpha-value>` placeholder is what makes `bg-primary/10` work: Tailwind converts any theme
 * colour string containing it into a function, then `withAlphaVariable` substitutes the modifier.
 * This only parses because the variable holds RGB channels rather than hex — see design-tokens.js.
 */
const role = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: {
    extend: {
      borderRadius: {
        control: RADIUS.control,
        card: RADIUS.card,
        sheet: RADIUS.sheet,
        // legacy — retained until the sweep completes
        button: "14px",
      },

      fontSize: {
        ...TYPE,
        // legacy — retained until the sweep completes
        display: ["32px", { lineHeight: "38px" }],
        headline: ["18px", { lineHeight: "26px" }],
        caption: ["14px", { lineHeight: "20px" }],
        micro: ["10px", { lineHeight: "14px" }],
      },

      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["monospace"],
      },

      colors: {
        /* ---- new semantic roles: one token, both themes, no `dark:` variant needed ---- */
        background: role("background"),
        card: role("card"),
        foreground: role("foreground"),
        "muted-foreground": role("muted-foreground"),
        "faint-foreground": role("faint-foreground"),
        primary: {
          DEFAULT: role("primary"),
          foreground: role("primary-foreground"),
        },
        accent: {
          DEFAULT: role("accent"),
          solid: role("accent-solid"),
        },

        /* ---------------------------------------------------------------------------
         * LEGACY TOKENS — every key below is still referenced by the un-migrated screens.
         * They are re-pointed at the SAME variables as the new roles so that old and new
         * class names can never render different colours during the sweep. Deleted in the
         * final step, at which point any orphaned `dark:` class stops compiling and the
         * `no-legacy-classes` check in scripts/verify-theme.js catches it.
         * ------------------------------------------------------------------------- */
        surface: {
          light: role("background"),
          "light-alt": role("card"),
          dark: role("background"),
          "dark-alt": role("card"),
        },
        border: {
          DEFAULT: role("border"),
          light: role("border"),
          dark: role("border"),
        },
        text: {
          primary: role("foreground"),
          secondary: role("muted-foreground"),
          tertiary: role("faint-foreground"),
          "dark-primary": role("foreground"),
          "dark-secondary": role("muted-foreground"),
          "dark-tertiary": role("faint-foreground"),
        },
        success: role("success"),
        danger: role("danger"),
        warning: role("warning"),
        budget: {
          under: role("success"),
          warning: role("warning"),
          over: role("danger"),
        },
      },
    },
  },
  plugins: [],
};
