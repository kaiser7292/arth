// Import-graph cycle detector. A require cycle bundles cleanly but leaves one module's exports
// undefined at init time, which crashes on launch with no compile-time signal.
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

const ROOT = process.cwd();
const graph = new Map();

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function resolve(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  for (const ext of ["index.tsx", "index.ts", "index.js"]) {
    const p = path.join(base, ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const files = [];
for (const d of ["app", "components", "hooks", "services", "utils", "constants", "database"]) {
  if (fs.existsSync(d)) walk(d, files);
}

for (const f of files) {
  const abs = path.resolve(f);
  const src = fs.readFileSync(abs, "utf8");
  let ast;
  try {
    ast = babel.parse(src, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch { continue; }
  const deps = [];
  for (const n of ast.program.body) {
    // Type-only imports are erased at compile time and cannot create a runtime cycle.
    if (n.type === "ImportDeclaration" && n.importKind !== "type") {
      const r = resolve(abs, n.source.value);
      if (r) deps.push(path.resolve(r));
    }
  }
  graph.set(abs, deps);
}

const cycles = [];
const state = new Map();
function dfs(node, stack) {
  if (state.get(node) === "done") return;
  if (state.get(node) === "active") {
    const i = stack.indexOf(node);
    if (i !== -1) cycles.push(stack.slice(i).concat([node]));
    return;
  }
  state.set(node, "active");
  for (const d of graph.get(node) || []) dfs(d, stack.concat([node]));
  state.set(node, "done");
}
for (const f of graph.keys()) dfs(f, []);

const seen = new Set();
const unique = cycles.filter((c) => {
  const key = [...c].sort().join("|");
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

console.log(unique.length + " require cycle(s)\n");
for (const c of unique.slice(0, 12)) {
  console.log("  " + c.map((x) => path.relative(ROOT, x).split(path.sep).join("/")).join("\n    -> "));
  console.log("");
}
