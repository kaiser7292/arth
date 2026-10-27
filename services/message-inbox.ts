/**
 * iPhone: bank messages handed to Arth by the "Add bank message to Arth" Shortcuts action
 * (plugins/ios/AddBankMessageIntent.swift). iPhone gives apps no access to messages; a Shortcuts
 * automation passes each one to that action, which appends it to an inbox file without opening
 * Arth. Here Arth reads the file when it opens and runs the messages through the same scan as
 * Android's SMS (sms-orchestrator.ts): parsing, account matching, duplicates, the review queue and
 * the Scan Runs log.
 *
 * The file is moved aside before it's read, so a message the automation appends meanwhile goes to
 * a new file and isn't lost or read twice; the moved file is deleted only after the scan.
 */

import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import { logger } from "@/utils/logger";
import { settingsStorage } from "@/services/storage";
import type { RawSMS } from "@/services/sms/sms-reader";
import { runSmsScan, type ScanOutcome } from "@/services/sms/sms-orchestrator";

/** Must match BankMessageInbox.fileName in AddBankMessageIntent.swift. */
const INBOX_FILE = "bank-messages.jsonl";
const READING_FILE = "bank-messages.reading.jsonl";
/** Must match BankMessageInbox.settingsFileName: {"notify": bool}, read by the Shortcuts action. */
const SETTINGS_FILE = "bank-messages-settings.json";
/** Must match BankMessageInbox.openRequestFileName: left by "Review bank message in Arth". */
const OPEN_REQUEST_FILE = "bank-messages-open";

const LAST_ARRIVAL_KEY = "iphone_messages_last_arrival";
const STATS_KEY = "iphone_messages_stats";
const NOTIFY_KEY = "iphone_messages_notify";

/** One line of the inbox file, as the Shortcuts action writes it. */
interface InboxLine {
  body?: unknown;
  sender?: unknown;
  receivedAt?: unknown;
}

/** The inbox file's lines as messages; lines that aren't valid are skipped. */
export function parseInbox(text: string): RawSMS[] {
  const out: RawSMS[] = [];
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const j = JSON.parse(line) as InboxLine;
      if (typeof j.body !== "string" || !j.body.trim()) return;
      const date = typeof j.receivedAt === "number" && Number.isFinite(j.receivedAt) ? j.receivedAt : Date.now();
      out.push({
        _id: `shortcut-${date}-${i}`,
        address: typeof j.sender === "string" && j.sender.trim() ? j.sender.trim() : "Shortcuts",
        body: j.body,
        date,
        type: 1,
      } as RawSMS);
    } catch {
      // A half-written line (the automation was cut off) - skip it.
    }
  });
  return out;
}

let importing: Promise<ScanOutcome | null> | null = null;

/** Read and clear the inbox (iPhone only). Safe to call often: concurrent calls share one run. */
export function importHandedMessages(): Promise<ScanOutcome | null> {
  if (Platform.OS !== "ios") return Promise.resolve(null);
  importing ??= (async () => {
    try {
      const reading = new File(Paths.document, READING_FILE);
      // A previous run that stopped half way left its file: read that first.
      if (!reading.exists) {
        const inbox = new File(Paths.document, INBOX_FILE);
        if (!inbox.exists) return null;
        inbox.move(reading);
      }
      const messages = parseInbox(await reading.text());
      const outcome = messages.length ? await runSmsScan({ manual: false, messages }) : null;
      reading.delete();
      if (outcome) recordArrival(messages, outcome);
      return outcome;
    } catch (e) {
      logger.warn("Importing handed-over bank messages failed:", e);
      return null;
    } finally {
      importing = null;
    }
  })();
  return importing;
}

/** How many messages are waiting (for the setup screen). */
export async function waitingMessageCount(): Promise<number> {
  if (Platform.OS !== "ios") return 0;
  let n = 0;
  for (const name of [INBOX_FILE, READING_FILE]) {
    const f = new File(Paths.document, name);
    if (f.exists) n += parseInbox(await f.text()).length;
  }
  return n;
}

// ── What came in, for "Just arrived", the Home card and the setup screen ──

/** The last batch of handed-over messages Arth read. */
export interface Arrival {
  /** When Arth read them (ms). */
  at: number;
  /** Messages in the batch. */
  read: number;
  /** Rows the batch added (expenses and credits). */
  addedIds: string[];
  /** Messages no parser or template could read. */
  unreadable: { body: string; sender: string; date: number }[];
  /** Opened in "Just arrived" (the Home card hides then). */
  seen: boolean;
}

interface Stats {
  /** Newest message handed over (ms), from its receivedAt. */
  lastMessageAt: number | null;
  /** "YYYY-MM" and how many messages came in that month. */
  month: string;
  monthCount: number;
}

const monthOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function readJson<T>(key: string): T | null {
  try {
    const raw = settingsStorage.getString(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Remember a batch: messages pasted in the app or read from the Shortcuts inbox. A batch that
 * arrives before the last one was looked at is merged into it, so nothing drops off the card.
 */
export function recordArrival(
  messages: RawSMS[],
  outcome: { addedIds?: string[]; unreadable?: Arrival["unreadable"] },
  now: number = Date.now(),
): void {
  if (messages.length === 0) return;
  const prev = getLastArrival();
  const keep = prev && !prev.seen ? prev : null;
  const arrival: Arrival = {
    at: now,
    read: (keep?.read ?? 0) + messages.length,
    addedIds: [...(keep?.addedIds ?? []), ...(outcome.addedIds ?? [])],
    unreadable: [...(keep?.unreadable ?? []), ...(outcome.unreadable ?? [])].slice(-20),
    seen: false,
  };
  settingsStorage.set(LAST_ARRIVAL_KEY, JSON.stringify(arrival));

  const stats = getMessageStats(now);
  const newest = Math.max(...messages.map((m) => Number(m.date) || 0));
  const month = monthOf(now);
  const inMonth = messages.filter((m) => monthOf(Number(m.date) || now) === month).length;
  const next: Stats = {
    lastMessageAt: Math.max(stats.lastMessageAt ?? 0, newest) || null,
    month,
    monthCount: (stats.month === month ? stats.monthCount : 0) + inMonth,
  };
  settingsStorage.set(STATS_KEY, JSON.stringify(next));
}

export function getLastArrival(): Arrival | null {
  return readJson<Arrival>(LAST_ARRIVAL_KEY);
}

export function markArrivalSeen(): void {
  const a = getLastArrival();
  if (a && !a.seen) settingsStorage.set(LAST_ARRIVAL_KEY, JSON.stringify({ ...a, seen: true }));
}

/** Last message and this month's count, for the setup screen's status. */
export function getMessageStats(now: number = Date.now()): Stats {
  const s = readJson<Stats>(STATS_KEY);
  const month = monthOf(now);
  if (!s) return { lastMessageAt: null, month, monthCount: 0 };
  return s.month === month ? s : { ...s, month, monthCount: 0 };
}

/** Newest message still waiting in the inbox (ms), or null. */
export async function newestWaitingAt(): Promise<number | null> {
  if (Platform.OS !== "ios") return null;
  let newest: number | null = null;
  for (const name of [INBOX_FILE, READING_FILE]) {
    const f = new File(Paths.document, name);
    if (!f.exists) continue;
    for (const m of parseInbox(await f.text())) newest = Math.max(newest ?? 0, Number(m.date) || 0);
  }
  return newest;
}

// ── Notification switch (read by the Shortcuts action through a file) ──

/** On by default: a notification each time the Shortcut hands a message over. */
export function isArrivalNotifyOn(): boolean {
  return settingsStorage.getBoolean(NOTIFY_KEY) ?? true;
}

export function setArrivalNotify(on: boolean): void {
  settingsStorage.set(NOTIFY_KEY, on);
  writeNotifyFile(on);
}

function writeNotifyFile(on: boolean): void {
  if (Platform.OS !== "ios") return;
  try {
    const f = new File(Paths.document, SETTINGS_FILE);
    f.write(JSON.stringify({ notify: on }));
  } catch (e) {
    logger.warn("Couldn't save the bank-message notification setting for Shortcuts:", e);
  }
}

/** Keep the action's copy of the switch in step (it's missing on a fresh install = on). */
export function syncArrivalNotifyFile(): void {
  writeNotifyFile(isArrivalNotifyOn());
}

// ── "Review bank message in Arth" opened Arth ──

/** True once after the Review action opened Arth; the request is used up. */
export function takeOpenRequest(): boolean {
  if (Platform.OS !== "ios") return false;
  try {
    const f = new File(Paths.document, OPEN_REQUEST_FILE);
    if (!f.exists) return false;
    f.delete();
    return true;
  } catch {
    return false;
  }
}

/** A bank message pasted or typed in Arth: read like a handed-over one and kept for "Just arrived". */
export async function addMessageText(text: string): Promise<ScanOutcome | null> {
  const body = text.trim();
  if (!body) return null;
  const message = { _id: `pasted-${Date.now()}`, address: "Pasted", body, date: Date.now(), type: 1 } as RawSMS;
  const outcome = await runSmsScan({ manual: true, messages: [message] });
  recordArrival([message], outcome);
  return outcome;
}
