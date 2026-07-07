/**
 * apply-patches.js  — run via "postinstall" in package.json
 *
 * Copies modified files from patches/<package>/... over the corresponding
 * node_modules files. Use this instead of patch-package when Windows path-
 * length limits prevent patch-package from diffing build-output folders.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const patches = [
  // expo-pdf-text-extract: add extractRows (coordinate-based PDF table extraction)
  {
    from: "patches/expo-pdf-text-extract/android/src/main/java/expo/modules/pdfextractor/PdfExtractorModule.kt",
    to:   "node_modules/expo-pdf-text-extract/android/src/main/java/expo/modules/pdfextractor/PdfExtractorModule.kt",
  },
  {
    from: "patches/expo-pdf-text-extract/src/index.ts",
    to:   "node_modules/expo-pdf-text-extract/src/index.ts",
  },
  {
    from: "patches/expo-pdf-text-extract/dist/index.js",
    to:   "node_modules/expo-pdf-text-extract/dist/index.js",
  },
  {
    from: "patches/expo-pdf-text-extract/dist/index.d.ts",
    to:   "node_modules/expo-pdf-text-extract/dist/index.d.ts",
  },
];

let applied = 0;
for (const { from, to } of patches) {
  const src = path.join(ROOT, from);
  const dst = path.join(ROOT, to);
  if (!fs.existsSync(src)) {
    console.warn(`[apply-patches] source not found, skipping: ${from}`);
    continue;
  }
  if (!fs.existsSync(path.dirname(dst))) {
    console.warn(`[apply-patches] destination directory missing, skipping: ${to}`);
    continue;
  }
  fs.copyFileSync(src, dst);
  console.log(`[apply-patches] ✓  ${from}`);
  applied++;
}

console.log(`[apply-patches] Applied ${applied} of ${patches.length} patches.`);
