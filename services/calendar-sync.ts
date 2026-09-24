/**
 * Calendar sync: Arth's upcoming money dates → a calendar on this phone.
 * See docs/CALENDAR_SYNC_PROPOSAL.md.
 *
 * One-way (Arth → calendar). Events go through Android's shared calendar store via
 * expo-calendar. If the chosen calendar is a Google one, Android's own Google sync uploads
 * them; Arth never talks to Google.
 *
 * The item → event-id map is device-local (MMKV): event ids belong to this phone's calendar
 * store and would be meaningless if restored onto another phone. Every event's notes carry an
 * `[arth:<key>]` tag so a lost map can be rebuilt from the calendar itself (no duplicates after a
 * reinstall).
 */

import * as Calendar from "expo-calendar";
import { Platform } from "react-native";
import { toHex } from "@/constants/brand";
import { SEMANTIC } from "@/constants/design-tokens";
import { initDatabase } from "@/database";
import { getForecastExpenses } from "@/services/expense";
import { getReminders } from "@/services/recurring-rules";
import { settingsStorage } from "@/services/storage";
import { formatAmount } from "@/utils/format";
import { logger } from "@/utils/logger";

// ─── Types ───

export type CalendarItemKind = "due" | "emi" | "reminder" | "fd";

export interface CalendarItem {
  /** Stable identity, e.g. "due:<expenseId>". */
  key: string;
  kind: CalendarItemKind;
  /** YYYY-MM-DD */
  date: string;
  /** Without amount, e.g. "HDFC card bill". */
  label: string;
  amount: number | null;
}

export interface StoredEvent {
  eventId: string;
  date: string;
  /** Fingerprint of what was written; a change means the event needs an update. */
  hash: string;
}

export type EventMap = Record<string, StoredEvent>;

export interface CalendarPrefs {
  enabled: boolean;
  /** Target calendar id, or null until chosen. */
  calendarId: string | null;
  kinds: Record<CalendarItemKind, boolean>;
  showAmounts: boolean;
}

export interface SyncResult {
  ok: boolean;
  created: number;
  updated: number;
  removed: number;
  total: number;
  error?: "disabled" | "no_permission" | "no_calendar" | "failed";
  at: number;
}

export const HORIZON_DAYS = 90;
export const AUTO_SYNC_MIN_GAP_MS = 15 * 60 * 1000;
const EVENT_HOUR = 9;
const EVENT_MINUTES = 30;
const ALARM_DAY_BEFORE = -24 * 60;
const ALARM_ON_THE_DAY = 0;
const TAG_RE = /\[arth:([^\]]+)\]/;

const PREFS_KEY = "calendar_sync_prefs";
const MAP_KEY = "calendar_sync_events";
const LAST_KEY = "calendar_sync_last";
const ARTH_CALENDAR_NAME = "arth";

export const DEFAULT_PREFS: CalendarPrefs = {
  enabled: false,
  calendarId: null,
  kinds: { due: true, emi: true, reminder: true, fd: true },
  showAmounts: true,
};

