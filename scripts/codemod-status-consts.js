/**
 * Final bridge pass: the scheme-independent constants introduced by the hex sweep become theme
 * roles, so they flip with the colour scheme like everything else.
 *
 *   node scripts/codemod-status-consts.js [--write]
 *
 * The hex sweep deliberately replaced literals with constants rather than theme roles, to avoid
 * changing dark-mode rendering in the same commit that changed the palette. That separation has
 * served its purpose: the palette is verified, so these can now become scheme-aware.
 *
 * TRANSFER_COLOR and CHART_COLORS stay - they are categorical, not semantic, and carry no
 * light/dark pairing.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

const WRITE = process.argv.includes("--write");

const MAP = {
  "STATUS_COLORS.success": "success",
  "STATUS_COLORS.warning": "warning",
  "STATUS_COLORS.error": "danger",
  "STATUS_COLORS.neutral": "mutedForeground",
  "STATUS_COLORS.muted": "faintForeground",
  BRAND_COLOR: "primary",
  BORDER_COLOR: "border",
};

const parses = (c) => {
  try {
    babel.parse(c, { sourceType: "module", plugins: ["typescript", "jsx"] });
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

let filesChanged = 0;
let converted = 0;
const skipped = [];

for (const file of [...walk("app"), ...walk("components")]) {
  const src = fs.readFileSync(file, "utf8");
  if (!Object.keys(MAP).some((k) => src.includes(k))) continue;

  // Reuse whatever binding this file already established.
  const bindMatch = src.match(/const\s+(theme|uiTheme)\s*=\s*useTheme\(\)/);
  const BIND = bindMatch ? bindMatch[1] : "theme";

  // Split at the end of the import block. Replacing across it turns
  // `import { BORDER_COLOR } from ...` into `import { theme.border }`, which is a syntax error -
  // so the import specifiers are pruned separately rather than rewritten.
  const ast0 = babel.parse(src, { sourceType: "module", plugins: ["typescript", "jsx"] });
  let importEnd = 0;
  for (const n of ast0.program.body) if (n.type === "ImportDeclaration") importEnd = n.end;

  let head = src.slice(0, importEnd);
  let body = src.slice(importEnd);

  // Longest keys first so STATUS_COLORS.success is not clipped by a shorter prefix.
  for (const key of Object.keys(MAP).sort((a, b) => b.length - a.length)) {
    if (!body.includes(key)) continue;
    converted += body.split(key).length - 1;
    body = body.split(key).join(BIND + "." + MAP[key]);
  }

  // Drop the now-unused specifiers from the semantic-colors import.
  for (const name of ["STATUS_COLORS", "BRAND_COLOR", "BORDER_COLOR"]) {
    if (body.includes(name)) continue;
    head = head.replace(new RegExp("(import[^;]*from[^;]*semantic-colors[^;]*;)", "g"), (stmt) => {
      const m = stmt.match(/\{([^}]*)\}/);
      if (!m) return stmt;
      const kept = m[1].split(",").map((x) => x.trim()).filter((x) => x && x !== name);
      return kept.length
        ? stmt.replace(m[1], " " + kept.join(", ") + " ")
        : "";
    });
  }

  let s = head + body;
  if (s === src) continue;

  if (!s.includes('from "@/hooks/use-theme"')) {
    // Recomputed against `s`, not `src`: pruning the import specifiers moved the offsets,
    // and reusing the original end index splices the new import mid-statement.
    const ast = babel.parse(s, { sourceType: "module", plugins: ["typescript", "jsx"] });
    let end = 0;
    for (const n of ast.program.body) if (n.type === "ImportDeclaration") end = n.end;
    s = s.slice(0, end) + '\nimport { useTheme } from "@/hooks/use-theme";' + s.slice(end);
  }

  if (!parses(s)) {
    skipped.push(file.split(path.sep).join("/"));
    continue;
  }
  filesChanged++;
  if (WRITE) fs.writeFileSync(file, s, "utf8");
}

console.log((WRITE ? "APPLIED" : "DRY RUN") + " - " + converted + " in " + filesChanged + " files");
if (skipped.length) console.log("  SKIPPED: " + skipped.join(", "));
