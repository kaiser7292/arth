import { View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card, ScreenContainer, Text } from "@/components/ui";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";

interface InstrumentOption {
  key: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: (router: ReturnType<typeof useRouter>) => void;
}

const OPTIONS: InstrumentOption[] = [
  {
    key: "market",
    title: "Equity / Mutual Fund / Gold",
    subtitle: "A demat or broker account — value comes from snapshots you record",
    icon: "trending-up-outline",
    onPress: (router) => router.push({ pathname: "/settings/account-add", params: { presetType: "demat" } }),
  },
  {
    key: "contribution",
    title: "EPF / NPS / PPF",
    subtitle: "A pension or retirement account — value is your running contributions",
    icon: "briefcase-outline",
    onPress: (router) => router.push({ pathname: "/settings/account-add", params: { presetType: "pension" } }),
  },
  {
    key: "contract",
    title: "Fixed Deposit",
    subtitle: "Principal, rate, and a maturity date — value is computed from the schedule",
    icon: "calendar-outline",
    onPress: (router) => router.push("/investments/add-fd"),
  },
];

/** Instrument picker — the one entry point into every investment-add flow (docs/INVESTMENT_ACCOUNTS_PROPOSAL.md section 5). Each option reuses an existing form. */
export default function AddInvestmentPickerScreen() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const theme = useTheme();

  return (
    <ScreenContainer padTop={false}>
      <View className="px-4 pt-4">
        <Text className="text-sm text-muted-foreground mb-4">
          What kind of investment do you want to add?
        </Text>
        {OPTIONS.map((opt) => (
          <Pressable key={opt.key} onPress={() => opt.onPress(router)} className="mb-3">
            <Card>
              <View className="flex-row items-center">
                <View
                  className="w-10 h-10 rounded-full items-center justify-center mr-3"
                  style={{ backgroundColor: theme.alpha("primary", 0.08) }}
                >
                  <Ionicons name={opt.icon} size={20} color={theme.primary} />
                </View>
                <View className="flex-1 mr-2">
                  <Text className="text-sm font-semibold text-foreground">{opt.title}</Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">{opt.subtitle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              </View>
            </Card>
          </Pressable>
        ))}
      </View>
    </ScreenContainer>
  );
}
