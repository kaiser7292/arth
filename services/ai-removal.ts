import { File } from "expo-file-system";
import { documentDirectory } from "expo-file-system/legacy";
import { settingsStorage } from "./storage";
import { logger } from "@/utils/logger";

/**
 * Arth AI (on-device Llama assistant) was removed in 4.11.0. Phones that used it still hold an
 * 880 MB or 1.9 GB model file and its settings, so free them on first start after the update.
 * Idempotent: a missing file or key is a no-op, so it is safe to run on every start.
 */
const MODEL_FILES = ["Llama-3.2-1B-Instruct-Q4_K_M.gguf", "Llama-3.2-3B-Instruct-Q4_K_M.gguf"];

const AI_KEYS = [
  "arth_ai_enabled",
  "arth_ai_nl_search_enabled",
  "arth_ai_data_expenses",
  "arth_ai_data_accounts",
  "arth_ai_data_budget",
  "arth_ai_data_hisaab",
  "arth_ai_data_vault",
  "arth_ai_chat_history",
  "arth_ai_active_model",
  "arth_ai_last_init_error",
];

export function removeArthAILeftovers(): void {
  for (const name of MODEL_FILES) {
    try {
      const f = new File((documentDirectory ?? "") + name);
      if (f.exists) f.delete();
    } catch (e) {
      logger.warn(`Couldn't delete old AI model ${name}:`, e);
    }
  }
  for (const key of AI_KEYS) {
    if (settingsStorage.contains(key)) settingsStorage.delete(key);
  }
}
