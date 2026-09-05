/**
 * Inserts a missing `const theme = useTheme();` into the exact functions tsc says need one.
 *
 *   npx tsc --noEmit > errs.txt 2>&1; node scripts/fix-theme-binding.js errs.txt [--write]
 *
 * The useTheme codemod attaches the binding next to an existing useColorScheme() call. That misses
 * helper components which never had one, because they received the colour object as a PROP instead
 * (`<Badge status={status} />`, `<Row sc={sc} />`). Their bodies now reference theme with nothing
 * to resolve it. Driving the fix from tsc's own error positions means every insertion point is one
 * the compiler actually flagged, rather than one a heuristic guessed at.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

const WRITE = process.argv.includes("--write");
const errFile = process.argv[2];
const lines = fs.readFileSync(errFile, "utf8").split(/\r?\n/);

/** file -> [{line, col}] for the missing-theme errors only. */
const targets = new Map();
for (const l of lines) {
  const m = l.match(/^(.+?)\((\d+),(\d+)\): error TS2304: Cannot find name 'theme'\.$/);
  if (!m) continue;
  const f = m[1].split("\\").join("/");
  if (!targets.has(f)) targets.set(f, []);
  targets.get(f).push({ line: Number(m[2]), col: Number(m[3]) });
}

const FN = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
]);

/** Deepest function node whose range contains `pos`. */
function enclosingFunction(ast, pos) {
  let best = null;
  (function visit(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node.type !== "string") return;
    if (node.start != null && (pos < node.start || pos > node.end)) return;
    if (FN.has(node.type) && node.body && node.body.type === "BlockStatement") {
      if (!best || node.start > best.start) best = node;
    }
    for (const k of Object.keys(node)) {
      if (k === "loc" || k === "leadingComments" || k === "trailingComments") continue;
      visit(node[k]);
    }
  })(ast.program);
  return best;
}

let filesChanged = 0;
let inserted = 0;

for (const [rel, positions] of targets) {
  const file = path.join(process.cwd(), rel);
  if (!fs.existsSync(file)) continue;
  let src = fs.readFileSync(file, "utf8");

  // Offsets from line/col, computed once against the original text.
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const offsets = positions.map((p) => lineStarts[p.line - 1] + (p.col - 1));

  const ast = babel.parse(src, { sourceType: "module", plugins: ["typescript", "jsx"] });

  const bodies = new Set();
  for (const off of offsets) {
    const fn = enclosingFunction(ast, off);
    if (fn) bodies.add(fn.body.start);
  }

  // Descending, so earlier insertions do not shift later offsets.
  const points = [...bodies].sort((a, b) => b - a);
  for (const at of points) {
    src = src.slice(0, at + 1) + "\n  const theme = useTheme();" + src.slice(at + 1);
    inserted++;
  }

  if (!src.includes('from "@/hooks/use-theme"')) {
    const a2 = babel.parse(src, { sourceType: "module", plugins: ["typescript", "jsx"] });
    let end = 0;
    for (const n of a2.program.body) if (n.type === "ImportDeclaration") end = n.end;
    src = src.slice(0, end) + '\nimport { useTheme } from "@/hooks/use-theme";' + src.slice(end);
  }

  try {
    babel.parse(src, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (e) {
    console.log("  SKIPPED " + rel + " -> " + e.message);
    continue;
  }

  filesChanged++;
  if (WRITE) fs.writeFileSync(file, src, "utf8");
}

console.log((WRITE ? "APPLIED" : "DRY RUN") + " - " + inserted + " bindings into " + filesChanged + " files");
