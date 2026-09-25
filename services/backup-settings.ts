import { duplicateDismissalsStorage, minBalanceAcksStorage, settingsStorage } from "@/services/storage";

/**
 * Settings (MMKV) in backups.
 *
 * Every key the app writes to device storage is listed here, either as backed up or as
 * device-only with a reason. __tests__/integration/settings-backup-coverage.test.ts scans the
 * code for every storage write and fails if a key is missing from this list (or its type
 * disagrees with how the code reads it) - so a new setting can't be silently left out.
 *
 * Types are declared rather than detected: MMKV can't report a value's type.
 */

export type SettingsStoreId = "settings" | "duplicateDismissals" | "minBalanceAcks";
export type SettingType = "string" | "number" | "boolean";

export interface SettingSpec {
  store: SettingsStoreId;
  /** Exact key, or a prefix when `prefix` is true (e.g. "home_card_hidden__"). */
  key: string;
  prefix?: boolean;
  type: SettingType;
  /** false = stays on this device; `why` says why. */
  backup: boolean;
  why?: string;
}

const S = (key: string, type: SettingType, extra: Partial<SettingSpec> = {}): SettingSpec => ({
  store: "settings",
  key,
  type,
  backup: true,
  ...extra,
});
const P = (key: string, type: SettingType, extra: Partial<SettingSpec> = {}): SettingSpec =>
  S(key, type, { prefix: true, ...extra });
const DEVICE = (why: string): Partial<SettingSpec> => ({ backup: false, why });

const SESSION = DEVICE("broker session / cache - tied to credentials in secure storage; re-synced on the device");
const PROGRESS = DEVICE("per-device progress marker");

export const SETTINGS_REGISTRY: SettingSpec[] = [
  // ── Preferences & decisions (backed up) ──
  S("theme", "string"),
  S("fiscal_year_start_month", "number"),
  S("budget_category_sort", "string"),
  S("budget_widgets_visible", "string"),
  S("onboarding_completed_version", "string"),
  S("locale_currency", "string"),
  S("locale_number_grouping", "string"),
  S("locale_date_format", "string"),
  S("locale_timezone", "string"),
  S("privacy_hide_amounts", "boolean"),
  S("voice_input_settings", "string"),
  S("saved_filter_views", "string"),
  S("default_filter_view_id", "string"),
  S("expenses.sortBy", "string"),
  S("budget.transactions.sortBy", "string"),
  S("budget.category.sortBy", "string"),
  S("insights.filtered.sortBy", "string"),
  P("portfolio_sort:", "string"),
  P("collapsible_", "boolean"),
  P("home_card_hidden__", "boolean"),
  S("report_loan_payoff_inputs", "string"),
  S("report_retirement_inputs", "string"),
  S("recon_account_suffix_map", "string"),
  S("reminder_dismissed_matches", "string"),
  S("scheduled_backup_enabled", "boolean"),
  S("scheduled_backup_frequency_hours", "number"),
  S("notif_overdue", "boolean"),
  S("notif_upcoming", "boolean"),
  S("notif_scheduled_backup", "boolean"),
  S("notif_new_transaction", "boolean"),
  S("sms_detection_enabled", "boolean"),
  S("sms_auto_mode_enabled", "boolean"),
  S("sms_start_date", "string"),
  S("sms_end_date", "string"),
  S("sms_scan_account_ids", "string"),
  S("arth_ai_enabled", "boolean"),
  S("arth_ai_nl_search_enabled", "boolean"),
  S("arth_ai_data_expenses", "boolean"),
  S("arth_ai_data_accounts", "boolean"),
  S("arth_ai_data_budget", "boolean"),
  S("arth_ai_data_hisaab", "boolean"),
  S("arth_ai_data_vault", "boolean"),
  S("arth_ai_chat_history", "string"),
  // Check-ins, rule suggestions, subscriptions, settle-up, month-end
  P("check_in_snoozed_until__", "number"),
  S("rule_suggestions_dismissed", "string"),
  P("subscription_reviewed__", "number"),
  P("hisaab_reminded__", "number"),
  P("month_end_confirmed__", "string"),
  // Broker links point at Arth accounts (restored with the database)
  S("kite_linked_account_id", "string"),
  S("angel_linked_account_id", "string"),
  S("zebpay_linked_account_id", "string"),
  S("kite_login_vault_entry_id", "string"),
  // Other stores
  { store: "duplicateDismissals", key: "dismissed_groups", type: "string", backup: true },
  { store: "minBalanceAcks", key: "min_balance_ack_", prefix: true, type: "boolean", backup: true },

  // ── Device-only ──
  S("arth_ai_active_model", "string", DEVICE("the AI model file is downloaded per device")),
  S("arth_ai_last_init_error", "string", DEVICE("diagnostic for this device")),
  S("biometric_lock_enabled", "boolean", DEVICE("app lock is set up per device; restoring it onto a phone without biometrics could lock you out")),
  S("biometric_lock_timeout_seconds", "number", DEVICE("belongs with the device's app-lock setup")),
  S("biometric_last_unlock_at", "number", PROGRESS),
  S("biometric_app_start_time", "number", PROGRESS),
  S("biometric_home_screen_landed", "boolean", PROGRESS),
  S("biometric_pending_deep_link", "string", PROGRESS),
  S("calendar_sync_prefs", "string", DEVICE("names a calendar on this phone")),
  S("calendar_sync_events", "string", DEVICE("event ids in this phone's calendar store")),
  S("calendar_sync_last", "string", PROGRESS),
  S("duplicate_scan_cache_v1", "string", DEVICE("cache, rebuilt from the database")),
  S("data_version", "number", DEVICE("in-memory cache invalidation counter")),
  S("last_backup_at", "string", DEVICE("when THIS device last backed up")),
  S("backup_warning_dismissed_until", "string", PROGRESS),
  S("scheduled_backup_last_run_at", "string", PROGRESS),
  S("merchant_mappings_seeded", "boolean", DEVICE("seeding marker for this install")),
  S("legacy_sms_task_cleaned", "boolean", DEVICE("one-time cleanup marker for this install")),
  S("notif_last_schedule_sync_ts", "number", PROGRESS),
  S("sms_permission_asked", "boolean", DEVICE("Android permission state is per device")),
  S("last_sms_check_timestamp", "number", DEVICE("how far THIS phone's SMS inbox has been read")),
  S("last_auto_scan_run_timestamp", "number", PROGRESS),
  S("kite_token_expiry", "string", SESSION),
  S("kite_holdings_cache", "string", SESSION),
  S("kite_mf_holdings_cache", "string", SESSION),
  S("kite_portfolio_total", "string", SESSION),
  S("kite_funds_total", "string", SESSION),
  S("kite_positions_cache", "string", SESSION),
  S("kite_sips_cache", "string", SESSION),
  S("kite_orders_cache", "string", SESSION),
  S("kite_mf_orders_cache", "string", SESSION),
  S("kite_last_synced", "string", SESSION),
  S("angel_token_expiry", "string", SESSION),
  S("angel_holdings_cache", "string", SESSION),
  S("angel_positions_cache", "string", SESSION),
  S("angel_orders_cache", "string", SESSION),
  S("angel_funds_cache", "string", SESSION),
  S("angel_last_synced", "string", SESSION),
  S("angel_portfolio_total", "string", SESSION),
  S("zebpay_connected", "string", SESSION),
  S("zebpay_balances_cache", "string", SESSION),
  S("zebpay_orders_cache", "string", SESSION),
  S("zebpay_portfolio_total", "string", SESSION),
  S("zebpay_inr_balance", "string", SESSION),
  S("zebpay_last_synced", "string", SESSION),
];

