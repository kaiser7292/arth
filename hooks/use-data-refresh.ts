import { createContext, createElement, useContext, useEffect, useRef, useCallback, type ReactNode } from "react";
import { useFocusEffect, usePathname } from "expo-router";
import { getDataVersion, subscribeDataVersion } from "@/services/settings";
import { recordLoad } from "@/services/load-timings";

/**
 * A skip key for a whole part of the app (docs/SPEED_AND_VOICE_PROPOSAL.md, fix 3): Home and the
 * tab pages put one around everything they show, and every card and page inside that doesn't
 * pass its own skipKey uses it. Coming back to Home with nothing saved then reloads nothing.
 */
const SkipKeyContext = createContext<string | undefined>(undefined);

/** The route, for naming a load; "" where the router isn't there (some tests mock it out). */
const useScreenName: () => string = typeof usePathname === "function" ? usePathname : () => "";

export function DataRefreshScope({ skipKey, children }: { skipKey: string; children: ReactNode }) {
  return createElement(SkipKeyContext.Provider, { value: skipKey }, children);
}

/** Time one load and record it (services/load-timings.ts). Never throws on the timing's account. */
function timed(screen: string, why: string, run: () => void | Promise<void>): void {
  const t0 = Date.now();
  let result: void | Promise<void>;
  try {
    result = run();
  } catch (e) {
    recordLoad(screen, why, Date.now() - t0);
    throw e;
  }
  if (result && typeof (result as Promise<void>).then === "function") {
    (result as Promise<void>).then(
      () => recordLoad(screen, why, Date.now() - t0),
      () => recordLoad(screen, why, Date.now() - t0),
    );
  } else {
    recordLoad(screen, why, Date.now() - t0);
  }
}

export type RefreshSource = "focus" | "data-version";

/**
 * Hook that keeps screen data in sync with the database.
 *
 * Two refresh triggers:
 * 1. **Focus** — reloads every time the screen gains focus (navigating back, tab switch).
 * 2. **Reactive** — reloads instantly when any service calls bumpDataVersion(),
 *    even while the screen is already focused (e.g. approve from a list).
 *
 * Screens that do their own cold-start dedup (e.g. Home with skipNextHomeLoad
 * to avoid double-fetching after the preloader seeded state) can distinguish
 * the two by accepting an optional `RefreshSource` arg — only the "focus"
 * variant should be skippable; "data-version" triggers must always reload,
 * since they signal fresh data the preloader couldn't have captured.
 *
 * @param loadFn - The async function that fetches screen data.
 */
export interface DataRefreshOptions {
  /**
   * A signature of everything the load depends on that is NOT the database — the viewed month,
   * the active filters, the selected financial year.
   *
   * Pass this only when the screen wants to skip redundant reloads. A focus reload is then
   * skipped when neither the data version nor this key has changed, and performed whenever
   * either has.
   *
   * This exists because the hand-rolled version of it was wrong on every screen that had it.
   * The pattern was `if (lastVersion === currentVersion) return;` inside the load callback,
   * which asks "has anything been written?" — but changing the viewed month writes nothing, so
   * the guard swallowed the reload and the screen kept rendering the previous month's data.
   * That shipped on the transactions tab and again on the budget tab. Keyed here, the two
   * questions ("is the data stale?" and "am I looking at something else?") cannot drift apart.
   */
  skipKey?: string;
}

export function useDataRefresh(
  loadFn: (source?: RefreshSource) => void | Promise<void>,
  options?: DataRefreshOptions,
): void {
  // Use a ref so the MMKV listener always calls the latest loadFn
  // without re-subscribing on every render.
  const loadFnRef = useRef(loadFn);
  loadFnRef.current = loadFn;

  const isFocused = useRef(false);
  const lastRef = useRef<string | null>(null);
  /** The load function last run: a new one means the screen's own inputs changed, so it reloads. */
  const lastFnRef = useRef<typeof loadFn | null>(null);
  // Its own key, else the one the part of the app around it sets (DataRefreshScope).
  const scopeKey = useContext(SkipKeyContext);
  const skipKey = options?.skipKey ?? scopeKey;
  const skipKeyRef = useRef(skipKey);
  skipKeyRef.current = skipKey;
  const screen = useScreenName();
  const screenRef = useRef(screen);
  screenRef.current = screen;

  useFocusEffect(
    useCallback(() => {
      isFocused.current = true;
      if (skipKey === undefined) {
        // No signature given: reload on every focus, which is the long-standing default.
        timed(screenRef.current, "focus", () => loadFn("focus"));
      } else {
        const stamp = `${getDataVersion()}|${skipKey}`;
        if (lastRef.current !== stamp || lastFnRef.current !== loadFn) {
          lastRef.current = stamp;
          lastFnRef.current = loadFn;
          timed(screenRef.current, "focus", () => loadFn("focus"));
        }
      }
      return () => {
        isFocused.current = false;
      };
    }, [loadFn, skipKey]),
  );

  // Subscribe to data version changes — reload instantly if screen is focused.
  // This catches mutations that happen on the SAME screen (approve, delete, etc.)
  useEffect(() => {
    const sub = subscribeDataVersion(() => {
      if (isFocused.current) {
        // Record what we just loaded, so the focus check does not repeat it.
        if (skipKeyRef.current !== undefined) {
          lastRef.current = `${getDataVersion()}|${skipKeyRef.current}`;
        }
        timed(screenRef.current, "data-version", () => loadFnRef.current("data-version"));
      }
    });
    return () => sub.remove();
  }, []);
}
