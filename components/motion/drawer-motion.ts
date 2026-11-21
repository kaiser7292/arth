import { fadeIn } from "./motion";

/**
 * Drawer motion, all Reanimated (owner, Nov 2026: drawers should open and close smoothly).
 *
 *   - the list glides: every list with drawers is an Animated.FlatList with
 *     itemLayoutAnimation={listLayout()} (or, mapped in a ScrollView, rows with layout=), so rows
 *     below an opening or closing drawer slide to their new place
 *   - the rows of a drawer that was just opened fade in: markDrawerOpened(key) on the tap, and
 *     each row asks drawerEntering(key) for its entering animation
 *
 * Only a drawer opened in the last moment fades in, so rows the list mounts while scrolling (it
 * renders in windows) just appear. Not LayoutAnimation: on the new architecture it switched the
 * Reanimated glide off (4.55, owner: "there is no animation any more").
 */
let opened: { key: string; at: number } | null = null;

/** How long after the tap a drawer's rows still count as just opened. */
const WINDOW_MS = 600;

export function markDrawerOpened(key: string): void {
  opened = { key, at: Date.now() };
}

/** The entering animation for a row of drawer `key`: a fade if that drawer was just opened. */
export function drawerEntering(key: string | null | undefined) {
  if (key == null || !opened || opened.key !== key || Date.now() - opened.at > WINDOW_MS) return undefined;
  return fadeIn();
}
