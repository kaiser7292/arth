/**
 * Speech recognition (voice entry on Home, voice search on Transactions) through
 * expo-speech-recognition, without crashing when its native module isn't in the build.
 *
 * The library looks its module up the moment it's imported and throws if it's missing - which took
 * the whole app down at start-up in the first iPhone builds, where autolinking left it out. Here
 * the module is looked up optionally: without it, `isSpeechRecognitionAvailable` is false, voice
 * isn't offered, and the calls below do nothing.
 */

import { useEventListener } from "expo";
import { requireOptionalNativeModule } from "expo-modules-core";
import type { ExpoSpeechRecognitionNativeEventMap, ExpoSpeechRecognitionOptions } from "expo-speech-recognition";

interface SpeechModule {
  start(options: ExpoSpeechRecognitionOptions): void;
  stop(): void;
  abort(): void;
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
}

const Native = requireOptionalNativeModule<SpeechModule>("ExpoSpeechRecognition");

/** False in a build without the speech module: hide the microphone buttons. */
export const isSpeechRecognitionAvailable = Native != null;

export const SpeechRecognition = {
  requestPermissionsAsync: async (): Promise<{ granted: boolean }> =>
    Native ? Native.requestPermissionsAsync() : { granted: false },
  start: (options: ExpoSpeechRecognitionOptions) => Native?.start(options),
  stop: () => Native?.stop(),
  abort: () => Native?.abort(),
};

/** Listens for nothing when there's no module. */
const NO_EVENTS = { addListener: () => ({ remove: () => {} }) };

/** The library's useSpeechRecognitionEvent, safe without the module. */
export function useSpeechRecognitionEvent<K extends keyof ExpoSpeechRecognitionNativeEventMap>(
  eventName: K,
  listener: (event: ExpoSpeechRecognitionNativeEventMap[K]) => void,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the native module is an event emitter at runtime
  useEventListener((Native ?? NO_EVENTS) as any, eventName as never, listener as never);
}
