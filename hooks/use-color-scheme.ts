import { useColorScheme as useNativeWindColorScheme } from "nativewind";
import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { getThemePreference, getAccentTheme as getStoredAccent, setAccentTheme as setStoredAccent } from "@/services/settings";
import { Colors } from "@/constants/theme";
import { DEFAULT_ACCENT_THEME } from "@/constants/accent-palettes";
import { BRAND_RAMP } from "@/constants/brand";
import type { AccentThemeId } from "@/constants/accent-palettes";

/* ------------------------------------------------------------------ */
/*  Accent Context — provides reactive accent theme across the app    */
/* ------------------------------------------------------------------ */

interface AccentContextValue {
  accentTheme: AccentThemeId;
  setAccentTheme: (id: AccentThemeId) => void;
}

const AccentContext = createContext<AccentContextValue>({
  accentTheme: DEFAULT_ACCENT_THEME,
  setAccentTheme: () => {},
});

/**
 * Wrap the app root with this provider so every `useColorScheme()` consumer
 * re-renders when the accent theme changes.
 */
export function AccentProvider({ children }: { children: React.ReactNode }) {
  const [accentTheme, setAccentThemeState] = useState<AccentThemeId>(
    () => getStoredAccent(),
  );

  const setAccentTheme = useCallback((id: AccentThemeId) => {
    setStoredAccent(id);
    setAccentThemeState(id);
  }, []);

  const value = useMemo(
    () => ({ accentTheme, setAccentTheme }),
    [accentTheme, setAccentTheme],
  );

  return React.createElement(AccentContext.Provider, { value }, children);
}

/* ------------------------------------------------------------------ */
/*  useColorScheme hook                                               */
/* ------------------------------------------------------------------ */

/**
 * Custom hook that wraps NativeWind's useColorScheme and syncs it
 * with the user's theme preference stored in MMKV.
 *
 * Also provides accent-aware colors: `tint`, `blue`, and `tabIconSelected`
 * are derived from the active accent palette instead of being hardcoded blue.
 */
export function useColorScheme() {
  const { colorScheme, setColorScheme } = useNativeWindColorScheme();
  const { accentTheme, setAccentTheme } = useContext(AccentContext);
  const synced = useRef(false);

  // Sync MMKV → NativeWind on first mount
  useEffect(() => {
    if (!synced.current) {
      const stored = getThemePreference();
      setColorScheme(stored);
      synced.current = true;
    }
  }, [setColorScheme]);

  const resolved = (colorScheme ?? "light") as "light" | "dark";
  // Single brand ramp from the design tokens. Formerly one of five user-selectable accent
  // palettes; the picker was removed in v1.11 and setAccentTheme() has been a no-op since, so
  // this indirection served nothing. Re-pointing it here is what moves all ~823 existing
  // `accent[N]` / `ac()` / `acAlpha()` call sites onto the new brand without editing them.
  // `id`/`name` retained only to satisfy the legacy AccentPalette shape; both go away with it.
  const palette = { id: DEFAULT_ACCENT_THEME, name: "Arth", ...BRAND_RAMP };

  // Build color set with accent-derived overrides.
  // For Ocean (default), these match the original hardcoded values exactly.
  const colors = useMemo(
    () => ({
      ...Colors[resolved],
      tint: resolved === "light" ? palette[600] : palette[400],
      blue: resolved === "light" ? palette[600] : palette[300],
      tabIconSelected: resolved === "light" ? palette[600] : palette[400],
    }),
    [resolved, palette],
  );

  return {
    /** Resolved color scheme ("light" or "dark") */
    colorScheme: resolved,
    /** Update both MMKV and NativeWind */
    setColorScheme,
    /** Theme-aware colors — accent properties are palette-derived */
    colors,
    /** Full active accent palette (50-900 scale) */
    accent: palette,
    /** Current accent theme ID */
    accentTheme,
    /** Change accent theme (persists to MMKV + triggers re-render) */
    setAccentTheme,
  };
}
