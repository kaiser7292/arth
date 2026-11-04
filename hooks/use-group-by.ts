import { useCallback, useState } from "react";
import { getGroupByPreference, setGroupByPreference } from "@/services/group-by-preference";

/** How a list is grouped, remembered per screen. Something it no longer offers falls back to the default. */
export function useGroupBy<K extends string>(
  screen: string,
  available: readonly K[],
  fallback: K,
): [K, (groupBy: K) => void] {
  const [, rerender] = useState(0);
  const value = getGroupByPreference(screen) as K | undefined;
  const set = useCallback(
    (groupBy: K) => {
      setGroupByPreference(screen, groupBy);
      rerender((n) => n + 1);
    },
    [screen],
  );
  return [value && available.includes(value) ? value : fallback, set];
}
