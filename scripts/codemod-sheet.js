/**
 * Migrates hand-rolled bottom sheets onto the shared Sheet primitive.
 *
 *   node scripts/codemod-sheet.js [--write] [file ...]
 *
 * Each of these files reimplements the same thing: a Modal, a backdrop Pressable, a reanimated
 * translateY, a grabber pill and a safe-area pad. They exist because BottomSheet was never
 * exported from components/ui/index.ts. Sheet now owns all of it - and adds drag-to-dismiss and
 * keyboard handling that none of the copies had.
 *
 * Only the JSX shell is rewritten here. The animation helpers (handleClose and friends, which
 * animate out and then call back via runOnJS) are converted separately, because their shapes vary.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

const WRITE = process.argv.includes("--write");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const NL = String.fromCharCode(10);

function jsxName(node) {
  const n = node && node.name;
  if (!n) return "";
  if (n.type === "JSXIdentifier") return n.name;
  if (n.type === "JSXMemberExpression") return (n.object.name || "") + "." + (n.property.name || "");
  return "";
}

function find(node, pred, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((n) => find(n, pred, out)); return out; }
  if (typeof node.type !== "string") return out;
  if (pred(node)) out.push(node);
  for (const k of Object.keys(node)) { if (k === "loc") continue; find(node[k], pred, out); }
  return out;
}

/**
 * Shift the block left by `spaces`, leaving the FIRST line alone - it starts mid-line at the
 * splice point and carries no leading whitespace of its own.
 */
function dedent(text, spaces) {
  if (spaces <= 0) return text;
  const pad = " ".repeat(spaces);
  return text
    .split(NL)
    .map((l, i) => (i === 0 ? l : l.startsWith(pad) ? l.slice(spaces) : l))
    .join(NL);
}

const results = [];

for (const file of only) {
  const src = fs.readFileSync(file, "utf8");
  let ast;
  try {
    ast = babel.parse(src, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (e) {
    results.push([file, "parse failed"]);
    continue;
  }

  const modals = find(ast.program, (n) => n.type === "JSXElement" && jsxName(n.openingElement) === "Modal");
  if (modals.length !== 1) { results.push([file, modals.length + " Modals - skipped"]); continue; }
  const modal = modals[0];

  const animated = find(modal, (n) => n.type === "JSXElement" && jsxName(n.openingElement) === "Animated.View");
  if (!animated.length) { results.push([file, "no Animated.View - skipped"]); continue; }
  // Some sheets animate the BACKDROP as well as the panel, and the backdrop comes first in the
  // tree. Pick the one that actually holds the sheet: it contains the grabber pill, or failing
  // that has the most children.
  const shell =
    animated.find((n) => /w-10 h-1 rounded-full/.test(src.slice(n.start, n.end))) ||
    animated.slice().sort((a, b) => (b.children || []).length - (a.children || []).length)[0];

  // Everything inside the animated shell, minus the leading grabber block.
  const kids = shell.children.filter((c) => !(c.type === "JSXText" && !c.value.trim()));
  if (!kids.length) { results.push([file, "empty shell - skipped"]); continue; }
  let first = 0;
  const firstText = src.slice(kids[0].start, kids[0].end);
  if (/w-10 h-1 rounded-full/.test(firstText)) first = 1;
  if (first >= kids.length) { results.push([file, "only a grabber - skipped"]); continue; }

  const contentStart = kids[first].start;
  const contentEnd = kids[kids.length - 1].end;
  // Dedent by exactly the nesting the Modal + Animated.View shell used to add.
  const shed = kids[first].loc.start.column - (modal.loc.start.column + 2);
  const content = dedent(src.slice(contentStart, contentEnd), shed);

  // Reuse the Modal's own visible/onRequestClose so the call site keeps its semantics.
  const attrs = modal.openingElement.attributes.filter((a) => a.type === "JSXAttribute");
  const get = (name) => {
    const a = attrs.find((x) => x.name.name === name);
    return a && a.value ? src.slice(a.value.start, a.value.end) : null;
  };
  const visible = get("visible") || "{visible}";
  const onClose = get("onRequestClose") || "{onClose}";

  const indent = " ".repeat(modal.loc.start.column);
  const replacement =
    "<Sheet visible=" + visible + " onClose=" + onClose + ">" + NL +
    indent + "  " + content + NL +
    indent + "</Sheet>";

  let out = src.slice(0, modal.start) + replacement + src.slice(modal.end);

  try {
    babel.parse(out, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (e) {
    results.push([file, "result would not parse: " + e.message]);
    continue;
  }

  results.push([file, "migrated"]);
  if (WRITE) fs.writeFileSync(file, out, "utf8");
}

for (const [f, r] of results) console.log("  " + r.padEnd(34) + f.split(path.sep).join("/"));
