/**
 * Artha accent theme palettes.
 * Each palette defines a full 50-900 color scale used as the app's primary accent.
 * Ocean (blue) is the default and matches the original app colors exactly.
 */

export type AccentThemeId = "ocean" | "mint" | "sunset" | "lavender" | "rose";

export interface AccentPalette {
  id: AccentThemeId;
  name: string;
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
}

export const ACCENT_PALETTES: Record<AccentThemeId, AccentPalette> = {
  ocean: {
    id: "ocean",
    name: "Ocean",
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
  mint: {
    id: "mint",
    name: "Mint",
    50: "#ECFDF5",
    100: "#D1FAE5",
    200: "#A7F3D0",
    300: "#6EE7B7",
    400: "#34D399",
    500: "#10B981",
    600: "#059669",
    700: "#047857",
    800: "#065F46",
    900: "#064E3B",
  },
  sunset: {
    id: "sunset",
    name: "Sunset",
    50: "#FFFBEB",
    100: "#FEF3C7",
    200: "#FDE68A",
    300: "#FCD34D",
    400: "#FBBF24",
    500: "#F59E0B",
    600: "#D97706",
    700: "#B45309",
    800: "#92400E",
    900: "#78350F",
  },
  lavender: {
    id: "lavender",
    name: "Lavender",
    50: "#F5F3FF",
    100: "#EDE9FE",
    200: "#DDD6FE",
    300: "#C4B5FD",
    400: "#A78BFA",
    500: "#8B5CF6",
    600: "#7C3AED",
    700: "#6D28D9",
    800: "#5B21B6",
    900: "#4C1D95",
  },
  rose: {
    id: "rose",
    name: "Rose",
    50: "#FFF1F2",
    100: "#FFE4E6",
    200: "#FECDD3",
    300: "#FDA4AF",
    400: "#FB7185",
    500: "#F43F5E",
    600: "#E11D48",
    700: "#BE123C",
    800: "#9F1239",
    900: "#881337",
  },
};

/** Ordered list for the theme picker UI */
export const ACCENT_THEME_LIST: AccentPalette[] = [
  ACCENT_PALETTES.ocean,
  ACCENT_PALETTES.mint,
  ACCENT_PALETTES.sunset,
  ACCENT_PALETTES.lavender,
  ACCENT_PALETTES.rose,
];

export const DEFAULT_ACCENT_THEME: AccentThemeId = "ocean";
