#!/usr/bin/env node
/**
 * Dev-only generator for database/defaults/osm-brand-mappings.ts — extra built-in merchant rules
 * for Indian store brands, from OpenStreetMap's Name Suggestion Index (BSD-3-Clause).
 *
 *   node scripts/build-osm-brands.mjs
 *
 * Runs at development time only: the result is a bundled TypeScript file. The app never contacts
 * OpenStreetMap or any other service to categorise merchants.
 *
 * Choices:
 *   - Brands whose locationSet includes India ("in") and whose OSM type maps to an Arth category
 *     (restaurants, shops, pharmacies, fuel, hotels, gyms, insurance offices). Banks/ATMs skipped.
 *   - Rules use matchMode "word" (whole words) because store names are often everyday words.
 *   - Single words under 5 letters, common English words and a hand-reviewed DROP list are left
 *     out; telecom brands go to Rent & Utilities (CATEGORY_OVERRIDE). Keywords Arth already
 *     ships in merchant-mappings.ts are skipped so the hand-curated rule wins.
 * Licence text is written to assets/data/licenses/ so it shows on the Open-source licences page.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NSI_VERSION = "6.0.20250817";
const BASE = `https://cdn.jsdelivr.net/npm/name-suggestion-index@${NSI_VERSION}`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "database", "defaults", "osm-brand-mappings.ts");
const LICENSE_OUT = path.join(ROOT, "assets", "data", "licenses", "LICENSE-osm-name-suggestion-index.txt");
const DEFAULTS = path.join(ROOT, "database", "defaults", "merchant-mappings.ts");

/** OSM type → Arth default category. Anything not listed is skipped. */
const CATEGORY_BY_TYPE = {
  "amenity/fast_food": "Food", "amenity/restaurant": "Food", "amenity/cafe": "Food", "amenity/ice_cream": "Food",
  "amenity/food_court": "Food", "shop/bakery": "Food", "shop/pastry": "Food", "shop/confectionery": "Food",
  "shop/deli": "Food", "shop/tea": "Food", "shop/coffee": "Food",
  "shop/supermarket": "Grocery & Supplies", "shop/convenience": "Grocery & Supplies", "shop/grocery": "Grocery & Supplies",
  "shop/greengrocer": "Grocery & Supplies", "shop/butcher": "Grocery & Supplies", "shop/dairy": "Grocery & Supplies",
  "shop/clothes": "Shopping & Gifts", "shop/shoes": "Shopping & Gifts", "shop/jewelry": "Shopping & Gifts",
  "shop/electronics": "Shopping & Gifts", "shop/mobile_phone": "Shopping & Gifts", "shop/department_store": "Shopping & Gifts",
  "shop/furniture": "Shopping & Gifts", "shop/cosmetics": "Shopping & Gifts", "shop/bag": "Shopping & Gifts",
  "shop/gift": "Shopping & Gifts", "shop/books": "Shopping & Gifts", "shop/toys": "Shopping & Gifts",
  "shop/sports": "Shopping & Gifts", "shop/watches": "Shopping & Gifts", "shop/variety_store": "Shopping & Gifts",
  "shop/houseware": "Shopping & Gifts", "shop/hardware": "Shopping & Gifts", "shop/doityourself": "Shopping & Gifts",
  "shop/boutique": "Shopping & Gifts", "shop/fabric": "Shopping & Gifts", "shop/computer": "Shopping & Gifts",
  "shop/appliance": "Shopping & Gifts", "shop/beauty": "Shopping & Gifts", "shop/hairdresser": "Shopping & Gifts",
  "amenity/pharmacy": "Health & Medicine", "shop/chemist": "Health & Medicine", "amenity/clinic": "Health & Medicine",
  "amenity/hospital": "Health & Medicine", "amenity/dentist": "Health & Medicine", "healthcare/laboratory": "Health & Medicine",
  "shop/optician": "Health & Medicine", "leisure/fitness_centre": "Health & Medicine",
  "amenity/fuel": "Car & Vehicles", "shop/car": "Car & Vehicles", "shop/motorcycle": "Car & Vehicles",
  "shop/car_repair": "Car & Vehicles", "shop/tyres": "Car & Vehicles", "shop/car_parts": "Car & Vehicles",
  "amenity/cinema": "Travel & Going Out", "tourism/hotel": "Travel & Going Out", "amenity/car_rental": "Travel & Going Out",
  "office/insurance": "Insurance",
};

