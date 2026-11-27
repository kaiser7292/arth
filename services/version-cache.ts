/**
 * Remember a heavy read until something changes (docs/SPEED_AND_VOICE_PROPOSAL.md, fix 1).
 *
 * A wrapped function's answer is kept per set of arguments and reused until:
 *  - anything is saved (the data version goes up: bumpDataVersion),
 *  - the day changes (month-to-date figures move with the date), or
 *  - the financial-year start month changes (several reports depend on it).
 *
 * Reopening an unchanged report then costs nothing. The same pattern Year in Review has used
 * (services/reports/year-review.ts), in one place. Answers are shared: callers must not change
 * what they get back (copy before sorting in place).
 */

import { getDataVersion, getFYStartMonth } from "@/services/settings";

interface Entry {
  promise: Promise<unknown>;
  /** The settled answer, for a screen that wants to draw it at once (peekCached). */
  value?: unknown;
  done: boolean;
}

const store = new Map<string, Entry>();
let stamp = "";
/** Per-name cap, so long-lived keys (many months, many filters) can't grow without end. */
const MAX_PER_NAME = 40;
const counts = new Map<string, string[]>();

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Everything that invalidates every entry at once. */
function currentStamp(): string {
  return `${getDataVersion()}|${today()}|${getFYStartMonth()}`;
}

function refresh(): void {
  const s = currentStamp();
  if (s !== stamp) {
    store.clear();
    counts.clear();
    stamp = s;
  }
}

function keyOf(name: string, args: unknown[]): string {
  return `${name}|${JSON.stringify(args)}`;
}

/** Wrap an async read so its answer is reused until the data, the day or the FY start changes. */
export function cachedByVersion<A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args: A) => {
    // Tests write rows straight to the database without bumping the version: no cache there,
    // unless a test switches it on to test the cache itself.
    if (inTests() && !testsUseCache) return fn(...args);
    refresh();
    const key = keyOf(name, args);
    const hit = store.get(key);
    if (hit) return hit.promise as Promise<R>;
    const entry: Entry = { promise: Promise.resolve(), done: false };
    const promise = fn(...args).then(
      (v) => {
        entry.value = v;
        entry.done = true;
        return v;
      },
      (e) => {
        // A failure is never remembered: the next call tries again.
        if (store.get(key) === entry) store.delete(key);
        throw e;
      },
    );
    entry.promise = promise;
    store.set(key, entry);
    const list = counts.get(name) ?? [];
    list.push(key);
    if (list.length > MAX_PER_NAME) store.delete(list.shift()!);
    counts.set(name, list);
    return promise;
  };
}

/** The remembered answer for these arguments if it's ready and still current, else undefined. */
export function peekCached<R>(name: string, ...args: unknown[]): R | undefined {
  refresh();
  const e = store.get(keyOf(name, args));
  return e?.done ? (e.value as R) : undefined;
}

let testsUseCache = false;
function inTests(): boolean {
  return typeof process !== "undefined" && !!process.env?.JEST_WORKER_ID;
}

/** For tests of the cache itself. */
export function __useCacheInTests(on: boolean): void {
  testsUseCache = on;
}

/** For tests. */
export function __resetVersionCache(): void {
  store.clear();
  counts.clear();
  stamp = "";
}
