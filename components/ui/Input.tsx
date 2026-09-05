import { TextInput, View } from "react-native";
import { Text } from "./Text";
import type { TextInputProps } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { evaluateFormula, isFormulaMode, getFormulaExpr } from "@/utils/formula";
import { formatAmount } from "@/utils/format";

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
  const { colors, colorScheme } = useColorScheme();

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
        <Text className="text-xs font-semibold text-muted-foreground mb-1.5">
          {label}
        </Text>
      )}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={handleBlur}
        keyboardType={formula ? "default" : keyboardType}
        accessibilityLabel={label || props.placeholder}
        className={`rounded-lg border px-3 py-3 text-base text-foreground bg-card ${
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
          className="text-xs mt-1 ml-1"
          style={{ color: formulaValid ? colors.tint : "#EF4444" }}
        >
          {formulaValid
            ? `= ${formatAmount(formulaResult!)}`
            : "Invalid expression"}
        </Text>
      )}
      {/* Normal error (suppressed while formula preview is showing) */}
      {error && !inFormula && (
        <Text className="text-xs text-danger mt-1">{error}</Text>
      )}
    </View>
  );
}
