import { MMKV } from "react-native-mmkv";

/**
 * Centralized MMKV stores.
 *
 * Why centralize: MMKV is singleton-per-id under the hood, so repeat
 * instantiations aren't a perf hit — but scattered `new MMKV({ id: "..." })`
 * calls fragment ownership and make it easy for a typo to silently split
 * writes to a different namespace. One source of truth here.
 *
 * Stores:
 *   - settings — global app preferences (theme, FY start month, biometric
 *     config, notification prefs, collapsed-section state, SMS permissions).
 *   - duplicateDismissals — user-dismissed duplicate-expense groups.
 *   - minBalanceAcks — per-month acknowledgements for min-balance alerts.
 */
export const settingsStorage = new MMKV({ id: "artha-settings" });
export const duplicateDismissalsStorage = new MMKV({ id: "artha-duplicate-dismissals" });
export const minBalanceAcksStorage = new MMKV({ id: "artha-min-balance-acks" });
