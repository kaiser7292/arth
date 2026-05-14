import { Platform } from "react-native";

/**
 * Artha design tokens — Notion-inspired.
 * Primary: Blue. Warm neutral surfaces. Data: Green (up) / Red (down).
 * Clean, spacious, modern finance aesthetic.
 */

export const Colors = {
  /** Primary blue palette (anchored at #2563EB) */
  primary: {
    50: "#EFF6FF",
    100: "#DBEAFE",
    200: "#BFDBFE",
    300: "#93C5FD",
    400: "#60A5FA",
    500: "#3B82F6",
    600: "#2563EB",
    700: "#1D4ED8",
    800: "#1E40AF",
    900: "#1E3A8A",
  },

  /** Budget / data status colors */
  budget: {
    under: "#22C55E",
    warning: "#F59E0B",
    over: "#EF4444",
  },

  /** Semantic colors for light mode */
  light: {
    text: "#1A1A1A",
    textSecondary: "#6B7280",
    background: "#F9F9F7",
    surface: "#F7F7F5",
    border: "#E5E5E3",
    tint: "#2563EB",
    icon: "#6B7280",
    tabIconDefault: "#9CA3AF",
    tabIconSelected: "#2563EB",
    blue: "#2563EB",
  },

  /** Semantic colors for dark mode */
  dark: {
    text: "#FFFFFF",
    textSecondary: "#A0A0A0",
    background: "#111111",
    surface: "#1E1E1E",
    border: "#2E2E2E",
    tint: "#60A5FA",
    icon: "#A0A0A0",
    tabIconDefault: "#6B7280",
    tabIconSelected: "#60A5FA",
    blue: "#93C5FD",
  },
};

/** Cross-platform shadow presets — soft, diffused, Gen Z aesthetic */
export const Shadows = {
  card: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
    },
    default: { elevation: 2 },
  }),
  dropdown: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
    },
    default: { elevation: 4 },
  }),
  fab: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 12,
    },
    default: { elevation: 8 },
  }),
  tabBar: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.05,
      shadowRadius: 8,
    },
    default: { elevation: 4 },
  }),
} as const;

/**
 * Status / semantic colors — lighter, softer palette.
 * Use StatusColors[colorScheme].success etc. in components.
 */
export const StatusColors = {
  light: {
    success: "#22C55E",
    successBg: "#22C55E14",
    danger: "#EF4444",
    dangerBg: "#EF444414",
    warning: "#F59E0B",
    warningBg: "#F59E0B14",
    muted: "#9CA3AF",
  },
  dark: {
    success: "#4ADE80",
    successBg: "#4ADE8014",
    danger: "#F87171",
    dangerBg: "#F8717114",
    warning: "#FBBF24",
    warningBg: "#FBBF2414",
    muted: "#6B7280",
  },
} as const;