// ─── Prefs + state (MMKV) ───

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = settingsStorage.getString(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function getCalendarPrefs(): CalendarPrefs {
  const p = readJson<Partial<CalendarPrefs>>(PREFS_KEY, {});
  return { ...DEFAULT_PREFS, ...p, kinds: { ...DEFAULT_PREFS.kinds, ...(p.kinds ?? {}) } };
}

export function setCalendarPrefs(patch: Partial<CalendarPrefs>): CalendarPrefs {
  const next = { ...getCalendarPrefs(), ...patch };
  settingsStorage.set(PREFS_KEY, JSON.stringify(next));
  return next;
}

function getEventMap(): EventMap {
  return readJson<EventMap>(MAP_KEY, {});
}

function saveEventMap(map: EventMap): void {
  settingsStorage.set(MAP_KEY, JSON.stringify(map));
}

export function getLastSync(): SyncResult | null {
  return readJson<SyncResult | null>(LAST_KEY, null);
}

// ─── Dates ───

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

// ─── Event content (pure) ───

export function eventTitle(item: CalendarItem, showAmounts: boolean): string {
  return showAmounts && item.amount != null && item.amount > 0
    ? `Arth · ${item.label} · ${formatAmount(item.amount)}`
    : `Arth · ${item.label}`;
}

export function eventNotes(item: CalendarItem): string {
  return `Added by Arth. Mark it paid in Arth rather than editing here; Arth overwrites changes on its next sync.\n[arth:${item.key}]`;
}

export function itemHash(item: CalendarItem, showAmounts: boolean): string {
  return `${item.date}|${eventTitle(item, showAmounts)}`;
}

function eventDetails(item: CalendarItem, showAmounts: boolean): Omit<Partial<Calendar.Event>, "id" | "organizer"> {
  const [y, m, d] = item.date.split("-").map(Number);
  const start = new Date(y, m - 1, d, EVENT_HOUR, 0, 0);
  const end = new Date(start.getTime() + EVENT_MINUTES * 60 * 1000);
  return {
    title: eventTitle(item, showAmounts),
    notes: eventNotes(item),
    startDate: start,
    endDate: end,
    allDay: false,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    alarms: [{ relativeOffset: ALARM_DAY_BEFORE }, { relativeOffset: ALARM_ON_THE_DAY }],
  };
}

// ─── Plan (pure) ───

export interface SyncPlan {
  create: CalendarItem[];
  update: { item: CalendarItem; eventId: string }[];
  remove: { key: string; eventId: string }[];
  /** Past events: stop tracking, leave in the calendar as history. */
  forget: string[];
}

export function planSync(desired: CalendarItem[], stored: EventMap, today: string, showAmounts: boolean): SyncPlan {
  const plan: SyncPlan = { create: [], update: [], remove: [], forget: [] };
  const wanted = new Map(desired.map((i) => [i.key, i]));

  for (const [key, ev] of Object.entries(stored)) {
    if (wanted.has(key)) continue;
    if (ev.date < today) plan.forget.push(key);
    else plan.remove.push({ key, eventId: ev.eventId });
  }
  for (const item of desired) {
    const ev = stored[item.key];
    if (!ev) plan.create.push(item);
    else if (ev.hash !== itemHash(item, showAmounts)) plan.update.push({ item, eventId: ev.eventId });
  }
  return plan;
}

// ─── Collect items from Arth's data ───

function inWindow(date: string | null | undefined, today: string, until: string): date is string {
  return !!date && date >= today && date <= until;
}

export async function collectCalendarItems(
  userId: string,
  kinds: CalendarPrefs["kinds"],
  today: string = ymd(new Date()),
): Promise<CalendarItem[]> {
  const until = addDays(today, HORIZON_DAYS);
  const db = await initDatabase();
  const items: CalendarItem[] = [];

  if (kinds.due) {
    const forecasts = await getForecastExpenses(userId);
    for (const f of forecasts) {
      if (!inWindow(f.due_date, today, until)) continue;
      const name = f.merchant_name || f.description || "Payment";
      items.push({
        key: `due:${f.id}`,
        kind: "due",
        date: f.due_date,
        label: f.forecast_type === "repayment" ? `${name} card bill` : `${name} due`,
        amount: f.amount,
      });
    }
  }

  if (kinds.emi) {
    const emis = await db.getAllAsync<{ id: string; due_date: string; emi_amount: number; name: string }>(
      `SELECT se.id, se.due_date, se.emi_amount, COALESCE(fa.account_label, fa.bank_name, 'Loan') AS name
         FROM loan_schedule_entries se
         JOIN loan_accounts la ON la.id = se.loan_account_id
         JOIN financial_accounts fa ON fa.id = la.financial_account_id
        WHERE fa.user_id = ? AND la.status = 'active' AND se.status = 'scheduled'
          AND se.due_date >= ? AND se.due_date <= ?;`,
      userId,
      today,
      until,
    );
    for (const e of emis) {
      items.push({ key: `emi:${e.id}`, kind: "emi", date: e.due_date, label: `${e.name} EMI`, amount: e.emi_amount });
    }
  }

  if (kinds.reminder) {
    const reminders = await getReminders(userId);
    for (const r of reminders) {
      if (!inWindow(r.rule.next_due_date, today, until)) continue;
      const name = r.source?.merchant_name || r.source?.description || "Reminder";
      items.push({
        // The date is part of the key: each cycle is its own event, and a fulfilled cycle's
        // event stays behind as history when the rule moves on.
        key: `reminder:${r.rule.id}:${r.rule.next_due_date}`,
        kind: "reminder",
        date: r.rule.next_due_date,
        label: name,
        amount: r.rule.amount ?? r.source?.amount ?? null,
      });
    }
  }

  if (kinds.fd) {
    const fds = await db.getAllAsync<{ id: string; maturity_date: string; name: string }>(
      `SELECT ip.id, ip.maturity_date, COALESCE(fa.account_label, fa.bank_name, 'Deposit') AS name
         FROM investment_products ip
         JOIN financial_accounts fa ON fa.id = ip.financial_account_id
        WHERE fa.user_id = ? AND ip.status = 'active' AND ip.maturity_date >= ? AND ip.maturity_date <= ?;`,
      userId,
      today,
      until,
    );
    for (const f of fds) {
      items.push({ key: `fd:${f.id}`, kind: "fd", date: f.maturity_date, label: `${f.name} matures`, amount: null });
    }
  }

  return items;
}

// ─── Calendars ───

export async function hasCalendarPermission(): Promise<boolean> {
  const { status } = await Calendar.getCalendarPermissionsAsync();
  return status === "granted";
}

export async function requestCalendarPermission(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === "granted";
}

const WRITABLE: string[] = [
  Calendar.CalendarAccessLevel.OWNER,
  Calendar.CalendarAccessLevel.EDITOR,
  Calendar.CalendarAccessLevel.CONTRIBUTOR,
  Calendar.CalendarAccessLevel.ROOT,
];

/** Calendars Arth can add events to. */
export async function getWritableCalendars(): Promise<Calendar.Calendar[]> {
  const all = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  return all.filter((c) => c.allowsModifications && (!c.accessLevel || WRITABLE.includes(c.accessLevel)));
}

export function isArthCalendar(c: Pick<Calendar.Calendar, "name" | "source">): boolean {
  return c.name === ARTH_CALENDAR_NAME && c.source?.isLocalAccount === true;
}

/** Find or create the phone-only "Arth" calendar. */
export async function ensureArthCalendar(): Promise<string> {
  const existing = (await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)).find(isArthCalendar);
  if (existing) return existing.id;
  return Calendar.createCalendarAsync({
    title: "Arth",
    name: ARTH_CALENDAR_NAME,
    color: toHex(SEMANTIC.light.primary),
    entityType: Calendar.EntityTypes.EVENT,
    source: { isLocalAccount: true, name: "Arth", type: Calendar.SourceType.LOCAL },
    ownerAccount: "Arth",
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });
}

