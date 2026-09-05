/**
 * Retires the arbitrary sub-12px text sizes.
 *
 *   node scripts/codemod-typescale.js [--write]
 *
 * WHY ONLY THESE 269 SITES, and not a full remap of all 3,000 text classes:
 *
 * The problem measured in the audit is not "every size is 1px too small" — it is that nothing is
 * big, so there is no hierarchy. Remapping 3,000 call sites would produce an enormous diff, risk
 * clipping against the fixed heights used throughout (h-9, h-14, maxHeight: 320), and still not
 * create hierarchy. Hierarchy comes from making the FEW important things large, which is per-screen
 * work in the redesign phase, not a find-and-replace.
 *
 * The two changes that ARE global are handled without touching call sites at all, by redefining
 * `xs` (12 -> 13px) and `sm` (14 -> 15px) in tailwind.config.js. Those two classes cover 2,723 of
 * the app's text sites; overriding the scale moves all of them at once and is a one-line revert if
 * the device shows clipping.
 *
 * That leaves only the arbitrary values, which are a genuine accessibility problem (6 sites at 8px)
 * and cannot be fixed by a scale override because they bypass the scale entirely.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

/** Every arbitrary size below the 11.5px floor collapses onto the `label` step. */
const SIZES = ["text-[8px]", "text-[9px]", "text-[10px]", "text-[11px]"];
const TARGET = "text-label";

const WRITE = process.argv.includes("--write");

function parses(code) {
  try {
    babel.parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
    return true;
  } catch {
    return false;
  }
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

const counts = {};
let filesChanged = 0;
const skipped = [];

for (const file of [...walk("app"), ...walk("components")]) {
  const src = fs.readFileSync(file, "utf8");
  let next = src;
  for (const size of SIZES) {
    if (!next.includes(size)) continue;
    counts[size] = (counts[size] || 0) + (next.split(size).length - 1);
    next = next.split(size).join(TARGET);
  }
  if (next === src) continue;
  if (!parses(next)) {
    skipped.push(file);
    continue;
  }
  filesChanged++;
  if (WRITE) fs.writeFileSync(file, next, "utf8");
}

console.log((WRITE ? "APPLIED" : "DRY RUN") + " — " + filesChanged + " files\n");
let total = 0;
for (const s of SIZES) {
  if (!counts[s]) continue;
  total += counts[s];
  console.log("  " + String(counts[s]).padStart(4) + "  " + s.padEnd(14) + " -> " + TARGET);
}
console.log("\n  " + total + " arbitrary sizes retired");
if (skipped.length) console.log("\n  SKIPPED (would not parse): " + skipped.join(", "));
