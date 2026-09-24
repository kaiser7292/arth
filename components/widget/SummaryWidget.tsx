import { FlexWidget, TextWidget } from "react-native-android-widget";
import type { ColorProp } from "react-native-android-widget";
import { SEMANTIC } from "@/constants/design-tokens";
import type { Scheme, SemanticRole } from "@/constants/design-tokens";
import { formatAmount } from "@/utils/format";

export interface SummaryWidgetData {
  toCatchUp: number;
  spentThisMonth: number;
}

/** Design-token channels ("15 118 110") → the rgba() form the widget renderer accepts. */
function tokenColor(scheme: Scheme, role: SemanticRole, alpha = 1): ColorProp {
  const [r, g, b] = SEMANTIC[scheme][role].split(/\s+/).map(Number);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Home-screen widget: "12 to catch up · ₹18,400 spent this month".
 *
 * Widgets render natively from a snapshot, not through NativeWind, so colours come straight
 * from the design tokens. Tapping the widget opens Catch Up (or Home when there's nothing to
 * review).
 */
export function SummaryWidget({ data, scheme }: { data: SummaryWidgetData | null; scheme: Scheme }) {
  const c = (role: SemanticRole, a?: number) => tokenColor(scheme, role, a);
  const hasItems = (data?.toCatchUp ?? 0) > 0;
  const uri = hasItems ? "artha://expense/catch-up" : "artha://";
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      accessibilityLabel={
        data ? `${data.toCatchUp} to catch up, ${formatAmount(data.spentThisMonth)} spent this month` : "Arth"
      }
      style={{
        height: "match_parent",
        width: "match_parent",
        backgroundColor: c("card"),
        borderRadius: 20,
        padding: 14,
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <TextWidget text="ARTH" style={{ fontSize: 11, color: c("mutedForeground"), fontWeight: "700", letterSpacing: 1 }} />
      {data ? (
        <FlexWidget style={{ flexDirection: "column", marginTop: 6 }}>
          <TextWidget
            text={hasItems ? `${data.toCatchUp} to catch up` : "All caught up"}
            style={{ fontSize: 18, fontWeight: "700", color: hasItems ? c("primary") : c("success") }}
          />
          <TextWidget
            text={`${formatAmount(data.spentThisMonth)} spent this month`}
            style={{ fontSize: 13, color: c("foreground"), marginTop: 2 }}
          />
        </FlexWidget>
      ) : (
        <TextWidget text="Open Arth to load" style={{ fontSize: 13, color: c("mutedForeground"), marginTop: 6 }} />
      )}
    </FlexWidget>
  );
}
