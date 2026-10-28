import { View } from "react-native";
import { Text } from "@/components/ui";
import type { HouseholdMember } from "@/services/household/types";

/** "just now", "4 min ago", "3 h ago", "yesterday", "2 days ago". Takes SQLite or ISO times. */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "not yet";
  const t = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).getTime();
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** A household member's initial in their colour. */
export function Avatar({ member, size = 32 }: { member: Pick<HouseholdMember, "name" | "colour">; size?: number }) {
  const colour = member.colour ?? "#888780";
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${colour}26`, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={{ color: colour, fontWeight: "600", fontSize: size * 0.4 }}>{member.name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}
