/**
 * Adds virtualization tuning to every FlatList.
 *
 *   node scripts/codemod-list-perf.js [--write]
 *
 * The codebase had ZERO occurrences of initialNumToRender, maxToRenderPerBatch or windowSize
 * across 43 lists, so every one used React Native's defaults (10 / 10 / 21). windowSize 21 keeps
 * ten screens of rows mounted either side of the viewport, which is what makes the long ledger and
 * transaction lists stutter - and it gets worse as the redesign makes each row heavier.
 *
 * removeClippedSubviews is deliberately NOT added. It is the one tuning prop that changes
 * behaviour rather than just budget, and on Android it is a known cause of blank rows with
 * complex row content. Not worth it for a scroll-smoothness gain we can get from the other three.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

const WRITE = process.argv.includes("--write");
const PROPS = [
  "initialNumToRender={12}",
  "maxToRenderPerBatch={10}",
  "windowSize={7}",
];

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

let filesChanged = 0;
let lists = 0;
const skipped = [];

for (const file of [...walk("app"), ...walk("components")]) {
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes("<FlatList")) continue;

  const ast = babel.parse(src, { sourceType: "module", plugins: ["typescript", "jsx"] });

  const points = [];
  (function visit(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(visit);
    if (typeof n.type !== "string") return;
    if (
      n.type === "JSXOpeningElement" &&
      n.name && n.name.type === "JSXIdentifier" && n.name.name === "FlatList"
    ) {
      const have = (n.attributes || [])
        .filter((a) => a.type === "JSXAttribute")
        .map((a) => a.name.name);
      if (!have.includes("initialNumToRender")) {
        // Match the indentation of the element's first existing attribute, so the inserted props
        // line up with the rest. The codebase is not prettier-formatted (running it rewrites
        // ~1,400 lines in a single screen), so the codemod has to produce tidy output itself.
        const NL = String.fromCharCode(10);
        const first = (n.attributes || []).find((a) => a.type === "JSXAttribute");
        // Only usable when the first attribute starts its own line. When it sits on the same line
        // as <FlatList, this slice would capture the element text itself and inject it as indent.
        let indent = null;
        if (first) {
          const ls = src.lastIndexOf(NL, first.start) + 1;
          const candidate = src.slice(ls, first.start);
          if (candidate.trim() === "") indent = candidate;
        }
        if (indent === null) {
          const ls = src.lastIndexOf(NL, n.start) + 1;
          const own = src.slice(ls, n.start);
          indent = (own.trim() === "" ? own : "") + "  ";
        }
        points.push({ at: n.name.end, indent });
      }
    }
    for (const k of Object.keys(n)) {
      if (k === "loc") continue;
      visit(n[k]);
    }
  })(ast.program);

  if (!points.length) continue;

  let s = src;
  // Descending so earlier insertions do not shift later offsets.
  for (const point of points.sort((a, b) => b.at - a.at)) {
    const block = PROPS.map((x) => String.fromCharCode(10) + point.indent + x).join("");
    s = s.slice(0, point.at) + block + s.slice(point.at);
    lists++;
  }

  try {
    babel.parse(s, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (e) {
    skipped.push(file + " -> " + e.message);
    continue;
  }
  filesChanged++;
  if (WRITE) fs.writeFileSync(file, s, "utf8");
}

console.log((WRITE ? "APPLIED" : "DRY RUN") + " - " + lists + " lists in " + filesChanged + " files");
for (const x of skipped) console.log("  SKIPPED " + x);
