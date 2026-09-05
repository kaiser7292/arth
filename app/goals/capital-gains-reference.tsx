import { View, Text, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ac, acAlpha } from "@/utils/accent";
import { StatusColors } from "@/constants/theme";
import {
  CAPITAL_GAINS_RATES,
  CAPITAL_GAINS_FY,
  type CapitalGainsRate,
} from "@/services/capital-gains";

function RateCard({ rate }: { rate: CapitalGainsRate }) {
  const { colors, accent, colorScheme } = useColorScheme();
  return (
    <Card className="mb-3">
      {/* Header */}
      <View className="flex-row items-center mb-3">
        <View className="w-10 h-10 rounded-full items-center justify-center mr-3" style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}>
          <Ionicons
            name={rate.icon as keyof typeof Ionicons.glyphMap}
            size={20}
            color={colors.blue}
          />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-bold text-foreground">
            {rate.assetClass}
          </Text>
          <Text className="text-xs text-muted-foreground">
            Holding period for LTCG: {rate.holdingPeriod}
          </Text>
        </View>
      </View>

      {/* Rates row */}
      <View className="flex-row mb-2">
        <View className="flex-1 items-center py-2 mr-1 rounded-lg" style={{ backgroundColor: StatusColors[colorScheme].successBg }}>
          <Text className="text-label font-semibold tracking-wider uppercase text-muted-foreground mb-0.5">
            LTCG
          </Text>
          <Text className="text-sm font-bold text-success">
            {rate.ltcgRate}
          </Text>
        </View>
        <View className="flex-1 items-center py-2 ml-1 rounded-lg" style={{ backgroundColor: StatusColors[colorScheme].dangerBg }}>
          <Text className="text-label font-semibold tracking-wider uppercase text-muted-foreground mb-0.5">
            STCG
          </Text>
          <Text className="text-sm font-bold text-danger">
            {rate.stcgRate}
          </Text>
        </View>
      </View>

      {/* Exemption */}
      {rate.exemption && (
        <View className="flex-row items-start mb-2 px-2 py-1.5 rounded-lg" style={{ backgroundColor: StatusColors[colorScheme].warningBg }}>
          <Ionicons
            name="shield-checkmark-outline"
            size={14}
            color={StatusColors[colorScheme].warning}
            style={{ marginTop: 1 }}
          />
          <Text className="text-xs text-muted-foreground ml-1.5 flex-1">
            {rate.exemption}
          </Text>
        </View>
      )}

      {/* Notes */}
      <Text className="text-xs text-faint-foreground leading-4">{rate.notes}</Text>
    </Card>
  );
}

export default function CapitalGainsReferenceScreen() {
  const { colors, accent, colorScheme } = useColorScheme();
  return (
    <ScreenContainer padTop={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View className="px-4 py-4">
          {/* Header */}
          <View className="items-center mb-4">
            <View className="w-14 h-14 rounded-full items-center justify-center mb-2" style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}>
              <Ionicons
                name="library-outline"
                size={28}
                color={colors.blue}
              />
            </View>
            <Text className="text-lg font-bold text-foreground">
              Capital Gains Tax Rates
            </Text>
            <View className="mt-1 px-3 py-1 rounded-full" style={{ backgroundColor: ac(accent, colorScheme, 50, 700) }}>
              <Text className="text-xs font-semibold" style={{ color: ac(accent, colorScheme, 500, 200) }}>
                FY {CAPITAL_GAINS_FY}
              </Text>
            </View>
          </View>

          {/* Disclaimer */}
          <View className="flex-row items-start mb-4 px-3 py-2.5 rounded-lg border border-border" style={{ backgroundColor: acAlpha(accent, 500, 0.08) }}>
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={colors.textSecondary}
              style={{ marginTop: 1 }}
            />
            <Text className="text-xs text-muted-foreground ml-2 flex-1 leading-4">
              This is a quick reference guide. Rates are as per Union Budget
              2024 and applicable for FY {CAPITAL_GAINS_FY}. Surcharge and cess
              apply on top. Consult a CA for specific tax advice.
            </Text>
          </View>

          {/* Rate Cards */}
          {CAPITAL_GAINS_RATES.map((rate) => (
            <RateCard key={rate.assetClass} rate={rate} />
          ))}

          {/* Key Terms */}
          <Card title="Key Terms" className="mb-3">
            <TermRow
              term="LTCG"
              definition="Long-Term Capital Gains - profit from selling an asset held beyond the specified period"
            />
            <TermRow
              term="STCG"
              definition="Short-Term Capital Gains - profit from selling an asset before the specified holding period"
            />
            <TermRow
              term="Slab rate"
              definition="Taxed at your personal income tax slab rate (depends on your taxable income and chosen regime)"
            />
            <TermRow
              term="Indexation"
              definition="Adjusting purchase price for inflation - removed for most assets post Budget 2024"
            />
            <TermRow
              term="STT"
              definition="Securities Transaction Tax - paid on stock exchange transactions; required for equity LTCG benefit"
            />
          </Card>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function TermRow({
  term,
  definition,
}: {
  term: string;
  definition: string;
}) {
  const { accent, colorScheme } = useColorScheme();
  return (
    <View className="flex-row items-start py-1.5">
      <Text className="text-xs font-bold w-20" style={{ color: ac(accent, colorScheme, 500, 200) }}>
        {term}
      </Text>
      <Text className="text-xs text-muted-foreground flex-1">
        {definition}
      </Text>
    </View>
  );
}
