#!/usr/bin/env node
/**
 * Dev-only reproducible generator for assets/data/*.json bundles.
 *
 * Fetches upstreams, normalizes the shape, commits the output. NEVER runs
 * on-device. Outputs are deterministic given the same upstream snapshot.
 *
 * Usage:
 *   node scripts/build-data-bundles.mjs              # build everything
 *   node scripts/build-data-bundles.mjs --only=mcc   # build one bundle
 *
 * License inheritance per bundle:
 *   - MCC (greggles/mcc-codes): Unlicense / public domain
 *   - IFSC (razorpay/ifsc):     MIT
 *
 * Attribution files are written to assets/data/licenses/ alongside the JSON.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "assets", "data");
const LICENSE_DIR = path.resolve(DATA_DIR, "licenses");

const BUILD_VERSION = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// ---------------------------------------------------------------------------
// MCC codes — ISO 18245 via greggles/mcc-codes (Unlicense)
// ---------------------------------------------------------------------------

const MCC_UPSTREAM =
  "https://raw.githubusercontent.com/greggles/mcc-codes/main/mcc_codes.json";

/**
 * Map MCC (first digit + notable ranges) to one of Artha's 13 default
 * categories. Imperfect by design — user corrections refine it over time
 * via the existing merchant_corrections learning loop.
 *
 * Category names MUST match `DEFAULT_CATEGORIES` in
 * database/defaults/categories.ts exactly.
 */
function mapMccToCategory(mcc, description) {
  const code = parseInt(mcc, 10);
  const desc = (description || "").toLowerCase();

  // Airlines & travel
  if (code >= 3000 && code <= 3299) return "Travel & Going Out";
  if (code >= 3500 && code <= 3999) return "Travel & Going Out";
  if (code >= 4000 && code <= 4799) return "Travel & Going Out";
  if (code === 4111 || code === 4121 || code === 4131) return "Travel & Going Out";
  if (code === 4411 || code === 4511 || code === 4722) return "Travel & Going Out";
  if (code === 7011 || code === 7012) return "Travel & Going Out";

  // Utilities, rent, telecom
  if (code === 4812 || code === 4814 || code === 4815 || code === 4816) return "Rent & Utilities";
  if (code === 4899 || code === 4900) return "Rent & Utilities";
  if (code === 6513) return "Rent & Utilities";

  // Car & fuel & repairs
  if (code === 5541 || code === 5542 || code === 5983) return "Car & Vehicles";
  if (code === 5511 || code === 5521 || code === 5571 || code === 5599) return "Car & Vehicles";
  if (code === 7523 || code === 7531 || code === 7535 || code === 7538 || code === 7542 || code === 7549) return "Car & Vehicles";

  // Grocery & supplies
  if (code === 5411 || code === 5422 || code === 5441 || code === 5451 || code === 5462 || code === 5499) return "Grocery & Supplies";
  if (code === 5300 || code === 5310 || code === 5311) return "Grocery & Supplies";

  // Food & dining
  if (code === 5812 || code === 5813 || code === 5814) return "Food";

  // Health & medicine
  if (code >= 8011 && code <= 8099) return "Health & Medicine";
  if (code === 5912 || code === 5122 || code === 5047) return "Health & Medicine";
  if (code === 8050 || code === 8062 || code === 8071) return "Health & Medicine";

  // Insurance
  if (code === 6300 || code === 5960) return "Insurance";

  // Entertainment & subscriptions — streaming/telecom/digital goods
  if (code === 4899 || code === 5815 || code === 5816 || code === 5817 || code === 5818) return "Subscriptions";
  if (code === 7832 || code === 7841 || code === 7829) return "Subscriptions";

  // Shopping & gifts
  if (code >= 5600 && code <= 5699) return "Shopping & Gifts";
  if (code >= 5700 && code <= 5799) return "Shopping & Gifts";
  if (code >= 5900 && code <= 5999 && code !== 5912 && code !== 5960 && code !== 5983) return "Shopping & Gifts";
  if (code >= 5200 && code <= 5299) return "Shopping & Gifts";

  // Family — childcare, schools, daycare
  if (code === 8211 || code === 8220 || code === 8241 || code === 8244 || code === 8249 || code === 8299) return "Family";
  if (code === 8351) return "Family";

  // Loans / financial services → EMIs
  if (code === 6012 || code === 6051) return "EMIs";

  // Fallback on description hints
  if (/pharma|medic|hospital|clinic|doctor/.test(desc)) return "Health & Medicine";
  if (/restaurant|food|dining|cafe|caterer/.test(desc)) return "Food";
  if (/grocer|supermark|bakery|dairy/.test(desc)) return "Grocery & Supplies";
  if (/airline|hotel|travel|rental car/.test(desc)) return "Travel & Going Out";
  if (/utility|telecom|cable|electric/.test(desc)) return "Rent & Utilities";

  return "Miscellaneous";
}

