/** Types for `constants/design-tokens.js`. TypeScript resolves this; Metro and Node load the .js. */

/** An unquoted RGB channel triplet, e.g. "15 118 110". Never a hex string — see the .js header. */
export type Channels = string;

export type SemanticRole =
  | "background"
  | "card"
  | "foreground"
  | "mutedForeground"
  | "faintForeground"
  | "border"
  | "primary"
  | "primaryForeground"
  | "accent"
  | "accentSolid"
  | "success"
  | "danger"
  | "warning";

export type Ramp = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, Channels>;

export type Scheme = "light" | "dark";

export declare const teal: Ramp;
export declare const SEMANTIC: Record<Scheme, Record<SemanticRole, Channels>>;
export declare const TYPE: Record<string, [string, Record<string, string>]>;
export declare const SCALE_OVERRIDES: Record<string, [string, Record<string, string>]>;
export declare const RADIUS: { control: string; card: string; sheet: string };
export declare const MOTION: { fast: number; base: number; slow: number; easing: string };
export declare const DATA: {
  accountType: Record<string, Channels>;
  transfer: Channels;
  series: Channels[];
};

/**
 * Component shape recipes. Class strings, except where a value lands in a style object.
 * See the block comment in design-tokens.js for the rules that keep these safe to change.
 */
export declare const COMPONENTS: {
  button: { base: string; pad: string; label: string; pressedOpacity: number; disabled: string };
  card: { base: string; title: string };
  input: { base: string; label: string; hint: string; error: string };
  chip: { base: string; label: string };
  badge: {
    sm: { pad: string; label: string; icon: number };
    md: { pad: string; label: string; icon: number };
    tintAlpha: number;
  };
  listRow: { base: string; icon: number; title: string; subtitle: string };
  separator: string;
  sheet: { radius: number; backdrop: string; maxHeightPct: number; handle: string };
  progress: { height: number };
};
