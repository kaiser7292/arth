import { Ionicons } from "@expo/vector-icons";
import { Badge } from "./Badge";

interface StatusPillProps {
  label: string;
  color: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

/**
 * The earlier name for Badge, kept so its call sites converge without being edited.
 *
 * It only ever took a raw colour, which is why it stayed at eight uses while about a hundred
 * pills were written inline: a caller who wanted "this is a warning" had to know which hex that
 * was in each colour scheme. New code should use Badge and name the role instead.
 *
 * Rendered at md, which is the size this always was.
 */
export function StatusPill({ label, color, icon }: StatusPillProps) {
  return <Badge label={label} color={color} icon={icon} size="md" />;
}
