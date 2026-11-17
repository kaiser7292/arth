/**
 * Moves a screen onto the design tokens (docs/UI_REVAMP_PLAN.md), the mechanical half of the
 * revamp. The layout changes each board asks for are made by hand afterwards.
 *
 *   node scripts/codemod-revamp-tokens.js [--write] <file> [<file> ...]
 *
 * Mapping, the same one the transactions rollout used:
 *   text-xs -> label · text-sm -> meta (body when it is a row title: medium/semibold/bold) ·
 *   text-base -> body · text-lg -> heading · text-xl / 2xl -> title · text-3xl -> display ·
 *   text-4xl -> hero
 *   rounded-sm / md / lg -> control · rounded-xl / 2xl -> card · rounded-3xl -> sheet
 *   X + "HH" (hex alpha) -> tint(X, a)   (adds the import)
 *   colors.text / textSecondary / background / surface / border / tint / icon -> theme.*
 *     (only when the file already has `const theme = useTheme()` in that component; otherwise it
 *     is reported for a hand fix)
 *
 * Inline `fontSize: N` is only reported: the right class depends on what the text is.
 */
const fs = require("fs");
const babel = require("@babel/parser");

const WRITE = process.argv.includes("--write");
const files = process.argv.slice(2).filter((a) => a !== "--write");
const Q = String.fromCharCode(34);

const TEXT = { xs: "label", base: "body", lg: "heading", xl: "title", "2xl": "title", "3xl": "display", "4xl": "hero" };
const ROUND = { sm: "control", md: "control", lg: "control", xl: "card", "2xl": "card", "3xl": "sheet" };
const COLORS = {
  text: "foreground",
  textSecondary: "mutedForeground",
  background: "background",
  surface: "card",
  border: "border",
  tint: "primary",
  icon: "mutedForeground",
  tabIconDefault: "mutedForeground",
  tabIconSelected: "primary",
};
/** colors.blue was the info blue; the data series blue is the same hue on the tokens. */
const SPECIAL = { blue: "data.series[3]" };

function parses(code) {
  try {
    babel.parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
    return true;
  } catch (e) {
    return e.message;
  }
}

/** text-sm is a row title when the same class string makes it medium or heavier. */
function mapTextSm(classStr) {
  return /\bfont-(medium|semibold|bold)\b/.test(classStr) ? "text-body" : "text-meta";
}

function convertClasses(src) {
  // Work per string literal / template chunk so text-sm can look at its neighbours.
  return src.replace(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g, (whole, q, body) => {
    if (!/text-|rounded/.test(body)) return whole;
    let b = body;
    b = b.replace(/(^|[^\w-])text-sm(?![\w-])/g, (m, pre) => pre + mapTextSm(body));
    b = b.replace(/(^|[^\w-])text-(xs|base|lg|xl|2xl|3xl|4xl)(?![\w-])/g, (m, pre, k) => `${pre}text-${TEXT[k]}`);
    b = b.replace(/(^|[^\w-])rounded(-[tblr]{1,2})?-(sm|md|lg|xl|2xl|3xl)(?![\w-])/g, (m, pre, side, k) => `${pre}rounded${side || ""}-${ROUND[k]}`);
    return q + b + q;
  });
}

function convertHexAlpha(src) {
  let used = false;
  const out = src.replace(
    /([A-Za-z_$][\w$]*(?:\.[\w$]+|\[[^\]\n]+\])*|"#[0-9A-Fa-f]{6}"|'#[0-9A-Fa-f]{6}')\s*\+\s*["']([0-9A-Fa-f]{2})["']/g,
    (m, expr, hh) => {
      used = true;
      const a = Math.round((parseInt(hh, 16) / 255) * 100) / 100;
      return `tint(${expr}, ${a})`;
    },
  );
  return { out, used };
}

function ensureTintImport(src) {
  if (/import\s*\{[^}]*\btint\b[^}]*\}\s*from\s*["']@\/constants\/brand["']/.test(src)) return src;
  const m = src.match(/import\s*\{([^}]*)\}\s*from\s*["']@\/constants\/brand["'];?/);
  if (m) return src.replace(m[0], m[0].replace("{" + m[1] + "}", "{" + m[1].replace(/\s*$/, "") + ", tint }"));
  const lines = src.split("\n");
  let last = 0;
  lines.forEach((l, i) => {
    if (/^import .* from /.test(l) || /^\} from /.test(l)) last = i;
  });
  lines.splice(last + 1, 0, `import { tint } from ${Q}@/constants/brand${Q};`);
  return lines.join("\n");
}

function convertColors(src) {
  if (!/const theme = useTheme\(\)/.test(src)) return src;
  return src.replace(
    /\bcolors\.(text|textSecondary|background|surface|border|tint|icon|tabIconDefault|tabIconSelected|blue)\b/g,
    (m, k) => `theme.${SPECIAL[k] ?? COLORS[k]}`,
  );
}

let failed = 0;
for (const file of files) {
  const before = fs.readFileSync(file, "utf8");
  let s = convertClasses(before);
  const hex = convertHexAlpha(s);
  s = hex.out;
  if (hex.used) s = ensureTintImport(s);
  s = convertColors(s);
  const ok = parses(s);
  const left = [];
  s.split(/\r?\n/).forEach((l, i) => {
    if (/fontSize:\s*\d/.test(l)) left.push(`  ${i + 1}: fontSize  ${l.trim()}`);
    if (/\bcolors\.(text|textSecondary|background|surface|border|tint|icon)\b/.test(l)) left.push(`  ${i + 1}: colors.*  ${l.trim()}`);
    if (/\+\s*"[0-9A-Fa-f]{2}"/.test(l)) left.push(`  ${i + 1}: hex+alpha ${l.trim()}`);
  });
  console.log(`${file}: ${ok === true ? (s === before ? "unchanged" : "converted") : "PARSE FAIL " + ok}`);
  left.forEach((x) => console.log(x));
  if (ok !== true) {
    failed++;
    continue;
  }
  if (WRITE && s !== before) fs.writeFileSync(file, s);
}
process.exit(failed ? 1 : 0);