// ─── Apply ───

/** Rebuild the map from tagged events in the calendar (after a reinstall or restore). */
async function adoptTaggedEvents(calendarId: string, map: EventMap, today: string): Promise<EventMap> {
  const start = new Date(`${today}T00:00:00`);
  const end = new Date(`${addDays(today, HORIZON_DAYS + 1)}T00:00:00`);
  const events = await Calendar.getEventsAsync([calendarId], start, end);
  const known = new Set(Object.values(map).map((e) => e.eventId));
  const next = { ...map };
  for (const ev of events) {
    const key = ev.notes?.match(TAG_RE)?.[1];
    if (!key || known.has(ev.id)) continue;
    if (next[key]) {
      // Two events for one item: keep the tracked one, drop the stray.
      await Calendar.deleteEventAsync(ev.id).catch(() => {});
    } else {
      // Unknown hash → the plan will rewrite it with current content.
      next[key] = { eventId: ev.id, date: ymd(new Date(ev.startDate)), hash: "" };
    }
  }
  return next;
}

let running: Promise<SyncResult> | null = null;

/** Full sync. Concurrent callers share one run. */
export function syncCalendar(userId: string): Promise<SyncResult> {
  if (!running) {
    running = doSync(userId).finally(() => {
      running = null;
    });
  }
  return running;
}

