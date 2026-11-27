/**
 * "Share with AI" - one step from the user's side: build the export, write the file, and open
 * the phone's share sheet on it so they can pick their assistant's app.
 *
 * The request travels three ways so the user never has to type or paste it: it is written inside
 * the file (the assistant acts on it as soon as the file is sent), it is on the clipboard (one
 * long-press if the assistant's message box is empty), and the reply format is in the file too.
 */

import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";

import {
  buildAiExport,
  type AiExportOptions,
  type AiExportResult,
} from "@/services/ai-export";
import { AI_EXPORT_MIME_TYPE, writeAiExportFile, type AiExportFile } from "@/services/ai-export-file";
import { AI_REQUESTS, aiShareMessage } from "@/services/ai-reply-format";
import { bumpDataVersion } from "@/services/settings";
import { settingsStorage as storage } from "@/services/storage";
import { toIsoDate } from "@/utils/date";
import { shareFile } from "@/services/share-file";

export interface AiShareResult {
  file: AiExportFile;
  counts: AiExportResult["counts"];
  skipped: string[];
}

/** Build the file and write it, without sharing. */
export async function createAiFile(userId: string, options: AiExportOptions): Promise<AiShareResult> {
  const result = await buildAiExport(userId, options);
  const file = writeAiExportFile(result.data, toIsoDate(new Date()));
  return { file, counts: result.counts, skipped: result.skipped };
}

/** Open the share sheet on a file made by createAiFile, with the request on the clipboard. */
export async function shareAiFile(file: AiExportFile, options: AiExportOptions): Promise<void> {
  const request = AI_REQUESTS.find((r) => r.id === options.suggest?.request);
  if (request) {
    try {
      await Clipboard.setStringAsync(aiShareMessage(request));
    } catch {
      // The request is inside the file as well; the clipboard is only a convenience.
    }
  }
  if (await Sharing.isAvailableAsync()) {
    await shareFile(file.filePath, { mimeType: AI_EXPORT_MIME_TYPE, dialogTitle: "Share with your AI assistant" });
  }
}

// ─── A reply waiting (Catch Up's "Your assistant's reply" card) ─────────────

const KEY_SETUP_PENDING = "ai_setup_pending";
/** What was asked for in the file that was shared (an AiFocus), so the paste screen knows. */
const KEY_REQUEST_FOCUS = "ai_request_focus";

/** True from the moment a file is shared until the reply is applied or the card dismissed. */
export function isAiSetupPending(): boolean {
  return storage.getBoolean(KEY_SETUP_PENDING) ?? false;
}

/** Sharing a file sets it with what was asked for; applying or dismissing clears it. */
export function setAiSetupPending(pending: boolean, focus?: string): void {
  if (pending && focus) storage.set(KEY_REQUEST_FOCUS, focus);
  if (!pending) storage.delete(KEY_REQUEST_FOCUS);
  if (isAiSetupPending() === pending) return;
  storage.set(KEY_SETUP_PENDING, pending);
  bumpDataVersion();
}

/** What the waiting reply was asked for, if a file was shared from the request page. */
export function getAiRequestFocus(): string | null {
  return storage.getString(KEY_REQUEST_FOCUS) ?? null;
}
