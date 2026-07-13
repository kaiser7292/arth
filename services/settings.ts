import type { AccentThemeId } from "@/constants/accent-palettes";
import { DEFAULT_ACCENT_THEME } from "@/constants/accent-palettes";
import { settingsStorage as storage } from "./storage";

const KEYS = {
  FISCAL_YEAR_START_MONTH: "fiscal_year_start_month",
  THEME: "theme",
  ACCENT_THEME: "accent_theme",
  BUDGET_WIDGETS_VISIBLE: "budget_widgets_visible",
  BUDGET_CATEGORY_SORT: "budget_category_sort",
  DATA_VERSION: "data_version",
  LAST_BACKUP_AT: "last_backup_at",
  BACKUP_WARNING_DISMISSED_UNTIL: "backup_warning_dismissed_until",
  ONBOARDING_COMPLETED_VERSION: "onboarding_completed_version",
} as const;

export const DEFAULT_BUDGET_WIDGETS = ["summary", "projection"] as const;
export type BudgetWidgetId = (typeof DEFAULT_BUDGET_WIDGETS)[number];

export type BudgetCategorySort = "default" | "alphabetical" | "budget_desc" | "spent_amount" | "spent_pct";

export function getBudgetCategorySort(): BudgetCategorySort {
  return (storage.getString(KEYS.BUDGET_CATEGORY_SORT) as BudgetCategorySort) ?? "default";
}

export function setBudgetCategorySort(sort: BudgetCategorySort): void {
  storage.set(KEYS.BUDGET_CATEGORY_SORT, sort);
}

/**
 * Get the fiscal year start month (1-12). Default: 4 (April, Indian FY).
 */
export function getFYStartMonth(): number {
  return storage.getNumber(KEYS.FISCAL_YEAR_START_MONTH) ?? 4;
}

/**
 * Set the fiscal year start month (1-12).
 */
export function setFYStartMonth(month: number): void {
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}. Must be 1-12.`);
  }
  storage.set(KEYS.FISCAL_YEAR_START_MONTH, month);
}

/**
 * Get the app theme preference. Default: "system".
 */
export function getThemePreference(): "light" | "dark" | "system" {
  return (storage.getString(KEYS.THEME) as "light" | "dark" | "system") ?? "system";
}

/**
 * Set the app theme preference.
 */
export function setThemePreference(theme: "light" | "dark" | "system"): void {
  storage.set(KEYS.THEME, theme);
}

/**
 * Get visible budget widget IDs. Default: all three visible.
 */
export function getBudgetWidgets(): BudgetWidgetId[] {
  const stored = storage.getString(KEYS.BUDGET_WIDGETS_VISIBLE);
  if (!stored) return [...DEFAULT_BUDGET_WIDGETS];
  try {
    return JSON.parse(stored);
  } catch {
    return [...DEFAULT_BUDGET_WIDGETS];
  }
}

/**
 * Set visible budget widget IDs.
 */
export function setBudgetWidgets(widgets: BudgetWidgetId[]): void {
  storage.set(KEYS.BUDGET_WIDGETS_VISIBLE, JSON.stringify(widgets));
}

/**
 * Clear the persisted collapse state for a collapsible section.
 * Called when a widget is removed so re-adding starts with default state.
 */
export function clearCollapsibleState(storageKey: string): void {
  storage.delete(`collapsible_${storageKey}`);
}

/**
 * Get the current data version. Screens use this to detect master data changes.
 */
export function getDataVersion(): number {
  return storage.getNumber(KEYS.DATA_VERSION) ?? 0;
}

/**
 * Bump the data version. Call this after ANY data mutation —
 * expenses, budgets, categories, payment modes, hisaab, forecasts,
 * yearly plans, salary profiles, splits, tags, merchant aliases, cleanup.
 *
 * All screens using useDataRefresh will instantly reload.
 */
export function bumpDataVersion(): void {
  storage.set(KEYS.DATA_VERSION, getDataVersion() + 1);
}

/**
 * Subscribe to data version changes. The callback fires every time
 * bumpDataVersion() is called, enabling instant screen refresh.
 *
 * Returns a remove function to unsubscribe.
 */
export function subscribeDataVersion(callback: () => void): { remove: () => void } {
  const listener = storage.addOnValueChangedListener((key) => {
    if (key === KEYS.DATA_VERSION) {
      callback();
    }
  });
  return { remove: () => listener.remove() };
}

/**
 * Accent is locked to ocean (blue). Picker was removed in v1.11.
 */
export function getAccentTheme(): AccentThemeId {
  return DEFAULT_ACCENT_THEME;
}

export function setAccentTheme(_theme: AccentThemeId): void {
  // no-op — accent is fixed to ocean
}

// Backup staleness tracking ----------------------------------------------------

/** Record the time of a successful backup (ISO string). */
export function setLastBackupAt(iso: string): void {
  storage.set(KEYS.LAST_BACKUP_AT, iso);
}

/** Returns ISO of last successful backup, or null if none. */
export function getLastBackupAt(): string | null {
  return storage.getString(KEYS.LAST_BACKUP_AT) ?? null;
}

/** Dismiss the stale-backup warning for N days. */
export function dismissBackupWarning(forDays = 7): void {
  const until = new Date();
  until.setDate(until.getDate() + forDays);
  storage.set(KEYS.BACKUP_WARNING_DISMISSED_UNTIL, until.toISOString());
}

/**
 * True when the user has no backup for >30 days AND the dismissal has expired.
 * Meant for a banner on the home screen.
 */
export function shouldShowBackupWarning(staleAfterDays = 30): boolean {
  const dismissedUntilIso = storage.getString(KEYS.BACKUP_WARNING_DISMISSED_UNTIL);
  if (dismissedUntilIso && new Date(dismissedUntilIso).getTime() > Date.now()) return false;

  const lastIso = storage.getString(KEYS.LAST_BACKUP_AT);
  if (!lastIso) return true; // never backed up
  const lastMs = new Date(lastIso).getTime();
  const staleMs = staleAfterDays * 24 * 60 * 60 * 1000;
  return Date.now() - lastMs > staleMs;
}

// Onboarding (v15) -----------------------------------------------------------

/**
 * Returns the app version the user completed onboarding on, or null if they
 * haven't. Used by app/_layout.tsx to decide whether to redirect a fresh
 * install into the wizard.
 *
 * The string "pre-existing" is a sentinel stamped by migrateExistingUser()
 * for users who installed before v15 — they shouldn't see the wizard
 * retroactively.
 */
export function getOnboardingCompletedVersion(): string | null {
  return storage.getString(KEYS.ONBOARDING_COMPLETED_VERSION) ?? null;
}

/** Stamp onboarding complete for the current app version. */
export function setOnboardingCompletedVersion(appVersion: string): void {
  storage.set(KEYS.ONBOARDING_COMPLETED_VERSION, appVersion);
}

/**
 * Clear the completed stamp. Called from Settings → Redo onboarding so the
 * wizard runs again on next reload.
 */
export function clearOnboardingCompletedVersion(): void {
  storage.delete(KEYS.ONBOARDING_COMPLETED_VERSION);
}
