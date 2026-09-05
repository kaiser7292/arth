import { View } from "react-native";
import { Text } from "./Text";
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
      className={`rounded-2xl bg-card p-5 ${
        elevated ? "" : "border border-border"
      } ${className}`}
      style={elevated ? Shadows.card : undefined}
    >
      {title && (
        <Text className="text-xs font-semibold tracking-wider uppercase text-muted-foreground mb-3" accessibilityRole="header">
          {title}
        </Text>
      )}
      {children}
    </View>
  );
}
