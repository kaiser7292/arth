import { useCallback } from "react";
import { View, Text } from "react-native";
import { Input } from "@/components/ui";

interface AmountInputProps {
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  autoFocus?: boolean;
}

/** Enforce max 2 decimal places while typing. */
function cap2Decimals(text: string): string {
  const dotIndex = text.indexOf(".");
  if (dotIndex === -1) return text;
  return text.slice(0, dotIndex + 3); // keep at most 2 chars after dot
}

/**
 * Large prominent amount input with INR currency prefix.
 * Enforces max 2 decimal places during input.
 */
export function AmountInput({
  value,
  onChangeText,
  error,
  autoFocus,
}: AmountInputProps) {
  const handleChange = useCallback(
    (text: string) => onChangeText(cap2Decimals(text)),
    [onChangeText],
  );

  return (
    <View className="items-center mb-6">
      <Text className="text-sm text-text-secondary dark:text-text-dark-secondary mb-1">
        Amount
      </Text>
      <View className="flex-row items-center">
        <Text className="text-3xl font-bold text-text-tertiary mr-1">
          {"\u20B9"}
        </Text>
        <Input
          value={value}
          onChangeText={handleChange}
          placeholder="0"
          keyboardType="numeric"
          maxLength={15}
          error={error}
          className="text-3xl font-bold text-center min-w-[120px] border-0 bg-transparent px-0 py-0"
          autoFocus={autoFocus}
        />
      </View>
    </View>
  );
}
