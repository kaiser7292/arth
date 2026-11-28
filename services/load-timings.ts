/**
 * How long each screen's data load takes (docs/SPEED_AND_VOICE_PROPOSAL.md §1.3), measured inside
 * the one shared loader (hooks/use-data-refresh.ts), so every screen is covered. Kept on this
 * phone only: the last 200 loads, shown on Settings → Speed diagnostics.
 */

import { settingsStorage } from "@/services/storage";

export const LOAD_TIMINGS_KEY = "diag_load_timings";
const KEEP = 200;

export interface LoadTiming {
  /** The screen (route) the load ran on. */
  screen: string;
  /** "focus": opened or came back; "data-version": something was saved while it showed. */
  why: string;
  ms: number;
  /** When it ran (ms since epoch). */
  at: number;
}

let buffer: LoadTiming[] | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function read(): LoadTiming[] {
  if (buffer) return buffer;
  try {
    const raw = settingsStorage.getString(LOAD_TIMINGS_KEY);
    const v = raw ? JSON.parse(raw) : [];
    buffer = Array.isArray(v) ? v : [];
  } catch {
    buffer = [];
  }
  return buffer;
}

/** Record one load. Written to storage a moment later, in one go, so timing never slows a load. */
export function recordLoad(screen: string, why: string, ms: number): void {
  const list = read();
  list.push({ screen, why, ms: Math.round(ms), at: Date.now() });
  if (list.length > KEEP) list.splice(0, list.length - KEEP);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      settingsStorage.set(LOAD_TIMINGS_KEY, JSON.stringify(read()));
    } catch {
      // Diagnostics only: never let them break anything.
    }
  }, 2000);
}

export function loadTimings(): LoadTiming[] {
  return [...read()];
}

export function clearLoadTimings(): void {
  buffer = [];
  settingsStorage.delete(LOAD_TIMINGS_KEY);
}

export interface ScreenSpeed {
  screen: string;
  count: number;
  /** The typical load (median). */
  typical: number;
  slowest: number;
}

/** Per screen: how many loads, the typical and the slowest, slowest first. Pure. */
export function summariseLoads(list: LoadTiming[]): ScreenSpeed[] {
  const by = new Map<string, number[]>();
  for (const t of list) by.set(t.screen, [...(by.get(t.screen) ?? []), t.ms]);
  return [...by.entries()]
    .map(([screen, ms]) => {
      const s = [...ms].sort((a, b) => a - b);
      return { screen, count: s.length, typical: s[Math.floor(s.length / 2)], slowest: s[s.length - 1] };
    })
    .sort((a, b) => b.typical - a.typical);
}
