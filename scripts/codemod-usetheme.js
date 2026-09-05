/**
 * Converts the compatibility bridge onto useTheme().
 *
 *   node scripts/codemod-usetheme.js [--write]
 *
 * The bridge (accent[N], ac(), acAlpha(), StatusColors) renders correct colours today, so this
 * looks like tidiness. It is not: 86 text-white labels sit on 105 accent[500] fills at roughly
 * 2.5:1, and the fix is to pair each brand fill with primaryForeground - which only exists on the
 * theme object. Converting is also what lets the bridge be deleted, at which point tsc proves the
 * colour migration is complete rather than merely believed complete.
 *
 * Mapping rules, derived from the measured shapes rather than guessed:
 *
 *   ac(accent, scheme, L, D)  - the LIGHT shade carries the intent. L>=400 is a foreground or a
 *                               solid fill; 200-300 is a border; <=100 is a tint background.
 *   accent[N]                 - same rule on N.
 *   accent[N] + "HH"          - hex alpha suffix, converted to its decimal fraction.
 *   acAlpha(accent, N, a)     - the alpha is already explicit.
 *   StatusColors[x].role      - direct lookup; the *Bg variants were 8% tints.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

const WRITE = process.argv.includes("--write");

/** Backslash, from a char code so no escaping layer between here and disk can eat it. */
const BS = String.fromCharCode(92);

/** Light shade -> theme expression. */
function brandFor(shade) {
  const n = Number(shade);
  if (n <= 100) return '__T__.alpha("primary", 0.1)';
  if (n <= 300) return '__T__.alpha("primary", 0.25)';
  return "__T__.primary";
}

/** Two-digit hex alpha -> decimal fraction, rounded to something readable. */
function alphaFor(hex) {
  const v = parseInt(hex, 16) / 255;
  return Math.round(v * 100) / 100;
}

const STATUS_PROPS = {
  success: "__T__.success",
  danger: "__T__.danger",
  warning: "__T__.warning",
  muted: "__T__.faintForeground",
  successBg: '__T__.alpha("success", 0.08)',
  dangerBg: '__T__.alpha("danger", 0.08)',
  warningBg: '__T__.alpha("warning", 0.08)',
};

const parses = (code) => {
  try {
    babel.parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
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

const stats = { acAlpha: 0, concat: 0, ac: 0, accent: 0, alias: 0, status: 0 };
let filesChanged = 0;
const skipped = [];

for (const file of [...walk("app"), ...walk("components")]) {
  const src = fs.readFileSync(file, "utf8");
  let s = src;

  // 1. acAlpha(accent, N, a) -> theme.alpha("primary", a)
  s = s.replace(/acAlpha\(\s*accent\s*,\s*\d+\s*,\s*([0-9.]+)\s*\)/g, (m, a) => {
    stats.acAlpha++;
    return '__T__.alpha("primary", ' + a + ")";
  });

  // 2. accent[N] + "HH"  -> theme.alpha("primary", d)   (before the bare accent[N] rule)
  s = s.replace(/accent\[(\d+)\]\s*\+\s*["']([0-9A-Fa-f]{2})["']/g, (m, shade, hex) => {
    stats.concat++;
    return '__T__.alpha("primary", ' + alphaFor(hex) + ")";
  });

  // 3. ac(accent, <scheme>, L, D) -> role by L
  s = s.replace(/ac\(\s*accent\s*,\s*[A-Za-z_$][\w$]*\s*,\s*(\d+)\s*,\s*\d+\s*\)/g, (m, l) => {
    stats.ac++;
    return brandFor(l);
  });

  // 4. bare accent[N]
  s = s.replace(/accent\[(\d+)\]/g, (m, shade) => {
    stats.accent++;
    return brandFor(shade);
  });

  // 5. object aliases: const sc = StatusColors[x];  then sc.success
  //    Only the seven known props are rewritten, so an unrelated `sc.foo` is never touched.
  const aliasRe = /const\s+([A-Za-z_$][\w$]*)\s*=\s*StatusColors\[[^\]]+\]\s*;\s*\n/g;
  const aliases = [];
  let am;
  while ((am = aliasRe.exec(s)) !== null) aliases.push(am[1]);
  for (const name of aliases) {
    for (const [prop, repl] of Object.entries(STATUS_PROPS)) {
      // A word boundary written as a plain JS string escape is a BACKSPACE character,
      // not a boundary, and silently matches nothing. Build it from a char code.
      const re = new RegExp(BS + "b" + name + BS + "." + prop + BS + "b", "g");
      s = s.replace(re, () => {
        stats.alias++;
        return repl;
      });
    }
    const declRe = new RegExp(
      BS + "s*const" + BS + "s+" + name + BS + "s*=" + BS + "s*StatusColors" +
        BS + "[[^" + BS + "]]+" + BS + "]" + BS + "s*;",
      "g",
    );
    s = s.replace(declRe, "");
  }

  // 6. direct StatusColors[x].prop
  s = s.replace(/StatusColors\[[^\]]+\]\.([a-zA-Z]+)/g, (m, prop) => {
    if (!STATUS_PROPS[prop]) return m;
    stats.status++;
    return STATUS_PROPS[prop];
  });

  if (s === src) continue;

  // 7. Pick a binding name, then give every component with a colour-scheme hook that binding.
  //    Four files already own the identifier `theme` - two for Colors[colorScheme], one for the
  //    theme-preference useState - so a hard-coded name collides and the file fails to parse.
  const taken = /(?:const|let|var)\s+(?:\[\s*)?theme[^A-Za-z0-9_$]/.test(s);
  const BIND = taken ? "uiTheme" : "theme";
  s = s.split("__T__").join(BIND);

  if (s.includes(BIND + ".")) {
    s = s.replace(
      /^([ 	]*)const\s*\{[^}]*\}\s*=\s*useColorScheme\(\);[ 	]*$/gm,
      (m, indent) => m + String.fromCharCode(10) + indent + "const " + BIND + " = useTheme();",
    );
  }

  // 8. import
  if (s.includes(BIND + ".") && !s.includes('from "@/hooks/use-theme"')) {
    const ast = babel.parse(src, { sourceType: "module", plugins: ["typescript", "jsx"] });
    let end = 0;
    for (const node of ast.program.body) if (node.type === "ImportDeclaration") end = node.end;
    const header = s.slice(0, end);
    const rest = s.slice(end);
    s = header + '\nimport { useTheme } from "@/hooks/use-theme";' + rest;
  }

  if (!parses(s)) {
    let why = "";
    try {
      babel.parse(s, { sourceType: "module", plugins: ["typescript", "jsx"] });
    } catch (e) {
      const ln = e.loc ? e.loc.line : 0;
      const ctx = s.split(String.fromCharCode(10)).slice(Math.max(0, ln - 2), ln + 1);
      why = e.message + " | " + ctx.join(" / ").trim().slice(0, 160);
    }
    skipped.push(file.split(path.sep).join("/") + "  ->  " + why);
    continue;
  }
  filesChanged++;
  if (WRITE) fs.writeFileSync(file, s, "utf8");
}

console.log((WRITE ? "APPLIED" : "DRY RUN") + " - " + filesChanged + " files\n");
for (const [k, v] of Object.entries(stats)) console.log("  " + String(v).padStart(4) + "  " + k);
console.log("\n  " + Object.values(stats).reduce((a, b) => a + b, 0) + " call sites converted");
if (skipped.length) {
  console.log("\n  SKIPPED (would not parse):");
  for (const f of skipped) console.log("    " + f);
}
