/**
 * Hand a file to the system share sheet - on iPhone that's also how files are saved to the phone
 * ("Save to Files") or sent on WhatsApp; on Android the Save to Phone buttons (save-to-phone.ts)
 * sit beside it.
 *
 * iPhone won't present the share sheet while another sheet, alert or modal is still animating
 * closed - it silently does nothing - and every share in Arth follows a tap in one. So on iPhone
 * this waits for that to finish first. The UTI tells iPhone what the file is, so apps offer to
 * open it (Files shows a PDF preview, Numbers takes a spreadsheet).
 */

import { Platform } from "react-native";
import * as Sharing from "expo-sharing";

const UTI_BY_MIME: Record<string, string> = {
  "application/pdf": "com.adobe.pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "org.openxmlformats.spreadsheetml.sheet",
  "image/png": "public.png",
  "text/csv": "public.comma-separated-values-text",
  "application/json": "public.json",
  "text/plain": "public.plain-text",
  "application/octet-stream": "public.data",
};

/** How long a closing sheet or alert takes to get out of the way on iPhone. */
const IOS_SETTLE_MS = 450;

export async function shareFile(uri: string, options: { mimeType: string; dialogTitle?: string; uti?: string }): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) return;
  if (Platform.OS === "ios") await new Promise((r) => setTimeout(r, IOS_SETTLE_MS));
  await Sharing.shareAsync(uri, {
    mimeType: options.mimeType,
    UTI: options.uti ?? UTI_BY_MIME[options.mimeType] ?? "public.data",
    ...(options.dialogTitle ? { dialogTitle: options.dialogTitle } : {}),
  });
}
