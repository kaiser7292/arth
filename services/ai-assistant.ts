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
  ACTIVE_MODEL: "arth_ai_active_model",
} as const;

// ── Model registry ────────────────────────────────────────────────
export interface ModelDefinition {
  id: string;
  name: string;
  filename: string;
  url: string;
  sizeMB: number;
  description: string;
  minRAMGB: number;
}

export const AVAILABLE_MODELS: ModelDefinition[] = [
  {
    id: "1b",
    name: "Llama 3.2 1B",
    filename: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
    url: "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf",
    sizeMB: 880,
    description: "Fast responses · Works on any Android phone",
    minRAMGB: 3,
  },
  {
    id: "3b",
    name: "Llama 3.2 3B",
    filename: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    url: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    sizeMB: 1930,
    description: "Smarter & more accurate · Needs 4 GB+ RAM",
    minRAMGB: 4,
  },
];

// Legacy single-model exports kept for any code that still references them
export const MODEL_FILENAME = AVAILABLE_MODELS[0].filename;
export const MODEL_URL = AVAILABLE_MODELS[0].url;
export const MODEL_SIZE_MB = AVAILABLE_MODELS[0].sizeMB;

function getModelDef(modelId: string): ModelDefinition {
  return AVAILABLE_MODELS.find((m) => m.id === modelId) ?? AVAILABLE_MODELS[0];
}

// ── System prompt (few-shot) ──────────────────────────────────────
// Small models imitate patterns better than they follow abstract rules.
const SYSTEM_PROMPT =
  "You are Arth AI inside the Arth personal finance app. " +
  "Answer ONLY from the financial data provided. Never calculate — every number is pre-computed by the app and already correct. " +
  "Be brief: 1-3 sentences max. Use ₹ for amounts.\n\n" +
  "Examples of correct responses:\n" +
  "Q: How much did I spend this month?\n" +
  "A: You spent ₹79,791 this month across 45 transactions. Your top category was Food at ₹18,500.\n\n" +
  "Q: Am I over budget?\n" +
  "A: You've used 68% of your July budget — ₹45,000 of ₹66,000. Food is ₹3,500 over.\n\n" +
  "Q: What's my savings balance?\n" +
  "A: Your HDFC Savings account has ₹1,23,456 as of this month.\n\n" +
  "Q: Your number seems wrong.\n" +
  "A: These figures come directly from your transaction records. Check the Transactions tab for a full breakdown.\n\n" +
  "Q: What did I spend on dining last month?\n" +
  "A: I don't have last month's category breakdown available. Open the Insights tab and select last month to see it.";

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

// ── Active model ──────────────────────────────────────────────────
export function getActiveModelId(): string {
  return settingsStorage.getString(KEYS.ACTIVE_MODEL) ?? "1b";
}

export function setActiveModelId(modelId: string): void {
  settingsStorage.set(KEYS.ACTIVE_MODEL, modelId);
  // Release context so the next chat open re-inits with the new model
  releaseAIContext();
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

// ── Per-model file helpers ────────────────────────────────────────
export function getModelPath(modelId?: string): string {
  const def = getModelDef(modelId ?? getActiveModelId());
  return (documentDirectory ?? "") + def.filename;
}

export function getModelNativePath(modelId?: string): string {
  return getModelPath(modelId).replace(/^file:\/\//, "");
}

export async function isModelDownloaded(modelId?: string): Promise<boolean> {
  try {
    return new File(getModelPath(modelId)).exists;
  } catch {
    return false;
  }
}

export async function getModelSizeOnDisk(modelId?: string): Promise<number> {
  try {
    const f = new File(getModelPath(modelId));
    if (!f.exists) return 0;
    return Math.round(f.size / 1024 / 1024);
  } catch {
    return 0;
  }
}

export async function deleteModel(modelId?: string): Promise<void> {
  const targetId = modelId ?? getActiveModelId();
  // Release context if we're deleting the currently loaded model
  if (targetId === loadedModelId) await releaseAIContext();
  const f = new File(getModelPath(targetId));
  if (f.exists) f.delete();
}

// ── Download ──────────────────────────────────────────────────────
let activeDownload: DownloadResumable | null = null;
let downloadingModelId: string | null = null;

export function getDownloadingModelId(): string | null {
  return downloadingModelId;
}

export async function downloadModel(
  modelId: string,
  onProgress: (downloadedMB: number, totalMB: number, pct: number) => void,
): Promise<void> {
  const def = getModelDef(modelId);
  downloadingModelId = modelId;
  activeDownload = createDownloadResumable(
    def.url,
    getModelPath(modelId),
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      const dl = totalBytesWritten / 1024 / 1024;
      const total = totalBytesExpectedToWrite > 0
        ? totalBytesExpectedToWrite / 1024 / 1024
        : def.sizeMB;
      const pct = total > 0 ? Math.min(dl / total, 1) : 0;
      onProgress(Math.round(dl), Math.round(total), pct);
    },
  );
  try {
    const result = await activeDownload.downloadAsync();
    if (!result) throw new Error("Download returned no result");
  } finally {
    activeDownload = null;
    downloadingModelId = null;
  }
}

export async function cancelDownload(): Promise<void> {
  if (activeDownload) {
    const modelId = downloadingModelId;
    await activeDownload.cancelAsync();
    activeDownload = null;
    downloadingModelId = null;
    if (modelId) {
      const f = new File(getModelPath(modelId));
      if (f.exists) f.delete();
    }
  }
}

// ── LLM context (module-level singleton) ─────────────────────────
type LlamaContext = Awaited<ReturnType<typeof import("llama.rn").initLlama>>;
let llamaContext: LlamaContext | null = null;
let initPromise: Promise<void> | null = null;
let loadedModelId: string | null = null;

export async function initAIContext(): Promise<void> {
  const targetId = getActiveModelId();

  // Already loaded with the right model
  if (llamaContext && loadedModelId === targetId) return;

  // Loaded with a different model — release before re-init
  if (llamaContext && loadedModelId !== targetId) {
    await releaseAIContext();
  }

  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { initLlama } = await import("llama.rn");
    llamaContext = await initLlama({
      model: getModelNativePath(targetId),
      n_ctx: 2048,
      n_batch: 512,
      n_threads: 4,
      n_gpu_layers: 0,
      use_mlock: false,
    });
    loadedModelId = targetId;
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
    // ignore
  }
  llamaContext = null;
  initPromise = null;
  loadedModelId = null;
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
      "\n\n[FINANCIAL DATA — read-only, pre-calculated, do not modify]\n" +
      dataContext +
      "\n[END DATA]\n" +
      "Use only the numbers above. Report them exactly as given.";
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...history,
  ];

  const result = await llamaContext.completion(
    {
      messages,
      n_predict: 200,
      temperature: 0.3,
      stop: ["<|eot_id|>", "<|end|>", "<|im_end|>", "<end_of_turn>"],
    },
    (data) => onToken(data.token),
  );
  return result.text;
}
