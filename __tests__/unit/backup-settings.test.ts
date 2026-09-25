/**
 * Settings round-trip through a backup: backed-up keys come back with their types; device-only
 * keys stay as they are on the restoring phone; junk in the file is ignored.
 */

type MockMap = Map<string, string | number | boolean>;
// On globalThis: jest.mock factories run before this module's own variables are initialised.
const mockStores = ((globalThis as unknown as { __mmkvStores?: Record<string, MockMap> }).__mmkvStores ??= {});
jest.mock("react-native-mmkv", () => ({
  MMKV: jest.fn().mockImplementation(({ id }: { id: string }) => {
    const all = ((globalThis as unknown as { __mmkvStores?: Record<string, Map<string, unknown>> }).__mmkvStores ??= {});
    const m = (all[id] = all[id] ?? new Map()) as Map<string, string | number | boolean>;
    return {
      getAllKeys: () => [...m.keys()],
      getString: (k: string) => (typeof m.get(k) === "string" ? (m.get(k) as string) : undefined),
      getNumber: (k: string) => (typeof m.get(k) === "number" ? (m.get(k) as number) : undefined),
      getBoolean: (k: string) => (typeof m.get(k) === "boolean" ? (m.get(k) as boolean) : undefined),
      set: (k: string, v: string | number | boolean) => void m.set(k, v),
      delete: (k: string) => void m.delete(k),
    };
  }),
}));

import { exportSettings, importSettings } from "../../services/backup-settings";

const settings = () => mockStores["artha-settings"];
const dups = () => mockStores["artha-duplicate-dismissals"];

beforeEach(() => {
  for (const m of Object.values(mockStores)) m.clear();
});

describe("settings in backups", () => {
  it("exports backed-up keys with their types and leaves device-only keys out", () => {
    settings().set("theme", "dark");
    settings().set("fiscal_year_start_month", 4);
    settings().set("home_card_hidden__loans", true);
    settings().set("rule_suggestions_dismissed", '["swiggy"]');
    settings().set("calendar_sync_events", "{}"); // device-only
    settings().set("last_sms_check_timestamp", 123); // device-only
    settings().set("some_unknown_key", "x"); // not in the registry
    dups().set("dismissed_groups", '["a,b"]');

    const out = exportSettings();
    const keys = out.map((v) => v.key).sort();
    expect(keys).toEqual(
      ["dismissed_groups", "fiscal_year_start_month", "home_card_hidden__loans", "rule_suggestions_dismissed", "theme"].sort(),
    );
    expect(out.find((v) => v.key === "fiscal_year_start_month")).toMatchObject({ type: "number", value: 4 });
  });

  it("restores them on another phone without touching that phone's device-only keys", () => {
    settings().set("theme", "dark");
    settings().set("check_in_snoozed_until__settleUp", 999);
    dups().set("dismissed_groups", '["a,b"]');
    const backup = exportSettings();

    // The restoring phone: different preferences, its own device-only state.
    for (const m of Object.values(mockStores)) m.clear();
    settings().set("theme", "light");
    settings().set("home_card_hidden__insights", true); // not in the backup -> removed
    settings().set("last_sms_check_timestamp", 555); // device-only -> kept

    expect(importSettings(backup)).toBe(3);
    expect(settings().get("theme")).toBe("dark");
    expect(settings().get("check_in_snoozed_until__settleUp")).toBe(999);
    expect(dups().get("dismissed_groups")).toBe('["a,b"]');
    expect(settings().has("home_card_hidden__insights")).toBe(false);
    expect(settings().get("last_sms_check_timestamp")).toBe(555);
  });

  it("ignores device-only keys, unknown keys and wrong types in a backup file", () => {
    const n = importSettings([
      { store: "settings", key: "calendar_sync_events", type: "string", value: "{}" },
      { store: "settings", key: "made_up", type: "string", value: "x" },
      { store: "settings", key: "theme", type: "number", value: 3 },
      { store: "settings", key: "privacy_hide_amounts", type: "boolean", value: true },
    ]);
    expect(n).toBe(1);
    expect(settings().has("calendar_sync_events")).toBe(false);
    expect(settings().get("privacy_hide_amounts")).toBe(true);
  });

  it("treats a backup without settings (older versions) as a no-op", () => {
    settings().set("theme", "light");
    expect(importSettings(undefined)).toBe(0);
    expect(settings().get("theme")).toBe("light");
  });
});
