/**
 * Collapses the legacy light/dark class pairs onto single scheme-aware tokens.
 *
 *   node scripts/codemod-dark.js            # dry run, prints a report
 *   node scripts/codemod-dark.js --write    # applies
 *   node scripts/codemod-dark.js --write app/(tabs) components/home
 *
 * Safe because `scripts/resolve-classes.js` proves both halves of each pair already compile to the
 * same CSS variable, which flips by scheme on its own. The `dark:` half is therefore redundant,
 * not load-bearing, and dropping it cannot change a rendered colour.
 *
 * THE ONE RULE THAT MATTERS: a `dark:` class is only removed when a *tokenised* light partner is
 * present in the same class string. Where the light half is a raw Tailwind literal (`bg-white`,
 * `text-red-600`) there is no variable behind it, so it will not flip — removing the dark half
 * would leave a white card in dark mode. Those are reported for hand editing, never rewritten.
 */
const fs = require("fs");
const path = require("path");
const babel = require("@babel/parser");

/**
 * A text scanner cannot reliably tell a template literal from a backtick that appears inside a
 * regex literal or a comment (app/ai-chat.tsx line 57 contains exactly that). Rather than chase
 * every lexical edge case, validate the result: nothing is written unless it still parses as
 * TSX. A file whose transform would not parse is reported and left untouched.
 */
function parses(code) {
  try {
    babel.parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
    return true;
  } catch {
    return false;
  }
}

/** Legacy light token -> new semantic token. */
const RENAME = {
  "text-text-primary": "text-foreground",
  "text-text-secondary": "text-muted-foreground",
  "text-text-tertiary": "text-faint-foreground",
  "bg-surface-light": "bg-background",
  "bg-surface-light-alt": "bg-card",
  "bg-border-light": "bg-border",
  "border-border-light": "border-border",
};

/**
 * Legacy dark token -> the light tokens that legitimately pair with it.
 * `bg-white` is deliberately absent from every list: it is a literal, not a token.
 * `text-text-tertiary` accepts either dark partner because the codebase used both
 * inconsistently (51 x dark-secondary, 28 x dark-tertiary) for the same light class.
 */
const PARTNERS = {
  "dark:text-text-dark-primary": ["text-text-primary"],
  "dark:text-text-dark-secondary": ["text-text-secondary", "text-text-tertiary"],
  "dark:text-text-dark-tertiary": ["text-text-tertiary", "text-text-secondary"],
  "dark:bg-surface-dark": ["bg-surface-light"],
  "dark:bg-surface-dark-alt": ["bg-surface-light-alt", "bg-surface-light"],
  "dark:bg-border-dark": ["bg-border-light"],
  "dark:border-border-dark": ["border-border-light"],
};

/** Classes referencing tokens that never existed in tailwind.config — dead today, silently. */
const DEAD = [
  "dark:text-text-dark",
  "dark:bg-background-dark",
  "dark:bg-card-dark",
  "dark:text-secondary-dark",
  "dark:bg-muted-dark",
  "dark:text-primary-400",
];

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
const TARGETS = roots.length ? roots : ["app", "components"];

/** Split a class token from its `/opacity` modifier so the modifier survives a rename. */
const split = (tok) => {
  const i = tok.indexOf("/");
  return i === -1 ? [tok, ""] : [tok.slice(0, i), tok.slice(i)];
};

const stats = { files: 0, renamed: 0, darkRemoved: 0, dead: 0 };
const orphans = [];
const unparseable = [];
const unknownDark = new Map();

