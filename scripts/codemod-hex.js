/**
 * Retires hardcoded hex colour literals onto the token layer.
 *
 *   node scripts/codemod-hex.js [--write]
 *
 * These are the last place the OLD palette still renders: 14 sites of the pre-teal blue, 18 of the
 * green that failed WCAG AA, 28 of the raw amber that fails as text. They bypass Tailwind entirely
 * (icon `color=` props, inline styles, arbitrary bg-[#...] classes), so neither the class sweep nor
 * the token bridge could reach them, and they are why parts of the app still look blue.
 *
 * Two deliberate limits:
 *
 * 1. Replacements are scheme-INDEPENDENT constants, matching what the literals did before. Making
 *    them scheme-aware would change dark-mode rendering in the same commit that changes the
 *    palette, so a device regression could not be attributed to either. That is per-screen work.
 *
 * 2. Ambiguous values are left alone: #FFFFFF (67 sites) means "card" in one place and "icon on a
 *    coloured button" in another, and #111111 / #1A1A1A are scheme-specific. Those need a human.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

/** Files whose hex IS the content — user-facing colour palettes, not theme values. */
const EXCLUDE = ["app/settings/category-edit.tsx"];

/** Quoted hex literal -> the constant that replaces it. Quotes are part of the match so that
 *  8-digit alpha values inside arbitrary classes (bg-[#EF444414]) are never touched here. */
const LITERALS = {
  '"#EF4444"': "STATUS_COLORS.error",
  '"#DC2626"': "STATUS_COLORS.error",
  '"#22C55E"': "STATUS_COLORS.success",
  '"#10B981"': "STATUS_COLORS.success",
  '"#16A34A"': "STATUS_COLORS.success",
  '"#3FB950"': "STATUS_COLORS.success",
  '"#3fb950"': "STATUS_COLORS.success", // same value, lowercase in source
  '"#F59E0B"': "STATUS_COLORS.warning",
  '"#D97706"': "STATUS_COLORS.warning",
  '"#6B7280"': "STATUS_COLORS.neutral",
  '"#9CA3AF"': "STATUS_COLORS.muted",
  '"#A0A0A0"': "STATUS_COLORS.muted",
  '"#3B82F6"': "BRAND_COLOR",
  '"#2563EB"': "BRAND_COLOR",
  '"#1E40AF"': "BRAND_COLOR",
  '"#0F766E"': "BRAND_COLOR",
  '"#8B5CF6"': "TRANSFER_COLOR",
  '"#E5E5E3"': "BORDER_COLOR",
};

/** Arbitrary Tailwind colour classes. All are alpha tints; 14 hex = 8%, 08 hex = 3%. */
const CLASSES = {
  "bg-[#EF444414]": "bg-danger/8",
  "bg-[#F59E0B14]": "bg-warning/8",
  "bg-[#22C55E14]": "bg-success/8",
  "bg-[#DC262608]": "bg-danger/3",
  "bg-[#3B82F614]": "bg-primary/8",
};

const SOURCE = "@/constants/semantic-colors";
const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*["']@\/constants\/semantic-colors["'];?/;
const WRITE = process.argv.includes("--write");

/**
 * End offset of the last top-level import, via the AST.
 *
 * A naive "insert after the first newline following the first import" lands INSIDE a multi-line
 * import block and breaks the file - which is exactly what the parser guard caught on 18 files.
 */
function afterLastImport(code) {
  const ast = babel.parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
  let end = 0;
  for (const node of ast.program.body) {
    if (node.type === "ImportDeclaration") end = node.end;
  }
  return end;
}

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

const counts = {};
let filesChanged = 0;
const skipped = [];

for (const file of [...walk("app"), ...walk("components")]) {
  const rel = file.split(path.sep).join("/");
  if (EXCLUDE.some((x) => rel.endsWith(x))) continue;

  const src = fs.readFileSync(file, "utf8");
  let next = src;
  const needed = new Set();

  for (const [cls, repl] of Object.entries(CLASSES)) {
    if (!next.includes(cls)) continue;
    counts[cls] = (counts[cls] || 0) + (next.split(cls).length - 1);
    next = next.split(cls).join(repl);
  }

  for (const [lit, repl] of Object.entries(LITERALS)) {
    if (!next.includes(lit)) continue;
    counts[lit] = (counts[lit] || 0) + (next.split(lit).length - 1);

    // A JSX attribute value must be braced: iconColor="#F59E0B" becomes
    // iconColor={STATUS_COLORS.warning}, not iconColor=STATUS_COLORS.warning.
    // The `=` with no space before the quote is what distinguishes a JSX attribute from an
    // ordinary assignment (`const x = "#F59E0B"`), which takes the bare identifier.
    next = next.split("=" + lit).join("={" + repl + "}");
    next = next.split(lit).join(repl);
    needed.add(repl.split(".")[0]);
  }

  if (next === src) continue;

  if (needed.size) {
    const existing = next.match(IMPORT_RE);
    if (existing) {
      const names = new Set(existing[1].split(",").map((x) => x.trim()).filter(Boolean));
      for (const n of needed) names.add(n);
      next = next.replace(
        IMPORT_RE,
        "import { " + [...names].sort().join(", ") + ' } from "' + SOURCE + '";',
      );
    } else {
      const line = "import { " + [...needed].sort().join(", ") + ' } from "' + SOURCE + '";';
      const anchor = next.indexOf("\n", next.indexOf("import"));
      next = next.slice(0, anchor + 1) + line + "\n" + next.slice(anchor + 1);
    }
  }

  if (!parses(next)) {
    skipped.push(rel);
    continue;
  }
  filesChanged++;
  if (WRITE) fs.writeFileSync(file, next, "utf8");
}

console.log((WRITE ? "APPLIED" : "DRY RUN") + " - " + filesChanged + " files\n");
let total = 0;
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  total += v;
  console.log("  " + String(v).padStart(3) + "  " + k.padEnd(18) + " -> " + (LITERALS[k] || CLASSES[k]));
}
console.log("\n  " + total + " literals retired");
if (skipped.length) console.log("\n  SKIPPED (would not parse): " + skipped.join(", "));
