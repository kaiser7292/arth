#!/usr/bin/env node
/**
 * Regenerate .expo/types/router.d.ts.
 *
 * expo-router writes this file from the Metro dev server, so on a machine that only ever runs
 * `expo prebuild` + gradle it goes stale silently. Ours was eight weeks behind: six routes that
 * exist on disk were missing from it, so every `router.push` to them failed to typecheck, and the
 * codebase had answered that with 150 `as never` casts - which then hid any genuine bad route too.
 *
 * Run this after adding or renaming a screen.
 */
const path = require("path");
process.env.EXPO_ROUTER_APP_ROOT = path.join(__dirname, "..", "app");
const { regenerateDeclarations } = require(path.join(
  __dirname, "..", "node_modules", "expo-router", "build", "typed-routes",
));
/**
 * Expo rewrites tsconfig.json on `expo start`, and when typed routes are off for that run - which
 * they are for the preview harness - it strips `.expo/types` and `expo-env.d.ts` from `include`.
 * That silently switches OFF route checking for the whole repo: every router.push stops being
 * verified, which is exactly what the 153 `as never` casts used to hide. Put them back.
 */
function ensureTsconfigIncludes() {
  const fs = require("fs");
  const tsconfigPath = path.join(__dirname, "..", "tsconfig.json");
  const raw = fs.readFileSync(tsconfigPath, "utf8");
  const cfg = JSON.parse(raw);
  const needed = [".expo/types/**/*.ts", "expo-env.d.ts"];
  const missing = needed.filter((n) => !(cfg.include ?? []).includes(n));
  if (!missing.length) return;
  cfg.include = [...(cfg.include ?? []), ...missing];
  const CR = String.fromCharCode(13);
  const LF = String.fromCharCode(10);
  const eol = raw.includes(CR + LF) ? CR + LF : LF;
  fs.writeFileSync(tsconfigPath, JSON.stringify(cfg, null, 2).split(LF).join(eol) + eol);
  console.log("tsconfig: restored " + missing.join(", ") + " to include");
}

ensureTsconfigIncludes();

const out = path.join(__dirname, "..", ".expo", "types");
regenerateDeclarations(out);
// regenerateDeclarations is debounced, so give it a moment before reporting.
setTimeout(() => {
  const p = path.join(out, "router.d.ts");
  const s = require("fs").statSync(p);
  console.log(`router.d.ts  ${s.size} bytes  ${s.mtime.toISOString()}`);
}, 1500);
