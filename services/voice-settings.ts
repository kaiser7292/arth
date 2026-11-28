import { settingsStorage as storage } from "./storage";

/**
 * Which speech engine listens (docs/SPEED_AND_VOICE_PROPOSAL.md §2.2 A6): Google's online
 * recogniser, or the one on the phone (works offline, needs English (India) installed for offline speech).
 */
export type VoiceEngine = "online" | "device";

export interface VoiceSettings {
  voiceIdentifier: string | null; // null = system default
  speakBack: boolean;             // true = TTS reads questions aloud
  engine: VoiceEngine;
}

const KEY = "voice_input_settings";
const DEFAULT: VoiceSettings = { voiceIdentifier: null, speakBack: true, engine: "online" };

export function getVoiceSettings(): VoiceSettings {
  const raw = storage.getString(KEY);
  if (!raw) return { ...DEFAULT };
  try {
    const s = { ...DEFAULT, ...JSON.parse(raw) } as VoiceSettings;
    if (s.engine !== "online" && s.engine !== "device") s.engine = "online";
    return s;
  } catch {
    return { ...DEFAULT };
  }
}

export function saveVoiceSettings(s: VoiceSettings): void {
  storage.set(KEY, JSON.stringify(s));
}
