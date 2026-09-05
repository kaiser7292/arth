/**
 * Fixes white labels sitting on brand fills.
 *
 *   node scripts/codemod-onbrand.js [--write]
 *
 * White on the brand measures about 2.5:1 in light and 1.9:1 in dark, where the brand resolves to
 * a light teal - well under the 4.5:1 floor, and close to illegible on a dark ground. The paired
 * `primary-foreground` role exists precisely for this: it flips to dark ink exactly when the brand
 * becomes light.
 *
 * Scoped by AST rather than by text. A blanket text-white swap would be wrong - white is correct on
 * a danger or success fill, and on a photo. Only labels inside an element actually filled with the
 * brand are rewritten, so the fix lands where the contrast problem is and nowhere else.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

const WRITE = process.argv.includes("--write");

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

/**
 * Identifiers a file assigns the brand to, so an indirect fill is recognised too.
 * Nine screens do `const accentColor = theme.primary` or `const tint = colors.tint` and then
 * `style={{ backgroundColor: accentColor }}` - a brand fill the attribute text alone cannot see.
 */
function brandAliases(src) {
  const names = new Set();
  const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(?:ui)?[Tt]heme\.primary|colors\.tint)\s*;/g;
  let m;
  while ((m = re.exec(src)) !== null) names.add(m[1]);
  return names;
}

/** Does this element's own attributes paint it with the brand colour? */
function brandFilled(src, node, aliases) {
  for (const attr of node.openingElement.attributes || []) {
    if (attr.type !== "JSXAttribute" || !attr.value) continue;
    const text = src.slice(attr.value.start, attr.value.end);
    const name = attr.name && attr.name.name;
    if (name === "style" && /backgroundColor:\s*(ui)?[Tt]heme\.primary\b/.test(text)) return true;
    if (name === "className" && /\bbg-primary\b/.test(text)) return true;
    if (name === "style") {
      const bg = text.match(/backgroundColor:[ ]*([A-Za-z_$][A-Za-z0-9_$]*)[ ]*[,}]/);
      if (bg && aliases.has(bg[1])) return true;
    }
  }
  return false;
}

let filesChanged = 0;
let swapped = 0;

for (const file of [...walk("app"), ...walk("components")]) {
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes("text-white")) continue;
  const aliases = brandAliases(src);

  let ast;
  try {
    ast = babel.parse(src, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch {
    continue;
  }

  /** Ranges of elements painted with the brand. */
  const ranges = [];
  (function visit(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(visit);
    if (typeof n.type !== "string") return;
    if (n.type === "JSXElement" && n.openingElement && brandFilled(src, n, aliases)) {
      ranges.push([n.start, n.end]);
    }
    for (const k of Object.keys(n)) {
      if (k === "loc" || k === "leadingComments" || k === "trailingComments") continue;
      visit(n[k]);
    }
  })(ast.program);

  if (!ranges.length) continue;

  // Rewrite from the end so earlier offsets stay valid.
  let out = src;
  const edits = [];
  for (const [start, end] of ranges) {
    const seg = out.slice(start, end);
    let idx = seg.indexOf("text-white");
    while (idx !== -1) {
      edits.push(start + idx);
      idx = seg.indexOf("text-white", idx + 1);
    }
  }
  const unique = [...new Set(edits)].sort((a, b) => b - a);
  for (const at of unique) {
    out = out.slice(0, at) + "text-primary-foreground" + out.slice(at + "text-white".length);
    swapped++;
  }

  if (out === src) continue;
  filesChanged++;
  if (WRITE) fs.writeFileSync(file, out, "utf8");
}

console.log((WRITE ? "APPLIED" : "DRY RUN") + " - " + swapped + " labels in " + filesChanged + " files");
console.log("remaining text-white is on non-brand fills, where white is correct");
