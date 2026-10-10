/**
 * Writes an Export for AI Insights (services/ai-export.ts) to a file the user can save or share.
 * Kept apart from the builder so the builder has no file-system dependency.
 */

import { File, Paths } from "expo-file-system";

import { formatAiExportJson } from "@/services/ai-export";

export interface AiExportFile {
  filePath: string;
  fileName: string;
  sizeBytes: number;
}

export const AI_EXPORT_MIME_TYPE = "application/json";

/** Written to the cache folder. Call deleteAiExportFile once the user is done with it. */
export function writeAiExportFile(data: unknown, generatedOn: string): AiExportFile {
  const fileName = `arth-ai-insights_${generatedOn}.json`;
  const file = new File(Paths.cache, fileName);
  try {
    if (file.exists) file.delete();
  } catch {
    // Overwritten by the write below anyway.
  }
  const json = formatAiExportJson(data);
  file.write(json);
  return { filePath: file.uri, fileName, sizeBytes: file.size ?? json.length };
}

export function deleteAiExportFile(filePath: string): void {
  try {
    const file = new File(filePath);
    if (file.exists) file.delete();
  } catch {
    // Non-critical - the OS clears the cache folder eventually.
  }
}
