import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

export type NanoStatus = "available" | "downloadable" | "downloading" | "unavailable";

export interface NanoAnswer {
  text: string;
  /** Time the model took, in milliseconds. */
  ms: number;
}

interface NativeNano {
  checkStatus(): Promise<NanoStatus>;
  /** iPhone only (missing on Android and on older builds): why it isn't ready, in one word. */
  statusReason?(): Promise<string>;
  download(): Promise<boolean>;
  warmup(): Promise<boolean>;
  generate(prompt: string, temperature: number, maxOutputTokens: number): Promise<NanoAnswer>;
  addListener(event: "onDownloadProgress", listener: (e: { bytes: number }) => void): EventSubscription;
}

const Native = requireOptionalNativeModule<NativeNano>("ArthNano");

/** False in a build without the module (Expo Go, web, a build made before it existed). Android uses Gemini Nano, iPhone Apple Intelligence. */
export const isNanoModulePresent = Native != null;

export async function checkNanoStatus(): Promise<NanoStatus> {
  return Native ? Native.checkStatus() : "unavailable";
}

/** iPhone: why the model isn't ready ("turned-off", "ios-too-old"…); null where the build can't say. */
export async function checkNanoReason(): Promise<string | null> {
  if (!Native || typeof Native.statusReason !== "function") return null;
  return Native.statusReason();
}

/** Ask Android to fetch the model. Resolves when done; throws if the download fails. */
export async function downloadNano(onProgress?: (bytes: number) => void): Promise<void> {
  if (!Native) throw new Error("On-device AI isn't in this build.");
  const sub = onProgress ? Native.addListener("onDownloadProgress", (e) => onProgress(e.bytes)) : null;
  try {
    await Native.download();
  } finally {
    sub?.remove();
  }
}

export async function warmupNano(): Promise<void> {
  if (!Native) throw new Error("On-device AI isn't in this build.");
  await Native.warmup();
}

export async function generateWithNano(prompt: string, temperature = 0, maxOutputTokens = 256): Promise<NanoAnswer> {
  if (!Native) throw new Error("On-device AI isn't in this build.");
  return Native.generate(prompt, temperature, maxOutputTokens);
}
