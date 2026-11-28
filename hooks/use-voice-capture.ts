/**
 * Listening, shared by voice entry, voice search and Ask Arth (docs/SPEED_AND_VOICE_PROPOSAL.md §2.2 A):
 *
 *   A1  your words appear as you speak (`live`)
 *   A2  your own words are passed as hints (Android 13+ honours them)
 *   A3  up to 5 guesses come back, best first, so the caller can pick the one that makes sense
 *   A4  on Android 13+ it keeps listening through short pauses and stops 2.5 s after you finish
 *       (or when you tap Done)
 *   A5  what went wrong is said in words (`error`)
 *   A6  the engine chosen in Settings → Voice input
 *
 * Every screen with a mic shares one speech engine, so each capture only handles events while it
 * is the one listening (`activeRef`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { SpeechRecognition, useSpeechRecognitionEvent } from "@/services/speech-recognition";
import { getVoiceSettings } from "@/services/voice-settings";

export type CaptureState = "idle" | "listening";

/** How long after the last word it stops by itself in continuous mode. */
const SILENCE_MS = 2500;

/** Always-useful hints: payment apps and Indian amounts. */
const BASE_HINTS = ["GPay", "PhonePe", "Paytm", "UPI", "CRED", "BHIM", "lakh", "crore", "hazaar", "rupees", "Swiggy", "Zomato", "Blinkit"];

/** The capture listening now, app-wide: starting another one cancels it, so one sentence never
 *  lands on two screens (voice entry and Ask Arth, say). */
let currentAbort: (() => void) | null = null;

/** Words said so far, without the pieces repeated by engines that resend everything each time. */
function joinPieces(soFar: string, next: string): string {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!soFar) return next.trim();
  const a = norm(soFar);
  const b = norm(next);
  // The engine resent everything: the new piece starts with all that was said, at a word boundary.
  if (b === a || b.startsWith(`${a} `)) return next.trim();
  return `${soFar} ${next}`.replace(/\s+/g, " ").trim();
}

const continuousSupported = () => Platform.OS === "android" && typeof Platform.Version === "number" && Platform.Version >= 33;

/** Words for a speech error. Undefined for errors that aren't worth saying (cancelled). Pure. */
export function voiceErrorMessage(code: string, engine: "online" | "device" = "online"): string | undefined {
  switch (code) {
    case "aborted":
      return undefined;
    case "no-speech":
    case "speech-timeout":
    case "nomatch":
      return "Didn't catch that. Tap the mic to try again.";
    case "busy":
      return "The microphone is busy in another app. Close it and try again.";
    case "audio-capture":
    case "interrupted":
      return "The microphone stopped. Tap the mic to try again.";
    case "network":
      return engine === "online"
        ? "Speech needs a connection right now. Try again, or switch to “On this phone” in Settings → Voice input."
        : "Speech couldn't reach the network. Try again.";
    case "language-not-supported":
      return engine === "device"
        ? "Offline speech for English (India) isn't installed. Install it in the phone's settings (Speech → Offline speech), or switch to Online in Settings → Voice input."
        : "This phone's speech service doesn't support English (India).";
    case "not-allowed":
    case "service-not-allowed":
      return "Arth needs the microphone. You can allow it in the phone's settings.";
    default:
      return "Voice stopped. Tap the mic to try again.";
  }
}

interface Options {
  /** Called once per capture with what was said: the best guess first, then the others. */
  onFinal: (guesses: string[]) => void;
}

