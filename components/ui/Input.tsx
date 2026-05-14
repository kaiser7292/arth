import { TextInput, View, Text } from "react-native";
import type { TextInputProps } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerClassName?: string;
}

export function Input({
  label,
  error,
  containerClassName = "",
  className = "",
  ...props
}: InputProps) {
  const { colors } = useColorScheme();
  return (
    <View className={containerClassName}>
      {label && (
        <Text className="text-xs font-semibold text-text-secondary dark:text-text-dark-secondary mb-1.5">
          {label}
        </Text>
      )}
      <TextInput
        accessibilityLabel={label || props.placeholder}
        className={`rounded-lg border px-3 py-3 text-base text-text-primary dark:text-text-dark-primary bg-white dark:bg-surface-dark-alt ${
          error
            ? "border-danger"
            : "border-border-light dark:border-border-dark"
        } ${className}`}
        placeholderTextColor={colors.tabIconDefault}
        {...props}
      />
      {error && (
        <Text className="text-xs text-danger mt-1">{error}</Text>
      )}
    </View>
  );
}
