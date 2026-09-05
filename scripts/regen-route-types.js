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
const out = path.join(__dirname, "..", ".expo", "types");
regenerateDeclarations(out);
// regenerateDeclarations is debounced, so give it a moment before reporting.
setTimeout(() => {
  const p = path.join(out, "router.d.ts");
  const s = require("fs").statSync(p);
  console.log(`router.d.ts  ${s.size} bytes  ${s.mtime.toISOString()}`);
}, 1500);
