import { File, Paths } from "expo-file-system";
import { createDownloadResumable, type DownloadResumable } from "expo-file-system/legacy";
import { settingsStorage } from "./storage";

const KEYS = {
  AI_ENABLED: "arth_ai_enabled",
  NL_SEARCH_ENABLED: "arth_ai_nl_search_enabled",
} as const;

// ── Model config ──────────────────────────────────────────────────
// Llama 3.2 1B Instruct Q4_K_M — ~880 MB, ungated on bartowski's HF mirror.
// If the download fails with auth errors, grab the direct URL from:
// https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF
export const MODEL_FILENAME = "Llama-3.2-1B-Instruct-Q4_K_M.gguf";
export const MODEL_URL =
  "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf";
export const MODEL_SIZE_MB = 880;

const SYSTEM_PROMPT =
  "You are Arth AI, a personal finance assistant built into the Arth app. " +
  "The user tracks all their expenses, credits, budgets, accounts, and loans entirely on-device — " +
  "no data is shared with any server. " +
  "Answer concisely and practically. When you don't have specific data, say so and suggest " +
  "where to look in the app (e.g. Transactions tab, Budget, Insights, or Accounts).";

// ── Preference helpers ────────────────────────────────────────────
export function isArthAIEnabled(): boolean {
  return settingsStorage.getBoolean(KEYS.AI_ENABLED) ?? false;
}

export function setArthAIEnabled(enabled: boolean): void {
  settingsStorage.set(KEYS.AI_ENABLED, enabled);
}

export function isNLSearchEnabled(): boolean {
  return settingsStorage.getBoolean(KEYS.NL_SEARCH_ENABLED) ?? true;
}

export function setNLSearchEnabled(enabled: boolean): void {
  settingsStorage.set(KEYS.NL_SEARCH_ENABLED, enabled);
}

// ── Model file helpers ────────────────────────────────────────────
export function getModelPath(): string {
  return Paths.document.uri + MODEL_FILENAME;
}

export async function isModelDownloaded(): Promise<boolean> {
  try {
    return new File(getModelPath()).exists;
  } catch {
    return false;
  }
}

export async function getModelSizeOnDisk(): Promise<number> {
  try {
    const f = new File(getModelPath());
    if (!f.exists) return 0;
    return Math.round(f.size / 1024 / 1024);
  } catch {
    return 0;
  }
}

export async function deleteModel(): Promise<void> {
  await releaseAIContext();
  const f = new File(getModelPath());
  if (f.exists) f.delete();
}

let activeDownload: DownloadResumable | null = null;

export async function downloadModel(
  onProgress: (downloadedMB: number, totalMB: number, pct: number) => void,
): Promise<void> {
  const dest = getModelPath();
  activeDownload = createDownloadResumable(
    MODEL_URL,
    dest,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      const dl = totalBytesWritten / 1024 / 1024;
      const total = totalBytesExpectedToWrite > 0
        ? totalBytesExpectedToWrite / 1024 / 1024
        : MODEL_SIZE_MB;
      const pct = total > 0 ? Math.min(dl / total, 1) : 0;
      onProgress(Math.round(dl), Math.round(total), pct);
    },
  );
  try {
    const result = await activeDownload.downloadAsync();
    if (!result) throw new Error("Download returned no result");
  } finally {
    activeDownload = null;
  }
}

export async function cancelDownload(): Promise<void> {
  if (activeDownload) {
    await activeDownload.cancelAsync();
    activeDownload = null;
    const f = new File(getModelPath());
    if (f.exists) f.delete();
  }
}

// ── LLM context (module-level singleton) ─────────────────────────
// Kept alive across screens so reinit cost (3-6s) is paid once per session.
// Release on app background via AppState listener in the chat screen.
type LlamaContext = Awaited<ReturnType<typeof import("llama.rn").initLlama>>;
let llamaContext: LlamaContext | null = null;
let initPromise: Promise<void> | null = null;

export async function initAIContext(): Promise<void> {
  if (llamaContext) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { initLlama } = await import("llama.rn");
    // initLlama needs a native filesystem path, not a file:// URI
    const nativePath = getModelPath().replace(/^file:\/\//, "");
    llamaContext = await initLlama({
      model: nativePath,
      n_ctx: 2048,
      n_batch: 512,
      n_threads: 4,
      n_gpu_layers: 0,
      use_mlock: false,
    });
  })();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

export async function releaseAIContext(): Promise<void> {
  if (!llamaContext) return;
  try {
    await llamaContext.release();
  } catch {
    // ignore — process may already be clean
  }
  llamaContext = null;
  initPromise = null;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function chatWithAI(
  history: ChatMessage[],
  onToken: (token: string) => void,
): Promise<string> {
  if (!llamaContext) throw new Error("Model not loaded");

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
  ];

  const result = await llamaContext.completion(
    {
      messages,
      n_predict: 300,
      temperature: 0.7,
      stop: ["<|eot_id|>", "<|end|>", "<|im_end|>", "<end_of_turn>"],
    },
    (data) => onToken(data.token),
  );
  return result.text;
}
