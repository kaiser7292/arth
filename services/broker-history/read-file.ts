import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import type * as XLSXType from "xlsx";

import type { Workbook } from "./types";

/** Reads a report file into rows, on this phone. Nothing leaves it. */

export class LockedFileError extends Error {}

let xlsx: typeof XLSXType | null = null;
const loadXlsx = () => (xlsx ??= require("xlsx") as typeof XLSXType);

const MAX_BYTES = 20 * 1024 * 1024;

export function workbookFromBase64(base64: string): Workbook {
  const X = loadXlsx();
  let book: XLSXType.WorkBook;
  try {
    book = X.read(base64, { type: "base64" });
  } catch (e) {
    if (/password/i.test(e instanceof Error ? e.message : "")) throw new LockedFileError();
    throw e;
  }
  const out: Workbook = {};
  for (const name of book.SheetNames) {
    out[name] = X.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, blankrows: false, raw: true });
  }
  return out;
}

export async function pickReportFile(): Promise<{ name: string; workbook: Workbook } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "text/csv", "text/comma-separated-values", "application/csv"],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  if (asset.size && asset.size > MAX_BYTES) throw new Error("That file is too large to be a broker report.");
  const base64 = await new File(asset.uri).base64();
  return { name: asset.name, workbook: workbookFromBase64(base64) };
}
