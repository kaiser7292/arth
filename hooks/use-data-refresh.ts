import { useEffect, useRef, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { subscribeDataVersion } from "@/services/settings";

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
export function useDataRefresh(
  loadFn: (source?: RefreshSource) => void | Promise<void>,
): void {
  // Use a ref so the MMKV listener always calls the latest loadFn
  // without re-subscribing on every render.
  const loadFnRef = useRef(loadFn);
  loadFnRef.current = loadFn;

  const isFocused = useRef(false);

  // Always reload on focus — no version check, just reload.
  useFocusEffect(
    useCallback(() => {
      isFocused.current = true;
      loadFn("focus");
      return () => {
        isFocused.current = false;
      };
    }, [loadFn]),
  );

  // Subscribe to data version changes — reload instantly if screen is focused.
  // This catches mutations that happen on the SAME screen (approve, delete, etc.)
  useEffect(() => {
    const sub = subscribeDataVersion(() => {
      if (isFocused.current) {
        loadFnRef.current("data-version");
      }
    });
    return () => sub.remove();
  }, []);
}