async function doSync(userId: string): Promise<SyncResult> {
  const base = { ok: false, created: 0, updated: 0, removed: 0, total: 0, at: Date.now() };
  const finish = (r: SyncResult) => {
    settingsStorage.set(LAST_KEY, JSON.stringify(r));
    return r;
  };
  const prefs = getCalendarPrefs();
  if (Platform.OS !== "android" || !prefs.enabled) return { ...base, error: "disabled" };
  if (!(await hasCalendarPermission())) return finish({ ...base, error: "no_permission" });
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  if (!prefs.calendarId || !calendars.some((c) => c.id === prefs.calendarId)) {
    return finish({ ...base, error: "no_calendar" });
  }
  const calendarId = prefs.calendarId;

  try {
    const today = ymd(new Date());
    const desired = await collectCalendarItems(userId, prefs.kinds, today);
    let map = await adoptTaggedEvents(calendarId, getEventMap(), today);
    const plan = planSync(desired, map, today, prefs.showAmounts);
    map = { ...map };

    for (const key of plan.forget) delete map[key];
    for (const { key, eventId } of plan.remove) {
      await Calendar.deleteEventAsync(eventId).catch(() => {});
      delete map[key];
    }
    for (const { item, eventId } of plan.update) {
      try {
        await Calendar.updateEventAsync(eventId, eventDetails(item, prefs.showAmounts));
      } catch {
        // Deleted in the calendar app: put it back.
        const id = await Calendar.createEventAsync(calendarId, eventDetails(item, prefs.showAmounts));
        map[item.key] = { eventId: id, date: item.date, hash: "" };
        continue;
      }
      map[item.key] = { eventId, date: item.date, hash: itemHash(item, prefs.showAmounts) };
    }
    for (const item of plan.create) {
      const id = await Calendar.createEventAsync(calendarId, eventDetails(item, prefs.showAmounts));
      map[item.key] = { eventId: id, date: item.date, hash: itemHash(item, prefs.showAmounts) };
    }
    // Any "" hash left from a re-create gets its real fingerprint now that it's written.
    for (const item of desired) {
      if (map[item.key] && map[item.key].hash === "") map[item.key].hash = itemHash(item, prefs.showAmounts);
    }
    saveEventMap(map);
    return finish({
      ...base,
      ok: true,
      created: plan.create.length,
      updated: plan.update.length,
      removed: plan.remove.length,
      total: desired.length,
    });
  } catch (e) {
    logger.error("Calendar sync failed", e);
    return finish({ ...base, error: "failed" });
  }
}

/** Automatic triggers (app open / leave, background scan) — at most every 15 minutes. */
export async function syncCalendarIfDue(userId: string): Promise<void> {
  if (!getCalendarPrefs().enabled) return;
  const last = getLastSync();
  if (last && Date.now() - last.at < AUTO_SYNC_MIN_GAP_MS) return;
  await syncCalendar(userId);
}

/** Turning sync off: delete the future events Arth created and forget them. */
export async function removeArthEvents(): Promise<number> {
  const today = ymd(new Date());
  const map = getEventMap();
  let removed = 0;
  if (await hasCalendarPermission()) {
    for (const ev of Object.values(map)) {
      if (ev.date < today) continue;
      await Calendar.deleteEventAsync(ev.eventId).then(() => removed++).catch(() => {});
    }
  }
  saveEventMap({});
  settingsStorage.delete(LAST_KEY);
  return removed;
}
