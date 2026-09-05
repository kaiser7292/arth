/**
 * Converts hand-built empty states onto the EmptyState primitive.
 *
 *   node scripts/codemod-emptystate.js [--write]
 *
 * Only the icon + title + subtitle shape is converted, and the icon name and both strings are
 * lifted from the existing markup rather than invented - so the copy a screen already had is
 * preserved exactly. Anything else is left for a human, because choosing an icon and writing a
 * useful subtitle is a judgment call, not a transform.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

const WRITE = process.argv.includes("--write");

const jsxName = (el) => (el && el.name && el.name.type === "JSXIdentifier" ? el.name.name : "");
const kids = (n) => (n.children || []).filter((c) => !(c.type === "JSXText" && !c.value.trim()));

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
  if (!src.includes("ListEmptyComponent")) continue;
  let ast;
  try { ast = babel.parse(src, { sourceType: "module", plugins: ["typescript", "jsx"] }); } catch { continue; }

  const attrs = find(ast.program, (n) => n.type === "JSXAttribute" && n.name.name === "ListEmptyComponent");
  const edits = [];

  for (const attr of attrs) {
    if (!attr.value || attr.value.type !== "JSXExpressionContainer") continue;
    const root = attr.value.expression;
    if (!root || root.type !== "JSXElement" || jsxName(root.openingElement) !== "View") continue;

    const children = kids(root);
    const icon = children.find((c) => c.type === "JSXElement" && jsxName(c.openingElement) === "Ionicons");
    const texts = children.filter((c) => c.type === "JSXElement" && jsxName(c.openingElement) === "Text");
    if (!icon || texts.length < 2) continue;   // not the shape we convert

    const nameAttr = (icon.openingElement.attributes || []).find(
      (a) => a.type === "JSXAttribute" && a.name.name === "name",
    );
    if (!nameAttr || nameAttr.value.type !== "StringLiteral") continue;

    // Inner text, verbatim, so existing copy survives the conversion.
    const inner = (t) => {
      const body = src.slice(t.start, t.end);
      const open = body.indexOf(">");
      const close = body.lastIndexOf("</");
      return body.slice(open + 1, close).trim();
    };
    const title = inner(texts[0]);
    const subtitle = inner(texts[1]);
    // Skip anything carrying JSX or an interpolation - lifting `No results for "{query}"` into a
    // string literal would turn the variable into the word "query".
    const literal = (v) => v && !v.includes("{") && !v.includes("<");
    if (!literal(title) || !literal(subtitle)) continue;

    // Always an expression container: a subtitle may contain double quotes (tags.tsx cites
    // "work trip", "birthday"), which a plain string attribute cannot hold.
    const wrap = (v) => "{" + JSON.stringify(v) + "}";
    const indent = " ".repeat(root.loc.start.column);
    const replacement =
      "<EmptyState" + String.fromCharCode(10) +
      indent + '  icon="' + nameAttr.value.value + '"' + String.fromCharCode(10) +
      indent + "  title=" + wrap(title) + String.fromCharCode(10) +
      indent + "  subtitle=" + wrap(subtitle) + String.fromCharCode(10) +
      indent + "/>";
    edits.push({ start: root.start, end: root.end, replacement });
  }

  if (!edits.length) continue;

  let out = src;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
    swaps++;
  }

  if (!/[{,]\s*EmptyState\s*[,}]/.test(out)) {
    const m = out.match(/import \{([^}]*)\} from "@\/components\/ui";/);
    if (m) {
      const names = [...new Set(m[1].split(",").map((x) => x.trim()).filter(Boolean).concat(["EmptyState"]))].sort();
      out = out.replace(m[0], "import { " + names.join(", ") + ' } from "@/components/ui";');
    } else {
      out = 'import { EmptyState } from "@/components/ui";' + String.fromCharCode(10) + out;
    }
  }

  try { babel.parse(out, { sourceType: "module", plugins: ["typescript", "jsx"] }); }
  catch (e) { console.log("  SKIPPED " + file + " -> " + e.message); continue; }

  files++;
  console.log("  converted  " + file.split(path.sep).join("/"));
  if (WRITE) fs.writeFileSync(file, out, "utf8");
}

console.log((WRITE ? "APPLIED" : "DRY RUN") + " - " + swaps + " empty states in " + files + " files");
