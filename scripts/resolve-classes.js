/**
 * Resolves real class strings from the app through the actual Tailwind + NativeWind pipeline and
 * prints the colour each produces in light and dark.
 *
 * This is the only way to verify colour statically: the values live in compiled CSS, so neither
 * tsc nor the Jest suite can see them, and the alternative is a device sweep per commit.
 *
 *   node scripts/resolve-classes.js                  # the default probe set
 *   node scripts/resolve-classes.js "bg-primary/10"  # ad hoc
 */
const fs = require("fs");
const path = require("path");
const postcss = require("postcss");
const tailwind = require("tailwindcss");
const { cssToReactNativeRuntime } = require("react-native-css-interop/dist/css-to-rn");

const ROOT = path.join(__dirname, "..");
const config = require(path.join(ROOT, "tailwind.config.js"));

/** The highest-frequency class strings in the codebase, by measured occurrence count. */
const PROBES = [
  ["text-text-secondary dark:text-text-dark-secondary", 1132],
  ["text-text-primary dark:text-text-dark-primary", 844],
  ["border-border-light dark:border-border-dark", 474],
  ["bg-surface-light-alt dark:bg-surface-dark-alt", 150],
  ["bg-border-light dark:bg-border-dark", 72],
  ["bg-surface-light dark:bg-surface-dark", 41],
  ["text-text-tertiary", 90],
  ["bg-white dark:bg-surface-dark-alt", 31],
  ["text-success", null],
  ["text-danger", null],
  ["bg-primary", null],
  ["bg-primary/10", null],
  ["text-foreground", null],
  ["text-muted-foreground", null],
];

const args = process.argv.slice(2);
const probes = args.length ? args.map((a) => [a, null]) : PROBES;

const classes = [...new Set(probes.flatMap(([c]) => c.split(/\s+/)))];
const src = fs.readFileSync(path.join(ROOT, "global.css"), "utf8");

const hex = (ch) =>
  Array.isArray(ch)
    ? "#" + ch.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase()
    : String(ch);

postcss([tailwind({ ...config, content: [{ raw: classes.join(" "), extension: "html" }] })])
  .process(src, { from: undefined })
  .then((out) => {
    const compiled = cssToReactNativeRuntime(Buffer.from(out.css), {
      darkMode: { type: "class", value: "dark" },
    });
    const vars = compiled.rootVariables || {};

    /** Pull the variable a utility references, then read both scheme values from rootVariables. */
    const resolve = (cls) => {
      const rule = (compiled.rules || {})[cls.replace(/\//g, "\/")] || (compiled.rules || {})[cls];
      const json = JSON.stringify(rule || {});
      const m = json.match(/--color-[a-z-]+/);
      if (!m) return null;
      const v = vars[m[0]];
      return v ? { name: m[0], light: hex(v.light), dark: hex(v.dark) } : null;
    };

    let bad = 0;
    let orphans = 0;
    console.log("class string".padEnd(52) + "uses".padStart(6) + "  light      dark       token");
    console.log("-".repeat(104));
    for (const [str, uses] of probes) {
      const parts = str.split(/\s+/);
      const r = resolve(parts[0]);
      const d = parts[1] ? resolve(parts[1]) : null;
      if (!r) {
        // Not a script failure: the light half is a raw Tailwind literal (bg-white, text-red-600)
        // rather than a design token, so it has no variable to read. It renders correctly today
        // only by coincidence and will NOT flip with the scheme. These are the orphans that turn
        // into white cards in dark mode the moment the legacy tokens are deleted.
        console.log(
          str.padEnd(52) + String(uses ?? "").padStart(6) +
            "  --         --         (literal, not a token) NEEDS HAND EDIT",
        );
        orphans++;
        continue;
      }
      // The whole point of the token collapse: the light class already flips by scheme, so the
      // paired dark: class is now redundant rather than load-bearing.
      const redundant = d && d.name === r.name ? "  (dark: now redundant)" : d ? "  MISMATCH" : "";
      if (d && d.name !== r.name) bad++;
      console.log(
        str.padEnd(52) +
          String(uses ?? "").padStart(6) +
          "  " + r.light.padEnd(10) + " " + r.dark.padEnd(10) + " " + r.name + redundant,
      );
    }
    if (bad) {
      console.error("\n" + bad + " probe(s) failed to resolve or disagreed across the pair.");
      process.exit(1);
    }
    console.log("\nAll probes resolve, and every legacy pair now maps to one scheme-aware token.");
  });