/** Everyday words that are also store names somewhere — too likely to match the wrong merchant. */
const GENERIC = new Set(
  ("more metro liberty plus star life care city home best royal nature natures fresh global family central trends trend " +
    "smart super mega mart bazaar bazar store shop market hotel cafe coffee pizza burger kitchen food foods bakery " +
    "medical pharmacy clinic hospital health fitness gold silver diamond fashion style beauty sport sports mobile " +
    "electronics digital express india indian national general united classic modern prime premium elite crown " +
    "spencer spencers forever woodland").split(" "),
);

/** Reviewed by hand: names that mean several different businesses in Indian SMS. */
const DROP = new Set(["reliance", "reliance industries", "bajaj", "empire", "naturals", "vodafone in"]);

/** Reviewed by hand: OSM files telecom brands as phone shops, but their SMS are bills and recharges. */
const CATEGORY_OVERRIDE = {
  airtel: "Rent & Utilities", vodafone: "Rent & Utilities", "vodafone idea": "Rent & Utilities",
  "idea cellular": "Rent & Utilities",
};

function asciiFold(s) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

function normalize(s) {
  let k = asciiFold(String(s)).toLowerCase().replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) k = k.replace(/\s+(limited|ltd|pvt|private|inc|corp|llp|llc|india|online)\.?$/g, "").trim();
  return k;
}

function usable(k) {
  if (!/^[a-z0-9][a-z0-9 &'.+-]*$/.test(k)) return false; // Latin only - SMS merchants are Latin
  const words = k.split(" ");
  if (words.length === 1 && (k.length < 5 || GENERIC.has(k))) return false;
  if (words.every((w) => GENERIC.has(w))) return false;
  return true;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

const existing = new Set([...fs.readFileSync(DEFAULTS, "utf8").matchAll(/keyword: "([^"]+)"/g)].map((m) => m[1]));
const nsi = JSON.parse(await fetchText(`${BASE}/dist/nsi.min.json`));

const rules = new Map();
for (const [tkv, value] of Object.entries(nsi.nsi)) {
  const [kind, key, val] = tkv.split("/");
  if (kind !== "brands") continue;
  const category = CATEGORY_BY_TYPE[`${key}/${val}`];
  if (!category) continue;
  for (const item of value.items ?? []) {
    const include = (item.locationSet?.include ?? []).map((x) => String(x).toLowerCase());
    if (!include.includes("in")) continue;
    const t = item.tags ?? {};
    const names = [t.brand, t["brand:en"], t.name, t["name:en"], ...(item.matchNames ?? [])].filter(Boolean);
    for (const raw of names) {
      const keyword = normalize(raw);
      if (!usable(keyword) || DROP.has(keyword) || existing.has(keyword) || rules.has(keyword)) continue;
      rules.set(keyword, { keyword, categoryName: CATEGORY_OVERRIDE[keyword] ?? category, brand: t.brand ?? item.displayName });
    }
  }
}

const sorted = [...rules.values()].sort((a, b) => a.categoryName.localeCompare(b.categoryName) || a.keyword.localeCompare(b.keyword));
const body = sorted
  .map((r) => `  { keyword: ${JSON.stringify(r.keyword)}, categoryName: ${JSON.stringify(r.categoryName)}, confidence: 0.85, matchMode: "word" },`)
  .join("\n");

fs.writeFileSync(
  OUT,
  `/**
 * GENERATED by scripts/build-osm-brands.mjs - do not edit by hand.
 *
 * Indian store brands from OpenStreetMap's Name Suggestion Index v${NSI_VERSION}
 * (https://github.com/osmlab/name-suggestion-index), BSD-3-Clause, mapped to Arth's default
 * categories. Whole-word matching (see migration 079). ${sorted.length} rules.
 */
import type { DefaultMerchantMapping } from "./merchant-mappings";

export const OSM_BRAND_MAPPINGS: DefaultMerchantMapping[] = [
${body}
];
`,
);

const license = await fetchText(`${BASE}/LICENSE.md`);
fs.writeFileSync(LICENSE_OUT, `Name Suggestion Index (OpenStreetMap brand data) v${NSI_VERSION}\nhttps://github.com/osmlab/name-suggestion-index\n\n${license.trim()}\n`);

const byCat = {};
for (const r of sorted) byCat[r.categoryName] = (byCat[r.categoryName] ?? 0) + 1;
console.log(`Wrote ${sorted.length} rules to ${path.relative(ROOT, OUT)}`, byCat);
