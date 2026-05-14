import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { Card } from "./Card";
import { CollapsibleSection } from "./CollapsibleSection";

interface WidgetCardProps {
  title: string;
  storageKey: string;
  defaultExpanded?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  badge?: number;
  rightContent?: React.ReactNode;
  onClose?: () => void;
  className?: string;
  children: React.ReactNode;
}

export function WidgetCard({
  title,
  storageKey,
  defaultExpanded = true,
  icon,
  iconColor,
  badge,
  rightContent,
  onClose,
  className = "",
  children,
}: WidgetCardProps) {
  const { colors } = useColorScheme();
  const composedRightContent = (
    <View className="flex-row items-center">
      {rightContent}
      {onClose && (
        <Pressable
          onPress={onClose}
          className="ml-2 p-1"
          hitSlop={8}
        >
          <Ionicons name="close" size={14} color={colors.textSecondary} />
        </Pressable>
      )}
    </View>
  );

  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
      <Card className={className}>
        <CollapsibleSection
          title={title}
          storageKey={storageKey}
          defaultExpanded={defaultExpanded}
          icon={icon}
          iconColor={iconColor}
          badge={badge}
          rightContent={composedRightContent}
        >
          {children}
        </CollapsibleSection>
      </Card>
    </Animated.View>
  );
}
