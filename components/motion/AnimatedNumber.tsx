import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "react-native-reanimated";
import { Money, type MoneyProps } from "@/components/ui/Text";
import { MOTION } from "@/constants/design-tokens";
import { isAmountsHidden } from "@/services/privacy-mode";
import { formatAmount } from "@/utils/format";
import { countValue } from "./motion";

interface AnimatedNumberProps extends MoneyProps {
  /** Count up from zero the first time it shows. Off = only changes glide. */
  countOnMount?: boolean;
}

/**
 * A Money amount that counts up when it first appears and glides when its value changes.
 *
 * - Screen readers get the final amount straight away (accessibilityLabel), never the numbers in
 *   between.
 * - Hidden amounts (privacy mode) never animate: a count-up would hint at the size.
 * - With "Remove animations" on, the final value shows at once.
 *
 * JS-driven (one setState per frame for ~0.7s) rather than a native text animation: it's used for
 * a handful of headline figures per screen, and going through Money keeps formatting, sign colour
 * and masking identical to every other amount in the app.
 */
export function AnimatedNumber({ value, countOnMount = true, ...rest }: AnimatedNumberProps) {
  const reduceMotion = useReducedMotion();
  const hidden = isAmountsHidden();
  const still = reduceMotion || hidden;
  const [shown, setShown] = useState(() => (countOnMount && !still ? 0 : value));
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    if (still) {
      setShown(value);
      return;
    }
    const from = shownRef.current;
    if (from === value) return;
    const duration = from === 0 ? MOTION.count : MOTION.slow + 100;
    const t0 = Date.now();
    let frame = 0;
    const tick = () => {
      const t = (Date.now() - t0) / duration;
      if (t >= 1) {
        setShown(value);
        return;
      }
      setShown(Math.round(countValue(from, value, t)));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // Frames pause while the app is in the background; make sure the real value always lands.
    const settle = setTimeout(() => setShown(value), duration + 150);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
    };
  }, [value, still]);

  const label = hidden ? undefined : `${value < 0 ? "minus " : ""}${formatAmount(Math.abs(value))}`;
  return <Money value={shown} accessibilityLabel={label} {...rest} />;
}
