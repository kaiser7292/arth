/**
 * Saved Filter Views — v17.5.28
 *
 * Persists named filter configurations for the Transactions tab.
 * Date filters use dynamic presets (resolved at load time) so saved views
 * stay current — "Last 30 days" always means today minus 30 days.
 *
 * MMKV-backed. Device-local (not part of backup).
 */

import { getFYStartMonth } from "@/services/settings";
import { getLastDayOfMonth } from "@/utils/date";
import { getCurrentFY, getFYRange } from "@/utils/fiscal-year";
import { settingsStorage } from "./storage";

export type DatePreset =
  | "today"
  | "last_7_days"
  | "last_30_days"
  | "this_month"
  | "last_month"
  | "last_3_months"
  | "this_quarter"
  | "this_fy"
  | "last_fy"
  | "custom"
  | "all";

export interface SavedFilterView {
  id: string;
  name: string;
  createdAt: string;
  filters: FilterViewState;
}

export interface FilterViewState {
  datePreset: DatePreset;
  customStartDate?: string;
  customEndDate?: string;
  nature: "realized" | "committed" | "credit" | "transfers" | "all";
  categoryIds: string[];
  paymentModeIds: string[];
  accountIds: string[];
  tagIds: string[];
  merchantNames?: string[];
  refundedStatus: "" | "refunded" | "not_refunded";
  avoidability: "" | "avoidable" | "unavoidable";
  search: string;
}

export interface ResolvedDateRange {
  start: string | undefined;
  end: string | undefined;
}

const VIEWS_KEY = "saved_filter_views";
const DEFAULT_VIEW_KEY = "default_filter_view_id";

function generateId(): string {
  return `fv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function resolveDatePreset(preset: DatePreset, customStart?: string, customEnd?: string): ResolvedDateRange {
  const now = new Date();
  const today = fmt(now);

  switch (preset) {
    case "today":
      return { start: today, end: today };
    case "last_7_days": {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      return { start: fmt(d), end: today };
    }
    case "last_30_days": {
      const d = new Date(now);
      d.setDate(d.getDate() - 29);
      return { start: fmt(d), end: today };
    }
    case "this_month": {
      const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      return { start, end: today };
    }
    case "last_month": {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return { start: `${ym}-01`, end: getLastDayOfMonth(ym) };
    }
    case "last_3_months": {
      const d = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      return { start: fmt(d), end: today };
    }
    case "this_quarter": {
      const qStart = Math.floor(now.getMonth() / 3) * 3;
      const d = new Date(now.getFullYear(), qStart, 1);
      return { start: fmt(d), end: today };
    }
    case "this_fy": {
      const fyStartMonth = getFYStartMonth();
      const fy = getCurrentFY(fyStartMonth);
      const { start, end } = getFYRange(fy, fyStartMonth);
      return { start: fmt(start), end: fmt(end) };
    }
    case "last_fy": {
      const fyStartMonth = getFYStartMonth();
      const fy = getCurrentFY(fyStartMonth) - 1;
      const { start, end } = getFYRange(fy, fyStartMonth);
      return { start: fmt(start), end: fmt(end) };
    }
    case "custom":
      return { start: customStart || undefined, end: customEnd || undefined };
    case "all":
      return { start: undefined, end: undefined };
  }
}

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  today: "Today",
  last_7_days: "Last 7 Days",
  last_30_days: "Last 30 Days",
  this_month: "This Month",
  last_month: "Last Month",
  last_3_months: "Last 3 Months",
  this_quarter: "This Quarter",
  this_fy: "This Financial Year",
  last_fy: "Last Financial Year",
  custom: "Custom Range",
  all: "All Time",
};

export const DATE_PRESET_ORDER: DatePreset[] = [
  "today",
  "last_7_days",
  "last_30_days",
  "this_month",
  "last_month",
  "last_3_months",
  "this_quarter",
  "this_fy",
  "last_fy",
  "custom",
  "all",
];

export function getSavedFilterViews(): SavedFilterView[] {
  const raw = settingsStorage.getString(VIEWS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as SavedFilterView[];
  } catch {
    return [];
  }
}

export function saveFilterView(name: string, filters: FilterViewState): SavedFilterView {
  const views = getSavedFilterViews();
  const view: SavedFilterView = {
    id: generateId(),
    name,
    createdAt: new Date().toISOString(),
    filters,
  };
  views.push(view);
  settingsStorage.set(VIEWS_KEY, JSON.stringify(views));
  return view;
}

export function deleteFilterView(id: string): void {
  const views = getSavedFilterViews().filter((v) => v.id !== id);
  settingsStorage.set(VIEWS_KEY, JSON.stringify(views));
  if (getDefaultFilterViewId() === id) {
    clearDefaultFilterView();
  }
}

export function getDefaultFilterViewId(): string | null {
  return settingsStorage.getString(DEFAULT_VIEW_KEY) ?? null;
}

export function setDefaultFilterView(id: string): void {
  settingsStorage.set(DEFAULT_VIEW_KEY, id);
}

export function clearDefaultFilterView(): void {
  settingsStorage.delete(DEFAULT_VIEW_KEY);
}

export function getDefaultFilterView(): SavedFilterView | null {
  const id = getDefaultFilterViewId();
  if (!id) return null;
  return getSavedFilterViews().find((v) => v.id === id) ?? null;
}