/** Rewrite one whitespace-separated class string. */
function rewriteClassString(str, file, line, scope) {
  const parts = str.split(/(\s+)/); // keep whitespace so formatting is preserved
  const bare = scope || new Set(parts.map((p) => split(p.trim())[0]).filter(Boolean));

  const out = [];
  for (const part of parts) {
    const tok = part.trim();
    if (!tok) {
      out.push(part);
      continue;
    }
    const [name, mod] = split(tok);

    if (DEAD.includes(name)) {
      stats.dead++;
      continue; // drop: references a token that was never registered, renders nothing today
    }

    if (PARTNERS[name]) {
      const hasPartner = PARTNERS[name].some((p) => bare.has(p));
      if (hasPartner) {
        stats.darkRemoved++;
        continue; // redundant — the light token already flips by scheme
      }
      // No tokenised partner: the light half is a literal, or the dark class stands alone.
      orphans.push({ file, line, cls: name, str: str.trim().slice(0, 90) });
      out.push(part);
      continue;
    }

    if (RENAME[name]) {
      stats.renamed++;
      out.push(part.replace(name + mod, RENAME[name] + mod));
      continue;
    }

    if (name.startsWith("dark:")) {
      unknownDark.set(name, (unknownDark.get(name) || 0) + 1);
    }
    out.push(part);
  }

  // Collapse the gaps left by removed tokens. Leading/trailing space is preserved only if the
  // input had it — inside a template segment that space separates the classes from an adjacent
  // ${...}, so inventing or dropping it changes the rendered class list.
  const hadLead = /^\s/.test(str);
  const hadTrail = /\s$/.test(str);
  let res = out.join("").replace(/ {2,}/g, " ");
  if (!hadLead) res = res.replace(/^ +/, "");
  if (!hadTrail) res = res.replace(/ +$/, "");
  return res;
}

/**
 * Class names live in three places, and each needs different handling:
 *   "..." / '...'            — the whole body is a class string.
 *   `... ${expr} ...`        — only the literal segments are class text; the ${} expressions are
 *                              code, and any class strings inside them are quoted, so they are
 *                              picked up by the quoted-string pass instead.
 *
 * Naively treating a whole template as one class string is what produced tokens carrying a stray
 * quote (`dark:border-border-dark"`), which then matched nothing and were silently skipped.
 */
const BS = String.fromCharCode(92);
/** Built via fromCharCode so the pattern survives any escaping layer between here and disk. */
const QUOTED_RE = new RegExp('"[^"' + BS + 'n]*"' + "|'[^'" + BS + "n]*'", "g");

/**
 * Rewrite quoted class strings that live INSIDE a template's ${...} expression.
 * Without this, the extremely common
 *   `bg-card ${elevated ? "" : "border border-border-light dark:border-border-dark"}`
 * leaves the ternary branch un-migrated, because the outer scanner treats ${...} as code.
 * Partner detection uses the whole template's scope, so a pair split across the ternary
 * boundary still resolves.
 */
function rewriteQuotedIn(code, file, line, scope) {
  return code.replace(QUOTED_RE, (m) => {
    const body = m.slice(1, -1);
    if (!TOUCHES.test(body)) return m;
    return m[0] + rewriteClassString(body, file, line, scope) + m[0];
  });
}

/** Split a template body into { text, isCode } segments, respecting nested braces. */
function segmentTemplate(body) {
  const segs = [];
  let i = 0, buf = "";
  while (i < body.length) {
    if (body[i] === "$" && body[i + 1] === "{") {
      if (buf) segs.push({ text: buf, isCode: false });
      buf = "";
      let depth = 0, j = i;
      for (; j < body.length; j++) {
        if (body[j] === "{") depth++;
        else if (body[j] === "}") { depth--; if (depth === 0) { j++; break; } }
      }
      segs.push({ text: body.slice(i, j), isCode: true });
      i = j;
    } else {
      buf += body[i++];
    }
  }
  if (buf) segs.push({ text: buf, isCode: false });
  return segs;
}

