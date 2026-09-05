/**
 * Second sweep pass: the pairs the main codemod deliberately refused to touch.
 *
 * In every case here the LIGHT half is a raw Tailwind literal with no CSS variable behind it, so
 * it cannot flip with the colour scheme. Dropping the dark half would have left a white card on a
 * dark ground. Each pair is therefore replaced wholesale with the semantic token that carries the
 * same intent in both schemes, decided by reading the call site rather than by pattern.
 *
 *   node scripts/codemod-orphans.js [--write]
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

/** [literal pair, replacement, why]. Longest/most specific first. */
const PAIRS = [
  // Surfaces. `bg-white` was standing in for "the raised surface"; that is `card` in both schemes.
  ["bg-white dark:bg-surface-dark-alt", "bg-card", "raised surface"],
  ["bg-white dark:bg-surface-dark", "bg-card", "active pill raised above its track"],
  // A chip meant to read as distinct FROM the card: lighter-grey in light, darker in dark.
  // `background` preserves that relationship on both grounds.
  ["bg-surface-light-alt dark:bg-surface-dark", "bg-background", "chip distinct from the card"],

  // Danger.
  ["bg-red-50 dark:bg-red-900/30", "bg-danger/10", "danger tint"],
  ["text-red-600 dark:text-red-400", "text-danger", "danger text"],

  // Warning. Note the token is the DARKENED amber: raw #F59E0B is 2.1:1 and fails AA as text.
  ["bg-amber-50 dark:bg-amber-900/20", "bg-warning/10", "warning tint"],
  ["bg-orange-100 dark:bg-orange-900", "bg-warning/15", "warning tint"],
  ["border-amber-200 dark:border-amber-800", "border-warning/30", "warning border"],
  ["text-orange-600 dark:text-orange-300", "text-warning", "warning text"],
  ["text-amber-700 dark:text-amber-400", "text-warning", "warning text"],

  // Brand. These were the last hardcoded blues left over from the pre-teal palette.
  ["bg-blue-50 dark:bg-blue-900/20", "bg-primary/10", "brand tint"],
  ["bg-blue-100 dark:bg-blue-900", "bg-primary/15", "brand tint"],
  ["border-blue-200 dark:border-blue-800", "border-primary/30", "brand border"],
  ["border-blue-400 dark:border-blue-500", "border-primary", "brand border"],
  ["text-blue-700 dark:text-blue-400", "text-primary", "brand text"],
  ["text-blue-600 dark:text-blue-500", "text-primary", "brand text"],
  ["text-blue-600 dark:text-blue-300", "text-primary", "brand text"],

  // Neutral tracks and dividers.
  ["bg-gray-300 dark:bg-gray-700", "bg-border", "track / divider"],
  ["bg-gray-300 dark:bg-gray-600", "bg-border", "track / divider"],
  ["bg-gray-200 dark:bg-gray-700", "bg-border", "track / divider"],

  // ---- second round: pairs left standing after the main sweep renamed their light half ----

  // Was `bg-surface-light-alt dark:bg-surface-dark` — a surface meant to read as distinct FROM the
  // card (avatar circles, chips, segmented buttons). `background` keeps that relationship in both
  // schemes; `card` would make them vanish into the surface behind them.
  ["bg-card dark:bg-surface-dark", "bg-background", "surface distinct from the card"],

  // Was `text-text-primary dark:text-text-dark-secondary` — a genuinely mismatched pair. These are
  // text-xs labels, so secondary is the right reading in both schemes.
  ["text-foreground dark:text-text-dark-secondary", "text-muted-foreground", "small label"],

  // app/ai-chat.tsx only: the scanner-based codemod refuses this file (backticks inside a regex),
  // but literal replacement is safe here and the parser guard confirms it.
  ["text-text-primary dark:text-text-dark-primary", "text-foreground", "ai-chat"],
  ["text-text-secondary dark:text-text-dark-secondary", "text-muted-foreground", "ai-chat"],
  ["border-border-light dark:border-border-dark", "border-border", "ai-chat"],

  // Hardcoded hex pair for a destructive-selection border.
  ["border-[#FECACA] dark:border-[#7F1D1D]", "border-danger/30", "destructive selection border"],
  // Selected-swatch ring: maximum contrast against the swatch in either scheme.
  ["border-gray-900 dark:border-white", "border-foreground", "selected swatch ring"],
];

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
  for (const [from, to] of PAIRS) {
    if (!next.includes(from)) continue;
    const n = next.split(from).length - 1;
    counts[from] = (counts[from] || 0) + n;
    next = next.split(from).join(to);
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
for (const [from, to, why] of PAIRS) {
  if (!counts[from]) continue;
  total += counts[from];
  console.log(
    "  " + String(counts[from]).padStart(3) + "  " + from.padEnd(46) + " -> " + to.padEnd(18) + why,
  );
}
console.log("\n  " + total + " pairs replaced");
if (skipped.length) console.log("\n  SKIPPED (would not parse): " + skipped.join(", "));
