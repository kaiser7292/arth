#!/usr/bin/env node
/**
 * Start the preview harness in a browser.
 *
 * `npm run preview` -> Metro serves preview/ as the Expo Router root, so the design system renders
 * with the real NativeWind classes, the real tokens and real text wrapping - no Gradle build, no
 * device. ARTH_PREVIEW is what app.config.js reads to swap the router root.
 *
 * Spawns Expo's CLI entry with this same node binary rather than `npx`, because spawning a .cmd
 * shim on Windows without a shell fails with EINVAL.
 */
const { spawn } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "..", "node_modules", "expo", "bin", "cli");
const child = spawn(process.execPath, [cli, "start", "--web", "--port", "8090"], {
  stdio: "inherit",
  env: { ...process.env, ARTH_PREVIEW: "1" },
  cwd: path.join(__dirname, ".."),
});
child.on("exit", (code) => process.exit(code ?? 0));
