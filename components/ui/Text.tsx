import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { formatAmount } from "@/utils/format";

export interface TextProps extends RNTextProps {
  className?: string;
}

/**
 * The app's base text component. Applies Inter, which is registered natively as a single Android
 * font family with 400/500/600/700 definitions (see the expo-font plugin block in app.json), so
 * `font-medium` / `font-semibold` / `font-bold` resolve to real weights rather than a synthesised
 * fake bold.
 *
 * `font-sans` is emitted first so any className the caller passes still wins.
 *
 * Font scaling behaviour is deliberately left untouched here. Capping it would interact with the
 * fixed heights used throughout the app, and changing the typeface and the scaling rules in the
 * same commit would make a device regression ambiguous. Dynamic type is handled separately.
 */
export function Text({ className = "", ...rest }: TextProps) {
  return <RNText className={`font-sans ${className}`} {...rest} />;
}

export interface MoneyProps extends TextProps {
  /** Amount in rupees. Formatting (Indian digit grouping, currency) is delegated to formatAmount. */
  value: number;
  /** Colour by sign: positive renders success, negative renders danger. Off by default. */
  signed?: boolean;
  /** Render a leading + for positive values. Implies `signed`. */
  showPlus?: boolean;
}

/**
 * Money figures.
 *
 * The point of this component is `tabular-nums`. Inter's default figures are proportional, so a
 * column of rupee amounts never lines up — which is most of why the ledger, balance sheet and
 * amortisation tables read as ragged. Tabular figures give every digit the same advance width, so
 * amounts align on the decimal down a column without any manual padding.
 */
export function Money({ value, signed, showPlus, className = "", ...rest }: MoneyProps) {
  const tone =
    signed || showPlus
      ? value > 0
        ? "text-success"
        : value < 0
          ? "text-danger"
          : ""
      : "";
  const body = formatAmount(Math.abs(value));
  const prefix = value < 0 ? "-" : showPlus && value > 0 ? "+" : "";

  return (
    <RNText
      className={`font-sans ${tone} ${className}`}
      style={{ fontVariant: ["tabular-nums"] }}
      {...rest}
    >
      {prefix}
      {body}
    </RNText>
  );
}
