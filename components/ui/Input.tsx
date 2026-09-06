import { TextInput, View } from "react-native";

import { Text } from "./Text";
import type { TextInputProps } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { evaluateFormula, isFormulaMode, getFormulaExpr } from "@/utils/formula";
import { formatAmount } from "@/utils/format";
import { useTheme } from "@/hooks/use-theme";
import { COMPONENTS } from "@/constants/design-tokens";

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerClassName?: string;
  /**
   * When true, typing "=" as the first character activates formula mode.
   * The field accepts a BODMAS expression (e.g. =5000+2500*(1+18%)).
   * A live preview is shown below. On blur, the expression is evaluated
   * and onChangeText is called with the numeric result string.
   */
  formula?: boolean;
}

export function Input({
  label,
  error,
  containerClassName = "",
  className = "",
  formula = false,
  value,
  onChangeText,
  onBlur,
  keyboardType,
  ...props
}: InputProps) {
  const theme = useTheme();
  const { colors } = useColorScheme();

  const inFormula = formula && typeof value === "string" && isFormulaMode(value);
  const formulaExpr = inFormula ? getFormulaExpr(value as string) : "";
  const hasExpr = formulaExpr.trim().length > 0;
  const formulaResult = hasExpr ? evaluateFormula(formulaExpr) : null;
  const formulaValid = formulaResult !== null;

  const handleBlur: NonNullable<TextInputProps["onBlur"]> = (e) => {
    if (inFormula && formulaValid && onChangeText) {
      onChangeText(String(formulaResult));
    }
    onBlur?.(e as Parameters<NonNullable<TextInputProps["onBlur"]>>[0]);
  };

  return (
    <View className={containerClassName}>
      {label && (
        <Text className={COMPONENTS.input.label}>
          {label}
        </Text>
      )}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={handleBlur}
        keyboardType={formula ? "default" : keyboardType}
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
        <Text className={COMPONENTS.input.error}>{error}</Text>
      )}
    </View>
  );
}
