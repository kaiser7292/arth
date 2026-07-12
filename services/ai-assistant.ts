import { File } from "expo-file-system";
import { createDownloadResumable, documentDirectory, type DownloadResumable } from "expo-file-system/legacy";
import { settingsStorage } from "./storage";

const KEYS = {
  AI_ENABLED: "arth_ai_enabled",
  NL_SEARCH_ENABLED: "arth_ai_nl_search_enabled",
  LAST_INIT_ERROR: "arth_ai_last_init_error",
  AI_DATA_EXPENSES: "arth_ai_data_expenses",
  AI_DATA_ACCOUNTS: "arth_ai_data_accounts",
  AI_DATA_BUDGET: "arth_ai_data_budget",
  AI_DATA_HISAAB: "arth_ai_data_hisaab",
  AI_DATA_VAULT: "arth_ai_data_vault",
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
  "You are Arth AI, a personal finance assistant inside the Arth app. " +
  "All finances are tracked 100% on-device — no data leaves the phone.\n\n" +
  "STRICT RULES — follow these exactly:\n" +
  "1. NEVER perform arithmetic or recalculate anything. Every number in the financial data has already been computed correctly by the app. Report them exactly as given — do not add, subtract, multiply, or divide.\n" +
  "2. If the user says a number is wrong, do NOT try to recalculate. Instead say: \"The app calculated this figure — please check the Transactions or Accounts screen for the breakdown.\"\n" +
  "3. Answer in 1-4 sentences. Use bullet points only when listing 3+ items.\n" +
  "4. Use ₹ for amounts. Never reformat or round amounts from the data.\n" +
  "5. If you lack specific data, say so and direct the user to the right screen (Transactions, Budget, Insights, or Accounts tab).\n" +
  "6. Never invent or estimate numbers.";

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

// ── Data access toggle helpers ───────────────────────────────────
export function isAIDataExpensesEnabled(): boolean {
  return settingsStorage.getBoolean(KEYS.AI_DATA_EXPENSES) ?? false;
}
export function setAIDataExpensesEnabled(v: boolean): void {
  settingsStorage.set(KEYS.AI_DATA_EXPENSES, v);
}

export function isAIDataAccountsEnabled(): boolean {
  return settingsStorage.getBoolean(KEYS.AI_DATA_ACCOUNTS) ?? false;
}
export function setAIDataAccountsEnabled(v: boolean): void {
  settingsStorage.set(KEYS.AI_DATA_ACCOUNTS, v);
}

export function isAIDataBudgetEnabled(): boolean {
  return settingsStorage.getBoolean(KEYS.AI_DATA_BUDGET) ?? false;
}
export function setAIDataBudgetEnabled(v: boolean): void {
  settingsStorage.set(KEYS.AI_DATA_BUDGET, v);
}

export function isAIDataHisaabEnabled(): boolean {
  return settingsStorage.getBoolean(KEYS.AI_DATA_HISAAB) ?? false;
}
export function setAIDataHisaabEnabled(v: boolean): void {
  settingsStorage.set(KEYS.AI_DATA_HISAAB, v);
}

export function isAIDataVaultEnabled(): boolean {
  return settingsStorage.getBoolean(KEYS.AI_DATA_VAULT) ?? false;
}
export function setAIDataVaultEnabled(v: boolean): void {
  settingsStorage.set(KEYS.AI_DATA_VAULT, v);
}

// ── Model file helpers ────────────────────────────────────────────
export function getModelPath(): string {
  // documentDirectory always has a trailing slash and matches the download destination
  return (documentDirectory ?? "") + MODEL_FILENAME;
}

// Native path for llama.rn (strips file:// URI prefix)
export function getModelNativePath(): string {
  return getModelPath().replace(/^file:\/\//, "");
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
    llamaContext = await initLlama({
      model: getModelNativePath(),
      n_ctx: 2048,
      n_batch: 512,
      n_threads: 4,
      n_gpu_layers: 0,
      use_mlock: false,
    });
  })();

  try {
    await initPromise;
    settingsStorage.delete(KEYS.LAST_INIT_ERROR);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    settingsStorage.set(KEYS.LAST_INIT_ERROR, msg);
    throw e;
  } finally {
    initPromise = null;
  }
}

export function getLastInitError(): string | undefined {
  return settingsStorage.getString(KEYS.LAST_INIT_ERROR);
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
  dataContext?: string,
): Promise<string> {
  if (!llamaContext) throw new Error("Model not loaded");

  let systemContent = SYSTEM_PROMPT;
  if (dataContext) {
    systemContent +=
      "\n\n--- USER'S FINANCIAL DATA (as of now) ---\n" +
      dataContext +
      "\n--- END DATA ---\n\n" +
      "Use this data to answer questions with specific numbers. " +
      "If the user asks about data you don't have access to, say so.";
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
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
