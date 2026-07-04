import { useCallback } from "react";
import { View, Text } from "react-native";
import type { TextInputProps } from "react-native";
import { Input } from "@/components/ui";
import { evaluateFormula, isFormulaMode, getFormulaExpr } from "@/utils/formula";
import { formatAmount } from "@/utils/format";
import { useColorScheme } from "@/hooks/use-color-scheme";

interface AmountInputProps {
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  autoFocus?: boolean;
}

/** Enforce max 2 decimal places while typing (skipped in formula mode). */
function cap2Decimals(text: string): string {
  const dotIndex = text.indexOf(".");
  if (dotIndex === -1) return text;
  return text.slice(0, dotIndex + 3);
}

/**
 * Large prominent amount input with INR currency prefix.
 *
 * When the user types "=" as the first character, formula mode activates:
 * - Full keyboard shows (to allow +  -  *  /  (  ) operators)
 * - A live preview shows the evaluated result below
 * - On blur or pressing Done, the expression is evaluated and the field
 *   is replaced with the numeric result
 *
 * Supports full BODMAS precedence, parentheses, and % (postfix, = /100):
 *   =5000+2500        → 7500
 *   =10000*18%        → 1800
 *   =(1+18%)*5000     → 5900
 *   =50000-12500/2    → 43750
 */
export function AmountInput({
  value,
  onChangeText,
  error,
  autoFocus,
}: AmountInputProps) {
  const { colors } = useColorScheme();

  const inFormula = isFormulaMode(value);
  const formulaExpr = inFormula ? getFormulaExpr(value) : "";
  const hasExpr = formulaExpr.trim().length > 0;
  const formulaResult = hasExpr ? evaluateFormula(formulaExpr) : null;
  const formulaValid = formulaResult !== null;

  const evaluateAndCommit = useCallback(() => {
    if (inFormula && formulaValid) {
      onChangeText(String(formulaResult));
    }
  }, [inFormula, formulaValid, formulaResult, onChangeText]);

  const handleChange = useCallback(
    (text: string) => {
      if (isFormulaMode(text)) {
        // Formula mode: pass through as-is (no decimal cap)
        onChangeText(text);
      } else {
        onChangeText(cap2Decimals(text));
      }
    },
    [onChangeText],
  );

  const handleBlur = useCallback<NonNullable<TextInputProps["onBlur"]>>(
    () => { evaluateAndCommit(); },
    [evaluateAndCommit],
  );

  return (
    <View className="items-center mb-6">
      <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mb-1">
        Amount
      </Text>
      <View className="flex-row items-center">
        {/* ₹ prefix — dimmed in formula mode since user is typing an expression */}
        <Text
          className={`text-3xl font-bold mr-1 ${inFormula ? "text-text-tertiary dark:text-text-dark-tertiary" : "text-text-tertiary dark:text-text-dark-tertiary"}`}
        >
          {"₹"}
        </Text>
        <Input
          value={value}
          onChangeText={handleChange}
          onBlur={handleBlur}
          onSubmitEditing={evaluateAndCommit}
          placeholder={inFormula ? "expression…" : "0"}
          keyboardType="default"
          maxLength={inFormula ? 80 : 15}
          error={inFormula ? undefined : error}
          className={`text-3xl font-bold text-center border-0 bg-transparent px-0 py-0 ${
            inFormula ? "min-w-[200px]" : "min-w-[120px]"
          }`}
          autoFocus={autoFocus}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* Formula result preview */}
      {inFormula && hasExpr && (
        <Text
          className="text-base font-semibold mt-1"
          style={{ color: formulaValid ? colors.tint : "#EF4444" }}
        >
          {formulaValid
            ? `= ${formatAmount(formulaResult!)}`
            : "Invalid expression"}
        </Text>
      )}

      {/* Hint shown as soon as "=" is typed but expression is empty */}
      {inFormula && !hasExpr && (
        <Text className="text-xs text-text-tertiary dark:text-text-dark-tertiary mt-1">
          Type an expression, e.g. =5000+2500
        </Text>
      )}

      {/* Normal error (suppressed in formula mode) */}
      {error && !inFormula && (
        <Text className="text-xs text-danger mt-1">{error}</Text>
      )}
    </View>
  );
}