/** Every bare class token anywhere in a region — used so partner detection spans a whole template. */
function collectBare(region) {
  const out = new Set();
  for (const raw of region.split(/[\s"'`{}()?:]+/)) {
    const t = split(raw.trim())[0];
    if (t) out.add(t);
  }
  return out;
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

const TOUCHES = new RegExp(
  "(" + [...Object.keys(RENAME), ...Object.keys(PARTNERS), ...DEAD].join("|") + ")",
);

const files = TARGETS.flatMap((t) => (fs.existsSync(t) ? walk(t) : []));

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  if (!TOUCHES.test(src)) continue;

  const lineAt = (off) => src.slice(0, off).split("\n").length;
  let out = "";
  let i = 0;
  let changed = false;

  while (i < src.length) {
    const ch = src[i];

    if (ch === "`") {
      // Template literal: rewrite only the literal segments, scope partners across the whole body.
      let j = i + 1;
      while (j < src.length && src[j] !== "`") j++;
      const body = src.slice(i + 1, j);
      if (TOUCHES.test(body)) {
        const scope = collectBare(body);
        const rebuilt = segmentTemplate(body)
          .map((seg) =>
            seg.isCode
              ? rewriteQuotedIn(seg.text, file, lineAt(i), scope)
              : rewriteClassString(seg.text, file, lineAt(i), scope),
          )
          .join("");
        if (rebuilt !== body) changed = true;
        out += "`" + rebuilt + "`";
      } else {
        out += src.slice(i, j + 1);
      }
      i = j + 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const pattern = ch === '"' ? '^"[^"' + String.fromCharCode(92) + "n]*\"" : "^'[^'" + String.fromCharCode(92) + "n]*'";
      const m = new RegExp(pattern).exec(src.slice(i));
      if (m) {
        const body = m[0].slice(1, -1);
        if (TOUCHES.test(body)) {
          const rebuilt = rewriteClassString(body, file, lineAt(i), collectBare(body));
          if (rebuilt !== body) changed = true;
          out += ch + rebuilt + ch;
        } else {
          out += m[0];
        }
        i += m[0].length;
        continue;
      }
    }

    out += ch;
    i++;
  }

  if (changed) {
    if (!parses(out)) {
      unparseable.push(file);
      continue;
    }
    stats.files++;
    if (WRITE) fs.writeFileSync(file, out, "utf8");
  }
}

console.log((WRITE ? "APPLIED" : "DRY RUN") + " over " + files.length + " files\n");
console.log("  files changed      " + stats.files);
console.log("  light tokens renamed " + stats.renamed);
console.log("  dark: classes removed " + stats.darkRemoved);
console.log("  dead classes removed  " + stats.dead);
console.log("  orphans left for hand edit " + orphans.length);
if (unparseable.length) {
  console.log("");
  console.log("  SKIPPED - transform would not parse, left untouched for hand editing:");
  for (const f of unparseable) console.log("    " + f);
}

if (unknownDark.size) {
  console.log("\nOther dark: classes seen (not in scope, left alone):");
  for (const [k, v] of [...unknownDark].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log("  " + String(v).padStart(4) + "  " + k);
  }
}

if (orphans.length) {
  console.log("\nORPHANS — light half is a literal or missing; these need a human:");
  const byCls = {};
  for (const o of orphans) (byCls[o.cls] ||= []).push(o);
  for (const [cls, list] of Object.entries(byCls)) {
    console.log("\n  " + cls + "  (" + list.length + ")");
    for (const o of list.slice(0, 4)) console.log("    " + o.file + ":" + o.line + "  " + o.str);
    if (list.length > 4) console.log("    ... and " + (list.length - 4) + " more");
  }
  fs.writeFileSync(
    path.join(__dirname, "..", "docs", "revamp-orphan-classes.md"),
    "# Orphan dark: classes — need hand editing\n\n" +
      "The light half is a raw Tailwind literal (no CSS variable behind it, so it will not flip\n" +
      "with the colour scheme) or there is no light half at all. Removing the `dark:` class would\n" +
      "leave these rendering the light colour in dark mode.\n\n" +
      Object.entries(byCls)
        .map(
          ([cls, list]) =>
            "## `" + cls + "` (" + list.length + ")\n\n" +
            list.map((o) => "- `" + o.file + ":" + o.line + "` — `" + o.str + "`").join("\n"),
        )
        .join("\n\n") + "\n",
    "utf8",
  );
  console.log("\n  Full list written to docs/revamp-orphan-classes.md");
}
