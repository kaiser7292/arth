/**
 * Removes bindings the useTheme conversion left unused.
 *
 *   node scripts/prune-dead-bindings.js [--write]
 *
 * After the conversion, ~98 files still import StatusColors and many still destructure `accent` or
 * `colorScheme` from useColorScheme without referencing them. TypeScript does not flag an unused
 * import or an unused destructured property, so nothing else catches these - and every one of them
 * keeps the compatibility bridge alive, which is what has to be deleted for tsc to prove the
 * migration is complete.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

const WRITE = process.argv.includes("--write");
const BS = String.fromCharCode(92);

/** Named imports safe to drop when unreferenced. */
const IMPORTS = ["StatusColors", "Colors", "ac", "acAlpha", "BRAND_COLOR", "BORDER_COLOR", "STATUS_COLORS"];
/** useColorScheme destructure members safe to drop when unreferenced. */
const MEMBERS = ["accent", "colorScheme", "colors", "accentTheme", "setAccentTheme"];

const parses = (code) => {
  try {
    babel.parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
    return true;
  } catch {
    return false;
  }
};

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

/** Occurrences of `name` as a standalone identifier. */
function uses(src, name) {
  const re = new RegExp("[^A-Za-z0-9_$.]" + name + "[^A-Za-z0-9_$]", "g");
  return (src.match(re) || []).length;
}

let filesChanged = 0;
const removed = { imports: 0, members: 0, lines: 0 };
const skipped = [];

for (const file of [...walk("app"), ...walk("components")]) {
  const src = fs.readFileSync(file, "utf8");
  let s = src;

  // --- named imports ---
  for (const name of IMPORTS) {
    const importRe = new RegExp(
      "import" + BS + "s*{([^}]*)}" + BS + "s*from" + BS + "s*[\"'][^\"']+[\"'];",
      "g",
    );
    s = s.replace(importRe, (stmt, inner) => {
      const names = inner.split(",").map((x) => x.trim()).filter(Boolean);
      if (!names.includes(name)) return stmt;
      // The declaration itself contributes one occurrence; anything more is a real use.
      if (uses(s, name) > names.filter((n) => n === name).length) return stmt;
      const kept = names.filter((n) => n !== name);
      removed.imports++;
      if (!kept.length) {
        removed.lines++;
        return "";
      }
      return stmt.replace(inner, " " + kept.join(", ") + " ");
    });
  }

  // --- useColorScheme destructure members ---
  const destructRe = new RegExp(
    "const" + BS + "s*{([^}]*)}" + BS + "s*=" + BS + "s*useColorScheme" + BS + "(" + BS + ");",
    "g",
  );
  s = s.replace(destructRe, (stmt, inner) => {
    const names = inner.split(",").map((x) => x.trim()).filter(Boolean);
    const kept = names.filter((n) => !MEMBERS.includes(n) || uses(s, n) > 1);
    if (kept.length === names.length) return stmt;
    removed.members += names.length - kept.length;
    if (!kept.length) {
      removed.lines++;
      return "";
    }
    return "const { " + kept.join(", ") + " } = useColorScheme();";
  });

  // tidy the blank lines left behind
  s = s.split(String.fromCharCode(10, 10, 10)).join(String.fromCharCode(10, 10));

  if (s === src) continue;
  if (!parses(s)) {
    skipped.push(file.split(path.sep).join("/"));
    continue;
  }
  filesChanged++;
  if (WRITE) fs.writeFileSync(file, s, "utf8");
}

console.log((WRITE ? "APPLIED" : "DRY RUN") + " - " + filesChanged + " files");
console.log("  dead imports removed      " + removed.imports);
console.log("  dead destructure members  " + removed.members);
console.log("  statements removed whole  " + removed.lines);
if (skipped.length) console.log("\n  SKIPPED: " + skipped.join(", "));
