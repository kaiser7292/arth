import { forwardRef, useRef, useState } from "react";
import { Platform, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { fadeIn } from "@/components/motion/motion";

import { Text } from "./Text";
import type { KeyboardTypeOptions, TextInputProps } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { evaluateFormula, isFormulaMode, getFormulaExpr } from "@/utils/formula";
import { formatAmount } from "@/utils/format";
import { useTheme } from "@/hooks/use-theme";
import { COMPONENTS } from "@/constants/design-tokens";

/**
 * The keyboard for amounts that can be formulas (=5000+2500*2): the full keyboard, which on iPhone
 * opens on its number-and-symbols page (digits, + - / ( ) and %), letters a tap away. Android's
 * full keyboard has a number row already.
 */
export const FORMULA_KEYBOARD: KeyboardTypeOptions = Platform.OS === "ios" ? "numbers-and-punctuation" : "default";

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerClassName?: string;
  /**
   * When true, typing "=" as the first character activates formula mode.
   * The field accepts a BODMAS expression (e.g. =5000+2500*(1+18%)).
   * A live preview is shown below. See useFormulaText for what the parent receives.
   */
  formula?: boolean;
}

/**
 * Lets an amount box take "=5000+2500*2". The box shows what's typed, while the parent is handed the
 * worked-out number on every keystroke ("" while it doesn't work out), so a Save tapped with the
 * keyboard still up reads the right amount. Leaving the box replaces the expression with the number.
 */
function useFormulaText({
  enabled,
  value,
  onChangeText,
  onFocus,
  onBlur,
}: Pick<TextInputProps, "value" | "onChangeText" | "onFocus" | "onBlur"> & { enabled: boolean }) {
  const [typed, setTyped] = useState<string | null>(null);
  const focused = useRef(false);
  const sent = useRef<string | undefined>(undefined);

  // Once out of the box, a new value from the parent (a reset, a re-fill) replaces what was typed.
  const expression = typed !== null && (focused.current || value === sent.current) ? typed : null;
  const shown = expression ?? value;
  const inFormula = enabled && typeof shown === "string" && isFormulaMode(shown);
  const expr = inFormula ? getFormulaExpr(shown as string) : "";
  const hasExpr = expr.trim().length > 0;
  const result = hasExpr ? evaluateFormula(expr) : null;

  const handleChange = (text: string) => {
    if (enabled && isFormulaMode(text)) {
      const worked = getFormulaExpr(text).trim() ? evaluateFormula(getFormulaExpr(text)) : null;
      sent.current = worked === null ? "" : String(worked);
      focused.current = true;
      setTyped(text);
      onChangeText?.(sent.current);
      return;
    }
    setTyped(null);
    onChangeText?.(text);
  };

  const handleFocus: NonNullable<TextInputProps["onFocus"]> = (e) => {
    focused.current = true;
    onFocus?.(e);
  };

  const handleBlur: NonNullable<TextInputProps["onBlur"]> = (e) => {
    focused.current = false;
    if (inFormula && result !== null) {
      // A saved "=..." handed in by the parent hasn't been worked out yet.
      if (expression === null) onChangeText?.(String(result));
      setTyped(null);
    }
    onBlur?.(e);
  };

  return { shown, inFormula, hasExpr, result, handleChange, handleFocus, handleBlur };
}

/** A bare TextInput for amounts in custom layouts: formulas work, with no label or preview line. */
export const FormulaTextInput = forwardRef<TextInput, TextInputProps & { formula?: boolean }>(function FormulaTextInput(
  { formula = true, value, onChangeText, onFocus, onBlur, keyboardType, ...props },
  ref,
) {
  const f = useFormulaText({ enabled: formula, value, onChangeText, onFocus, onBlur });
  return (
    <TextInput
      ref={ref}
      value={f.shown}
      onChangeText={f.handleChange}
      onFocus={f.handleFocus}
      onBlur={f.handleBlur}
      keyboardType={formula ? FORMULA_KEYBOARD : keyboardType}
      {...props}
    />
  );
});

export function Input({
  label,
  error,
  containerClassName = "",
  className = "",
  formula = false,
  value,
  onChangeText,
  onFocus,
  onBlur,
  keyboardType,
  ...props
}: InputProps) {
  const theme = useTheme();
  const { colors } = useColorScheme();

  const { shown, inFormula, hasExpr, result: formulaResult, handleChange, handleFocus, handleBlur } = useFormulaText({
    enabled: formula,
    value,
    onChangeText,
    onFocus,
    onBlur,
  });
  const formulaValid = formulaResult !== null;

  return (
    <View className={containerClassName}>
      {label && (
        <Text className={COMPONENTS.input.label}>
          {label}
        </Text>
      )}
      <TextInput
        value={shown}
        onChangeText={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        keyboardType={formula ? FORMULA_KEYBOARD : keyboardType}
        accessibilityLabel={label || props.placeholder}
        className={`${COMPONENTS.input.base} ${
          error
            ? "border-danger"
            : inFormula
            ? "border-primary"
            : "border-border"
        } ${className}`}
        placeholderTextColor={colors.tabIconDefault}
        {...props}
      />
      {/* Formula preview */}
      {inFormula && hasExpr && (
        <Text
          className={COMPONENTS.input.hint}
          style={{ color: formulaValid ? colors.tint : theme.danger }}
        >
          {formulaValid
            ? `= ${formatAmount(formulaResult!)}`
            : "Invalid expression"}
        </Text>
      )}
      {/* Normal error (suppressed while formula preview is showing) */}
      {error && !inFormula && (
        <Animated.View entering={fadeIn()}>
          <Text className={COMPONENTS.input.error}>{error}</Text>
        </Animated.View>
      )}
    </View>
  );
}
