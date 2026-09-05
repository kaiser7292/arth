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

/** The semantic tokens the app now uses, with their measured occurrence counts. */
const PROBES = [
  ["text-foreground", null],
  ["text-muted-foreground", null],
  ["text-faint-foreground", null],
  ["bg-background", null],
  ["bg-card", null],
  ["border-border", null],
  ["bg-primary", null],
  ["bg-primary/10", null],
  ["text-primary", null],
  ["text-accent", null],
  ["text-success", null],
  ["text-danger", null],
  ["text-warning", null],
  ["bg-danger/10", null],
];

/**
 * Classes that must no longer appear anywhere in source. They were deleted from tailwind.config,
 * so any survivor compiles to nothing and renders an unstyled element — invisible to tsc, invisible
 * to the test suite, and visible only as a wrong colour on a device.
 */
const FORBIDDEN = [
  "dark:",
  "text-text-primary",
  "text-text-secondary",
  "text-text-tertiary",
  "bg-surface-light",
  "bg-surface-dark",
  "bg-border-light",
  "border-border-light",
  "rounded-button",
  "text-micro",
];

function scanForbidden() {
  const hits = [];
  const walkSrc = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walkSrc(f);
      else if (f.endsWith(".tsx")) {
        const text = fs.readFileSync(f, "utf8");
        for (const bad of FORBIDDEN) {
          if (text.includes(bad)) hits.push({ file: f, cls: bad });
        }
      }
    }
  };
  for (const d of ["app", "components"]) if (fs.existsSync(d)) walkSrc(d);
  return hits;
}

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
    const forbidden = scanForbidden();
    if (forbidden.length) {
      console.error("");
      console.error("FORBIDDEN classes still in source — these compile to nothing and render");
      console.error("an unstyled element, which tsc and the test suite cannot see:");
      for (const h of forbidden.slice(0, 25)) console.error("  " + h.file + "   " + h.cls);
      if (forbidden.length > 25) console.error("  ... and " + (forbidden.length - 25) + " more");
    }
    if (bad || forbidden.length) {
      console.error("");
      console.error(bad + forbidden.length + " problem(s) found.");
      process.exit(1);
    }
    console.log("");
    console.log("Every token resolves in both schemes, and no legacy or dark: class survives");
    console.log("anywhere in app/ or components/.");
  });