async function buildMcc() {
  console.log("[mcc] fetching", MCC_UPSTREAM);
  const res = await fetch(MCC_UPSTREAM);
  if (!res.ok) throw new Error(`MCC fetch failed: ${res.status}`);
  const rows = await res.json();

  const entries = rows
    .map((r) => ({
      code: r.mcc,
      description: r.edited_description || r.combined_description || r.irs_description || "",
      category_name: mapMccToCategory(r.mcc, r.edited_description || r.combined_description),
    }))
    .filter((e) => e.code && e.description)
    .sort((a, b) => a.code.localeCompare(b.code));

  const bundle = {
    version: BUILD_VERSION,
    source: "https://github.com/greggles/mcc-codes (Unlicense)",
    count: entries.length,
    entries,
  };

  await fs.writeFile(
    path.join(DATA_DIR, "mcc-codes.json"),
    JSON.stringify(bundle, null, 2) + "\n",
  );
  console.log(`[mcc] wrote ${entries.length} entries`);
}

// ---------------------------------------------------------------------------
// IFSC bank-prefix slice via razorpay/ifsc (MIT)
// ---------------------------------------------------------------------------

// razorpay/ifsc ships `src/banknames.json` as a flat {CODE: "Bank Name"} map.
const IFSC_UPSTREAM =
  "https://raw.githubusercontent.com/razorpay/ifsc/master/src/banknames.json";

async function buildIfsc() {
  console.log("[ifsc] fetching", IFSC_UPSTREAM);
  const res = await fetch(IFSC_UPSTREAM);
  if (!res.ok) throw new Error(`IFSC fetch failed: ${res.status}`);
  const map = await res.json();

  const entries = Object.entries(map)
    .map(([prefix, name]) => ({
      ifsc_prefix: prefix,
      bank_name: name,
      bank_short_code: prefix,
    }))
    .sort((a, b) => a.ifsc_prefix.localeCompare(b.ifsc_prefix));

  const bundle = {
    version: BUILD_VERSION,
    source: "https://github.com/razorpay/ifsc (MIT)",
    count: entries.length,
    entries,
  };

  await fs.writeFile(
    path.join(DATA_DIR, "ifsc-prefixes.json"),
    JSON.stringify(bundle, null, 2) + "\n",
  );
  console.log(`[ifsc] wrote ${entries.length} entries`);
}

// ---------------------------------------------------------------------------
// License files
// ---------------------------------------------------------------------------

async function writeLicenses() {
  await fs.mkdir(LICENSE_DIR, { recursive: true });

  await fs.writeFile(
    path.join(LICENSE_DIR, "README.md"),
    `# Bundled public-data licenses

Each JSON under \`assets/data/\` that derives from a public upstream carries
its license here.

| Bundle | License | Upstream |
|---|---|---|
| mcc-codes.json | Unlicense (public domain) | https://github.com/greggles/mcc-codes |
| ifsc-prefixes.json | MIT | https://github.com/razorpay/ifsc |
| sms-senders.json | Artha-authored | — |
| sms-templates.json | Artha-authored (regex derivative work over factual SMS content) | — |
| merchant-brands.json | Artha-authored | — |

Regenerated via \`node scripts/build-data-bundles.mjs\` during batch builds.
`,
  );

  await fs.writeFile(
    path.join(LICENSE_DIR, "LICENSE-greggles-mcc.txt"),
    `This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute
this software, either in source code form or as a compiled binary, for any
purpose, commercial or non-commercial, and by any means.

For more information, please refer to <https://unlicense.org>.
`,
  );

  await fs.writeFile(
    path.join(LICENSE_DIR, "LICENSE-razorpay-ifsc.txt"),
    `MIT License

Copyright (c) Razorpay Software Private Limited

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

  await fs.mkdir(DATA_DIR, { recursive: true });

  if (!only || only === "mcc") await buildMcc();
  if (!only || only === "ifsc") await buildIfsc();
  if (!only) await writeLicenses();

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
