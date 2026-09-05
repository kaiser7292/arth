/**
 * Replaces the copy-pasted Stack screenOptions block with the shared hook.
 *
 *   node scripts/codemod-stack-options.js [--write]
 *
 * Eleven feature layouts carried the same block verbatim, each reading Colors[colorScheme] — the
 * last thing keeping the legacy Colors map alive. The value range is located through the AST
 * because the object spans many lines and contains a nested JSX element (headerLeft); the
 * surrounding line edits are done line-by-line rather than by regex, so CRLF line endings and
 * escaping cannot silently make a pattern miss.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

const WRITE = process.argv.includes("--write");

const DROP = [
  "const { colorScheme } = useColorScheme();",
  "const theme = Colors[colorScheme];",
  'import { useColorScheme } from "@/hooks/use-color-scheme";',
  'import { Colors } from "@/constants/theme";',
  'import { HeaderBackHome } from "@/components/ui/HeaderBackHome";',
];
const HOOK_IMPORT = 'import { useStackScreenOptions } from "@/components/ui/stack-options";';

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name === "_layout.tsx") acc.push(p);
  }
  return acc;
}

let changed = 0;
const skipped = [];

for (const file of walk("app")) {
  const src = fs.readFileSync(file, "utf8");
  // A partially-applied earlier run already removed headerShadowVisible from some files,
  // so the guard keys on what actually identifies these layouts.
  const isFeatureLayout =
    src.includes("Colors[colorScheme]") || src.includes("headerShadowVisible");
  if (!isFeatureLayout) continue;


  const ast = babel.parse(src, { sourceType: "module", plugins: ["typescript", "jsx"] });

  let range = null;
  (function visit(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(visit);
    if (typeof n.type !== "string") return;
    if (
      n.type === "JSXAttribute" &&
      n.name && n.name.name === "screenOptions" &&
      n.value && n.value.type === "JSXExpressionContainer"
    ) {
      range = [n.value.start, n.value.end];
    }
    for (const k of Object.keys(n)) {
      if (k === "loc") continue;
      visit(n[k]);
    }
  })(ast.program);
  if (!range) continue;

  const replaced = src.slice(0, range[0]) + "{screenOptions}" + src.slice(range[1]);

  const out = [];
  let addedHook = false;
  // A partially-applied earlier run may already have added it; do not add a second.
  let addedImport = replaced.includes(HOOK_IMPORT);
  for (const raw of replaced.split("\n")) {
    const line = raw.replace("\r", "");
    const trimmed = line.trim();

    if (DROP.includes(trimmed)) {
      // HeaderBackHome moved into the shared hook, so its import becomes the hook's import.
      if (trimmed.includes("HeaderBackHome") && !addedImport) {
        out.push(HOOK_IMPORT);
        addedImport = true;
      }
      continue;
    }

    out.push(line);

    if (!addedHook && trimmed.startsWith("export default function") && trimmed.endsWith("{")) {
      out.push("  const screenOptions = useStackScreenOptions();");
      addedHook = true;
    }
  }

  let s = out.join("\n");
  if (!s.includes(HOOK_IMPORT)) s = HOOK_IMPORT + "\n" + s;
  // Collapse any duplicate copy left by a previous partial run.
  while (s.includes(HOOK_IMPORT + "\n" + HOOK_IMPORT)) {
    s = s.replace(HOOK_IMPORT + "\n" + HOOK_IMPORT, HOOK_IMPORT);
  }

  try {
    babel.parse(s, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (e) {
    skipped.push(file + " -> " + e.message);
    continue;
  }
  changed++;
  if (WRITE) fs.writeFileSync(file, s, "utf8");
}

console.log((WRITE ? "APPLIED" : "DRY RUN") + " - " + changed + " layouts");
for (const x of skipped) console.log("  SKIPPED " + x);
