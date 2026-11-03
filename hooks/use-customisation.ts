import { useSyncExternalStore } from "react";
import { customiseVersion, subscribeCustomise } from "@/services/customise";

/** Re-renders the calling screen when something is switched on or off, or Home cards are reordered. */
export function useCustomisation(): void {
  useSyncExternalStore(subscribeCustomise, customiseVersion);
}
