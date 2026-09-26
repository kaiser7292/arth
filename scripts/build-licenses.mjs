#!/usr/bin/env node
/**
 * Generates assets/data/open-source-licenses.json for Settings → Open-source licences.
 *
 * Walks every production dependency (npm ls --omit=dev --all), reads each
 * package's license field and LICENSE/NOTICE text, and adds the bundled data
 * attributions from assets/data/licenses/. Re-run after adding or upgrading
 * dependencies — the licenses-coverage test fails when a direct dependency
 * is missing.
 *
 *   node scripts/build-licenses.mjs      (or: npm run licenses)
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "data", "open-source-licenses.json");
const DATA_LICENSE_DIR = path.join(ROOT, "assets", "data", "licenses");
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;

function licenseText(dir) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const texts = files
    .filter((f) => LICENSE_FILE.test(f))
    .sort()
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8").trim());
  return texts.length ? texts.join("\n\n") : null;
}

function licenseName(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(" OR ");
  return "UNKNOWN";
}

const paths = execSync("npm ls --omit=dev --all --parseable", {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split(/\r?\n/)
  .map((p) => p.trim())
  .filter((p) => p && path.resolve(p) !== ROOT);

const seen = new Map();
for (const dir of paths) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    continue;
  }
  if (!pkg.name || pkg.private) continue;
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) continue;
  seen.set(key, {
    name: pkg.name,
    version: pkg.version ?? "",
    license: licenseName(pkg),
    text: licenseText(dir),
  });
}

const packages = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const data = fs.existsSync(DATA_LICENSE_DIR)
  ? fs
      .readdirSync(DATA_LICENSE_DIR)
      .filter((f) => /^LICENSE/i.test(f))
      .sort()
      .map((f) => ({
        name: `Bundled data: ${f.replace(/^LICENSE-/i, "").replace(/\.[^.]+$/, "")}`,
        version: "",
        license: "See text",
        text: fs.readFileSync(path.join(DATA_LICENSE_DIR, f), "utf8").trim(),
      }))
  : [];

fs.writeFileSync(OUT, JSON.stringify({ packages: [...data, ...packages] }) + "\n");
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`Wrote ${packages.length} packages + ${data.length} data attributions to ${path.relative(ROOT, OUT)} (${kb} KB)`);
const missingText = packages.filter((p) => !p.text).length;
if (missingText) console.log(`${missingText} packages have no LICENSE file (licence type is still listed)`);
