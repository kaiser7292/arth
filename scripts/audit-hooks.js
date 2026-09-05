/**
 * Finds rules-of-hooks violations introduced by the theme conversion.
 *
 *   node scripts/audit-hooks.js
 *
 * A hook must run unconditionally, in the same order, on every render of a component. The
 * conversion inserted `const theme = useTheme()` mechanically, and three shapes break that rule:
 *
 *   1. a plain helper function that is called conditionally or inside a loop
 *   2. a hook inside a callback (map/filter/onPress)
 *   3. a hook placed after an early return
 *
 * None of these are visible to TypeScript or to the test suite, and all of them crash the app at
 * runtime with "Rendered more hooks than during the previous render".
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

const HOOK = /^use[A-Z]/;
const FN = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
/**
 * Class bodies are tracked separately. A hook inside a class method is always illegal - React
 * throws "Invalid hook call" - and it is invisible to the function-owner check above, because the
 * method's enclosing function is the class, not a component. This gap let a useTheme() call sit in
 * the app's ErrorBoundary.render(), which wraps everything and so crashed every launch.
 */
const CLASS_BODY = new Set(["ClassMethod", "ClassPrivateMethod", "ClassProperty", "ClassDeclaration", "ClassExpression"]);

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

const findings = [];

for (const file of [...walk("app"), ...walk("components"), ...walk("hooks")]) {
  const src = fs.readFileSync(file, "utf8");
  if (!/\buse[A-Z]\w*\(/.test(src)) continue;

  let ast;
  try {
    ast = babel.parse(src, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch {
    continue;
  }
  const rel = file.split(path.sep).join("/");

  (function visit(node, stack) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, stack));
    if (typeof node.type !== "string") return;

    let next = stack;
    if (CLASS_BODY.has(node.type)) {
      next = stack.concat([{ node, name: null, inClass: true }]);
    }
    if (FN.has(node.type)) {
      const name =
        (node.id && node.id.name) ||
        (node.__inferredName) ||
        null;
      next = stack.concat([{ node, name }]);
    }

    if (
      node.type === "CallExpression" &&
      node.callee && node.callee.type === "Identifier" &&
      HOOK.test(node.callee.name)
    ) {
      const owner = next[next.length - 1];
      const inClass = next.some((f) => f.inClass);
      if (inClass) {
        const line = src.slice(0, node.start).split(String.fromCharCode(10)).length;
        findings.push({
          rel,
          line,
          why: "hook inside a CLASS component - always illegal, React throws on render",
          hook: node.callee.name,
        });
      } else if (owner) {
        const name = owner.name;
        const line = src.slice(0, node.start).split("\n").length;

        // 1. the owning function is not a component and not itself a hook
        if (name && !/^[A-Z]/.test(name) && !HOOK.test(name)) {
          findings.push({ rel, line, why: "hook inside plain helper " + name + "()", hook: node.callee.name });
        }
        // 2. anonymous function nested inside another function - a callback
        else if (!name && next.length > 1) {
          findings.push({ rel, line, why: "hook inside a nested callback", hook: node.callee.name });
        }
        // 3. an early return appears before the hook in the same body
        else if (owner.node.body && owner.node.body.type === "BlockStatement") {
          for (const stmt of owner.node.body.body) {
            if (stmt.end < node.start && stmt.type === "IfStatement") {
              const inner = src.slice(stmt.start, stmt.end);
              if (/\breturn\b/.test(inner)) {
                findings.push({ rel, line, why: "hook after a conditional return", hook: node.callee.name });
                break;
              }
            }
          }
        }
      }
    }

    for (const k of Object.keys(node)) {
      if (k === "loc" || k === "leadingComments" || k === "trailingComments") continue;
      visit(node[k], next);
    }
  })(ast.program, []);
}

const seen = new Set();
const unique = findings.filter((f) => {
  const k = f.rel + ":" + f.line + ":" + f.why;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

if (!unique.length) {
  console.log("No rules-of-hooks violations found.");
} else {
  console.log(unique.length + " potential violation(s):\n");
  for (const f of unique) {
    console.log("  " + f.rel + ":" + f.line + "  " + f.hook + "()  - " + f.why);
  }
}
