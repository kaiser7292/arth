import { useEffect, useRef, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { getDataVersion, subscribeDataVersion } from "@/services/settings";

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
  const skipKey = options?.skipKey;
  const skipKeyRef = useRef(skipKey);
  skipKeyRef.current = skipKey;

  useFocusEffect(
    useCallback(() => {
      isFocused.current = true;
      if (skipKey === undefined) {
        // No signature given: reload on every focus, which is the long-standing default.
        loadFn("focus");
      } else {
        const stamp = `${getDataVersion()}|${skipKey}`;
        if (lastRef.current !== stamp) {
          lastRef.current = stamp;
          loadFn("focus");
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
        loadFnRef.current("data-version");
      }
    });
    return () => sub.remove();
  }, []);
}
