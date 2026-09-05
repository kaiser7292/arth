/**
 * The theme API for new and migrated code.
 *
 * Replaces four overlapping mechanisms: `Colors[colorScheme]`, `StatusColors[colorScheme]`,
 * `ac(accent, colorScheme, light, dark)` and `acAlpha(accent, shade, alpha)`. Where those forced
 * every call site to resolve light-vs-dark itself, a role here is already resolved for the active
 * scheme — the same collapse the CSS variables perform for `className`.
 *
 * Deliberately NOT built on `useUnstableNativeVariable()`. That hook can read `:root` variables,
 * but NativeWind strips any variable no emitted utility references (so a JS-only token silently
 * reads `undefined` on device), its return value is a channel array rather than a colour string,
 * it leaks an effect per colour-scheme change, and `vars()` is already deprecated in NativeWind v5.
 * TypeScript is the source of truth instead; CSS is generated from it.
 */
import { useMemo } from "react";
import { useColorScheme as useNativeWindColorScheme } from "nativewind";
import { SEMANTIC } from "@/constants/design-tokens";
import type { Channels, Scheme, SemanticRole } from "@/constants/design-tokens";
import { ROLES, DATA_HEX, withAlpha } from "@/constants/brand";

export interface Theme extends Record<SemanticRole, string> {
  scheme: Scheme;
  /** Raw channels, for callers that need to apply their own alpha. */
  channels: Record<SemanticRole, Channels>;
  /** `alpha("primary", 0.1)` — the JS equivalent of the `bg-primary/10` class. */
  alpha: (role: SemanticRole, a: number) => string;
  data: typeof DATA_HEX;
}

const build = (scheme: Scheme): Theme =>
  Object.freeze({
    ...ROLES[scheme],
    scheme,
    channels: SEMANTIC[scheme],
    alpha: (role: SemanticRole, a: number) => withAlpha(SEMANTIC[scheme][role], a),
    data: DATA_HEX,
  }) as Theme;

/** Built once per scheme, not per render — these are frozen constants. */
const THEMES: Record<Scheme, Theme> = { light: build("light"), dark: build("dark") };

export function useTheme(): Theme {
  const { colorScheme } = useNativeWindColorScheme();
  const scheme: Scheme = colorScheme === "dark" ? "dark" : "light";
  return useMemo(() => THEMES[scheme], [scheme]);
}

/** Non-hook access, for module-scope constants and helpers outside components. */
export const getTheme = (scheme: Scheme): Theme => THEMES[scheme];
