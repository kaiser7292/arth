import { Text as RNText, type TextProps as RNTextProps, type StyleProp, type TextStyle } from "react-native";
import { formatAmount } from "@/utils/format";

export interface TextProps extends RNTextProps {
  className?: string;
  /**
   * Opt out of tabular figures. Almost never wanted — see the note below — but available for
   * display type where proportional figures genuinely read better.
   */
  proportional?: boolean;
}

const TABULAR: StyleProp<TextStyle> = { fontVariant: ["tabular-nums"] };

/**
 * The app's base text component.
 *
 * Applies Inter, registered natively as a single Android family with 400/500/600/700 definitions
 * (see the expo-font block in app.json), so font-medium / font-semibold / font-bold resolve to
 * real weights rather than a synthesised fake bold. `font-sans` is emitted first so any className
 * the caller passes still wins.
 *
 * TABULAR FIGURES ARE ON BY DEFAULT, and that is the single change that makes money columns line
 * up. Inter's default figures are proportional — a 1 is narrower than a 0 — so a column of rupee
 * amounts never aligns no matter how it is laid out. There are 665 formatAmount call sites in the
 * app; converting each one individually would be a large, risky diff for the same result. Setting
 * it once here fixes every ledger, balance sheet and amortisation table at once.
 *
 * The cost is that digits in running prose are slightly wider and more uniform. For a finance app
 * that is a fair trade, and it is what most of them do.
 *
 * Font scaling is deliberately untouched. Capping it interacts with the fixed heights used
 * throughout, and changing the typeface and the scaling rules together would make a device
 * regression ambiguous.
 */
export function Text({ className = "", proportional, style, ...rest }: TextProps) {
  return (
    <RNText
      className={`font-sans ${className}`}
      style={proportional ? style : [TABULAR, style]}
      {...rest}
    />
  );
}

export interface MoneyProps extends Omit<TextProps, "children"> {
  /** Amount in rupees. Formatting (Indian digit grouping, currency) is delegated to formatAmount. */
  value: number;
  /** Colour by sign: positive renders success, negative renders danger. */
  signed?: boolean;
  /** Render a leading + for positive values. Implies `signed`. */
  showPlus?: boolean;
}

/**
 * A money figure with its sign and colour handled in one place.
 *
 * Tabular figures come from Text. What this adds is the sign convention: the minus is rendered as
 * a true minus (U+2212) rather than a hyphen, which is the same width as a digit and therefore
 * does not knock the column out of alignment, and the positive/negative colour pair comes from the
 * theme instead of being re-decided at each call site.
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
  // U+2212 MINUS SIGN, not a hyphen: it is digit-width, so it keeps the column aligned.
  const prefix = value < 0 ? "−" : showPlus && value > 0 ? "+" : "";

  return (
    <Text className={`${tone} ${className}`} {...rest}>
      {prefix}
      {formatAmount(Math.abs(value))}
    </Text>
  );
}
