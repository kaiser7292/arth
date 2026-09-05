/**
 * Routes every raw react-native <Text> through components/ui/Text.
 *
 *   node scripts/codemod-text-import.js [--write]
 *
 * Inter is registered natively (see the expo-font block in app.json), but React Native applies no
 * font family by default, so a bare <Text> renders in the system font regardless. Something has to
 * put `font-sans` on it. The options were: add the class at ~3,000 call sites, patch defaultProps
 * (removed for function components in React 19, so unreliable), or route the import. Routing the
 * import is the smallest change and it also gives a single place to handle font scaling, tabular
 * numerals and accessibility defaults later.
 *
 * Only the exact named import `Text` is touched — TextInput, TextProps and TextStyle are left alone.
 * Files inside components/ui import from "./Text" rather than the barrel, to avoid a cycle.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

const WRITE = process.argv.includes("--write");
const RN_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']react-native["'];?/;
const UI_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']@\/components\/ui["'];?/;

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

let changed = 0;
const skipped = [];
const dropped = [];

for (const file of [...walk("app"), ...walk("components")]) {
  const rel = file.split(path.sep).join("/");
  if (rel.endsWith("components/ui/Text.tsx")) continue;

  const src = fs.readFileSync(file, "utf8");
  const m = src.match(RN_IMPORT);
  if (!m) continue;

  const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
  if (!names.includes("Text")) continue;

  const kept = names.filter((n) => n !== "Text");
  let next;
  if (kept.length) {
    next = src.replace(RN_IMPORT, 'import { ' + kept.join(", ") + ' } from "react-native";');
  } else {
    // Nothing else was imported from react-native; drop the statement entirely.
    next = src.replace(RN_IMPORT, "");
    dropped.push(rel);
  }

  const inUi = rel.includes("components/ui/");
  const source = inUi ? "./Text" : "@/components/ui";

  const existing = next.match(UI_IMPORT);
  if (existing && !inUi) {
    const uiNames = existing[1].split(",").map((s) => s.trim()).filter(Boolean);
    if (!uiNames.includes("Text")) uiNames.push("Text");
    uiNames.sort();
    next = next.replace(UI_IMPORT, 'import { ' + uiNames.join(", ") + ' } from "@/components/ui";');
  } else {
    const line = 'import { Text } from "' + source + '";';
    const anchor = next.indexOf("\n", next.indexOf("import"));
    next = next.slice(0, anchor + 1) + line + "\n" + next.slice(anchor + 1);
  }

  if (!parses(next)) {
    skipped.push(rel);
    continue;
  }
  changed++;
  if (WRITE) fs.writeFileSync(file, next, "utf8");
}

console.log((WRITE ? "APPLIED" : "DRY RUN") + "\n");
console.log("  files rerouted to the ui Text     " + changed);
console.log("  react-native import fully dropped " + dropped.length);
if (skipped.length) {
  console.log("\n  SKIPPED (would not parse):");
  for (const f of skipped) console.log("    " + f);
}
