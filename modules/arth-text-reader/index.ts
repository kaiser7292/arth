import { requireOptionalNativeModule } from "expo-modules-core";

/** A recognised piece of text, its box as a fraction of the image (0..1, top-left origin). */
export interface TextBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One recognised line, with its words when the reader gives them (Android). */
export interface TextLine extends TextBox {
  words?: TextBox[];
}

export interface TextReadResult {
  lines: TextLine[];
  imageWidth: number;
  imageHeight: number;
}

const Native = requireOptionalNativeModule<{ readText(uri: string): Promise<TextReadResult> }>("ArthTextReader");

/** False in a build without the native module (Expo Go, web): screenshot reading isn't offered. */
export const isTextReaderAvailable = Native != null;

/** Read the text in an image on the device. Throws when the image can't be read. */
export async function readTextInImage(uri: string): Promise<TextReadResult> {
  if (!Native) throw new Error("Reading screenshots isn't available in this build.");
  return Native.readText(uri);
}
