import { useColorScheme } from "@/hooks/use-color-scheme";
import { Text } from "./Text";
import { getFlag } from "@/services/feature-flags";
import { ac } from "@/utils/accent";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";

/**
 * Inline chip that jumps into the help center, optionally scoped to a
 * context key. Renders as a small rounded pill so it slots under any
 * complex section without disrupting layout.
 *
 * Hidden when the v15_help_center flag is off.
 *
 * Example:
 *   <LearnMoreChip contextKey="review-queue" label="How reviews work" />
 */
interface Props {
  /** Optional context key — help center filters related articles first. */
  contextKey?: string;
  /** Label text. Default: "Learn more". */
  label?: string;
  /** Tight mode removes the rounded pill background — used in dense layouts. */
  subtle?: boolean;
}

export function LearnMoreChip({ contextKey, label = "Learn more", subtle = false }: Props) {
  const router = useRouter();
  const { accent, colorScheme } = useColorScheme();

  if (!getFlag("v15_help_center")) return null;

  const tint = ac(accent, colorScheme, 500, 200);
  const bg = tint + "14";

  const handlePress = () => {
    const href = contextKey
      ? `/settings/help?context=${encodeURIComponent(contextKey)}`
      : "/settings/help";
    router.push(href as never);
  };

  if (subtle) {
    return (
      <Pressable onPress={handlePress} className="flex-row items-center py-1" hitSlop={8}>
        <Ionicons name="help-circle-outline" size={14} color={tint} style={{ marginRight: 4 }} />
        <Text className="text-xs" style={{ color: tint }}>
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      className="self-start flex-row items-center rounded-full px-3 py-1.5"
      style={{ backgroundColor: bg }}
      hitSlop={6}
    >
      <Ionicons name="help-circle-outline" size={14} color={tint} style={{ marginRight: 4 }} />
      <Text className="text-xs font-medium" style={{ color: tint }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Variant that renders as a full-width row — useful at the bottom of a
 * settings section or next to an empty state.
 */
export function LearnMoreRow({ contextKey, label = "Learn more" }: Props) {
  const router = useRouter();
  const { accent, colorScheme } = useColorScheme();

  if (!getFlag("v15_help_center")) return null;

  const tint = ac(accent, colorScheme, 500, 200);

  const handlePress = () => {
    const href = contextKey
      ? `/settings/help?context=${encodeURIComponent(contextKey)}`
      : "/settings/help";
    router.push(href as never);
  };

  return (
    <Pressable
      onPress={handlePress}
      className="flex-row items-center py-3"
    >
      <Ionicons
        name="help-circle-outline"
        size={18}
        color={tint}
        style={{ marginRight: 8 }}
      />
      <Text className="flex-1 text-sm font-medium" style={{ color: tint }}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={colorScheme === 'dark' ? '#A0A0A0' : '#6B7280'} />
      <View />
    </Pressable>
  );
}
