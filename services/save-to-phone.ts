/**
 * Save-to-Phone helper (v16.0.8)
 *
 * Shared wrapper around Android's Storage Access Framework (SAF). Lets the
 * user pick any folder on device (pre-seeded to Downloads) and drops the
 * file there. Used by Backup & Restore and by the Hisaab export flow.
 *
 * Android-only. iOS has no SAF equivalent — callers should fall back to
 * the Share sheet on iOS (or hide the Save-to-Phone option entirely).
 */

import { Platform } from "react-native";
import { File } from "expo-file-system";
import { StorageAccessFramework, writeAsStringAsync } from "expo-file-system/legacy";

/** SAF URI that seeds the picker inside the Downloads folder on Android. */
const ANDROID_DOWNLOADS_INITIAL_URI =
  "content://com.android.externalstorage.documents/document/primary:Download";

export interface SaveToPhoneResult {
  ok: boolean;
  destUri?: string;
  error?: string;
  /** User dismissed the folder picker. */
  cancelled?: boolean;
  /** SAF unavailable (iOS). */
  unsupported?: boolean;
}

export interface SaveToPhoneOptions {
  /** Local file path to copy from (the authoritative cache copy). */
  sourcePath: string;
  /**
   * Encoding used to read the source file AND write it to the user's chosen
   * location. Backup files live as base64 TEXT on disk (the encryption layer
   * already produced a base64 string). Exports (PDF / XLSX) are binary and
   * stored as base64 on disk too (via `File.write(..., { encoding: "base64" })`
   * for Excel, `Print.printToFileAsync` for PDF which writes raw bytes — the
   * SAF layer handles raw bytes by reading them as base64 then writing as
   * base64, which round-trips cleanly).
   */
  encoding?: "base64" | "utf8";
  /** MIME type hint for the SAF file creation. */
  mimeType?: string;
  /** Filename override; defaults to the tail of sourcePath. */
  fileName?: string;
  /**
   * Delete the cache copy on success. Good for backups (file now lives at
   * the user's chosen location). Off for exports — user may still want to
   * Share the same file after saving.
   */
  deleteSourceOnSuccess?: boolean;
}

/**
 * Copy a file to a user-picked SAF folder. Returns cancelled=true if the
 * user dismissed the picker, unsupported=true on iOS.
 */
export async function saveToPhone(
  options: SaveToPhoneOptions,
): Promise<SaveToPhoneResult> {
  if (Platform.OS !== "android") {
    return { ok: false, unsupported: true };
  }

  const { sourcePath, encoding = "base64", mimeType = "application/octet-stream", fileName, deleteSourceOnSuccess = false } = options;

  try {
    const perm = await StorageAccessFramework.requestDirectoryPermissionsAsync(
      ANDROID_DOWNLOADS_INITIAL_URI,
    );
    if (!perm.granted) {
      return { ok: false, cancelled: true };
    }

    const sourceFile = new File(sourcePath);
    const resolvedName = fileName ?? sourcePath.split("/").pop() ?? "file";

    // For PDF/XLSX (binary), File#text() still returns the on-disk bytes
    // decoded as a string — but since we wrote them via base64 encoding,
    // reading as base64 and writing as base64 round-trips the binary cleanly.
    // For backup files (already base64-text), either read mode gets the
    // same content.
    const content = encoding === "base64"
      ? await sourceFile.base64()
      : await sourceFile.text();

    const destUri = await StorageAccessFramework.createFileAsync(
      perm.directoryUri,
      resolvedName,
      mimeType,
    );
    await writeAsStringAsync(destUri, content, {
      encoding: encoding === "base64" ? "base64" : "utf8",
    });

    if (deleteSourceOnSuccess) {
      try {
        if (sourceFile.exists) sourceFile.delete();
      } catch {
        // Non-critical.
      }
    }

    return { ok: true, destUri };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
