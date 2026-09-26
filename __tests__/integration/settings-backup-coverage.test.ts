import * as fs from "fs";
import * as path from "path";

/**
 * Settings backup guard: every key the app writes to device storage (MMKV) must be in
 * services/backup-settings.ts SETTINGS_REGISTRY - as backed up, or as device-only with a
 * reason - and its declared type must match how the code reads it. A new setting that nobody
 * classified fails this test instead of silently missing from backups.
 */

jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(() => ({})),
}));

import { SETTINGS_REGISTRY, specFor, type SettingsStoreId } from "../../services/backup-settings";

const ROOT = path.resolve(__dirname, "../..");
const STORE_EXPORTS: Record<string, SettingsStoreId> = {
  settingsStorage: "settings",
  duplicateDismissalsStorage: "duplicateDismissals",
  minBalanceAcksStorage: "minBalanceAcks",
};

/**
 * Writes whose key is computed at runtime. Each lists the concrete key(s) it can produce, which
 * must then be covered by the registry. A NEW computed key fails the test until it's added here.
 */
const DYNAMIC: Record<string, string[]> = {
  "services/broker-link.ts|KEY[broker]": ["angel_linked_account_id", "zebpay_linked_account_id"],
  "services/broker-terms.ts|ACCEPTED_KEYS[id]": ["broker_terms_accepted_kite", "broker_terms_accepted_angel", "broker_terms_accepted_zebpay"],
  "services/home-card-preferences.ts|key": ["home_card_hidden__investments"],
  "services/min-balance.ts|ackKey(accountId": ["min_balance_ack_acc_2026-09"],
  "services/notifications.ts|key": ["notif_overdue", "notif_upcoming", "notif_scheduled_backup", "notif_new_transaction"],
  "services/portfolio-rows.ts|SORT_PREF(broker)": ["portfolio_sort:kite"],
  "components/ui/CollapsibleSection.tsx|fullKey": ["collapsible_x"],
};

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.web\.tsx?$/.test(e.name)) out.push(f);
    }
  };
  for (const d of ["services", "app", "components", "hooks", "utils", "constants"]) walk(path.join(ROOT, d));
  return out.filter((f) => !f.endsWith(path.join("services", "storage.ts")));
}

/** Local names bound to each storage, from `import { a as b } from ".../storage"`. */
function storeAliases(src: string): Record<string, SettingsStoreId> {
  const out: Record<string, SettingsStoreId> = {};
  const re = /import\s*\{([^}]*)\}\s*from\s*["'](?:@\/services|\.)\/storage["']/g;
  for (const m of src.matchAll(re)) {
    for (const part of m[1].split(",")) {
      const [name, alias] = part.trim().split(/\s+as\s+/);
      if (STORE_EXPORTS[name]) out[(alias ?? name).trim()] = STORE_EXPORTS[name];
    }
  }
  return out;
}

/** const NAME = "literal" and KEYS-object members (NAME: "literal"). */
function literals(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/\b(?:const|let)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["'`]([^"'`$]+)["'`]/g)) out[m[1]] = m[2];
  for (const m of src.matchAll(/^\s*([A-Z_][A-Z0-9_]*)\s*:\s*["'`]([^"'`$]+)["'`]/gm)) out[`KEYS.${m[1]}`] = m[2];
  return out;
}

interface Write {
  file: string;
  store: SettingsStoreId;
  expr: string;
  keys: string[] | null;
}

function findWrites(): Write[] {
  const writes: Write[] = [];
  for (const file of sourceFiles()) {
    const src = fs.readFileSync(file, "utf8");
    const aliases = storeAliases(src);
    const names = Object.keys(aliases);
    if (names.length === 0) continue;
    const lits = literals(src);
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const re = new RegExp(`\\b(${names.join("|")})\\.set\\(\\s*([^,]+),`, "g");
    for (const m of src.matchAll(re)) {
      const expr = m[2].trim();
      let keys: string[] | null = null;
      if (lits[expr]) keys = [lits[expr]];
      else {
        const plus = expr.match(/^([A-Za-z_.][A-Za-z0-9_.]*)\s*\+/);
        if (plus && lits[plus[1]]) keys = [`${lits[plus[1]]}x`];
        else if (DYNAMIC[`${rel}|${expr}`]) keys = DYNAMIC[`${rel}|${expr}`];
      }
      writes.push({ file: rel, store: aliases[m[1]], expr, keys });
    }
  }
  return writes;
}

const writes = findWrites();

describe("every setting the app writes is classified for backup", () => {
  it("found the storage writes", () => {
    expect(writes.length).toBeGreaterThan(80);
  });

  it("can resolve every key (computed keys must be listed in DYNAMIC)", () => {
    expect(writes.filter((w) => w.keys == null).map((w) => `${w.file}: .set(${w.expr}, ...)`)).toEqual([]);
  });

  it("covers every key in the registry (backed up, or device-only with a reason)", () => {
    const missing: string[] = [];
    for (const w of writes) for (const k of w.keys ?? []) if (!specFor(w.store, k)) missing.push(`${w.store}:${k}  (${w.file})`);
    expect(missing).toEqual([]);
  });

  it("gives every device-only entry a reason", () => {
    expect(SETTINGS_REGISTRY.filter((s) => !s.backup && !s.why).map((s) => s.key)).toEqual([]);
  });

  it("declares the same type the code reads the key with", () => {
    const mismatches: string[] = [];
    for (const file of new Set(writes.map((w) => w.file))) {
      const src = fs.readFileSync(path.join(ROOT, file), "utf8");
      const lits = literals(src);
      const aliases = storeAliases(src);
      const names = Object.keys(aliases);
      const re = new RegExp(`\\b(${names.join("|")})\\.get(String|Number|Boolean)\\(\\s*([^)\\s,]+)`, "g");
      for (const m of src.matchAll(re)) {
        const key = lits[m[3]];
        if (!key) continue;
        const spec = specFor(aliases[m[1]], key);
        const type = m[2].toLowerCase();
        if (spec && spec.type !== type) mismatches.push(`${key}: registry says ${spec.type}, ${file} reads ${type}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
