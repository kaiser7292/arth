/**
 * Reverts theme.* back to the scheme-independent constants where it landed at MODULE scope.
 *
 * A module-level constant table cannot call a hook, so these few sites keep the constants. They
 * are mostly hand-written severity tables (SEVERITY_COLORS and friends) that also carry their own
 * light/dark hex pairs - the same shape as the bug found in AlertBanner, where the dark half was
 * never read. Converting them properly means restructuring the table around roles, which is
 * per-screen work rather than a codemod.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

const WRITE = process.argv.includes("--write");
const BACK = {
  "theme.success": "STATUS_COLORS.success",
  "theme.warning": "STATUS_COLORS.warning",
  "theme.danger": "STATUS_COLORS.error",
  "theme.mutedForeground": "STATUS_COLORS.neutral",
  "theme.faintForeground": "STATUS_COLORS.muted",
  "theme.primary": "BRAND_COLOR",
  "theme.border": "BORDER_COLOR",
};

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
let reverted = 0;

for (const rel of files) {
  const file = path.join(process.cwd(), rel);
  let src = fs.readFileSync(file, "utf8");
  const ast = babel.parse(src, { sourceType: "module", plugins: ["typescript", "jsx"] });

  // Collect ranges of every top-level function/component; anything outside them is module scope.
  const inside = [];
  for (const n of ast.program.body) {
    if (n.type === "FunctionDeclaration") inside.push([n.start, n.end]);
    if (n.type === "ExportDefaultDeclaration" || n.type === "ExportNamedDeclaration") {
      inside.push([n.start, n.end]);
    }
    if (n.type === "VariableDeclaration") {
      for (const d of n.declarations) {
        if (d.init && /Function|Arrow/.test(d.init.type)) inside.push([n.start, n.end]);
      }
    }
  }
  const atModuleScope = (i) => !inside.some(([a, b]) => i >= a && i < b);

  const needed = new Set();
  let out = "";
  let i = 0;
  while (i < src.length) {
    let matched = null;
    for (const key of Object.keys(BACK)) {
      if (src.startsWith(key, i)) {
        matched = key;
        break;
      }
    }
    if (matched && atModuleScope(i)) {
      out += BACK[matched];
      needed.add(BACK[matched].split(".")[0]);
      reverted++;
      i += matched.length;
      continue;
    }
    out += src[i];
    i++;
  }

  if (needed.size) {
    const have = out.match(/import\s*\{([^}]*)\}\s*from\s*["']@\/constants\/semantic-colors["'];/);
    if (have) {
      const names = new Set(have[1].split(",").map((x) => x.trim()).filter(Boolean));
      for (const n of needed) names.add(n);
      out = out.replace(have[0], "import { " + [...names].sort().join(", ") + ' } from "@/constants/semantic-colors";');
    } else {
      const a2 = babel.parse(out, { sourceType: "module", plugins: ["typescript", "jsx"] });
      let end = 0;
      for (const n of a2.program.body) if (n.type === "ImportDeclaration") end = n.end;
      out = out.slice(0, end) + "\nimport { " + [...needed].sort().join(", ") + ' } from "@/constants/semantic-colors";' + out.slice(end);
    }
  }

  if (WRITE) fs.writeFileSync(file, out, "utf8");
}
console.log((WRITE ? "APPLIED" : "DRY RUN") + " - " + reverted + " module-scope sites reverted");
