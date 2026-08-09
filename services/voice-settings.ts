import { settingsStorage as storage } from "./storage";

export interface VoiceSettings {
  voiceIdentifier: string | null; // null = system default
  speakBack: boolean;             // true = TTS reads questions aloud
}

const KEY = "voice_input_settings";
const DEFAULT: VoiceSettings = { voiceIdentifier: null, speakBack: true };

export function getVoiceSettings(): VoiceSettings {
  const raw = storage.getString(KEY);
  if (!raw) return { ...DEFAULT };
  try { return { ...DEFAULT, ...JSON.parse(raw) }; }
  catch { return { ...DEFAULT }; }
}

export function saveVoiceSettings(s: VoiceSettings): void {
  storage.set(KEY, JSON.stringify(s));
}
