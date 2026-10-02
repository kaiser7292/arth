import { useEffect, useState } from "react";
import { Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, Text } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { formatAmount } from "@/utils/format";
import { DEFAULT_USER_ID } from "@/constants/app";
import { getFYStartMonth } from "@/services/settings";
import { getCurrentFY, getFYLabel } from "@/utils/fiscal-year";
import { getSelectableInvestmentBuckets, type InvestmentBucket } from "@/services/yearly-plan";
import { logger } from "@/utils/logger";

/**
 * Optional "count this towards an investment bucket" picker. Lists current-FY-onward buckets,
 * current year first (buckets across years can share a name). Renders nothing when there are
 * no buckets.
 */
export function BucketLinkPicker({
  value,
  onChange,
  className = "",
}: {
  value: string | null;
  onChange: (bucketId: string | null) => void;
  /** Applied to the card wrapper. */
  className?: string;
}) {
  const theme = useTheme();
  const [buckets, setBuckets] = useState<InvestmentBucket[]>([]);

  useEffect(() => {
    let cancelled = false;
    const startMonth = getFYStartMonth();
    const currentFY = String(getCurrentFY(startMonth));
    getSelectableInvestmentBuckets(DEFAULT_USER_ID)
      .then((list) => {
        if (cancelled) return;
        list.sort((a, b) => {
          const aCur = a.financial_year === currentFY ? 1 : 0;
          const bCur = b.financial_year === currentFY ? 1 : 0;
          if (aCur !== bCur) return bCur - aCur;
          return (b.financial_year ?? "").localeCompare(a.financial_year ?? "");
        });
        setBuckets(list);
      })
      .catch((e) => {
        logger.error("Load investment buckets failed:", e);
        if (!cancelled) setBuckets([]);
      });
    return () => { cancelled = true; };
  }, []);

  if (buckets.length === 0) return null;
  const startMonth = getFYStartMonth();

  const row = (id: string | null, icon: keyof typeof Ionicons.glyphMap, label: string, right?: string) => {
    const active = value === id;
    return (
      <Pressable
        key={id ?? "none"}
        onPress={() => onChange(id)}
        className="flex-row items-center py-2.5 px-2 rounded-lg"
        style={{ backgroundColor: active ? theme.alpha("primary", 0.1) : "transparent" }}
        accessibilityRole="radio"
        accessibilityState={{ selected: active }}
      >
        <Ionicons name={icon} size={16} color={active ? theme.primary : theme.mutedForeground} />
        <Text
          className={`flex-1 ml-2 text-sm text-foreground ${active ? "font-semibold" : ""}`}
          numberOfLines={1}
        >
          {label}
        </Text>
        {right ? <Text className="text-xs text-muted-foreground ml-2">{right}</Text> : null}
        {active && <Ionicons name="checkmark" size={16} color={theme.primary} style={{ marginLeft: 6 }} />}
      </Pressable>
    );
  };

  return (
    <Card className={className}>
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Count towards investment bucket (optional)
      </Text>
      {row(null, "close-circle-outline", "Don't link")}
      {buckets.map((b) => {
        const fy = parseInt(b.financial_year ?? "", 10);
        const name = Number.isFinite(fy) ? `${b.name} · ${getFYLabel(fy, startMonth)}` : b.name;
        return row(b.id, "bookmark-outline", name, `${formatAmount(b.current_contributed)} / ${formatAmount(b.annual_target)}`);
      })}
      <Text className="text-xs text-faint-foreground mt-1.5">
        The deposit counts as a contribution on its start date, and comes off the bucket when the FD
        matures.
      </Text>
    </Card>
  );
}
