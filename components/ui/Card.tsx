import { Platform, View } from "react-native";
import { trimEdgeDividers } from "./Rows";
import { Text } from "./Text";
import { Shadows } from "@/constants/theme";
import { COMPONENTS } from "@/constants/design-tokens";

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
      className={`${COMPONENTS.card.base} ${
        elevated && Platform.OS !== "android" ? "" : "border border-border"
      } ${className}`}
      style={elevated ? Shadows.card : undefined}
    >
      {title && (
        <Text className={COMPONENTS.card.title} accessibilityRole="header">
          {title}
        </Text>
      )}
      {trimEdgeDividers(children)}
    </View>
  );
}
