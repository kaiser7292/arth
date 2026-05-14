import { View, Text } from "react-native";
import { Shadows } from "@/constants/theme";

interface CardProps {
  title?: string;
  elevated?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Card({
  title,
  elevated = true,
  className = "",
  children,
}: CardProps) {
  return (
    <View
      className={`rounded-2xl bg-surface-light-alt dark:bg-surface-dark-alt p-5 ${
        elevated ? "" : "border border-border-light dark:border-border-dark"
      } ${className}`}
      style={elevated ? Shadows.card : undefined}
    >
      {title && (
        <Text className="text-xs font-semibold tracking-wider uppercase text-text-secondary dark:text-text-dark-secondary mb-3" accessibilityRole="header">
          {title}
        </Text>
      )}
      {children}
    </View>
  );
}