type Store = {
  getAllKeys(): string[];
  getString(k: string): string | undefined;
  getNumber(k: string): number | undefined;
  getBoolean(k: string): boolean | undefined;
  set(k: string, v: string | number | boolean): void;
  delete(k: string): void;
};

const STORES: Record<SettingsStoreId, Store> = {
  settings: settingsStorage as unknown as Store,
  duplicateDismissals: duplicateDismissalsStorage as unknown as Store,
  minBalanceAcks: minBalanceAcksStorage as unknown as Store,
};

export interface SettingValue {
  store: SettingsStoreId;
  key: string;
  type: SettingType;
  value: string | number | boolean;
}

/** The registry entry that owns `key`, if any (exact match wins over prefix). */
export function specFor(store: SettingsStoreId, key: string, registry: SettingSpec[] = SETTINGS_REGISTRY): SettingSpec | undefined {
  return (
    registry.find((s) => s.store === store && !s.prefix && s.key === key) ??
    registry.find((s) => s.store === store && s.prefix && key.startsWith(s.key))
  );
}

function read(store: Store, key: string, type: SettingType): string | number | boolean | undefined {
  return type === "string" ? store.getString(key) : type === "number" ? store.getNumber(key) : store.getBoolean(key);
}

/** Everything backed-up that's currently set, with its type, for the backup file. */
export function exportSettings(): SettingValue[] {
  const out: SettingValue[] = [];
  for (const id of Object.keys(STORES) as SettingsStoreId[]) {
    const store = STORES[id];
    for (const key of store.getAllKeys()) {
      const spec = specFor(id, key);
      if (!spec?.backup) continue;
      const value = read(store, key, spec.type);
      if (value !== undefined) out.push({ store: id, key, type: spec.type, value });
    }
  }
  return out;
}

/**
 * Restore backed-up settings. Replaces what's on the device for backed-up keys (like the
 * database restore replaces tables); device-only keys are never touched. Values whose key
 * isn't backed up by this version of the app, or whose type doesn't match, are ignored.
 */
export function importSettings(values: SettingValue[] | undefined | null): number {
  if (!Array.isArray(values)) return 0;
  for (const id of Object.keys(STORES) as SettingsStoreId[]) {
    const store = STORES[id];
    for (const key of store.getAllKeys()) {
      if (specFor(id, key)?.backup) store.delete(key);
    }
  }
  let restored = 0;
  for (const v of values) {
    const store = STORES[v.store];
    const spec = store ? specFor(v.store, v.key) : undefined;
    if (!spec?.backup || spec.type !== v.type || typeof v.value !== v.type) continue;
    store.set(v.key, v.value);
    restored++;
  }
  return restored;
}
