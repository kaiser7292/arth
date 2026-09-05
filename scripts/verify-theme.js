/**
 * Theme guards. Run via `npm run verify:theme`, and from `__tests__/unit/theme.test.ts`.
 *
 * These catch failure modes neither TypeScript nor the existing test suite can see, because they
 * live in CSS strings and surface only as wrong pixels on a device:
 *
 *   1. DARK MODE SILENTLY OFF — a bare `.dark {}` selector instead of `.dark:root {}` compiles to
 *      a dead class rule. Every screen then renders light colours on a dark ground, no error.
 *   2. STALE global.css — it is generated; a hand edit is reverted by the next generate.
 *   3. VARIABLES STRIPPED — NativeWind drops any CSS variable no emitted utility references.
 *   4. CONTRAST REGRESSION — a text role falling under WCAG AA against its ground.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { cssToReactNativeRuntime } = require("react-native-css-interop/dist/css-to-rn");
const { SEMANTIC } = require("../constants/design-tokens.js");

const ROOT = path.join(__dirname, "..");
const failures = [];
const fail = (msg) => failures.push(msg);

/* ---- 1. global.css is in sync with the tokens ------------------------------------------ */
try {
  execFileSync("node", [path.join(__dirname, "generate-theme.js"), "--check"], { stdio: "pipe" });
} catch {
  fail("global.css is stale. Run: node scripts/generate-theme.js");
}

/* ---- 2. compile Tailwind's OUTPUT, not the raw source ----------------------------------
 * Raw global.css cannot go straight to the compiler: NativeWind strips every CSS variable that no
 * emitted utility references, so an unprocessed file yields zero variables. Tailwind must run
 * first. The probe forces one utility per registered colour, which is exactly the condition under
 * test — "when a role IS referenced, does it resolve in both light and dark?"
 */
async function compileTheme() {
  const postcss = require("postcss");
  const tailwind = require("tailwindcss");
  const config = require("../tailwind.config.js");

  const probe = [];
  for (const [key, val] of Object.entries(config.theme.extend.colors)) {
    if (typeof val === "string") {
      probe.push("bg-" + key, "text-" + key);
    } else {
      for (const sub of Object.keys(val)) {
        probe.push(sub === "DEFAULT" ? "bg-" + key : "bg-" + key + "-" + sub);
      }
    }
  }
  probe.push("bg-primary/10", "text-success/60"); // exercise the <alpha-value> path

  const src = fs.readFileSync(path.join(ROOT, "global.css"), "utf8");
  const out = await postcss([
    tailwind({ ...config, content: [{ raw: probe.join(" "), extension: "html" }] }),
  ]).process(src, { from: undefined });

  return cssToReactNativeRuntime(Buffer.from(out.css), {
    // must mirror tailwind.config.js, or the dark-root selector is not recognised
    darkMode: { type: "class", value: "dark" },
  });
}

function cssName(role) {
  return "--color-" + role.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
}

function checkVariables(compiled) {
  const rootVars = compiled.rootVariables || {};

  if (Object.keys(rootVars).length === 0) {
    fail("No root variables survived compilation — global.css lost its :root block.");
    return rootVars;
  }

  for (const role of Object.keys(SEMANTIC.light)) {
    const name = cssName(role);
    const v = rootVars[name];
    if (!v) {
      fail("Variable " + name + " did not survive compilation.");
      continue;
    }
    if (!("light" in v)) fail("Variable " + name + " has no light value.");
    // THE guard: a bare `.dark` selector yields a light-only variable and no error anywhere.
    if (!("dark" in v)) {
      fail(
        "Variable " + name + " has NO DARK VALUE — dark mode is silently broken. The dark " +
          "block in global.css must use the selector '.dark:root', never '.dark'.",
      );
    }
  }
  return rootVars;
}

/* ---- 3. contrast ---------------------------------------------------------------------- */
const lin = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const lum = (ch) => {
  const [r, g, b] = ch.split(/\s+/).map(Number);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Roles used as TEXT must clear AA. `accentSolid` is fills-only and deliberately excluded. */
const TEXT_ROLES = [
  "foreground",
  "mutedForeground",
  "primary",
  "accent",
  "success",
  "danger",
  "warning",
];
const AA = 4.5;
const contrast = [];

for (const scheme of ["light", "dark"]) {
  for (const ground of ["background", "card"]) {
    for (const role of TEXT_ROLES) {
      const r = ratio(SEMANTIC[scheme][role], SEMANTIC[scheme][ground]);
      contrast.push({ scheme, ground, role, ratio: r });
      if (r < AA) {
        fail(
          "Contrast " + scheme + "/" + ground + ": " + role + " is " + r.toFixed(2) +
            ":1, below AA " + AA + ":1.",
        );
      }
    }
  }
}

async function verifyTheme() {
  const compiled = await compileTheme();
  const rootVariables = checkVariables(compiled);
  return { rootVariables, contrast, failures };
}

module.exports = { verifyTheme, contrast, ratio, failures };

if (require.main === module) {
  verifyTheme().then(({ rootVariables }) => {
    console.log("Compiled " + Object.keys(rootVariables).length + " root variables.");
    const worst = contrast.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 4);
    console.log("Tightest contrast pairs:");
    for (const c of worst) {
      console.log("  " + c.ratio.toFixed(2) + ":1  " + c.role + " on " + c.ground + " (" + c.scheme + ")");
    }
    if (failures.length) {
      console.error("\nFAILED:");
      for (const f of failures) console.error("  - " + f);
      process.exit(1);
    }
    console.log("\nAll theme guards passed.");
  });
}
