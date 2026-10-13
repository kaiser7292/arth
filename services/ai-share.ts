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
  DEFAULT_AI_EXPORT_SECTIONS,
  resolveAiExportPeriod,
  type AiExportOptions,
  type AiExportResult,
} from "@/services/ai-export";
import { AI_EXPORT_MIME_TYPE, writeAiExportFile, type AiExportFile } from "@/services/ai-export-file";
import { AI_REQUESTS, aiShareMessage } from "@/services/ai-reply-format";
import { bumpDataVersion } from "@/services/settings";
import { settingsStorage as storage } from "@/services/storage";
import { toIsoDate } from "@/utils/date";

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
    await Sharing.shareAsync(file.filePath, { mimeType: AI_EXPORT_MIME_TYPE, dialogTitle: "Share with your AI assistant" });
  }
}

/** Everything a first-time setup needs: all entries including unreviewed ones, and unread messages. */
export async function buildSetupOptions(userId: string): Promise<AiExportOptions> {
  const period = await resolveAiExportPeriod("all_time", userId);
  return {
    ...period,
    sections: { ...DEFAULT_AI_EXPORT_SECTIONS, netWorth: false },
    hidePeopleNames: true,
    hideMerchantNames: false,
    suggest: { request: "setup", includeUnreviewed: true, includeUnreadMessages: true },
  };
}

// ─── "AI Assisted Setup" card on Home ──────────────────────────────────────

const KEY_SETUP_PENDING = "ai_setup_pending";

/** True from the moment the setup file is shared until the reply is applied or the card dismissed. */
export function isAiSetupPending(): boolean {
  return storage.getBoolean(KEY_SETUP_PENDING) ?? false;
}

export function setAiSetupPending(pending: boolean): void {
  if (isAiSetupPending() === pending) return;
  storage.set(KEY_SETUP_PENDING, pending);
  bumpDataVersion();
}