export function useVoiceCapture({ onFinal }: Options) {
  const [state, setState] = useState<CaptureState>("idle");
  const [live, setLive] = useState("");
  const [error, setError] = useState<string | null>(null);

  const activeRef = useRef(false);
  /** Each start() and abort() is a new session: a start still waiting for permission, or events
   *  from the session before, are about an old one and are ignored. */
  const sessionRef = useRef(0);
  /** This session's engine has started (its "start" event or a first result). Until then an
   *  "end" is the previous session's, arriving late. */
  const startedRef = useRef(false);
  const noStartRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Started, but nothing heard yet: stop after a while rather than show the mic on forever. */
  const noSpeechRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Finished pieces said so far (continuous mode delivers one per pause). */
  const doneTextRef = useRef("");
  /** The guesses for the last piece, so the final answer can offer each. */
  const lastGuessesRef = useRef<string[]>([]);
  /** Guesses for words still being said (not final yet): used if you tap Done mid-sentence. */
  const interimRef = useRef<string[]>([]);
  const deliveredRef = useRef(false);
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const clearSilence = () => {
    if (silenceRef.current) clearTimeout(silenceRef.current);
    silenceRef.current = null;
    if (noStartRef.current) clearTimeout(noStartRef.current);
    noStartRef.current = null;
    if (noSpeechRef.current) clearTimeout(noSpeechRef.current);
    noSpeechRef.current = null;
  };

  const deliver = useCallback(() => {
    if (!activeRef.current || deliveredRef.current) return;
    deliveredRef.current = true;
    activeRef.current = false;
    clearSilence();
    setState("idle");
    if (currentAbort === abortRef.current) currentAbort = null;
    // Everything final, then words still being said when you tapped Done (kept, not dropped).
    const finals = lastGuessesRef.current.filter((g) => g.trim());
    let all: string[];
    if (interimRef.current.length > 0) {
      const soFar = joinPieces(doneTextRef.current, finals[0] ?? "");
      all = interimRef.current.map((g) => joinPieces(soFar, g));
    } else {
      all = (finals.length ? finals : [""]).map((g) => joinPieces(doneTextRef.current, g));
    }
    all = all.filter((g) => g.length > 0);
    if (all.length > 0) onFinalRef.current([...new Set(all)]);
    else setError(voiceErrorMessage("no-speech") ?? null);
  }, []);

  const start = useCallback(async (hints: readonly string[] = []) => {
    // Another screen listening stops first.
    if (currentAbort && currentAbort !== abortRef.current) currentAbort();
    const token = ++sessionRef.current;
    const { granted } = await SpeechRecognition.requestPermissionsAsync();
    // Closed or started again while the permission was being checked.
    if (token !== sessionRef.current) return false;
    if (!granted) {
      setError(voiceErrorMessage("not-allowed") ?? null);
      return false;
    }
    const { engine } = getVoiceSettings();
    clearSilence();
    activeRef.current = true;
    startedRef.current = false;
    deliveredRef.current = false;
    doneTextRef.current = "";
    lastGuessesRef.current = [];
    interimRef.current = [];
    setLive("");
    setError(null);
    setState("listening");
    currentAbort = abortRef.current;
    const contextualStrings = [...new Set([...hints, ...BASE_HINTS].map((h) => h.trim()).filter((h) => h.length > 1))].slice(0, 100);
    SpeechRecognition.start({
      lang: "en-IN",
      interimResults: true,
      maxAlternatives: 5,
      continuous: continuousSupported(),
      contextualStrings,
      requiresOnDeviceRecognition: engine === "device",
    });
    // An engine that never starts (or never says so) mustn't leave the mic showing as on.
    noStartRef.current = setTimeout(() => {
      if (token !== sessionRef.current || !activeRef.current || startedRef.current) return;
      SpeechRecognition.abort();
      activeRef.current = false;
      setState("idle");
      setError(voiceErrorMessage("no-speech") ?? null);
    }, 10000);
    return true;
  }, []);

  /** Done speaking: use what was heard. */
  const stop = useCallback(() => {
    if (!activeRef.current) return;
    SpeechRecognition.stop();
    // Some engines don't send a last result after stop: deliver what we have shortly.
    clearSilence();
    silenceRef.current = setTimeout(deliver, 800);
  }, [deliver]);

  /** Cancel: nothing is delivered. */
  const abort = useCallback(() => {
    sessionRef.current++;
    clearSilence();
    if (activeRef.current) SpeechRecognition.abort();
    activeRef.current = false;
    deliveredRef.current = true;
    if (currentAbort === abortRef.current) currentAbort = null;
    setState("idle");
    // Opening again starts clean: no old words or error showing.
    setLive("");
    setError(null);
  }, []);
  const abortRef = useRef<() => void>(abort);
  abortRef.current = abort;

  useEffect(() => () => {
    sessionRef.current++;
    clearSilence();
    if (activeRef.current) SpeechRecognition.abort();
    activeRef.current = false;
  }, []);

  useSpeechRecognitionEvent("start", () => {
    if (!activeRef.current) return;
    startedRef.current = true;
    // Nothing said for 8 s after it started: stop, and say so.
    if (noSpeechRef.current) clearTimeout(noSpeechRef.current);
    noSpeechRef.current = setTimeout(() => {
      if (!activeRef.current || doneTextRef.current || interimRef.current.length || lastGuessesRef.current.some((g) => g.trim())) return;
      SpeechRecognition.abort();
      activeRef.current = false;
      setState("idle");
      setError(voiceErrorMessage("no-speech") ?? null);
    }, 8000);
  });

  useSpeechRecognitionEvent("result", (event) => {
    if (!activeRef.current) return;
    startedRef.current = true;
    if (noSpeechRef.current) clearTimeout(noSpeechRef.current);
    noSpeechRef.current = null;
    const guesses = event.results.map((r) => r.transcript).filter((t) => t && t.trim());
    if (guesses.length === 0) return;
    if (event.isFinal) {
      interimRef.current = [];
      // Everything final so far: earlier pieces, plus the best guess of the last one. The last
      // piece keeps all its guesses, so the caller can still pick the one that makes sense.
      const soFar = joinPieces(doneTextRef.current, lastGuessesRef.current[0] ?? "");
      // An engine that resends everything: this piece already holds what was said.
      doneTextRef.current = joinPieces(soFar, guesses[0]) === guesses[0].trim() ? "" : soFar;
      lastGuessesRef.current = guesses;
      setLive(joinPieces(doneTextRef.current, guesses[0]));
      if (!continuousSupported()) {
        deliver();
        return;
      }
      clearSilence();
      silenceRef.current = setTimeout(() => {
        SpeechRecognition.stop();
        deliver();
      }, SILENCE_MS);
    } else {
      interimRef.current = guesses;
      // What was said before this piece stays on screen while you keep talking.
      setLive(joinPieces(joinPieces(doneTextRef.current, lastGuessesRef.current[0] ?? ""), guesses[0]));
      clearSilence();
      if (continuousSupported()) {
        silenceRef.current = setTimeout(() => {
          SpeechRecognition.stop();
          silenceRef.current = setTimeout(deliver, 800);
        }, SILENCE_MS + 1500);
      }
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    if (!activeRef.current) return;
    // The session before, cancelled: not about this one.
    if (!startedRef.current && (event.error === "aborted" || event.error === "client")) return;
    // Something was already heard: use it rather than lose it.
    if (doneTextRef.current || lastGuessesRef.current.some((g) => g.trim()) || interimRef.current.length) {
      deliver();
      return;
    }
    activeRef.current = false;
    clearSilence();
    setState("idle");
    const msg = voiceErrorMessage(event.error, getVoiceSettings().engine);
    if (msg) setError(msg);
  });

  useSpeechRecognitionEvent("end", () => {
    // Before this session started, an "end" is the previous session's arriving late.
    if (!activeRef.current || !startedRef.current) return;
    deliver();
  });

  return { state, live, error, setError, start, stop, abort };
}
