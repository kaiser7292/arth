import { useColorScheme as useNativeWindColorScheme } from "nativewind";
import { useEffect, useMemo, useRef } from "react";
import { getThemePreference } from "@/services/settings";
import { LIGHT, DARK } from "@/constants/brand";

/**
 * Colour-scheme hook.
 *
 * Reduced to what it actually does: resolve the scheme and sync it with the stored preference.
 * The `colors` map is retained for the handful of call sites that still read `colors.tint` or
 * `colors.border`; new code should use `useTheme()` from `@/hooks/use-theme`, which exposes the
 * full semantic role set already resolved for the active scheme.
 *
 * The AccentProvider and its five-palette context are gone. They served a picker that was removed
 * in v1.11 — `setAccentTheme()` had been a documented no-op ever since — while every component
 * still paid for the context and the indirection.
 */
export function useColorScheme() {
  const { colorScheme, setColorScheme } = useNativeWindColorScheme();
  const synced = useRef(false);

  // Sync the stored preference into NativeWind once on mount.
  useEffect(() => {
    if (!synced.current) {
      setColorScheme(getThemePreference());
      synced.current = true;
    }
  }, [setColorScheme]);

  const resolved = (colorScheme ?? "light") as "light" | "dark";
  const roles = resolved === "dark" ? DARK : LIGHT;

  const colors = useMemo(
    () => ({
      text: roles.foreground,
      textSecondary: roles.mutedForeground,
      background: roles.background,
      surface: roles.card,
      border: roles.border,
      tint: roles.primary,
      icon: roles.mutedForeground,
      tabIconDefault: roles.faintForeground,
      tabIconSelected: roles.primary,
      blue: roles.primary,
    }),
    [roles],
  );

  return {
    /** Resolved colour scheme ("light" or "dark") */
    colorScheme: resolved,
    /** Update both the stored preference and NativeWind */
    setColorScheme,
    /** Legacy colour map. Prefer useTheme(). */
    colors,
  };
}
