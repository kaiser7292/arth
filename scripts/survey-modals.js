/**
 * Classifies every raw <Modal> so the migration onto Sheet only touches the ones that ARE sheets.
 * A centred confirm dialog and a full-screen filter are not bottom sheets, and forcing them into
 * one would be a regression dressed up as consolidation.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

const buckets = { sheet: [], dialog: [], fullscreen: [], unknown: [] };

for (const file of [...walk("app"), ...walk("components")]) {
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes("<Modal")) continue;
  let ast;
  try {
    ast = babel.parse(src, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch { continue; }
  const rel = file.split(path.sep).join("/");

  (function visit(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(visit);
    if (typeof n.type !== "string") return;
    if (n.type === "JSXElement" && n.openingElement.name && n.openingElement.name.name === "Modal") {
      const body = src.slice(n.start, n.end);
      const line = src.slice(0, n.start).split(String.fromCharCode(10)).length;
      const entry = { rel, line };
      const grabber = /w-10 h-1 rounded-full/.test(body);
      const slide = /translateY|slideAnim/.test(body);
      const centred = /justify-center/.test(body) && /items-center/.test(body);
      const full = /presentationStyle|animationType="slide"/.test(body) && !grabber && !slide;

      if (grabber || slide) buckets.sheet.push(entry);
      else if (centred) buckets.dialog.push(entry);
      else if (full) buckets.fullscreen.push(entry);
      else buckets.unknown.push(entry);
    }
    for (const k of Object.keys(n)) { if (k === "loc") continue; visit(n[k]); }
  })(ast.program);
}

for (const [kind, list] of Object.entries(buckets)) {
  console.log("\n" + kind.toUpperCase() + " (" + list.length + ")");
  const byFile = {};
  for (const e of list) (byFile[e.rel] ||= []).push(e.line);
  for (const [f, lines] of Object.entries(byFile)) console.log("  " + f + "  @" + lines.join(","));
}
