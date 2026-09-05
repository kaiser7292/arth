/**
 * Replaces screen-level spinners with the skeleton loading state.
 *
 *   node scripts/codemod-loading.js [--write]
 *
 * Only the centred full-screen shape is touched:
 *
 *   <View className="flex-1 items-center justify-center">
 *     <ActivityIndicator size="large" ... />
 *   </View>
 *
 * Inline spinners are left alone - a button showing progress, or a footer while a page loads, is
 * doing a different job and a skeleton there would be wrong. A View wrapping the spinner AND other
 * content (a message, a retry button) is also skipped, because the replacement would drop it.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

const WRITE = process.argv.includes("--write");

function jsxName(el) {
  const n = el && el.name;
  return n && n.type === "JSXIdentifier" ? n.name : "";
}
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}
function find(node, pred, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((n) => find(n, pred, out)); return out; }
  if (typeof node.type !== "string") return out;
  if (pred(node)) out.push(node);
  for (const k of Object.keys(node)) { if (k === "loc") continue; find(node[k], pred, out); }
  return out;
}

let files = 0, swaps = 0;

for (const file of [...walk("app"), ...walk("components")]) {
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes("ActivityIndicator")) continue;
  let ast;
  try { ast = babel.parse(src, { sourceType: "module", plugins: ["typescript", "jsx"] }); } catch { continue; }

  const targets = find(ast.program, (n) => {
    if (n.type !== "JSXElement" || jsxName(n.openingElement) !== "View") return false;
    const cls = (n.openingElement.attributes || []).find(
      (a) => a.type === "JSXAttribute" && a.name.name === "className",
    );
    if (!cls || !cls.value || cls.value.type !== "StringLiteral") return false;
    if (!/flex-1/.test(cls.value.value) || !/justify-center/.test(cls.value.value)) return false;
    const kids = (n.children || []).filter((c) => !(c.type === "JSXText" && !c.value.trim()));
    // Exactly one child, and it is the spinner: anything else would be discarded.
    return kids.length === 1 && kids[0].type === "JSXElement" &&
      jsxName(kids[0].openingElement) === "ActivityIndicator" &&
      /size="large"/.test(src.slice(kids[0].start, kids[0].end));
  });

  if (!targets.length) continue;

  let out = src;
  for (const t of targets.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, t.start) + "<LoadingState />" + out.slice(t.end);
    swaps++;
  }

  if (!/[{,]\s*LoadingState\s*[,}]/.test(out)) {
    const m = out.match(/import \{([^}]*)\} from "@\/components\/ui";/);
    if (m) {
      const names = [...new Set(m[1].split(",").map((x) => x.trim()).filter(Boolean).concat(["LoadingState"]))].sort();
      out = out.replace(m[0], "import { " + names.join(", ") + ' } from "@/components/ui";');
    } else {
      out = 'import { LoadingState } from "@/components/ui";' + String.fromCharCode(10) + out;
    }
  }

  try { babel.parse(out, { sourceType: "module", plugins: ["typescript", "jsx"] }); }
  catch (e) { console.log("  SKIPPED " + file + " -> " + e.message); continue; }

  files++;
  if (WRITE) fs.writeFileSync(file, out, "utf8");
}

console.log((WRITE ? "APPLIED" : "DRY RUN") + " - " + swaps + " spinners in " + files + " files");
