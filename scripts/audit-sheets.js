#!/usr/bin/env node
/**
 * Two things about sheets that nothing else catches, both of which shipped as bugs.
 *
 * 1. A `flex-1` DIRECT child of <Sheet>.
 *    flex-1 is flexGrow 1 with flexBasis 0%. Sheet's panel is an auto-height column, so such a
 *    child's hypothetical size is 0, the column has no free space to distribute, and the child
 *    lays out at ZERO height. Nothing errors - the content is simply never drawn. This is what
 *    made the simulator's "it happened - link to transactions" list not appear at all.
 *
 *    Only direct children are flagged, because those are the ones sitting in the panel's own
 *    column. Deeper down, flex-1 is almost always inside a flex-row, where it is correct.
 *
 * 2. A hand-rolled sheet: a <Modal> whose panel has a top-rounded corner.
 *    Each one re-implements positioning, a backdrop and usually an animation, and each has
 *    reproduced bugs the shared Sheet has already had fixed.
 *
 * Exits non-zero on either, so it can sit in the same run as audit-hooks and resolve-classes.
 */
const fs = require("fs");
const path = require("path");

const ROOTS = ["app", "components"];
const SKIP = new Set([path.join("components", "ui", "Sheet.tsx")]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const NEWLINE = new RegExp("\\r?\\n");
const FLEX_ONE = new RegExp('className="[^"]*\\bflex-1\\b');
const TAG = new RegExp("<(/?)([A-Za-z][A-Za-z0-9_.]*)([^>]*?)(/?)>", "gs");

const collapsing = [];
const handRolled = [];

for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    if (SKIP.has(file)) continue;
    const src = fs.readFileSync(file, "utf8");

    // --- 1. collapsing children ------------------------------------------
    // Depth is counted from the JSX tags themselves, so a `{cond && (` wrapper - which is not
    // a tag - correctly does not change the nesting level.
    if (src.includes("<Sheet")) {
      const openRe = new RegExp("<Sheet\\b", "g");
      let om;
      while ((om = openRe.exec(src))) {
        let depth = 0;
        TAG.lastIndex = src.indexOf(">", om.index) + 1;
        let tm;
        while ((tm = TAG.exec(src))) {
          const closing = tm[1];
          const name = tm[2];
          const attrs = tm[3];
          const selfClose = tm[4];
          if (name === "Sheet" && closing) break;
          if (closing) {
            depth--;
            continue;
          }
          if (depth === 0 && FLEX_ONE.test(attrs)) {
            const line = src.slice(0, tm.index).split(NEWLINE).length;
            const snippet = tm[0].replace(new RegExp("\\s+", "g"), " ").slice(0, 90);
            collapsing.push(file + ":" + line + "  " + snippet);
          }
          if (!selfClose) depth++;
        }
      }
    }

    // --- 2. hand-rolled sheets -------------------------------------------
    if (new RegExp("<Modal\\b").test(src) && /(borderTopLeftRadius|rounded-t-)/.test(src)) {
      handRolled.push(file);
    }
  }
}

let bad = false;
if (collapsing.length) {
  bad = true;
  console.error("flex-1 on a direct child of <Sheet> - lays out at zero height:\n");
  for (const h of collapsing) console.error("  " + h);
  console.error("\nDrop flex-1 and let the child size to its content; give scrollables their own maxHeight.\n");
}
if (handRolled.length) {
  bad = true;
  console.error("Hand-rolled sheet-shaped <Modal> - use <Sheet> from @/components/ui:\n");
  for (const f of handRolled) console.error("  " + f);
  console.error("");
}
if (!bad) console.log("No collapsing sheet children, and no hand-rolled sheets.");
process.exit(bad ? 1 : 0);
