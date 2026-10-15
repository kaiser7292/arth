import { forwardRef } from "react";
import { View } from "react-native";
import { Text } from "@/components/ui";
import { BRAND_RAMP } from "@/constants/brand";
import type { ShareLine } from "@/services/reports/year-review";

/**
 * The image that gets shared. Fixed brand colours (not the theme) so it looks
 * the same whether the sharer uses light or dark mode. Captured with
 * react-native-view-shot in app/insights/year-review.tsx.
 */
export const ShareCard = forwardRef<View, { fyLabel: string; lines: ShareLine[]; isComplete: boolean }>(
  function ShareCard({ fyLabel, lines, isComplete }, ref) {
    return (
      <View
        ref={ref}
        collapsable={false}
        style={{ backgroundColor: BRAND_RAMP[800], borderRadius: 20, padding: 22 }}
      >
        <Text style={{ color: BRAND_RAMP[200], fontSize: 12, fontWeight: "600", letterSpacing: 1.2 }}>
          {isComplete ? "MY YEAR IN REVIEW" : "MY YEAR SO FAR"}
        </Text>
        <Text style={{ color: "#FFFFFF", fontSize: 26, fontWeight: "800", marginTop: 4 }}>{fyLabel}</Text>
        <View style={{ marginTop: 16, flexDirection: "row", flexWrap: "wrap", marginHorizontal: -5 }}>
          {lines.map((l) => (
            <View key={l.label} style={{ width: "50%", padding: 5 }}>
              <View style={{ backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12, padding: 12, minHeight: 64 }}>
                <Text style={{ color: BRAND_RAMP[200], fontSize: 11 }}>{l.label}</Text>
                <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700", marginTop: 2 }} numberOfLines={2}>
                  {l.value}
                </Text>
              </View>
            </View>
          ))}
        </View>
        <Text style={{ color: BRAND_RAMP[200], fontSize: 11, marginTop: 14 }}>
          Tracked privately on my phone with Arth
        </Text>
      </View>
    );
  },
);
