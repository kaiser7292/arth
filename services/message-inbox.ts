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
import type { RawSMS } from "@/services/sms/sms-reader";
import { runSmsScan, type ScanOutcome } from "@/services/sms/sms-orchestrator";

/** Must match BankMessageInbox.fileName in AddBankMessageIntent.swift. */
const INBOX_FILE = "bank-messages.jsonl";
const READING_FILE = "bank-messages.reading.jsonl";

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
