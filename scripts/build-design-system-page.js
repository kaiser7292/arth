#!/usr/bin/env node
/**
 * Writes the current design tokens into docs/design-system.html (the "Design System" page on
 * souravbaid.com), between the TOKENS:BEGIN / TOKENS:END markers.
 *
 * Run after changing constants/design-tokens.js:  npm run site:design-system
 * The page renders swatches, the type scale, radii and motion from this data, so the site can't
 * drift from what the app ships.
 */
const fs = require("node:fs");
const path = require("node:path");
const { SEMANTIC, teal, TYPE, RADIUS, MOTION, DATA } = require("../constants/design-tokens.js");

const file = path.join(__dirname, "..", "docs", "design-system.html");
const html = fs.readFileSync(file, "utf8");
const begin = "/*TOKENS:BEGIN*/";
const end = "/*TOKENS:END*/";
const i = html.indexOf(begin);
const j = html.indexOf(end);
if (i < 0 || j < i) throw new Error("TOKENS markers not found in docs/design-system.html");

const data = { SEMANTIC, teal, TYPE, RADIUS, MOTION, DATA };
const out = html.slice(0, i + begin.length) + "\nconst TOKENS = " + JSON.stringify(data) + ";\n" + html.slice(j);
fs.writeFileSync(file, out);
console.log("Wrote tokens into " + path.relative(process.cwd(), file));
