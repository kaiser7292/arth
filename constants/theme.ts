import { Platform } from "react-native";

/**
 * Cross-platform elevation presets.
 *
 * All that remains of this module. `Colors` and `StatusColors` lived here and were the app's
 * colour source before the token migration; every one of their ~1,300 call sites now goes through
 * `useTheme()`, so they are deleted. Elevation is not colour and has no light/dark pairing, so it
 * stays as plain constants.
 */
export const Shadows = {
  card: Platform.select({
    ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
    default: { elevation: 2 },
  }),
  dropdown: Platform.select({
    ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12 },
    default: { elevation: 4 },
  }),
  fab: Platform.select({
    ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12 },
    default: { elevation: 8 },
  }),
  tabBar: Platform.select({
    ios: { shadowColor: "#000", shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.05, shadowRadius: 8 },
    default: { elevation: 4 },
  }),
} as const;
